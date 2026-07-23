import { createHash, randomUUID } from "node:crypto";

const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled"]);
const SCHEDULE_ACTIONS = new Set([
  "create_schedule",
  "update_schedule",
  "pause_schedule",
  "resume_schedule",
  "trigger_schedule",
  "delete_schedule",
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprint(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function publicIntent(intent) {
  const copy = structuredClone(intent);
  delete copy.response;
  delete copy.payload;
  delete copy.payloadRef;
  return copy;
}

function readTarget(adapter, intent) {
  if (intent.action === "create_schedule") {
    const existing = adapter.readSchedule(intent.targetId);
    return { id: intent.targetId, exists: Boolean(existing) };
  }
  if (SCHEDULE_ACTIONS.has(intent.action)) {
    return adapter.readSchedule(intent.targetId);
  }
  if (intent.action === "resolve_clarification") {
    return adapter.readClarification(intent.targetId);
  }
  if (intent.action === "cancel_run") {
    return adapter.readRun(intent.targetId);
  }
  return null;
}

export function prepare(adapter, intent) {
  if (!intent?.action || !intent?.targetId || !intent?.idempotencyKey) {
    throw new Error("action, targetId, and idempotencyKey are required");
  }
  if (intent.action === "resolve_approval") {
    throw new Error(
      "unsafe upstream capability: approvals are session FIFO and cannot target an approval request ID",
    );
  }
  if (intent.action === "retry_run" || intent.action === "resume_run") {
    throw new Error(`unsupported upstream capability: ${intent.action}`);
  }
  if (intent.action === "cancel_run") {
    throw new Error("disabled by stream policy: governed run termination");
  }

  const target = readTarget(adapter, intent);
  if (!target) throw new Error(`target not found: ${intent.targetId}`);
  if (intent.action === "create_schedule" && target.exists) {
    throw new Error(`target already exists: ${intent.targetId}`);
  }
  if (
    intent.action === "resolve_clarification" &&
    (target.state !== "pending" || !intent.responseDigest)
  ) {
    throw new Error("clarification must be pending and use a response digest");
  }

  const targetFingerprint = fingerprint(target);
  const safeIntent = publicIntent(intent);
  const planFingerprint = fingerprint({ targetFingerprint, intent: safeIntent });
  const confirmation = `CONFIRM ${intent.action} ${intent.targetId} ${planFingerprint.slice(0, 12)}`;

  return {
    version: 1,
    intent: safeIntent,
    target,
    targetFingerprint,
    planFingerprint,
    confirmation,
  };
}

function verify(adapter, intent, before, dispatchResult) {
  if (intent.action === "create_schedule") {
    const after = adapter.readSchedule(intent.targetId);
    return {
      verified:
        after?.id === intent.targetId &&
        after.profile === intent.profile &&
        after.name === intent.name &&
        after.cadence === intent.cadence &&
        after.payloadDigest === intent.payloadDigest,
      after,
    };
  }
  if (intent.action === "update_schedule") {
    const after = adapter.readSchedule(intent.targetId);
    const matches = Object.entries(intent.patch ?? {}).every(
      ([key, value]) => after?.[key] === value,
    );
    return { verified: matches && after.revision > before.revision, after };
  }
  if (intent.action === "pause_schedule" || intent.action === "resume_schedule") {
    const after = adapter.readSchedule(intent.targetId);
    const expected = intent.action === "resume_schedule";
    return {
      verified: after?.enabled === expected && after.revision > before.revision,
      after,
    };
  }
  if (intent.action === "trigger_schedule") {
    const executionId = dispatchResult?.executionId ?? intent.executionId;
    const after = executionId ? adapter.readExecution(executionId) : null;
    return {
      verified:
        Boolean(after) &&
        after.jobId === intent.targetId &&
        after.correlationId === intent.correlationId,
      after,
    };
  }
  if (intent.action === "delete_schedule") {
    const after = adapter.readSchedule(intent.targetId);
    return { verified: after === null, after };
  }
  if (intent.action === "resolve_clarification") {
    const after = adapter.readClarification(intent.targetId);
    return {
      verified:
        after?.state === "resolved" &&
        after.responseDigest === intent.responseDigest,
      after,
    };
  }
  return { verified: false, after: null };
}

export function verifyCancelled(adapter, runId) {
  const after = adapter.readRun(runId);
  return {
    verified: after?.status === "cancelled",
    terminal: TERMINAL_RUN_STATES.has(after?.status),
    after,
  };
}

export class Coordinator {
  constructor() {
    this.receipts = new Map();
  }

  execute(adapter, plan, confirmation) {
    if (confirmation !== plan.confirmation) {
      return { outcome: "blocked", reason: "confirmation_mismatch", dispatches: 0 };
    }
    const prior = this.receipts.get(plan.intent.idempotencyKey);
    if (prior) return { ...structuredClone(prior), replayed: true };

    const current = readTarget(adapter, plan.intent);
    if (fingerprint(current) !== plan.targetFingerprint) {
      return { outcome: "blocked", reason: "stale_target", dispatches: 0 };
    }

    let dispatchResult = null;
    let dispatchError = null;
    try {
      dispatchResult = adapter.dispatch(plan.intent);
    } catch (error) {
      dispatchError = error;
    }

    const check = verify(adapter, plan.intent, plan.target, dispatchResult);
    const receipt = {
      receiptId: randomUUID(),
      idempotencyKey: plan.intent.idempotencyKey,
      planFingerprint: plan.planFingerprint,
      outcome: check.verified ? "verified" : "outcome_unknown",
      dispatches: 1,
      verification: check,
      transportError: dispatchError ? "dispatch_result_unavailable" : null,
      retryAllowed: false,
    };
    this.receipts.set(plan.intent.idempotencyKey, receipt);
    return structuredClone(receipt);
  }
}

export function managementSurface() {
  return {
    schedules: {
      globalEnumeration: "desktop_management_only",
      profileEnumeration: ["agent_api", "cli"],
      knownId: ["desktop_management", "agent_api"],
    },
    executionHistory: {
      profileEnumeration: ["cli", "cron_store"],
      states: ["claimed", "running", "completed", "failed", "unknown"],
      retryQueue: false,
    },
    liveRuns: {
      globalEnumeration: false,
      knownId: ["agent_api"],
      statusTtlSeconds: 3600,
      retry: false,
      resume: false,
      cooperativeStop: true,
    },
    approvals: {
      globalEnumeration: false,
      exactRequestTargeting: false,
      upstreamSemantics: "session_fifo",
    },
    clarifications: {
      globalEnumeration: false,
      exactRequestTargeting: "tui_request_id_only",
    },
    queues: {
      globalEnumeration: false,
      sessionMetadataOnly: true,
      contentRedactionRequired: true,
    },
    workers: {
      subsystem: "kanban_plugin",
      separateFromAgentRuns: true,
      terminationInScope: false,
    },
  };
}
