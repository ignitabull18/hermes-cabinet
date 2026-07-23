import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import {
  DEFAULT_HERMES_ACP_DEADLINES,
  HermesAcpError,
  runHermesAcpTurn,
  shutdownHermesAcpClients,
} from "./acp-client";

process.env.OLLAMA_API_KEY = "fixture";
afterEach(shutdownHermesAcpClients);

async function fixtureExecutable(source: string): Promise<{ cliPath: string; cwd: string }> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cabinet-acp-test-"));
  const cliPath = path.join(cwd, "fixture-hermes");
  await fs.writeFile(cliPath, `#!${process.execPath}\n${source}`, { mode: 0o700 });
  return { cliPath, cwd };
}

const protocolFixture = String.raw`
if (process.env.HERMES_ACP_NO_TOOLS !== "1") process.exit(91);
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    const capabilities = message.params.clientCapabilities;
    if (capabilities.terminal !== false ||
        capabilities.fs.readTextFile !== false ||
        capabilities.fs.writeTextFile !== false) process.exit(92);
    send({ jsonrpc: "2.0", id: message.id, result: {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true }
    } });
  } else if (message.method === "session/new") {
    if (!Array.isArray(message.params.mcpServers) || message.params.mcpServers.length !== 0) {
      process.exit(93);
    }
    send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "fixture-session" } });
  } else if (message.method === "session/load") {
    if (!Array.isArray(message.params.mcpServers) || message.params.mcpServers.length !== 0) {
      process.exit(94);
    }
    send({ jsonrpc: "2.0", id: message.id, result: {} });
  } else if (message.method === "session/prompt") {
    const update = { jsonrpc: "2.0", method: "session/update", params: {
      sessionId: message.params.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "CABINET_ACCEPTANCE_OK" } }
    }};
    send(update);
    send(update);
    send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
  }
});
`;

test("ACP starts one durable session and suppresses duplicate stream frames", async () => {
  const fixture = await fixtureExecutable(protocolFixture);
  try {
    const deltas: string[] = [];
    const result = await runHermesAcpTurn({
      config: { cliPath: fixture.cliPath, profile: "operator-os", providerCredentialEnvName: "OLLAMA_API_KEY", noTools: true },
      cwd: fixture.cwd,
      prompt: "safe acceptance prompt",
      timeoutMs: 3_000,
      onDelta: (text) => { deltas.push(text); },
    });
    assert.equal(result.sessionId, "fixture-session");
    assert.equal(result.output, "CABINET_ACCEPTANCE_OK");
    assert.deepEqual(deltas, ["CABINET_ACCEPTANCE_OK"]);
    assert.equal(result.toolEventCount, 0);
  } finally {
    await fs.rm(fixture.cwd, { recursive: true, force: true });
  }
});

test("ACP gives initialization its measured 120-second deadline", () => {
  assert.equal(DEFAULT_HERMES_ACP_DEADLINES.initializationMs, 120_000);
  assert.notEqual(
    DEFAULT_HERMES_ACP_DEADLINES.initializationMs,
    DEFAULT_HERMES_ACP_DEADLINES.sessionMs,
  );
});

test("ACP keeps one official-SDK process across two same-session turns", async () => {
  const fixture = await fixtureExecutable(protocolFixture);
  const pids: number[] = [];
  try {
    const config = {
      cliPath: fixture.cliPath,
      profile: "operator-os",
      providerCredentialEnvName: "OLLAMA_API_KEY" as const,
      noTools: true as const,
    };
    const first = await runHermesAcpTurn({
      config,
      cwd: fixture.cwd,
      prompt: "first fixture turn",
      timeoutMs: 3_000,
      onSpawn: (child) => { pids.push(child.pid ?? 0); },
    });
    const second = await runHermesAcpTurn({
      config,
      cwd: fixture.cwd,
      prompt: "second fixture turn",
      sessionId: first.sessionId,
      timeoutMs: 3_000,
      onSpawn: (child) => { pids.push(child.pid ?? 0); },
    });
    assert.equal(second.sessionId, first.sessionId);
    assert.equal(pids.length, 2);
    assert.equal(pids[1], pids[0]);
  } finally {
    await fs.rm(fixture.cwd, { recursive: true, force: true });
  }
});

test("ACP reloads a persisted session after the Cabinet-side pool restarts", async () => {
  const fixture = await fixtureExecutable(protocolFixture);
  const pids: number[] = [];
  try {
    const config = {
      cliPath: fixture.cliPath,
      profile: "operator-os",
      providerCredentialEnvName: "OLLAMA_API_KEY" as const,
      noTools: true as const,
    };
    const first = await runHermesAcpTurn({
      config,
      cwd: fixture.cwd,
      prompt: "first fixture turn",
      timeoutMs: 3_000,
      onSpawn: (child) => { pids.push(child.pid ?? 0); },
    });
    await shutdownHermesAcpClients();
    const second = await runHermesAcpTurn({
      config,
      cwd: fixture.cwd,
      prompt: "second fixture turn",
      sessionId: first.sessionId,
      timeoutMs: 3_000,
      onSpawn: (child) => { pids.push(child.pid ?? 0); },
    });
    assert.equal(second.sessionId, first.sessionId);
    assert.notEqual(pids[1], pids[0]);
  } finally {
    await fs.rm(fixture.cwd, { recursive: true, force: true });
  }
});

test("ACP serializes concurrent turns without duplicate dispatch", async () => {
  const fixture = await fixtureExecutable(protocolFixture.replace(
    'send(update);\n    send(update);\n    send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });',
    `if (global.activePrompt) process.exit(95);
    global.activePrompt = true;
    setTimeout(() => {
      send(update);
      send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
      global.activePrompt = false;
    }, 25);`,
  ));
  const pids: number[] = [];
  try {
    const config = {
      cliPath: fixture.cliPath,
      profile: "operator-os",
      providerCredentialEnvName: "OLLAMA_API_KEY" as const,
      noTools: true as const,
    };
    const results = await Promise.all([
      runHermesAcpTurn({
        config,
        cwd: fixture.cwd,
        prompt: "queued one",
        timeoutMs: 3_000,
        onSpawn: (child) => { pids.push(child.pid ?? 0); },
      }),
      runHermesAcpTurn({
        config,
        cwd: fixture.cwd,
        prompt: "queued two",
        timeoutMs: 3_000,
        onSpawn: (child) => { pids.push(child.pid ?? 0); },
      }),
    ]);
    assert.deepEqual(results.map((result) => result.output), [
      "CABINET_ACCEPTANCE_OK",
      "CABINET_ACCEPTANCE_OK",
    ]);
    assert.equal(new Set(pids).size, 1);
  } finally {
    await fs.rm(fixture.cwd, { recursive: true, force: true });
  }
});

test("ACP passes only the strict no-tools process allowlist", async () => {
  process.env.CABINET_SECRET_SENTINEL = "must-not-cross";
  const fixture = await fixtureExecutable(`
if (process.env.CABINET_SECRET_SENTINEL) process.exit(96);
${protocolFixture}
`);
  try {
    const result = await runHermesAcpTurn({
      config: {
        cliPath: fixture.cliPath,
        profile: "operator-os",
        providerCredentialEnvName: "OLLAMA_API_KEY",
        noTools: true,
      },
      cwd: fixture.cwd,
      prompt: "environment fixture",
      timeoutMs: 3_000,
    });
    assert.equal(result.output, "CABINET_ACCEPTANCE_OK");
  } finally {
    delete process.env.CABINET_SECRET_SENTINEL;
    await fs.rm(fixture.cwd, { recursive: true, force: true });
  }
});

test("ACP reports the exact pre-dispatch initialization timeout owner", async () => {
  const fixture = await fixtureExecutable(`
setTimeout(() => {}, 5_000);
`);
  const trace: Array<{ stage: string; elapsedMs: number; deadlineMs?: number }> = [];
  try {
    await assert.rejects(
      runHermesAcpTurn({
        config: {
          cliPath: fixture.cliPath,
          profile: "operator-os",
          providerCredentialEnvName: "OLLAMA_API_KEY",
          noTools: true,
          deadlines: { initializationMs: 20, shutdownMs: 20 },
        },
        cwd: fixture.cwd,
        prompt: "must not dispatch",
        timeoutMs: 500,
        onTrace: (event) => { trace.push(event); },
      }),
      (error: unknown) => error instanceof HermesAcpError
        && error.kind === "timeout"
        && error.stage === "initialization"
        && error.promptDispatched === false,
    );
    assert.equal(
      trace.find((event) => event.stage === "acp_initialize_started")?.deadlineMs,
      20,
    );
    assert.ok(trace.some((event) => event.stage === "shutdown"));
    assert.ok(trace.every((event, index) =>
      index === 0 || event.elapsedMs >= trace[index - 1].elapsedMs));
  } finally {
    await fs.rm(fixture.cwd, { recursive: true, force: true });
  }
});

test("ACP reports session creation timeout separately from initialization", async () => {
  const fixture = await fixtureExecutable(protocolFixture.replace(
    'send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "fixture-session" } });',
    "return;",
  ));
  try {
    await assert.rejects(
      runHermesAcpTurn({
        config: {
          cliPath: fixture.cliPath,
          profile: "operator-os",
          providerCredentialEnvName: "OLLAMA_API_KEY",
          noTools: true,
          deadlines: { sessionMs: 20, shutdownMs: 20 },
        },
        cwd: fixture.cwd,
        prompt: "must not dispatch",
        timeoutMs: 500,
      }),
      (error: unknown) => error instanceof HermesAcpError
        && error.kind === "timeout"
        && error.stage === "session_create"
        && error.promptDispatched === false,
    );
  } finally {
    await fs.rm(fixture.cwd, { recursive: true, force: true });
  }
});

test("ACP preserves native session identity after a post-dispatch first-event timeout", async () => {
  const fixture = await fixtureExecutable(protocolFixture.replace(
    'const update = { jsonrpc: "2.0", method: "session/update", params: {',
    'return; const update = { jsonrpc: "2.0", method: "session/update", params: {',
  ));
  try {
    await assert.rejects(
      runHermesAcpTurn({
        config: {
          cliPath: fixture.cliPath,
          profile: "operator-os",
          providerCredentialEnvName: "OLLAMA_API_KEY",
          noTools: true,
          deadlines: { promptFirstEventMs: 20, shutdownMs: 20 },
        },
        cwd: fixture.cwd,
        prompt: "dispatched once",
        timeoutMs: 500,
      }),
      (error: unknown) => error instanceof HermesAcpError
        && error.kind === "timeout"
        && error.stage === "prompt_first_event"
        && error.promptDispatched === true
        && error.sessionId === "fixture-session",
    );
  } finally {
    await fs.rm(fixture.cwd, { recursive: true, force: true });
  }
});

test("ACP distinguishes total completion timeout after a first event", async () => {
  const fixture = await fixtureExecutable(protocolFixture.replace(
    'send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });',
    "return;",
  ));
  try {
    await assert.rejects(
      runHermesAcpTurn({
        config: {
          cliPath: fixture.cliPath,
          profile: "operator-os",
          providerCredentialEnvName: "OLLAMA_API_KEY",
          noTools: true,
          deadlines: { promptFirstEventMs: 100, shutdownMs: 20 },
        },
        cwd: fixture.cwd,
        prompt: "dispatched once",
        timeoutMs: 30,
      }),
      (error: unknown) => error instanceof HermesAcpError
        && error.kind === "timeout"
        && error.stage === "prompt_total"
        && error.promptDispatched === true
        && error.sessionId === "fixture-session",
    );
  } finally {
    await fs.rm(fixture.cwd, { recursive: true, force: true });
  }
});

test("ACP does not retry a crashed turn and may restart only for a future request", async () => {
  const fixture = await fixtureExecutable(`
const fs = require("node:fs");
const path = require("node:path");
const marker = path.join(process.cwd(), ".first-process-crashed");
${protocolFixture.replace(
    'const update = { jsonrpc: "2.0", method: "session/update", params: {',
    `if (!fs.existsSync(marker)) {
      fs.writeFileSync(marker, "fixture");
      process.exit(97);
    }
    const update = { jsonrpc: "2.0", method: "session/update", params: {`,
  )}
`);
  const pids: number[] = [];
  const config = {
    cliPath: fixture.cliPath,
    profile: "operator-os",
    providerCredentialEnvName: "OLLAMA_API_KEY" as const,
    noTools: true as const,
    deadlines: { shutdownMs: 20 },
  };
  try {
    await assert.rejects(
      runHermesAcpTurn({
        config,
        cwd: fixture.cwd,
        prompt: "crash once",
        timeoutMs: 500,
        onSpawn: (child) => { pids.push(child.pid ?? 0); },
      }),
      (error: unknown) => error instanceof HermesAcpError
        && error.kind === "transport"
        && error.promptDispatched === true,
    );
    assert.equal(pids.length, 1);

    const next = await runHermesAcpTurn({
      config,
      cwd: fixture.cwd,
      prompt: "future request",
      timeoutMs: 500,
      onSpawn: (child) => { pids.push(child.pid ?? 0); },
    });
    assert.equal(next.output, "CABINET_ACCEPTANCE_OK");
    assert.equal(pids.length, 2);
    assert.notEqual(pids[1], pids[0]);
  } finally {
    await fs.rm(fixture.cwd, { recursive: true, force: true });
  }
});

test("ACP loads the stored session before a follow-up", async () => {
  const fixture = await fixtureExecutable(protocolFixture);
  try {
    const result = await runHermesAcpTurn({
      config: { cliPath: fixture.cliPath, profile: "operator-os", providerCredentialEnvName: "OLLAMA_API_KEY", noTools: true },
      cwd: fixture.cwd,
      prompt: "follow-up",
      sessionId: "fixture-session",
      timeoutMs: 3_000,
    });
    assert.equal(result.sessionId, "fixture-session");
    assert.equal(result.output, "CABINET_ACCEPTANCE_OK");
  } finally {
    await fs.rm(fixture.cwd, { recursive: true, force: true });
  }
});

test("ACP fails closed on malformed output without exposing it", async () => {
  const fixture = await fixtureExecutable(`process.stdout.write("not-json" + String.fromCharCode(10)); setTimeout(() => {}, 5000);`);
  try {
    await assert.rejects(
      runHermesAcpTurn({
        config: { cliPath: fixture.cliPath, profile: "operator-os", providerCredentialEnvName: "OLLAMA_API_KEY", noTools: true },
        cwd: fixture.cwd,
        prompt: "safe acceptance prompt",
        timeoutMs: 3_000,
      }),
      (error: unknown) => error instanceof HermesAcpError && error.kind === "protocol" && !error.message.includes("not-json"),
    );
  } finally {
    await fs.rm(fixture.cwd, { recursive: true, force: true });
  }
});

test("ACP rejects any tool event in no-tools mode", async () => {
  const fixture = await fixtureExecutable(protocolFixture.replace(
    'const update = { jsonrpc: "2.0", method: "session/update", params: {',
    'const update = { jsonrpc: "2.0", method: "session/update", params: {',
  ).replace(
    'update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "CABINET_ACCEPTANCE_OK" } }',
    'update: { sessionUpdate: "tool_call", toolCallId: "forbidden", title: "forbidden" }',
  ));
  try {
    await assert.rejects(
      runHermesAcpTurn({
        config: { cliPath: fixture.cliPath, profile: "operator-os", providerCredentialEnvName: "OLLAMA_API_KEY", noTools: true },
        cwd: fixture.cwd,
        prompt: "safe acceptance prompt",
        timeoutMs: 1_000,
      }),
      (error: unknown) => error instanceof HermesAcpError && error.kind === "tool_event",
    );
  } finally {
    await fs.rm(fixture.cwd, { recursive: true, force: true });
  }
});

test("ACP refuses to spawn when the no-tools invariant is false at runtime", async () => {
  const fixture = await fixtureExecutable("require('node:fs').writeFileSync('spawned', 'yes');");
  try {
    await assert.rejects(
      runHermesAcpTurn({
        config: {
          cliPath: fixture.cliPath,
          profile: "operator-os",
          providerCredentialEnvName: "OLLAMA_API_KEY",
          noTools: false,
        } as never,
        cwd: fixture.cwd,
        prompt: "must not run",
        timeoutMs: 1_000,
      }),
      (error: unknown) => error instanceof HermesAcpError && error.kind === "configuration",
    );
    await assert.rejects(fs.access(path.join(fixture.cwd, "spawned")));
  } finally {
    await fs.rm(fixture.cwd, { recursive: true, force: true });
  }
});

test("a partial assistant chunk followed by a tool event cannot complete successfully", async () => {
  const fixture = await fixtureExecutable(protocolFixture.replace(
    'send(update);\n    send(update);',
    `send(update);
    send({ jsonrpc: "2.0", method: "session/update", params: {
      sessionId: message.params.sessionId,
      update: { sessionUpdate: "tool_call", toolCallId: "sentinel", title: "sentinel" }
    }});`,
  ));
  const deltas: string[] = [];
  try {
    await assert.rejects(
      runHermesAcpTurn({
        config: { cliPath: fixture.cliPath, profile: "operator-os", providerCredentialEnvName: "OLLAMA_API_KEY", noTools: true },
        cwd: fixture.cwd,
        prompt: "safe acceptance prompt",
        timeoutMs: 1_000,
        onDelta: (text) => { deltas.push(text); },
      }),
      (error: unknown) => error instanceof HermesAcpError && error.kind === "tool_event",
    );
    assert.deepEqual(deltas, ["CABINET_ACCEPTANCE_OK"]);
  } finally {
    await fs.rm(fixture.cwd, { recursive: true, force: true });
  }
});
