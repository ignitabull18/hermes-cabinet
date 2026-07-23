#!/usr/bin/env node

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PORT = 4311;
const APP_URL = `http://127.0.0.1:${PORT}`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const FIXTURE = path.join(HERE, "fixture-acp.mjs");
const INITIAL_TOKEN_CLASS = "initial-test-token";
const FOLLOW_UP_TOKEN_CLASS = "follow-up-test-token";
const OUTPUT_TOKEN_CLASS = "acceptance-token";
const FOLLOW_UP_DELAY_MS = Number(
  process.argv.find((value) => value.startsWith("--follow-up-delay-ms="))?.split("=")[1] ??
    "3500",
);
const OUTPUT_PATH =
  process.argv.find((value) => value.startsWith("--output="))?.slice("--output=".length) ??
  null;

function invariant(value, message) {
  if (!value) throw new Error(message);
}

async function portAvailable() {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => server.close(resolve));
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${APP_URL}/api/health`);
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      // Expected while the isolated process starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
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
  await portAvailable();
}

async function writeFixtureData(dataDir) {
  await fs.mkdir(path.join(dataDir, ".agents", ".config"), { recursive: true });
  await fs.mkdir(path.join(dataDir, ".home"), { recursive: true });
  await fs.mkdir(
    path.join(dataDir, "trace-room", ".agents", "editor"),
    { recursive: true },
  );
  await fs.writeFile(
    path.join(dataDir, ".cabinet"),
    "schemaVersion: 1\nid: home\nname: Trace Home\nkind: home\nentry: index.md\n",
  );
  await fs.writeFile(path.join(dataDir, "index.md"), "# Trace Home\n");
  await fs.writeFile(
    path.join(dataDir, ".agents", ".config", "workspace.json"),
    `${JSON.stringify({
      exists: true,
      version: 2,
      home: { name: "Trace Home" },
      room: { id: "trace-room", type: "office", name: "Trace Room", slug: "trace-room" },
      cabinet: { name: "Trace Room", description: "Synthetic trace fixture.", size: "" },
      setupDate: "2026-07-23T00:00:00.000Z",
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(dataDir, ".home", "home.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      kind: "home",
      defaultRoom: "trace-room",
      lastActiveRoom: "trace-room",
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(dataDir, "trace-room", ".cabinet"),
    "schemaVersion: 1\nid: trace-room\nname: Trace Room\nkind: room\nentry: index.md\n",
  );
  await fs.writeFile(
    path.join(dataDir, "trace-room", "index.md"),
    "# Trace Room\n",
  );
  await fs.writeFile(
    path.join(dataDir, "trace-room", ".agents", "editor", "persona.md"),
    [
      "---",
      "name: Trace Operator",
      "slug: editor",
      "type: specialist",
      "department: engineering",
      "role: Synthetic trace",
      "provider: hermes",
      "adapterType: hermes_runtime",
      "active: true",
      "setupComplete: true",
      "channels: [general]",
      "focus: []",
      "---",
      "",
      "Synthetic trace fixture.",
      "",
    ].join("\n"),
  );
}

async function jsonFetch(url, init, operation) {
  const response = await fetch(url, init);
  const body = await response.text();
  invariant(response.ok, `${operation} failed with HTTP ${response.status}`);
  return JSON.parse(body);
}

async function detail(conversationId) {
  return jsonFetch(
    `${APP_URL}/api/agents/conversations/${encodeURIComponent(conversationId)}?withTurns=1&cabinetPath=trace-room`,
    undefined,
    "conversation detail",
  );
}

async function waitForCompleted(conversationId) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const current = await detail(conversationId);
    if (current.meta.status === "completed") return current;
    invariant(
      current.meta.status !== "failed",
      `conversation failed (${current.meta.errorKind ?? "unclassified"})`,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("conversation completion timeout");
}

async function waitForCausalCompletion(conversationId, protocolLedgerPath) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const [current, protocol] = await Promise.all([
      detail(conversationId),
      readJsonLines(protocolLedgerPath),
    ]);
    const secondPromptCompleted = protocol.some(
      (event) => event.type === "prompt.completed" && event.requestOrdinal === 2,
    );
    const pendingAssistant = (current.turns ?? []).some(
      (turn) => turn.role === "agent" && turn.pending,
    );
    if (
      secondPromptCompleted &&
      !pendingAssistant &&
      (current.turns ?? []).filter((turn) => turn.role === "agent").length === 2
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("causal follow-up completion timeout");
}

async function readJsonLines(filePath) {
  try {
    return (await fs.readFile(filePath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function fileSnapshot(root) {
  const rows = [];
  async function walk(dir, relative = "") {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, childRelative);
      else {
        const stat = await fs.stat(full);
        rows.push([childRelative, stat.size, Math.trunc(stat.mtimeMs)]);
      }
    }
  }
  await walk(root);
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

async function waitForDurableBarrier(root) {
  let prior = await fileSnapshot(root);
  for (let stable = 0; stable < 3;) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const next = await fileSnapshot(root);
    if (next === prior) stable += 1;
    else stable = 0;
    prior = next;
  }
}

function classifyTurns(turns = []) {
  return turns.map((turn) => ({
    id: turn.id,
    turn: turn.turn,
    role: turn.role === "agent" ? "assistant" : turn.role,
    lifecycle: turn.pending ? "pending" : "final",
    fixedTokenClass:
      turn.role === "user"
        ? turn.turn === 1
          ? INITIAL_TOKEN_CLASS
          : FOLLOW_UP_TOKEN_CLASS
        : OUTPUT_TOKEN_CLASS,
    timestamp: turn.ts,
  }));
}

async function checkpoint(label, conversationId, dataDir, protocolLedgerPath) {
  const current = conversationId ? await detail(conversationId) : null;
  const turns = classifyTurns(current?.turns);
  const eventsPath = conversationId
    ? path.join(
        dataDir,
        "trace-room",
        ".agents",
        ".conversations",
        conversationId,
        "events.log",
      )
    : "";
  const events = conversationId ? await readJsonLines(eventsPath) : [];
  const protocol = await readJsonLines(protocolLedgerPath);
  const sessionId = current?.session?.resumeId ?? null;
  let processEpoch = 0;
  const promptRequests = protocol.flatMap((event) => {
    if (event.type === "initialize") processEpoch += 1;
    return event.type === "prompt.dispatch"
      ? [`process-${processEpoch}:request-${event.requestId}`]
      : [];
  });
  const completedPrompts = protocol.filter(
    (event) => event.type === "prompt.completed",
  ).length;
  const acceptedUserTurns = turns.filter((turn) => turn.role === "user").length;
  return {
    checkpoint: label,
    capturedAt: new Date().toISOString(),
    cabinetConversationId: conversationId,
    nativeSessionId: sessionId,
    turnIds: turns.map((turn) => turn.id),
    requestIds: promptRequests,
    conversationLifecycleState: current?.meta?.status ?? null,
    roles: turns.map((turn) => turn.role),
    lifecycleStates: turns.map((turn) => turn.lifecycle),
    sequenceNumbers: events.map((event) => event.seq),
    eventTypes: events.map((event) => event.type),
    durableStoreCounts: {
      conversations: conversationId ? 1 : 0,
      userTurns: turns.filter((turn) => turn.role === "user").length,
      assistantTurns: turns.filter((turn) => turn.role === "assistant").length,
      pendingAssistantTurns: turns.filter(
        (turn) => turn.role === "assistant" && turn.lifecycle === "pending",
      ).length,
      eventRows: events.length,
      nativeSessions: sessionId ? 1 : 0,
    },
    inMemoryCounts: {
      loadedTurns: turns.length,
      loadedUserTurns: turns.filter((turn) => turn.role === "user").length,
      loadedAssistantTurns: turns.filter((turn) => turn.role === "assistant").length,
    },
    timestamps: turns.map((turn) => turn.timestamp),
    pendingBackgroundOperations: Math.max(acceptedUserTurns - completedPrompts, 0),
    turns,
  };
}

async function main() {
  await portAvailable();
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cabinet-acp-trace-"));
  const dataDir = path.join(stateRoot, "data");
  const homeDir = path.join(stateRoot, "home");
  const envFile = path.join(stateRoot, "cabinet.env");
  const traceRoot = path.join(homeDir, ".acp-trace");
  const fixtureState = path.join(traceRoot, "fixture-state.json");
  const protocolLedger = path.join(traceRoot, "protocol-ledger.jsonl");
  await fs.mkdir(traceRoot, { recursive: true });
  await writeFixtureData(dataDir);
  await fs.writeFile(envFile, "", { mode: 0o600 });
  invariant(
    Number.isInteger(FOLLOW_UP_DELAY_MS) && FOLLOW_UP_DELAY_MS >= 0,
    "follow-up delay must be a non-negative integer",
  );
  await fs.writeFile(
    fixtureState,
    `${JSON.stringify({
      prompts: 0,
      sessionCreated: false,
      followUpDelayMs: FOLLOW_UP_DELAY_MS,
    })}\n`,
    { mode: 0o600 },
  );
  await fs.writeFile(protocolLedger, "", { mode: 0o600 });

  const logs = [];
  let app = null;
  const env = {
    ...process.env,
    HOME: homeDir,
    CABINET_DATA_DIR: dataDir,
    CABINET_ENV_FILE: envFile,
    CABINET_RUNTIME_MODE: "hermes",
    CABINET_TASK_RUNNER: "inprocess",
    CABINET_HERMES_EXECUTION_CLI_PATH: FIXTURE,
    CABINET_HERMES_EXECUTION_NO_TOOLS: "true",
    CABINET_HERMES_PROFILE: "trace-profile",
    CABINET_HERMES_INTERVENTIONS_ENABLED: "false",
    OLLAMA_API_KEY: "synthetic-fixture",
    KB_PASSWORD: "",
    NODE_ENV: "production",
    PORT: String(PORT),
  };
  const start = async () => {
    app = spawn("npx", ["next", "start", "-p", String(PORT)], {
      cwd: REPO,
      env,
      detached: true,
      stdio: "pipe",
    });
    app.stdout.on("data", (chunk) => logs.push(String(chunk)));
    app.stderr.on("data", (chunk) => logs.push(String(chunk)));
    await waitForHealth();
  };

  let conversationId = null;
  const ledger = [];
  try {
    await start();
    ledger.push(await checkpoint("A", null, dataDir, protocolLedger));
    const created = await jsonFetch(
      `${APP_URL}/api/agents/conversations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentSlug: "editor",
          source: "manual",
          userMessage: "INITIAL_TEST_TOKEN",
          cabinetPath: "trace-room",
          providerId: "hermes",
          adapterType: "hermes_runtime",
        }),
      },
      "initial submission",
    );
    conversationId = created.conversation?.id;
    invariant(conversationId, "initial submission returned no conversation identity");
    await waitForCompleted(conversationId);
    ledger.push(await checkpoint("B", conversationId, dataDir, protocolLedger));
    await waitForDurableBarrier(dataDir);
    ledger.push(await checkpoint("C", conversationId, dataDir, protocolLedger));

    await stop(app);
    await start();
    ledger.push(await checkpoint("D", conversationId, dataDir, protocolLedger));

    await jsonFetch(
      `${APP_URL}/api/agents/conversations/${encodeURIComponent(conversationId)}/continue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userMessage: "FOLLOW_UP_TEST_TOKEN",
          cabinetPath: "trace-room",
        }),
      },
      "follow-up submission",
    );
    for (let index = 0; index < 500; index += 1) {
      const current = await detail(conversationId);
      if ((current.turns ?? []).filter((turn) => turn.role === "user").length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const accepted = await checkpoint("E", conversationId, dataDir, protocolLedger);
    ledger.push(accepted);
    if (
      accepted.conversationLifecycleState === "completed" &&
      accepted.pendingBackgroundOperations > 0
    ) {
      ledger.push({
        ...accepted,
        checkpoint: "F",
        capturedAt: new Date().toISOString(),
      });
    } else {
      await waitForCompleted(conversationId);
      ledger.push(await checkpoint("F", conversationId, dataDir, protocolLedger));
    }
    await waitForCausalCompletion(conversationId, protocolLedger);
    await waitForDurableBarrier(dataDir);
    ledger.push(await checkpoint("G", conversationId, dataDir, protocolLedger));

    await stop(app);
    await start();
    ledger.push(await checkpoint("H", conversationId, dataDir, protocolLedger));

    const protocol = await readJsonLines(protocolLedger);
    const summary = {
      schemaVersion: 1,
      port: PORT,
      synthetic: true,
      syntheticFollowUpDelayMs: FOLLOW_UP_DELAY_MS,
      contentPolicy: "fixed-token-classification-only",
      checkpoints: ledger,
      protocolEvents: protocol,
      processLogClassification: logs.length > 0 ? "captured-not-persisted" : "empty",
    };
    const serialized = `${JSON.stringify(summary, null, 2)}\n`;
    if (OUTPUT_PATH) {
      const resolvedOutput = path.resolve(REPO, OUTPUT_PATH);
      invariant(
        resolvedOutput.startsWith(`${REPO}${path.sep}`),
        "output must remain inside the repository",
      );
      await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
      await fs.writeFile(resolvedOutput, serialized);
    }
    process.stdout.write(serialized);
  } finally {
    await stop(app).catch(() => undefined);
    await fs.rm(stateRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

await main();
