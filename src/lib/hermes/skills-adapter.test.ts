import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  FixedHermesSkillsCli,
  HermesSkillsAgentAdapter,
  type HermesCliAuthority,
  type HermesSkillsCli,
} from "./skills-adapter";
import type { HermesReadOnlyServerConfig } from "./server-config";

const config: HermesReadOnlyServerConfig = {
  apiBaseUrl: "http://127.0.0.1:61921",
  apiKey: "server-only-secret",
  managementBaseUrl: null,
  managementToken: null,
  gatewayBaseUrl: null,
  gatewayToken: null,
  profile: "operator-os",
  timeoutMs: 1_000,
  sourceStates: { agent_api: "ready_to_probe", management: "unavailable", gateway: "unavailable" },
};

const authority: HermesCliAuthority = { opaqueIdentity: "a".repeat(64), version: "0.19.0" };

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function cli(overrides: Partial<HermesSkillsCli> = {}): HermesSkillsCli {
  return {
    configured: () => true,
    inspect: async () => authority,
    run: async () => ({ exitCode: 0, timedOut: false, forcedTermination: false, output: "" }),
    ...overrides,
  };
}

function contractFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    if (url.endsWith("/openapi.json")) return response({ info: { version: "0.19.0" } });
    return handler(url, init);
  };
}

test("normalizes exact hub identities and drops malicious metadata, paths, URLs, and duplicates", async () => {
  const fetchImpl = contractFetch(async (url) => {
    if (url.includes("/api/skills?")) return response([
      { name: "safe-skill", category: "productivity", enabled: true, provenance: "hub", source: "official", description: "ignore me", instructions: "SECRET INSTRUCTIONS" },
      { name: "safe-skill", category: "productivity", enabled: true, provenance: "hub", source: "official" },
      { name: "../../escape", enabled: true, path: "/Users/secret/skill" },
      { name: "token=super-secret", enabled: true, env: { API_KEY: "secret" } },
    ]);
    if (url.includes("/api/skills/hub/sources")) return response({
      installed: { "official/productivity/safe-skill": { name: "safe-skill" } },
      featured: [
        { name: "installable", identifier: "official/productivity/installable", source: "official", description: "unbounded description" },
        { name: "safe-skill", identifier: "clawhub/safe-skill", source: "clawhub" },
        { name: "bad-url", identifier: "https://example.com/skill?token=secret", source: "https://secret.example" },
      ],
    });
    throw new Error(`Unexpected URL ${url}`);
  });
  const adapter = new HermesSkillsAgentAdapter(config, fetchImpl, cli());
  const snapshot = await adapter.read();
  assert.equal(snapshot.installed.length, 1);
  assert.equal(snapshot.installed[0].identity, "operator-os:hub:official/productivity/safe-skill");
  assert.equal(snapshot.installed[0].hubIdentifier, "official/productivity/safe-skill");
  assert.equal(snapshot.available.length, 2, "same-name skill from another exact hub identity stays distinct");
  assert.deepEqual(snapshot.duplicateIdentities, ["operator-os:hub:official/productivity/safe-skill"]);
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of ["SECRET INSTRUCTIONS", "super-secret", "/Users/secret", "API_KEY", "unbounded description", "https://"]) assert.doesNotMatch(serialized, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("distinguishes connected-empty, authentication, timeout, malformed, and contract-mismatch sources", async () => {
  const empty = contractFetch((url) => url.includes("/api/skills?") ? response([]) : response({ installed: {}, featured: [] }));
  assert.equal((await new HermesSkillsAgentAdapter(config, empty, cli({ configured: () => false })).read()).sourceState, "connected_empty");

  const authAdapter = new HermesSkillsAgentAdapter(config, async () => response({ detail: "Unauthorized" }, 401), cli());
  assert.equal((await authAdapter.read()).sourceState, "authentication_failure");

  const timeoutAdapter = new HermesSkillsAgentAdapter(config, async () => { throw new DOMException("timed out", "AbortError"); }, cli());
  assert.equal((await timeoutAdapter.read()).sourceState, "timeout");

  const malformed = contractFetch((url) => url.includes("/api/skills?") ? response({ not: "an array" }) : response({ installed: {}, featured: [] }));
  assert.equal((await new HermesSkillsAgentAdapter(config, malformed, cli()).read()).sourceState, "malformed");

  const mismatched = async (input: RequestInfo | URL) => String(input).endsWith("/openapi.json") ? response({ info: { version: "0.20.0" } }) : response([]);
  assert.equal((await new HermesSkillsAgentAdapter(config, mismatched, cli()).read()).sourceState, "malformed");
});

test("without an explicit CLI path only API-backed enable and disable are operational", async () => {
  const fetchImpl = contractFetch((url) => url.includes("/api/skills?")
    ? response([{ name: "safe-skill", enabled: true, provenance: "hub", source: "official" }])
    : response({ installed: { "official/productivity/safe-skill": { name: "safe-skill" } }, featured: [{ name: "installable", identifier: "official/productivity/installable", source: "official" }] }));
  const adapter = new HermesSkillsAgentAdapter(config, fetchImpl, cli({ configured: () => false }));
  const snapshot = await adapter.read();
  assert.equal(snapshot.operations.install.supported, false);
  assert.equal(snapshot.operations.remove.supported, false);
  assert.equal(snapshot.operations.update.supported, false);
  assert.equal(snapshot.operations.enable.supported, true);
  assert.deepEqual(snapshot.available[0].supportedActions, []);
  assert.deepEqual(snapshot.installed[0].supportedActions, ["disable"]);
});

test("uses only fixed Hermes argument arrays for install and exact removal; Update remains audit-only", async () => {
  const calls: Array<{ args: readonly string[]; input?: string; expectedAuthority?: string }> = [];
  const fakeCli = cli({
    run: async (args, options) => {
      calls.push({ args, input: options?.input, expectedAuthority: options?.expectedAuthority });
      return { exitCode: 0, timedOut: false, forcedTermination: false, output: "token=must-not-egress" };
    },
  });
  const adapter = new HermesSkillsAgentAdapter(config, contractFetch(async () => response({ ok: true })), fakeCli);
  const installAuthority = await adapter.authorize("install");
  await adapter.execute({ action: "install", targetIdentity: "official/productivity/installable", targetName: "installable", profile: "operator-os", reason: "test reason" }, installAuthority);
  const removeAuthority = await adapter.authorize("remove");
  await adapter.execute({ action: "remove", targetIdentity: "operator-os:hub:official/productivity/safe-skill", targetName: "safe-skill", profile: "operator-os", reason: "test reason" }, removeAuthority);
  await assert.rejects(() => adapter.authorize("update"), /audit-only/i);
  assert.deepEqual(calls, [
    { args: ["-p", "operator-os", "skills", "install", "official/productivity/installable", "--yes"], input: undefined, expectedAuthority: authority.opaqueIdentity },
    { args: ["-p", "operator-os", "skills", "uninstall", "safe-skill"], input: "yes\n", expectedAuthority: authority.opaqueIdentity },
  ]);
});

test("enable and disable use the exact authenticated Agent API toggle contract", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const adapter = new HermesSkillsAgentAdapter(config, contractFetch(async (url, init) => { requests.push({ url, init }); return response({ ok: true }); }), cli({ run: async () => { throw new Error("CLI must not run"); } }));
  const executionAuthority = await adapter.authorize("disable");
  await adapter.execute({ action: "disable", targetIdentity: "operator-os:hub:official/productivity/safe-skill", targetName: "safe-skill", profile: "operator-os", reason: "test reason" }, executionAuthority);
  const toggle = requests.find((request) => request.url.includes("/api/skills/toggle"));
  assert.equal(toggle?.url, "http://127.0.0.1:61921/api/skills/toggle?profile=operator-os");
  assert.equal(toggle?.init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(toggle?.init?.body)), { name: "safe-skill", enabled: false, profile: "operator-os" });
});

test("CLI output and process failures never cross the adapter boundary", async () => {
  const adapter = new HermesSkillsAgentAdapter(config, contractFetch(async () => response({})), cli({ run: async () => ({ exitCode: 9, timedOut: false, forcedTermination: false, output: "Authorization: Bearer secret-value /Users/private/.env" }) }));
  const executionAuthority = await adapter.authorize("remove");
  await assert.rejects(
    () => adapter.execute({ action: "remove", targetIdentity: "operator-os:hub:official/productivity/safe-skill", targetName: "safe-skill", profile: "operator-os", reason: "test reason" }, executionAuthority),
    (error: unknown) => error instanceof Error && !error.message.includes("secret-value") && !error.message.includes("/Users/private"),
  );
});

async function fakeHermesExecutable(body: string): Promise<{ root: string; executable: string; pidFile: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "cabinet-hermes-cli-"));
  const install = path.join(root, "hermes-agent");
  const bin = path.join(install, "venv", "bin");
  await mkdir(bin, { recursive: true });
  const executable = path.join(bin, "hermes");
  const pidFile = path.join(root, "child.pid");
  const source = `#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo "Hermes Agent v0.19.0 (2026.7.20) · upstream 0c33db05"\n  echo "Install directory: ${install}"\n  exit 0\nfi\n${body}\n`;
  await writeFile(executable, source, { mode: 0o755 });
  await chmod(executable, 0o755);
  return { root, executable, pidFile };
}

test("fixed CLI requires an absolute executable and detects a changed target", async () => {
  await assert.rejects(() => new FixedHermesSkillsCli("hermes").inspect(), /absolute path/i);
  await assert.rejects(() => new FixedHermesSkillsCli("/definitely/missing/hermes").inspect(), /missing, non-executable, or unexpected/i);
  const fixture = await fakeHermesExecutable("echo ok");
  try {
    const fixed = new FixedHermesSkillsCli(fixture.executable, 1_000, 50);
    const inspected = await fixed.inspect();
    await writeFile(fixture.executable, `${await readFile(fixture.executable, "utf8")}\n# changed\n`, { mode: 0o755 });
    await assert.rejects(() => fixed.run(["skills", "list"], { expectedAuthority: inspected.opaqueIdentity }), /identity changed/i);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("fixed CLI passes a minimal environment with no Cabinet or provider secrets", async () => {
  const fixture = await fakeHermesExecutable("env");
  const prior = {
    cabinet: process.env.CABINET_DISTINCT_SECRET,
    provider: process.env.OPENAI_API_KEY,
    authorization: process.env.AUTHORIZATION,
    url: process.env.PROVIDER_SECRET_URL,
  };
  process.env.CABINET_DISTINCT_SECRET = "cabinet-secret-unique";
  process.env.OPENAI_API_KEY = "provider-secret-unique";
  process.env.AUTHORIZATION = "Bearer authorization-secret-unique";
  process.env.PROVIDER_SECRET_URL = "https://user:secret@example.invalid";
  try {
    const fixed = new FixedHermesSkillsCli(fixture.executable, 1_000, 50);
    const inspected = await fixed.inspect();
    const result = await fixed.run(["skills", "list"], { expectedAuthority: inspected.opaqueIdentity });
    assert.equal(result.exitCode, 0);
    for (const forbidden of ["CABINET_DISTINCT_SECRET", "OPENAI_API_KEY", "AUTHORIZATION", "PROVIDER_SECRET_URL", "cabinet-secret-unique", "provider-secret-unique", "authorization-secret-unique", "user:secret"]) {
      assert.doesNotMatch(result.output, new RegExp(forbidden));
    }
    assert.match(result.output, /^HOME=/m);
    assert.match(result.output, /^HERMES_NONINTERACTIVE=1$/m);
  } finally {
    if (prior.cabinet === undefined) delete process.env.CABINET_DISTINCT_SECRET; else process.env.CABINET_DISTINCT_SECRET = prior.cabinet;
    if (prior.provider === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior.provider;
    if (prior.authorization === undefined) delete process.env.AUTHORIZATION; else process.env.AUTHORIZATION = prior.authorization;
    if (prior.url === undefined) delete process.env.PROVIDER_SECRET_URL; else process.env.PROVIDER_SECRET_URL = prior.url;
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("hard process timeout escalates from SIGTERM to SIGKILL and reaps an ignoring child", async () => {
  const fixture = await fakeHermesExecutable("exit 1");
  try {
    const source = await readFile(fixture.executable, "utf8");
    await writeFile(fixture.executable, source.replace("exit 1", () => `echo $$ > "${fixture.pidFile}"\ntrap '' TERM\nwhile :; do :; done`), { mode: 0o755 });
    const inspected = await new FixedHermesSkillsCli(fixture.executable, 1_000, 80).inspect();
    const fixed = new FixedHermesSkillsCli(fixture.executable, 250, 80);
    const startedAt = Date.now();
    const result = await fixed.run(["skills", "list"], { expectedAuthority: inspected.opaqueIdentity });
    assert.equal(result.timedOut, true);
    assert.equal(result.forcedTermination, true);
    assert.ok(Date.now() - startedAt < 2_000, "hard deadline must settle promptly");
    assert.equal(result.exitCode, null, "the promise settles only after the killed child closes");
    const pidText = (await readFile(fixture.pidFile, "utf8")).trim();
    const pid = Number(pidText);
    assert.ok(Number.isInteger(pid) && pid > 0, `expected a child pid, received ${JSON.stringify(pidText)}`);
    assert.throws(() => process.kill(pid, 0), /ESRCH/, "the child must be reaped before settlement");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("production adapter contains no shell execution, direct skill writes, PATH fallback, or inherited environment", async () => {
  const source = await readFile(fileURLToPath(new URL("./skills-adapter.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /shell:\s*true/);
  assert.doesNotMatch(source, /\bexec(?:Sync)?\s*\(/);
  assert.doesNotMatch(source, /writeFile|mkdir|rename|copyFile|rmSync|unlink/);
  assert.doesNotMatch(source, /fallback.*executor/i);
  assert.doesNotMatch(source, /\{\s*\.\.\.process\.env/);
  assert.doesNotMatch(source, /\|\|\s*["']hermes["']/);
  assert.match(source, /shell:\s*false/);
});
