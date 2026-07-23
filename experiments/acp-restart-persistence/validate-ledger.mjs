#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ledgerPath = path.resolve(
  process.argv[2] ??
    "docs/research/parallel/acp-restart-persistence/ledger.json",
);
const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
const checkpoints = new Map(
  ledger.checkpoints.map((checkpoint) => [checkpoint.checkpoint, checkpoint]),
);

function counts(label, expected) {
  const checkpoint = checkpoints.get(label);
  assert.ok(checkpoint, `missing checkpoint ${label}`);
  assert.deepEqual(
    [
      checkpoint.durableStoreCounts.userTurns,
      checkpoint.durableStoreCounts.assistantTurns,
      checkpoint.durableStoreCounts.pendingAssistantTurns,
      checkpoint.durableStoreCounts.nativeSessions,
      checkpoint.pendingBackgroundOperations,
    ],
    expected,
    `unexpected ${label} cardinalities`,
  );
}

counts("A", [0, 0, 0, 0, 0]);
for (const label of ["B", "C", "D"]) counts(label, [1, 1, 0, 1, 0]);
for (const label of ["E", "F"]) counts(label, [2, 1, 0, 1, 1]);
for (const label of ["G", "H"]) counts(label, [2, 2, 0, 1, 0]);

assert.equal(checkpoints.get("E").conversationLifecycleState, "completed");
assert.equal(checkpoints.get("F").conversationLifecycleState, "completed");
assert.deepEqual(
  [...new Set(
    ledger.checkpoints
      .filter((checkpoint) => checkpoint.nativeSessionId)
      .map((checkpoint) => checkpoint.nativeSessionId),
  )],
  ["fixture-acp-session"],
);
assert.equal(
  ledger.protocolEvents.filter((event) => event.type === "prompt.dispatch").length,
  2,
);
assert.equal(
  ledger.protocolEvents.filter((event) => event.type === "session.load").length,
  1,
);
assert.equal(
  ledger.protocolEvents.find((event) => event.type === "session.load")
    ?.replayNotificationCount,
  0,
);
assert.equal(
  ledger.protocolEvents.filter(
    (event) => event.type === "assistant.chunk",
  ).length,
  2,
);

process.stdout.write("ACP persistence ledger validation passed\n");
