import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCEPTANCE_FOLLOW_UP,
  ACCEPTANCE_PROMPT,
  PersistentAcpSdkProbe,
  type ProbeTurnResult,
} from "./probe.js";

function bounded(turn: ProbeTurnResult) {
  return {
    outputMatches: turn.output === "CABINET_TRANSPORT_OK",
    sessionId: turn.sessionId,
    stopReason: turn.stopReason,
    processId: turn.processId,
    metrics: turn.metrics,
  };
}

async function runAcceptance(probe: PersistentAcpSdkProbe, verifyRestart = false) {
  const sessionId = await probe.newSession();
  const first = await probe.prompt(sessionId, ACCEPTANCE_PROMPT);
  const second = await probe.prompt(sessionId, ACCEPTANCE_FOLLOW_UP);
  const processBeforeRestart = probe.processId;
  let restartLoad = false;
  let processAfterRestart: number | null = null;
  if (verifyRestart) {
    await probe.restartAndLoad(sessionId);
    processAfterRestart = probe.processId;
    restartLoad = processAfterRestart !== null && processAfterRestart !== processBeforeRestart;
  }
  return {
    protocolVersion: 1,
    sameSession: first.sessionId === second.sessionId,
    sameProcess: first.processId === second.processId,
    zeroToolEvents: first.metrics.toolEventCount + second.metrics.toolEventCount === 0,
    restartLoad,
    processChangedOnRestart: verifyRestart
      ? processAfterRestart !== processBeforeRestart
      : null,
    first: bounded(first),
    second: bounded(second),
  };
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cabinet-acp-sdk-fixture-"));
  const fixtureAgent = fileURLToPath(new URL("./fixture-agent.mjs", import.meta.url));
  const probe = new PersistentAcpSdkProbe({
    command: process.execPath,
    args: [fixtureAgent],
    cwd: root,
    timeoutMs: 5_000,
    environment: { ACP_FIXTURE_STATE: path.join(root, "sessions.json") },
  });
  try {
    console.log(JSON.stringify(await runAcceptance(probe), null, 2));
  } finally {
    await probe.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function live() {
  if (!process.argv.includes("--authorized-live")) {
    throw new Error("Refusing live model use without --authorized-live.");
  }
  const command = process.env.HERMES_ACP_COMMAND;
  const cwd = process.env.HERMES_ACP_CWD;
  if (!command || !cwd || !path.isAbsolute(command) || !path.isAbsolute(cwd)) {
    throw new Error("HERMES_ACP_COMMAND and HERMES_ACP_CWD must be absolute paths.");
  }
  const args = JSON.parse(process.env.HERMES_ACP_ARGS_JSON || "[]");
  if (!Array.isArray(args) || !args.every((value) => typeof value === "string")) {
    throw new Error("HERMES_ACP_ARGS_JSON must be a JSON string array.");
  }
  const probe = new PersistentAcpSdkProbe({
    command,
    args,
    cwd,
    timeoutMs: 120_000,
  });
  try {
    const result = await runAcceptance(probe, true);
    console.log(JSON.stringify(result, null, 2));
    if (
      !result.first.outputMatches ||
      !result.second.outputMatches ||
      !result.sameSession ||
      !result.sameProcess ||
      !result.zeroToolEvents ||
      !result.restartLoad
    ) {
      process.exitCode = 1;
    }
  } finally {
    await probe.stop();
  }
}

const mode = process.argv[2];
if (mode === "fixture") await fixture();
else if (mode === "live") await live();
else throw new Error("Usage: cli.js fixture | live --authorized-live");
