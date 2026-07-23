#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline";
import { randomUUID } from "node:crypto";

const mode = process.env.ACP_FIXTURE_MODE || "normal";
const statePath = process.env.ACP_FIXTURE_STATE;
const sessions = statePath && fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, "utf8"))
  : {};
const pending = new Map();

function persist() {
  if (statePath) fs.writeFileSync(statePath, JSON.stringify(sessions));
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function response(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params = {} } = message;
  if (method === "initialize") {
    response(id, {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
      agentInfo: { name: "fixture-agent", version: "1" },
    });
    return;
  }
  if (method === "session/new") {
    if (!Array.isArray(params.mcpServers) || params.mcpServers.length !== 0) {
      error(id, -32602, "MCP servers forbidden");
      return;
    }
    if (process.env.HERMES_ACP_NO_TOOLS !== "1") {
      error(id, -32602, "no-tools environment missing");
      return;
    }
    const sessionId = `fixture-${randomUUID()}`;
    sessions[sessionId] = { turns: 0, cwd: params.cwd };
    persist();
    response(id, { sessionId });
    return;
  }
  if (method === "session/load") {
    if (!sessions[params.sessionId]) {
      error(id, -32000, "session not found");
      return;
    }
    response(id, {});
    return;
  }
  if (method === "session/prompt") {
    if (!sessions[params.sessionId]) {
      error(id, -32000, "session not found");
      return;
    }
    if (mode === "death") process.exit(23);
    if (mode === "malformed") {
      process.stdout.write("{ definitely-not-json }\n");
      return;
    }
    if (mode === "hang") {
      pending.set(params.sessionId, id);
      return;
    }
    if (mode === "tool") {
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "forbidden",
            title: "forbidden",
            kind: "other",
            status: "pending",
            content: [],
            locations: [],
          },
        },
      });
    }
    sessions[params.sessionId].turns += 1;
    persist();
    const promptText = params.prompt?.[0]?.text || "";
    const text = promptText.includes("previous response")
      ? "CABINET_TRANSPORT_OK"
      : promptText.includes("local Cabinet transport acceptance test")
        ? "CABINET_TRANSPORT_OK"
        : `fixture-turn-${sessions[params.sessionId].turns}`;
    const update = {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      },
    };
    send(update);
    if (mode === "duplicate") send(update);
    response(id, { stopReason: "end_turn" });
    return;
  }
  if (method === "session/cancel") {
    const promptId = pending.get(params.sessionId);
    if (promptId !== undefined) {
      pending.delete(params.sessionId);
      response(promptId, { stopReason: "cancelled" });
    }
    return;
  }
  if (id !== undefined) error(id, -32601, "method not found");
});
