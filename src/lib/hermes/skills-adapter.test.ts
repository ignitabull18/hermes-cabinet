import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  AUDITED_HERMES_SOURCE_REVISION,
  FixedHermesSkillsCli,
  HermesSkillsAdapterError,
  HermesSkillsAgentAdapter,
  type HermesCliAuthority,
  type HermesSkillsCli,
  type HermesSkillsReadPolicies,
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

const authority: HermesCliAuthority = {
  opaqueIdentity: "a".repeat(64),
  version: "0.19.0",
  sourceRevision: AUDITED_HERMES_SOURCE_REVISION,
  schemaVersion: 1,
  installationId: "b".repeat(64),
};

const fastPolicies: HermesSkillsReadPolicies = {
  canonicalInstalled: { perAttemptTimeoutMs: 20, totalDeadlineMs: 45, maxAttempts: 2 },
  exactCandidate: { perAttemptTimeoutMs: 20, totalDeadlineMs: 45, maxAttempts: 2 },
  catalog: { perAttemptTimeoutMs: 20, totalDeadlineMs: 25, maxAttempts: 1 },
};

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function canonical(matches: unknown[] = []): unknown {
  const names = new Map<string, number>();
  for (const value of matches) {
    const name = String((value as { name?: unknown }).name ?? "");
    names.set(name, (names.get(name) ?? 0) + 1);
  }
  return {
    ambiguity_count: 0,
    contract: "hermes.skills.installed-state",
    exact_match_count: matches.filter((value) => (value as { origin?: unknown }).origin === "hub").length,
    matches,
    profile: "operator-os",
    same_name_collision_count: [...names.values()].reduce((total, count) => total + Math.max(0, count - 1), 0),
    schema_version: 2,
  };
}

const officialMatch = {
  authority_class: "official_public",
  enabled: true,
  identifier: "official/communication/one-three-one-rule",
  install_path: "communication/one-three-one-rule",
  installed: true,
  local_fulfillment: true,
  name: "one-three-one-rule",
  native_trust: "builtin",
  official: true,
  origin: "hub",
  public: true,
  source: "official",
};

const officialCatalog = {
  contract: "hermes.skills.catalog",
  object: "list",
  schema_version: 2,
  data: [{
    authority_class: "official_public",
    category: "communication",
    identifier: "official/communication/one-three-one-rule",
    local_fulfillment: true,
    name: "one-three-one-rule",
    native_trust: "builtin",
    official: true,
    public: true,
    source: "official",
  }],
};

function candidate(contract: "hermes.skills.candidate" | "hermes.skills.audit"): Record<string, unknown> {
  return {
    authority_class: "official_public",
    contract,
    ...(contract === "hermes.skills.audit" ? { finding_count: 0 } : {}),
    identifier: "official/communication/one-three-one-rule",
    local_fulfillment: true,
    name: "one-three-one-rule",
    native_trust: "builtin",
    official: true,
    prerequisite_classes: ["platform"],
    profile: "operator-os",
    public: true,
    schema_version: 2,
    source: "official",
    ...(contract === "hermes.skills.audit" ? { verdict: "safe" } : {}),
  };
}

function cliRouter(
  route: (args: readonly string[], call: number) => unknown = (args) => args.includes("list") ? canonical() : candidate(args.includes("audit") ? "hermes.skills.audit" : "hermes.skills.candidate"),
): HermesSkillsCli & { calls: Array<{ args: readonly string[]; skip?: boolean }>; inspections: number } {
  let call = 0;
  return {
    calls: [],
    inspections: 0,
    configured: () => true,
    inspect: async function () { this.inspections += 1; return authority; },
    run: async function (args, options) {
      this.calls.push({ args, skip: options?.skipExternalSecretSources });
      call += 1;
      const value = route(args, call);
      if (value instanceof Error) throw value;
      return { exitCode: 0, timedOut: false, forcedTermination: false, output: typeof value === "string" ? value : `${JSON.stringify(value)}\n` };
    },
  };
}

test("canonical installed state comes only from strict CLI JSON and preserves exact official provenance", async () => {
  const fakeCli = cliRouter((args) => args.includes("list") ? canonical([officialMatch]) : canonical());
  const urls: string[] = [];
  const adapter = new HermesSkillsAgentAdapter(config, async (input) => { urls.push(String(input)); return response({}); }, fakeCli, fastPolicies);
  const state = await adapter.readCanonicalInstalledState("operator-os");
  assert.equal(state.interface, "Canonical Hermes CLI installed-state JSON");
  assert.equal(state.installed.length, 1);
  assert.equal(state.installed[0].identity, "operator-os:hub:official/communication/one-three-one-rule");
  assert.deepEqual(state.installed[0].supportedActions, ["remove"]);
  assert.equal(state.installed[0].enabled, true);
  assert.deepEqual(urls, [], "canonical state must not touch Agent or Desktop HTTP routes");
  assert.deepEqual(fakeCli.calls, [{ args: ["-p", "operator-os", "skills", "list", "--json"], skip: true }]);
});

test("official catalog uses only authenticated Agent /v1/skills projection and never trusts it as installed state", async () => {
  const fakeCli = cliRouter();
  const urls: string[] = [];
  const adapter = new HermesSkillsAgentAdapter(config, async (input) => {
    urls.push(String(input));
    return response(officialCatalog);
  }, fakeCli, fastPolicies);
  const snapshot = await adapter.discoverCatalog("three");
  assert.equal(snapshot.available.length, 1);
  assert.deepEqual(snapshot.available[0].supportedActions, ["install"]);
  assert.equal(snapshot.operations.enable.supported, false);
  assert.equal(snapshot.operations.disable.supported, false);
  assert.equal(snapshot.operations.update.supported, false);
  assert.deepEqual(urls, ["http://127.0.0.1:61921/v1/skills?catalog=official"]);
  assert.doesNotMatch(JSON.stringify(snapshot), /description|prompt|manifest|https?:\/\//i);
});

test("exact candidate inspect and audit bind one identifier with safe zero-finding local official authority", async () => {
  const fakeCli = cliRouter();
  const adapter = new HermesSkillsAgentAdapter(config, async () => { throw new Error("HTTP must not run"); }, fakeCli, fastPolicies);
  const inspected = await adapter.inspectExactCandidate("official/communication/one-three-one-rule", "operator-os");
  assert.equal(inspected.identifier, "official/communication/one-three-one-rule");
  assert.equal(inspected.source, "official");
  assert.equal(inspected.nativeTrust, "builtin");
  assert.equal(inspected.authorityClass, "official_public");
  assert.equal(inspected.scanVerdict, "safe");
  assert.equal(inspected.findingCount, 0);
  assert.deepEqual(inspected.prerequisiteClasses, ["platform"]);
  assert.equal(inspected.prerequisiteClassification, "none_declared");
  assert.deepEqual(fakeCli.calls.map((call) => call.args), [
    ["-p", "operator-os", "skills", "inspect", "official/communication/one-three-one-rule", "--json"],
    ["-p", "operator-os", "skills", "audit", "official/communication/one-three-one-rule", "--json"],
  ]);
  assert.ok(fakeCli.calls.every((call) => call.skip === true));
});

test("malformed JSON, human output, extra fields, version drift, collisions, and provenance drift fail closed", async () => {
  const cases: unknown[] = [
    "Name: human table output",
    "{not-json}",
    { ...(canonical() as Record<string, unknown>), unexpected: "field" },
    { ...(canonical() as Record<string, unknown>), schema_version: 1 },
    canonical([{ ...officialMatch, identifier: null }]),
    { ...(canonical([officialMatch, { ...officialMatch, identifier: null, install_path: null, origin: "local", source: "local", native_trust: "local", authority_class: "unapproved", official: false, public: false }]) as Record<string, unknown>), same_name_collision_count: 0 },
    canonical([{ ...officialMatch, native_trust: "official" }]),
  ];
  for (const value of cases) {
    const adapter = new HermesSkillsAgentAdapter(config, async () => response({}), cliRouter(() => value), fastPolicies);
    await assert.rejects(() => adapter.readCanonicalInstalledState("operator-os"), HermesSkillsAdapterError);
  }
});

test("candidate mismatches and sensitive prerequisites block exact authority", async () => {
  const mismatch = cliRouter((args) => args.includes("audit") ? { ...candidate("hermes.skills.audit"), identifier: "official/other/skill" } : candidate("hermes.skills.candidate"));
  await assert.rejects(() => new HermesSkillsAgentAdapter(config, async () => response({}), mismatch, fastPolicies).inspectExactCandidate("official/communication/one-three-one-rule", "operator-os"), /disagree/i);

  const sensitive = cliRouter((args) => ({ ...candidate(args.includes("audit") ? "hermes.skills.audit" : "hermes.skills.candidate"), prerequisite_classes: ["credential"] }));
  const value = await new HermesSkillsAgentAdapter(config, async () => response({}), sensitive, fastPolicies).inspectExactCandidate("official/communication/one-three-one-rule", "operator-os");
  assert.equal(value.prerequisiteClassification, "declared");
});

test("execution authority and dispatch use only fixed CLI arrays; enable, disable, and update are unsupported", async () => {
  const fakeCli = cliRouter();
  const fetchCalls: string[] = [];
  const adapter = new HermesSkillsAgentAdapter(config, async (input) => { fetchCalls.push(String(input)); return response({}); }, fakeCli, fastPolicies);
  const install = await adapter.inspectExecutionAuthority("install", "operator-os");
  await adapter.execute({ action: "install", targetIdentity: "official/communication/one-three-one-rule", targetName: "one-three-one-rule", profile: "operator-os", reason: "governed test", skipExternalSecretSources: true }, install);
  const remove = await adapter.inspectExecutionAuthority("remove", "operator-os");
  await adapter.execute({ action: "remove", targetIdentity: "operator-os:hub:official/communication/one-three-one-rule", targetName: "one-three-one-rule", profile: "operator-os", reason: "governed test", skipExternalSecretSources: true }, remove);
  assert.deepEqual(fakeCli.calls.slice(-2).map((call) => call.args), [
    ["-p", "operator-os", "skills", "install", "official/communication/one-three-one-rule", "--yes"],
    ["-p", "operator-os", "skills", "uninstall", "official/communication/one-three-one-rule", "--yes"],
  ]);
  for (const action of ["enable", "disable", "update"] as const) await assert.rejects(() => adapter.inspectExecutionAuthority(action, "operator-os"), /only governed install and removal/i);
  assert.deepEqual(fetchCalls, []);
});

test("25 catalog, canonical, candidate, precondition, verification, and reconciliation simulations make zero Desktop requests", async () => {
  const forbidden: string[] = [];
  for (let index = 0; index < 25; index += 1) {
    const fakeCli = cliRouter((args) => args.includes("list") ? canonical(index % 2 ? [officialMatch] : []) : candidate(args.includes("audit") ? "hermes.skills.audit" : "hermes.skills.candidate"));
    const adapter = new HermesSkillsAgentAdapter(config, async (input) => {
      const url = String(input);
      if (/\/api\/skills|toggle|\/hub\//.test(url)) forbidden.push(url);
      return response(officialCatalog);
    }, fakeCli, fastPolicies);
    await adapter.discoverCatalog();
    await adapter.readCanonicalInstalledState("operator-os");
    await adapter.inspectExactCandidate("official/communication/one-three-one-rule", "operator-os");
  }
  assert.deepEqual(forbidden, []);
});

async function fakeHermesExecutable(body: string): Promise<{ root: string; executable: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "cabinet-hermes-cli-"));
  const install = path.join(root, "hermes-agent");
  const bin = path.join(install, "venv", "bin");
  await mkdir(bin, { recursive: true });
  const executable = path.join(bin, "hermes");
  const resolvedInstall = await realpath(install);
  const resolvedExecutable = path.join(resolvedInstall, "venv", "bin", "hermes");
  const identityCore = {
    entrypoint: resolvedExecutable, install_method: "git", installation_root: resolvedInstall,
    product: "Hermes Agent", python_executable: "/usr/bin/python3", release_date: "2026.7.20",
    schema: "hermes.cli.identity", schema_version: 1,
    source_revision: AUDITED_HERMES_SOURCE_REVISION, version: "0.19.0",
  };
  const identity = { ...identityCore, installation_id: createHash("sha256").update(JSON.stringify(identityCore)).digest("hex") };
  await writeFile(executable, `#!/bin/sh\nif [ "$1" = version ]; then printf '%s\\n' '${JSON.stringify(identity)}'; exit 0; fi\n${body}\n`, { mode: 0o755 });
  await chmod(executable, 0o755);
  return { root, executable };
}

test("fixed CLI pins exact companion identity, detects file drift, and passes a nonsecret minimal environment", async () => {
  const fixture = await fakeHermesExecutable("env");
  process.env.OPENAI_API_KEY = "must-not-egress";
  try {
    const fixed = new FixedHermesSkillsCli(fixture.executable, 1_000, 50);
    const inspected = await fixed.inspect();
    const result = await fixed.run(["skills", "list", "--json"], { expectedAuthority: inspected.opaqueIdentity, skipExternalSecretSources: true });
    assert.equal(result.exitCode, 0);
    assert.doesNotMatch(result.output, /OPENAI_API_KEY|must-not-egress/);
    assert.match(result.output, /HERMES_SKIP_EXTERNAL_SECRET_SOURCES=official-public-skills-v1/);
    await writeFile(fixture.executable, `${await readFile(fixture.executable, "utf8")}\n# drift\n`, { mode: 0o755 });
    await assert.rejects(() => fixed.run(["skills", "list", "--json"], { expectedAuthority: inspected.opaqueIdentity }), /identity changed/i);
  } finally {
    delete process.env.OPENAI_API_KEY;
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("production adapter contains no Desktop Management dependency, shell execution, human-output parser, direct writes, or inherited environment", async () => {
  const source = await readFile(fileURLToPath(new URL("./skills-adapter.ts", import.meta.url)), "utf8");
  for (const forbidden of [/\/api\/skills/, /toggle/, /\/hub\/(?:search|sources|preview|scan)/, /openapi\.json/, /shell:\s*true/, /\bexec(?:Sync)?\s*\(/, /writeFile|mkdir|rename|copyFile|rmSync|unlink/, /\{\s*\.\.\.process\.env/, /parse.*table|split.*column/i]) assert.doesNotMatch(source, forbidden);
  assert.match(source, /shell:\s*false/);
  assert.match(source, /\/v1\/skills\?catalog=official/);
});
