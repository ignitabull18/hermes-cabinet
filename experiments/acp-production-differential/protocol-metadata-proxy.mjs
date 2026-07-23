#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import { performance } from "node:perf_hooks";

const [companion, tracePath] = process.argv.slice(2);
if (!companion || !tracePath) {
  process.exit(64);
}

const startedAt = performance.now();
let nextSequence = 0;
let firstNotification = false;
let firstAssistantChunk = false;
const pendingByDirection = {
  client_to_agent: "",
  agent_to_client: "",
};
const requestStages = new Map();

function trace(stage, detail = {}) {
  const record = {
    sequence: ++nextSequence,
    elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
    stage,
    ...detail,
  };
  fs.appendFileSync(tracePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

function classify(line, direction) {
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    trace("protocol_parse_error", { direction });
    return;
  }
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return;
  const method = typeof frame.method === "string" ? frame.method : null;
  if (direction === "client_to_agent") {
    if (method === "initialize") {
      trace("acp_initialize_started");
      requestStages.set(frame.id, "acp_initialize_completed");
    }
    if (method === "session/new") {
      trace("session_create_started");
      requestStages.set(frame.id, "session_create_completed");
    }
    if (method === "session/load") {
      trace("session_load_started");
      requestStages.set(frame.id, "session_load_completed");
    }
    if (method === "session/prompt") {
      trace("prompt_dispatched");
      requestStages.set(frame.id, "final_result");
    }
    if (method === "session/cancel") trace("cancellation_sent");
    return;
  }

  if (method === "session/update") {
    if (!firstNotification) {
      firstNotification = true;
      trace("first_notification");
    }
    const update = frame.params?.update;
    if (
      !firstAssistantChunk
      && update?.sessionUpdate === "agent_message_chunk"
      && update?.content?.type === "text"
    ) {
      firstAssistantChunk = true;
      trace("first_assistant_chunk");
    }
    return;
  }
  if (!Object.hasOwn(frame, "id")) return;
  const completion = requestStages.get(frame.id);
  if (completion) trace(completion);
  requestStages.delete(frame.id);
}

function inspectChunks(stream, direction) {
  stream.on("data", (chunk) => {
    pendingByDirection[direction] += chunk.toString("utf8");
    let newline = pendingByDirection[direction].indexOf("\n");
    while (newline >= 0) {
      const line = pendingByDirection[direction].slice(0, newline).trim();
      pendingByDirection[direction] = pendingByDirection[direction].slice(newline + 1);
      if (line) classify(line, direction);
      newline = pendingByDirection[direction].indexOf("\n");
    }
  });
}

trace("child_spawn_started");
const child = spawn(companion, [], {
  cwd: process.cwd(),
  env: process.env,
  shell: false,
  stdio: ["pipe", "pipe", "pipe"],
});
child.once("spawn", () => trace("child_spawn_completed"));
child.once("error", () => trace("child_spawn_failed"));

inspectChunks(process.stdin, "client_to_agent");
inspectChunks(child.stdout, "agent_to_client");
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

const terminate = (signal) => {
  trace("shutdown", { signal });
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
};
process.once("SIGTERM", () => terminate("SIGTERM"));
process.once("SIGINT", () => terminate("SIGINT"));
child.once("exit", (code, signal) => {
  trace("child_exit", {
    exitCode: Number.isInteger(code) ? code : null,
    signal: signal ?? null,
  });
  process.exitCode = Number.isInteger(code) ? code : signal ? 1 : 0;
});
