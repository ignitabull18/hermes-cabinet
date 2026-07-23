#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const PORT = 4301;
const PROMPT =
  "This is a local Cabinet transport diagnostic. Do not use tools or contact external systems. Reply with exactly CABINET_DIAGNOSTIC_OK.";
const referenceRoot = path.join(
  os.homedir(),
  "projects/worktrees/hermes-cabinet-integration/production-stabilization-v2",
);
const companion = path.join(
  os.homedir(),
  "projects/worktrees/hermes-agent-parallel-v2/acp/cabinet-hermes-acp-no-tools",
);
const experimentRoot = import.meta.dirname;

if (!process.argv.includes("--authorized-live") || !process.env.OLLAMA_API_KEY) {
  throw new Error("authorized non-displaying credential resolution is required");
}

async function waitForPortAvailable() {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => server.close(resolve));
  });
}

async function waitForHealth(url, timeoutMs = 90_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("isolated Cabinet did not become healthy");
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (child.pid) process.kill(-child.pid, "SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null && child.pid) process.kill(-child.pid, "SIGKILL");
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "acp-production-diagnostic-"));
const home = path.join(root, "home");
const data = path.join(root, "data");
const tracePath = path.join(root, "trace.jsonl");
const wrapperPath = path.join(root, "diagnostic-acp");
const resultPath = path.join(root, "result.json");
let app = null;
const startedAt = performance.now();

try {
  await waitForPortAvailable();
  await fs.mkdir(path.join(home, ".hermes-cabinet-acp"), { recursive: true });
  await fs.mkdir(path.join(data, ".agents", ".config"), { recursive: true });
  await fs.mkdir(path.join(data, ".home"), { recursive: true });
  await fs.mkdir(path.join(data, "diagnostic-cabinet", ".agents", "editor"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(home, ".hermes-cabinet-acp", "config.yaml"),
    "model:\n  default: glm-5.2\n  provider: ollama-cloud\n",
    { mode: 0o600 },
  );
  await fs.writeFile(path.join(root, "cabinet.env"), "", { mode: 0o600 });
  await fs.writeFile(
    path.join(data, ".cabinet"),
    "schemaVersion: 1\nid: home\nname: Diagnostic Home\nkind: home\nentry: index.md\n",
  );
  await fs.writeFile(path.join(data, "index.md"), "# Diagnostic Home\n");
  await fs.writeFile(
    path.join(data, ".agents", ".config", "workspace.json"),
    JSON.stringify({
      exists: true,
      version: 2,
      home: { name: "Diagnostic Home" },
      room: {
        id: "diagnostic-01",
        type: "office",
        name: "Diagnostic Cabinet",
        slug: "diagnostic-cabinet",
      },
      cabinet: { name: "Diagnostic Cabinet", description: "Isolated diagnostic." },
      setupDate: new Date().toISOString(),
    }),
  );
  await fs.writeFile(
    path.join(data, ".home", "home.json"),
    JSON.stringify({
      schemaVersion: 1,
      kind: "home",
      defaultRoom: "diagnostic-cabinet",
      lastActiveRoom: "diagnostic-cabinet",
    }),
  );
  await fs.writeFile(
    path.join(data, "diagnostic-cabinet", ".cabinet"),
    "schemaVersion: 1\nid: diagnostic-cabinet\nname: Diagnostic Cabinet\nkind: room\nentry: index.md\n",
  );
  await fs.writeFile(
    path.join(data, "diagnostic-cabinet", "index.md"),
    "# Diagnostic Cabinet\n",
  );
  await fs.writeFile(
    path.join(data, "diagnostic-cabinet", ".agents", "editor", "persona.md"),
    "---\nname: Operator\nslug: editor\ntype: specialist\ndepartment: engineering\nrole: Diagnostic operator\nprovider: hermes\nactive: true\nsetupComplete: true\nworkdir: /data\nworkspace: /\nchannels: [general]\nfocus: []\n---\n\nIsolated diagnostic fixture. Do not use tools.\n",
  );
  await fs.writeFile(
    wrapperPath,
    `#!/bin/sh\nexec "${process.execPath}" "${path.join(experimentRoot, "protocol-metadata-proxy.mjs")}" "${companion}" "${tracePath}"\n`,
    { mode: 0o700 },
  );

  const env = {
    PATH: process.env.PATH,
    HOME: home,
    LANG: process.env.LANG,
    OLLAMA_API_KEY: process.env.OLLAMA_API_KEY,
    CABINET_DATA_DIR: data,
    CABINET_ENV_FILE: path.join(root, "cabinet.env"),
    CABINET_RUNTIME_MODE: "hermes",
    CABINET_HERMES_EXECUTION_CLI_PATH: wrapperPath,
    CABINET_HERMES_EXECUTION_NO_TOOLS: "true",
    CABINET_HERMES_PROFILE: "operator-os",
    CABINET_HERMES_INTERVENTIONS_ENABLED: "false",
    CABINET_DAEMON_PORT: "4311",
    KB_PASSWORD: "",
    NODE_ENV: "production",
    PORT: String(PORT),
  };
  app = spawn(
    path.join(referenceRoot, "node_modules", ".bin", "next"),
    ["start", "-p", String(PORT)],
    {
      cwd: referenceRoot,
      env,
      detached: true,
      stdio: "ignore",
    },
  );
  await waitForHealth(`http://127.0.0.1:${PORT}/api/health`);

  const createStarted = performance.now();
  const create = await fetch(`http://127.0.0.1:${PORT}/api/agents/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentSlug: "editor",
      source: "manual",
      userMessage: PROMPT,
      cabinetPath: "diagnostic-cabinet",
    }),
  });
  if (!create.ok) throw new Error(`conversation create failed with HTTP ${create.status}`);
  const created = await create.json();
  const id = created.conversation?.id;
  if (!id) throw new Error("conversation identity missing");

  const deadline = performance.now() + 930_000;
  let final = null;
  while (performance.now() < deadline) {
    const response = await fetch(
      `http://127.0.0.1:${PORT}/api/agents/conversations/${encodeURIComponent(id)}?withTurns=1`,
    );
    if (!response.ok) throw new Error(`conversation detail failed with HTTP ${response.status}`);
    const detail = await response.json();
    if (detail.meta?.status === "completed" || detail.meta?.status === "failed") {
      final = detail;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const traceText = await fs.readFile(tracePath, "utf8").catch(() => "");
  const trace = traceText
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const diagnostic = {
    elapsedMs: Math.round((performance.now() - createStarted) * 10) / 10,
    totalElapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
    status: final?.meta?.status ?? "external_deadline",
    exitCode: Number.isInteger(final?.meta?.exitCode) ? final.meta.exitCode : null,
    errorKind: typeof final?.meta?.errorKind === "string" ? final.meta.errorKind : null,
    assistantTurnCount: Array.isArray(final?.turns)
      ? final.turns.filter((turn) => turn.role === "agent").length
      : 0,
    trace,
  };
  await fs.writeFile(resultPath, JSON.stringify(diagnostic, null, 2), { mode: 0o600 });
  process.stdout.write(`${resultPath}\n`);
} finally {
  await stop(app);
}
