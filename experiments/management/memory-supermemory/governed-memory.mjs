import { createHash, randomUUID } from "node:crypto";

const FORBIDDEN_KEYS = /(^|_)(api.?key|token|secret|password|content|body|message|messages|query|result|results|profile.?facts?|memory.?text|raw.?id|container.?tag|project.?id)(_|$)/i;
const SAFE_ENUMS = {
  providerState: new Set(["built_in_only", "selected", "missing", "unknown"]),
  availability: new Set(["available", "unavailable", "unknown"]),
  runtimeState: new Set(["not_loaded", "loaded", "initialized", "degraded", "unknown"]),
  credentialState: new Set(["present", "absent", "unknown"]),
  scopeKind: new Set(["shared", "profile", "custom", "unknown"]),
  healthState: new Set(["healthy", "unhealthy", "unchecked", "unknown"]),
  support: new Set(["supported", "unsupported", "upstream_required", "unknown"]),
};

const ACTIONS = Object.freeze({
  "provider.select": { risk: "high", approval: "operator", idempotency: "required" },
  "provider.configure": { risk: "high", approval: "operator", idempotency: "required" },
  "memory.store": { risk: "high", approval: "operator", idempotency: "required" },
  "memory.forget_exact": { risk: "critical", approval: "typed_exact", idempotency: "required" },
  "memory.forget_by_query": { risk: "forbidden", approval: "unavailable", idempotency: "unavailable" },
  "memory.delete_scope": { risk: "catastrophic", approval: "typed_scope", idempotency: "required" },
  "migration.preview": { risk: "medium", approval: "operator", idempotency: "optional" },
  "migration.apply": { risk: "critical", approval: "typed_scope", idempotency: "required" },
  "export.request": { risk: "high", approval: "operator", idempotency: "required" },
  "import.apply": { risk: "critical", approval: "typed_scope", idempotency: "required" },
});

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function scan(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scan(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) {
      throw new Error(`unsafe field rejected at ${path}.${key}`);
    }
    scan(nested, `${path}.${key}`);
  }
}

function enumValue(group, value) {
  const normalized = String(value ?? "unknown");
  if (!SAFE_ENUMS[group].has(normalized)) {
    throw new Error(`invalid ${group}: ${normalized}`);
  }
  return normalized;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

export function fingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function buildSafeState(observation) {
  assertPlainObject(observation, "observation");
  scan(observation);
  const safe = {
    schemaVersion: 1,
    provider: {
      selected: String(observation.provider?.selected || "built-in"),
      state: enumValue("providerState", observation.provider?.state),
      configured: Boolean(observation.provider?.configured),
      availability: enumValue("availability", observation.provider?.availability),
    },
    plugin: {
      discovered: Boolean(observation.plugin?.discovered),
      source: ["bundled", "user", "none", "unknown"].includes(observation.plugin?.source)
        ? observation.plugin.source
        : "unknown",
      version: String(observation.plugin?.version || "unknown"),
      manifestDigest: String(observation.plugin?.manifestDigest || "unknown"),
    },
    runtime: {
      state: enumValue("runtimeState", observation.runtime?.state),
      toolsExposed: [...new Set(observation.runtime?.toolsExposed || [])].sort(),
      writeContext: ["enabled", "suppressed", "unknown"].includes(observation.runtime?.writeContext)
        ? observation.runtime.writeContext
        : "unknown",
    },
    credential: {
      state: enumValue("credentialState", observation.credential?.state),
      scopeRestricted: Boolean(observation.credential?.scopeRestricted),
    },
    scope: {
      kind: enumValue("scopeKind", observation.scope?.kind),
      customScopeCount: Number.isSafeInteger(observation.scope?.customScopeCount)
        ? observation.scope.customScopeCount
        : null,
    },
    settings: {
      autoRecall: Boolean(observation.settings?.autoRecall),
      autoCapture: Boolean(observation.settings?.autoCapture),
      captureMode: String(observation.settings?.captureMode || "unknown"),
      searchMode: String(observation.settings?.searchMode || "unknown"),
      maxRecallResults: Number.isSafeInteger(observation.settings?.maxRecallResults)
        ? observation.settings.maxRecallResults
        : null,
    },
    health: {
      state: enumValue("healthState", observation.health?.state),
      checkedAt: observation.health?.checkedAt || null,
      errorCode: observation.health?.errorCode || null,
    },
    capabilities: Object.fromEntries(
      Object.entries(observation.capabilities || {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, enumValue("support", value)]),
    ),
    provenance: {
      source: String(observation.provenance?.source || "hermes"),
      installedRevision: String(observation.provenance?.installedRevision || "unknown"),
      observedAt: observation.provenance?.observedAt || null,
    },
  };
  scan(safe);
  return Object.freeze({ ...safe, fingerprint: fingerprint(safe) });
}

export function prepareMutation({ action, currentState, target, approval, idempotencyKey, now }) {
  assertPlainObject(currentState, "currentState");
  assertPlainObject(target, "target");
  scan(target);
  const policy = ACTIONS[action];
  if (!policy) throw new Error(`unsupported action: ${action}`);
  if (policy.risk === "forbidden") throw new Error(`${action} is forbidden`);
  if (policy.idempotency === "required" && !idempotencyKey) {
    throw new Error("idempotencyKey is required");
  }
  const targetFingerprint = fingerprint(target);
  const expected = currentState.fingerprint || fingerprint(currentState);
  const requiredPhrase = policy.approval.startsWith("typed_")
    ? `${action}:${targetFingerprint.slice(0, 12)}`
    : null;
  if (requiredPhrase && approval?.typedPhrase !== requiredPhrase) {
    throw new Error(`typed confirmation must equal ${requiredPhrase}`);
  }
  return Object.freeze({
    schemaVersion: 1,
    operationId: randomUUID(),
    action,
    risk: policy.risk,
    approval: {
      kind: policy.approval,
      approvedBy: approval?.approvedBy || null,
      approvedAt: approval?.approvedAt || null,
      typedPhrase: requiredPhrase,
    },
    precondition: { expectedFingerprint: expected },
    target: canonical(target),
    targetFingerprint,
    idempotencyKey: idempotencyKey || null,
    preparedAt: now || new Date().toISOString(),
    execution: "not_implemented",
    retryPolicy: "never_automatic",
  });
}

export function reconcileMutation({ envelope, readbackFingerprint, transport }) {
  assertPlainObject(envelope, "envelope");
  if (readbackFingerprint === envelope.targetFingerprint) {
    return { outcome: "verified_applied", retryAllowed: false };
  }
  if (readbackFingerprint === envelope.precondition.expectedFingerprint) {
    return { outcome: "verified_not_applied", retryAllowed: false };
  }
  if (transport === "confirmed_not_dispatched") {
    return { outcome: "verified_not_applied", retryAllowed: false };
  }
  return {
    outcome: "outcome_unknown",
    retryAllowed: false,
    requiredNextStep: "fresh_authoritative_readback_and_operator_reconciliation",
  };
}

export const deletionRiskModel = Object.freeze([
  { action: "memory.forget_exact", risk: "critical", reversible: false, requirement: "exact immutable id plus fingerprint" },
  { action: "memory.forget_by_query", risk: "forbidden", reversible: false, requirement: "upstream dry-run token and exact-match commit contract" },
  { action: "memory.delete_scope", risk: "catastrophic", reversible: false, requirement: "scope inventory, owner/admin approval, export evidence, typed scope confirmation" },
]);
