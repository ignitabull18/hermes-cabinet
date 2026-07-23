#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const SESSION_ID = "fixture-acp-session";
const ACCEPTANCE_TOKEN = "FIXTURE_TOKEN";
const traceRoot = path.join(process.env.HOME ?? "", ".acp-trace");
const statePath = path.join(traceRoot, "fixture-state.json");
const ledgerPath = path.join(traceRoot, "protocol-ledger.jsonl");

if (!process.env.HOME) process.exit(2);

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return { prompts: 0, sessionCreated: false };
  }
}

function writeState(state) {
  fs.writeFileSync(statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
}

function record(event) {
  fs.appendFileSync(
    ledgerPath,
    `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
    { mode: 0o600 },
  );
}

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      record({ type: "initialize", requestId: message.id });
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { protocolVersion: 1 },
      });
      continue;
    }
    if (message.method === "session/new") {
      const state = readState();
      state.sessionCreated = true;
      writeState(state);
      record({
        type: "session.new",
        requestId: message.id,
        sessionId: SESSION_ID,
        mcpServerCount: Array.isArray(message.params?.mcpServers)
          ? message.params.mcpServers.length
          : -1,
      });
      send({ jsonrpc: "2.0", id: message.id, result: { sessionId: SESSION_ID } });
      continue;
    }
    if (message.method === "session/load") {
      const state = readState();
      const matches =
        state.sessionCreated === true && message.params?.sessionId === SESSION_ID;
      record({
        type: "session.load",
        requestId: message.id,
        sessionId: message.params?.sessionId ?? null,
        identityMatches: matches,
        replayNotificationCount: 0,
        mcpServerCount: Array.isArray(message.params?.mcpServers)
          ? message.params.mcpServers.length
          : -1,
      });
      if (!matches) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32001, message: "session unavailable" },
        });
      } else {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
      }
      continue;
    }
    if (message.method === "session/prompt") {
      const state = readState();
      state.prompts += 1;
      writeState(state);
      const requestOrdinal = state.prompts;
      record({
        type: "prompt.dispatch",
        requestId: message.id,
        requestOrdinal,
        sessionId: message.params?.sessionId ?? null,
        fixedTokenClass: "acceptance-token",
      });
      const completePrompt = () => {
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: ACCEPTANCE_TOKEN },
            },
          },
        });
        record({
          type: "assistant.chunk",
          requestOrdinal,
          sessionId: SESSION_ID,
          sequence: 1,
          fixedTokenClass: "acceptance-token",
        });
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: { stopReason: "end_turn" },
        });
        record({
          type: "prompt.completed",
          requestOrdinal,
          sessionId: SESSION_ID,
          sequence: 2,
        });
      };
      const responseDelayMs =
        requestOrdinal === 2 && Number.isInteger(state.followUpDelayMs)
          ? state.followUpDelayMs
          : 0;
      if (responseDelayMs > 0) {
        record({
          type: "synthetic.response_delay",
          requestOrdinal,
          sessionId: SESSION_ID,
          durationMs: responseDelayMs,
        });
        setTimeout(completePrompt, responseDelayMs);
      } else {
        completePrompt();
      }
      continue;
    }
    if (message.method === "session/cancel") {
      record({
        type: "session.cancel",
        sessionId: message.params?.sessionId ?? null,
      });
    }
  }
});
