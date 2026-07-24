import assert from "node:assert/strict";
import test from "node:test";

import { conversationTurnToTaskTurn } from "./conversation-to-task-view";

test("conversation turn projection preserves failed assistant lifecycle metadata", () => {
  const projected = conversationTurnToTaskTurn({
    id: "failed-assistant",
    turn: 2,
    role: "agent",
    ts: "2026-07-23T00:00:04.000Z",
    content: "The persisted failure response.",
    sessionId: "stable-native-session",
    exitCode: 1,
    error: "The response failed.",
  });

  assert.equal(projected.role, "agent");
  assert.equal(projected.content, "The persisted failure response.");
  assert.equal(projected.sessionId, "stable-native-session");
  assert.equal(projected.exitCode, 1);
  assert.equal(projected.error, "The response failed.");
});
