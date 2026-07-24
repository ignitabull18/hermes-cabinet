import type {
  ConversationPersistenceEvidence,
  ConversationCheckpointEvidence,
} from "./contracts";
import { assertPendingRequiredWritesDrained } from "./pending-required-writes";

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requireCounts(
  checkpoint: ConversationCheckpointEvidence | undefined,
  expected: { user: number; completedAssistant: number; total: number },
): void {
  requireCondition(checkpoint, "required conversation checkpoint is missing");
  const counts = checkpoint.durableStoreCounts;
  requireCondition(counts, `checkpoint ${checkpoint.checkpoint} durable counts are missing`);
  requireCondition(
    counts.user === expected.user &&
      counts.completedAssistant === expected.completedAssistant &&
      counts.total === expected.total &&
      counts.duplicateTurnIdentities === 0,
    `checkpoint ${checkpoint.checkpoint} has invalid conversation cardinality`,
  );
}

export function assertLiveConversationEvidence(
  evidence: ConversationPersistenceEvidence | null,
): void {
  requireCondition(evidence, "conversation persistence evidence is missing");
  requireCondition(
    evidence.nativeSessionIdentityStable === true,
    "native Hermes session identity was not stable",
  );
  requireCondition(
    evidence.exactFinalCardinality === true,
    "conversation did not persist exact 2/2 cardinality",
  );
  requireCondition(
    evidence.secondRestartCompleted === true,
    "second Cabinet restart did not complete",
  );

  const byCheckpoint = new Map(
    evidence.checkpoints.map((checkpoint) => [checkpoint.checkpoint, checkpoint]),
  );
  for (const checkpoint of ["B", "C", "D"] as const) {
    requireCounts(byCheckpoint.get(checkpoint), {
      user: 1,
      completedAssistant: 1,
      total: 2,
    });
  }
  for (const checkpoint of ["G", "H"] as const) {
    requireCounts(byCheckpoint.get(checkpoint), {
      user: 2,
      completedAssistant: 2,
      total: 4,
    });
  }
  for (const checkpoint of ["C", "G", "H"] as const) {
    const pendingRequiredWrites = byCheckpoint.get(checkpoint)?.pendingRequiredWrites;
    requireCondition(
      pendingRequiredWrites,
      `checkpoint ${checkpoint} pending required writes are missing`,
    );
    assertPendingRequiredWritesDrained(pendingRequiredWrites, checkpoint);
  }
  for (const checkpoint of ["B", "F"] as const) {
    const observation = byCheckpoint.get(checkpoint)?.observability;
    requireCondition(observation, `checkpoint ${checkpoint} observability is missing`);
    requireCondition(
      observation.modelRequestsAttempted === 1 &&
        observation.providerRetries === 0 &&
        observation.fallbackAttempts === 0 &&
        observation.toolEventCount === 0 &&
        observation.decisionEventCount === 0 &&
        observation.duplicateChunkCount === 0 &&
        observation.mcpServerCount === 0,
      `checkpoint ${checkpoint} provider or no-tools accounting is invalid`,
    );
  }
}
