import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCEPTANCE_FOLLOW_UP,
  ACCEPTANCE_PROMPT,
  AcpProbeError,
  PersistentAcpSdkProbe,
} from "../src/probe.js";

const fixtureAgent = fileURLToPath(new URL("../src/fixture-agent.mjs", import.meta.url));
const probes: PersistentAcpSdkProbe[] = [];
const roots: string[] = [];

async function makeProbe(mode = "normal", timeoutMs = 2_000) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cabinet-acp-sdk-test-"));
  roots.push(root);
  const probe = new PersistentAcpSdkProbe({
    command: process.execPath,
    args: [fixtureAgent],
    cwd: root,
    timeoutMs,
    environment: {
      ACP_FIXTURE_MODE: mode,
      ACP_FIXTURE_STATE: path.join(root, "sessions.json"),
    },
  });
  probes.push(probe);
  return probe;
}

afterEach(async () => {
  await Promise.all(probes.splice(0).map((probe) => probe.stop()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test("one persistent official-SDK connection supports exact two-turn acceptance", async () => {
  const probe = await makeProbe();
  const sessionId = await probe.newSession();
  const first = await probe.prompt(sessionId, ACCEPTANCE_PROMPT);
  const second = await probe.prompt(sessionId, ACCEPTANCE_FOLLOW_UP);
  assert.equal(first.output, "CABINET_TRANSPORT_OK");
  assert.equal(second.output, "CABINET_TRANSPORT_OK");
  assert.equal(first.sessionId, second.sessionId);
  assert.equal(first.processId, second.processId);
  assert.equal(first.metrics.toolEventCount + second.metrics.toolEventCount, 0);
  assert.ok(first.metrics.startupLatencyMs >= 0);
  assert.ok(first.metrics.firstTokenLatencyMs !== null);
  assert.ok(first.metrics.totalLatencyMs >= first.metrics.firstTokenLatencyMs);
});

test("browser-style client reconnect does not replace the persistent ACP process", async () => {
  const probe = await makeProbe();
  const sessionId = await probe.newSession();
  const first = await probe.prompt(sessionId, "turn one");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await probe.prompt(sessionId, "turn two");
  assert.equal(first.processId, second.processId);
  assert.equal(second.output, "fixture-turn-2");
});

test("identical chunks are detected and excluded from assembled output", async () => {
  const probe = await makeProbe("duplicate");
  const sessionId = await probe.newSession();
  const result = await probe.prompt(sessionId, "duplicate");
  assert.equal(result.output, "fixture-turn-1");
  assert.equal(result.metrics.duplicateEventCount, 1);
});

test("forbidden tool events fail the turn", async () => {
  const probe = await makeProbe("tool");
  const sessionId = await probe.newSession();
  await assert.rejects(
    probe.prompt(sessionId, "tool"),
    (error: unknown) => error instanceof AcpProbeError && error.kind === "tool_event",
  );
});

test("malformed frames are rejected by the official SDK", async () => {
  const probe = await makeProbe("malformed", 300);
  const sessionId = await probe.newSession();
  await assert.rejects(
    probe.prompt(sessionId, "malformed", 300),
    (error: unknown) => error instanceof AcpProbeError && error.kind === "protocol",
  );
  assert.equal(probe.diagnostics.protocolParseErrors, 1);
});

test("timeout sends ACP session cancellation", async () => {
  const probe = await makeProbe("hang", 100);
  const sessionId = await probe.newSession();
  await assert.rejects(
    probe.prompt(sessionId, "hang", 100),
    (error: unknown) => error instanceof AcpProbeError && error.kind === "timeout",
  );
  assert.equal(probe.diagnostics.cancellationCount, 1);
});

test("process death is a transport error", async () => {
  const probe = await makeProbe("death");
  const sessionId = await probe.newSession();
  await assert.rejects(
    probe.prompt(sessionId, "die"),
    (error: unknown) => error instanceof AcpProbeError && error.kind === "transport",
  );
});

test("persisted session loads after ACP process restart", async () => {
  const probe = await makeProbe();
  const sessionId = await probe.newSession();
  const first = await probe.prompt(sessionId, "before restart");
  await probe.restartAndLoad(sessionId);
  const second = await probe.prompt(sessionId, "after restart");
  assert.notEqual(first.processId, second.processId);
  assert.equal(second.sessionId, sessionId);
  assert.equal(second.output, "fixture-turn-2");
});
