import assert from "node:assert/strict";
import test from "node:test";

import type {
  AcceptanceConversationObservation,
  ConversationCheckpointEvidence,
  ConversationPersistenceEvidence,
} from "./contracts";
import { assertLiveConversationEvidence } from "./conversation-gate";
import {
  assertPendingRequiredWritesDrained,
  normalizePendingRequiredWrites,
  pendingWriteLedger,
} from "./pending-required-writes";

function observation(pendingRequiredWrites: unknown): AcceptanceConversationObservation {
  return {
    contract: "cabinet.acceptance.conversation-observability",
    schemaVersion: 1,
    conversationIdentity: "conversation-hash",
    nativeSessionIdentity: "session-hash",
    conversationStatus: "completed",
    turnIdentities: [],
    requestIdentities: [],
    durableStoreCounts: {
      user: 2,
      assistant: 2,
      running: 0,
      failed: 0,
      completed: 4,
      completedAssistant: 2,
      total: 4,
    },
    inMemoryCounts: {
      user: 2,
      assistant: 2,
      running: 0,
      failed: 0,
      completed: 4,
      completedAssistant: 2,
      total: 4,
    },
    inMemoryCountSource: "post_flush_projection",
    pendingRequiredWrites,
    acpChildState: "running",
    readinessState: "ready",
    provider: "ollama-cloud",
    model: "glm-5.2",
    modelRequestsAttempted: 1,
    providerRetries: 0,
    fallbackAttempts: 0,
    toolEventCount: 0,
    decisionEventCount: 0,
    duplicateChunkCount: 0,
    mcpServerCount: 0,
    lastProviderHttpStatus: "2xx",
    lastFailureClass: "none",
  } as AcceptanceConversationObservation;
}

test("normalizes authoritative zero and positive integer values", () => {
  assert.deepEqual(
    normalizePendingRequiredWrites({ legacy: undefined, observability: observation(0) }),
    {
      state: "known",
      value: 0,
      source: "acceptance_observability",
      legacyState: "absent",
    },
  );
  assert.deepEqual(
    normalizePendingRequiredWrites({ legacy: undefined, observability: observation(3) }),
    {
      state: "known",
      value: 3,
      source: "acceptance_observability",
      legacyState: "absent",
    },
  );
});

test("fails closed for absent, null, malformed, and negative authoritative values", () => {
  const absent = observation(0) as unknown as Record<string, unknown>;
  delete absent.pendingRequiredWrites;
  assert.deepEqual(
    normalizePendingRequiredWrites({
      legacy: undefined,
      observability: absent as unknown as AcceptanceConversationObservation,
    }),
    {
      state: "unknown",
      value: null,
      source: "acceptance_observability",
      reason: "authoritative_absent",
    },
  );
  assert.deepEqual(
    normalizePendingRequiredWrites({ legacy: undefined, observability: observation(null) }),
    {
      state: "unknown",
      value: null,
      source: "acceptance_observability",
      reason: "authoritative_null",
    },
  );
  assert.deepEqual(
    normalizePendingRequiredWrites({ legacy: undefined, observability: observation("0") }),
    {
      state: "unknown",
      value: null,
      source: "acceptance_observability",
      reason: "authoritative_malformed",
    },
  );
  assert.deepEqual(
    normalizePendingRequiredWrites({ legacy: undefined, observability: observation(-1) }),
    {
      state: "unknown",
      value: null,
      source: "acceptance_observability",
      reason: "authoritative_negative",
      authoritativeValue: -1,
    },
  );
});

test("legacy null permits canonical zero while legacy disagreement fails closed", () => {
  assert.deepEqual(
    normalizePendingRequiredWrites({ legacy: null, observability: observation(0) }),
    {
      state: "known",
      value: 0,
      source: "acceptance_observability",
      legacyState: "null",
    },
  );
  assert.deepEqual(
    normalizePendingRequiredWrites({ legacy: 2, observability: observation(0) }),
    {
      state: "unknown",
      value: null,
      source: "acceptance_observability",
      reason: "legacy_disagreement",
      legacyValue: 2,
      authoritativeValue: 0,
    },
  );
  assert.equal(
    normalizePendingRequiredWrites({ legacy: 0, observability: observation(1) }).state,
    "unknown",
  );
});

test("durability gate passes only for authoritative zero", () => {
  assert.doesNotThrow(() =>
    assertPendingRequiredWritesDrained(
      normalizePendingRequiredWrites({ legacy: null, observability: observation(0) }),
      "H",
    ),
  );
  assert.throws(
    () =>
      assertPendingRequiredWritesDrained(
        normalizePendingRequiredWrites({ legacy: undefined, observability: observation(1) }),
        "H",
      ),
    /checkpoint H has 1 pending required write/,
  );
  assert.throws(
    () =>
      assertPendingRequiredWritesDrained(
        normalizePendingRequiredWrites({ legacy: undefined, observability: observation(null) }),
        "H",
      ),
    /authoritative_null/,
  );
});

function checkpoint(
  id: ConversationCheckpointEvidence["checkpoint"],
  user: number,
  completedAssistant: number,
  total: number,
  legacy: unknown,
): ConversationCheckpointEvidence {
  const canonical = observation(0);
  return {
    checkpoint: id,
    recordedAt: "2026-07-23T00:00:00.000Z",
    eventType: "fixture",
    conversationIdentity: "conversation-hash",
    nativeSessionIdentity: "session-hash",
    requestIdentity: id < "E" ? "initial" : "follow-up",
    turns: [],
    durableStoreCounts: {
      user,
      assistant: completedAssistant,
      completedAssistant,
      total,
      duplicateTurnIdentities: 0,
    },
    inMemoryCounts: canonical.inMemoryCounts,
    pendingRequiredWrites: normalizePendingRequiredWrites({
      legacy,
      observability: canonical,
    }),
    observability: canonical,
  };
}

test("prior legacy-null fixture passes the full conversation gate and can proceed to routes", () => {
  const evidence: ConversationPersistenceEvidence = {
    schemaVersion: 1,
    transport: "fixture-prior-live-result",
    checkpoints: [
      checkpoint("B", 1, 1, 2, null),
      checkpoint("C", 1, 1, 2, null),
      checkpoint("D", 1, 1, 2, null),
      checkpoint("F", 2, 2, 4, null),
      checkpoint("G", 2, 2, 4, null),
      checkpoint("H", 2, 2, 4, null),
    ],
    nativeSessionIdentityStable: true,
    exactFinalCardinality: true,
    secondRestartCompleted: true,
    unavailableMeasurements: [],
  };
  assert.doesNotThrow(() => assertLiveConversationEvidence(evidence));
  const providerGateConversation = { userTurns: 2, completedAssistantTurns: 2 };
  assert.ok(providerGateConversation);
});

test("human-report ledger and machine-result checkpoints use equal typed values", () => {
  const evidence: ConversationPersistenceEvidence = {
    schemaVersion: 1,
    transport: "fixture",
    checkpoints: [checkpoint("H", 2, 2, 4, null)],
    nativeSessionIdentityStable: true,
    exactFinalCardinality: true,
    secondRestartCompleted: true,
    unavailableMeasurements: [],
  };
  const humanReportValue = JSON.parse(JSON.stringify(pendingWriteLedger(evidence)));
  const machineResultValue = evidence.checkpoints.map((entry) => ({
    checkpoint: entry.checkpoint,
    pendingRequiredWrites: entry.pendingRequiredWrites,
  }));
  assert.deepEqual(humanReportValue, machineResultValue);
});
