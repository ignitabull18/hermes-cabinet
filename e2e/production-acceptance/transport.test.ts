import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationPersistenceEvidence } from "./contracts";
import {
  buildConversationCheckpoint,
  LiveCabinetAcpTransport,
} from "./transport";

test("content-free checkpoint records exact cardinality and duplicate identities", () => {
  const checkpoint = buildConversationCheckpoint(
    "H",
    "second_restart_reloaded",
    {
      meta: { id: "conversation-private", status: "completed" },
      session: { resumeId: "session-private", alive: false },
      turns: [
        { id: "u1", turn: 1, role: "user", content: "private" },
        { id: "a1", turn: 1, role: "agent", content: "private" },
        { id: "u2", turn: 2, role: "user", content: "private" },
        { id: "a2", turn: 2, role: "agent", content: "private" },
      ],
      persistence: {
        pendingRequiredWrites: 0,
        inMemoryCounts: { user: 2, assistant: 2, completedAssistant: 2, total: 4 },
      },
    },
    null,
  );

  assert.deepEqual(checkpoint.durableStoreCounts, {
    user: 2,
    assistant: 2,
    completedAssistant: 2,
    total: 4,
    duplicateTurnIdentities: 0,
  });
  assert.equal(checkpoint.pendingRequiredWrites, 0);
  assert.doesNotMatch(JSON.stringify(checkpoint), /private/);
});

test("pending and failed assistant lifecycle states are preserved without content", () => {
  const checkpoint = buildConversationCheckpoint(
    "E",
    "follow_up_accepted",
    {
      meta: { id: "conversation", status: "running" },
      turns: [
        { id: "u2", turn: 2, role: "user", content: "hidden" },
        { id: "a2", turn: 2, role: "agent", content: "", pending: true },
        { id: "a3", turn: 3, role: "agent", content: "hidden", exitCode: 1 },
      ],
    },
    "follow-up",
  );

  assert.deepEqual(
    checkpoint.turns.map((turn) => turn.lifecycleState),
    ["completed", "pending", "failed"],
  );
  assert.doesNotMatch(JSON.stringify(checkpoint), /hidden/);
});

test("failed cardinality still exports the complete diagnostic ledger", async () => {
  const originalFetch = globalThis.fetch;
  const completedDetail = {
    meta: { id: "conversation-private", status: "completed" },
    session: { resumeId: "session-private", alive: false },
    turns: [
      { id: "u1", turn: 1, role: "user", content: "hidden" },
      { id: "a1", turn: 1, role: "agent", content: "CABINET_ACCEPTANCE_OK" },
      { id: "u2", turn: 2, role: "user", content: "hidden" },
    ],
  };
  let postCount = 0;
  let restarts = 0;
  const capture: { evidence: ConversationPersistenceEvidence | null } = {
    evidence: null,
  };
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "POST") {
      postCount += 1;
      return Response.json(
        postCount === 1
          ? { conversation: { id: "conversation-private", status: "running" } }
          : { ok: true },
      );
    }
    return Response.json(completedDetail);
  };
  try {
    await assert.rejects(
      new LiveCabinetAcpTransport().runTwoTurnContract(
        {
          appUrl: "http://127.0.0.1:4314",
          restart: async () => {
            restarts += 1;
          },
        },
        (value) => {
          capture.evidence = value;
        },
      ),
      /exactly two user and two assistant turns/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(restarts, 2);
  const evidence = capture.evidence;
  assert.ok(evidence);
  assert.equal(evidence?.checkpoints.length, 8);
  assert.equal(evidence?.checkpoints.at(-1)?.checkpoint, "H");
  assert.equal(evidence?.exactFinalCardinality, false);
  assert.equal(evidence?.modelRequestCount, 2);
  assert.doesNotMatch(JSON.stringify(evidence), /hidden|private/);
});
