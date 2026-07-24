import type {
  AcceptanceConversationObservation,
  ConversationPersistenceEvidence,
  NormalizedPendingRequiredWrites,
} from "./contracts";

type PendingWriteInputs = {
  legacy: unknown;
  observability: AcceptanceConversationObservation | null | undefined;
};

function validCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

export function normalizePendingRequiredWrites({
  legacy,
  observability,
}: PendingWriteInputs): NormalizedPendingRequiredWrites {
  const authoritativePresent =
    observability !== null &&
    observability !== undefined &&
    Object.prototype.hasOwnProperty.call(observability, "pendingRequiredWrites");
  const authoritative = authoritativePresent
    ? (observability as { pendingRequiredWrites?: unknown }).pendingRequiredWrites
    : undefined;

  if (!authoritativePresent || authoritative === undefined) {
    return {
      state: "unknown",
      value: null,
      source: "acceptance_observability",
      reason: "authoritative_absent",
    };
  }
  if (authoritative === null) {
    return {
      state: "unknown",
      value: null,
      source: "acceptance_observability",
      reason: "authoritative_null",
    };
  }
  if (!Number.isInteger(authoritative)) {
    return {
      state: "unknown",
      value: null,
      source: "acceptance_observability",
      reason: "authoritative_malformed",
    };
  }
  if (Number(authoritative) < 0) {
    return {
      state: "unknown",
      value: null,
      source: "acceptance_observability",
      reason: "authoritative_negative",
      authoritativeValue: Number(authoritative),
    };
  }

  if (legacy === undefined) {
    return {
      state: "known",
      value: Number(authoritative),
      source: "acceptance_observability",
      legacyState: "absent",
    };
  }
  if (legacy === null) {
    return {
      state: "known",
      value: Number(authoritative),
      source: "acceptance_observability",
      legacyState: "null",
    };
  }
  if (!validCount(legacy)) {
    return {
      state: "unknown",
      value: null,
      source: "acceptance_observability",
      reason: "legacy_malformed",
    };
  }
  if (legacy !== authoritative) {
    return {
      state: "unknown",
      value: null,
      source: "acceptance_observability",
      reason: "legacy_disagreement",
      legacyValue: legacy,
      authoritativeValue: Number(authoritative),
    };
  }
  return {
    state: "known",
    value: Number(authoritative),
    source: "acceptance_observability",
    legacyState: "matching",
  };
}

export function assertPendingRequiredWritesDrained(
  value: NormalizedPendingRequiredWrites,
  checkpoint: string,
): void {
  if (value.state === "unknown") {
    throw new Error(
      `checkpoint ${checkpoint} pending required writes are unknown: ${value.reason}`,
    );
  }
  if (value.value !== 0) {
    throw new Error(
      `checkpoint ${checkpoint} has ${value.value} pending required write(s)`,
    );
  }
}

export function pendingWriteLedger(
  evidence: ConversationPersistenceEvidence | null,
): Array<{
  checkpoint: string;
  pendingRequiredWrites: NormalizedPendingRequiredWrites;
}> {
  return (evidence?.checkpoints ?? []).map((checkpoint) => ({
    checkpoint: checkpoint.checkpoint,
    pendingRequiredWrites: checkpoint.pendingRequiredWrites,
  }));
}
