import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSafeState,
  deletionRiskModel,
  fingerprint,
  prepareMutation,
  reconcileMutation,
} from "./governed-memory.mjs";

const baseObservation = {
  provider: { selected: "supermemory", state: "selected", configured: true, availability: "available" },
  plugin: { discovered: true, source: "bundled", version: "1.0.1", manifestDigest: "sha256:fixture" },
  runtime: { state: "loaded", toolsExposed: ["supermemory-search", "supermemory-save"], writeContext: "unknown" },
  credential: { state: "present", scopeRestricted: false },
  scope: { kind: "profile", customScopeCount: 0 },
  settings: { autoRecall: true, autoCapture: true, captureMode: "conversation", searchMode: "hybrid", maxRecallResults: 5 },
  health: { state: "unchecked", checkedAt: null, errorCode: null },
  capabilities: { search: "supported", graph: "upstream_required", export: "unsupported" },
  provenance: { source: "hermes-installed-source", installedRevision: "55759cb", observedAt: "2026-07-23T00:00:00Z" },
};

test("safe state is deterministic and metadata-only", () => {
  const first = buildSafeState(baseObservation);
  const second = buildSafeState(structuredClone(baseObservation));
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.scope.kind, "profile");
  assert.equal(first.health.state, "unchecked");
});

test("content, query, raw scope, and secrets are rejected recursively", () => {
  for (const unsafe of [
    { ...baseObservation, content: "private" },
    { ...baseObservation, nested: { query: "find private fact" } },
    { ...baseObservation, apiKey: "secret" },
    { ...baseObservation, scope: { ...baseObservation.scope, containerTag: "private-scope" } },
  ]) {
    assert.throws(() => buildSafeState(unsafe), /unsafe field rejected/);
  }
});

test("exact deletion requires idempotency and exact typed confirmation", () => {
  const state = buildSafeState(baseObservation);
  const target = { resourceDigest: "sha256:memory-fixture", scopeDigest: "sha256:scope-fixture" };
  assert.throws(
    () => prepareMutation({ action: "memory.forget_exact", currentState: state, target }),
    /idempotencyKey is required/,
  );
  assert.throws(
    () => prepareMutation({
      action: "memory.forget_exact",
      currentState: state,
      target,
      idempotencyKey: "fixture-key",
      approval: { typedPhrase: "wrong" },
    }),
    /typed confirmation/,
  );
});

test("query deletion is forbidden", () => {
  const state = buildSafeState(baseObservation);
  assert.throws(
    () => prepareMutation({
      action: "memory.forget_by_query",
      currentState: state,
      target: { matchDigest: "sha256:fixture" },
      idempotencyKey: "fixture-key",
    }),
    /forbidden/,
  );
});

test("successful exact deletion envelope never executes", () => {
  const state = buildSafeState(baseObservation);
  const target = { resourceDigest: "sha256:memory-fixture", scopeDigest: "sha256:scope-fixture" };
  const envelope = prepareMutation({
    action: "memory.forget_exact",
    currentState: state,
    target,
    idempotencyKey: "fixture-key",
    approval: {
      approvedBy: "fixture-operator",
      approvedAt: "2026-07-23T00:00:00Z",
      typedPhrase: `memory.forget_exact:${fingerprint(target).slice(0, 12)}`,
    },
    now: "2026-07-23T00:00:00Z",
  });
  assert.equal(envelope.execution, "not_implemented");
  assert.equal(envelope.retryPolicy, "never_automatic");
});

test("ambiguous transport reconciles to outcome_unknown without retry", () => {
  const state = buildSafeState(baseObservation);
  const envelope = {
    targetFingerprint: "target",
    precondition: { expectedFingerprint: state.fingerprint },
  };
  assert.deepEqual(reconcileMutation({
    envelope,
    readbackFingerprint: "different",
    transport: "timeout_after_dispatch",
  }), {
    outcome: "outcome_unknown",
    retryAllowed: false,
    requiredNextStep: "fresh_authoritative_readback_and_operator_reconciliation",
  });
});

test("deletion model classifies exact, query, and scope deletion", () => {
  assert.deepEqual(deletionRiskModel.map((row) => row.risk), ["critical", "forbidden", "catastrophic"]);
});
