import test from "node:test";
import assert from "node:assert/strict";

import {
  authorizeAfterCanonicalReread,
  fingerprintSnapshot,
  previewGovernedAction,
  reconcileAfterMutation,
  supportedOperations,
} from "./governed-actions.mjs";

const snapshot = (state, completeness = "full_canonical_config") => ({
  authority: "hermes",
  profile: "fixture-profile",
  completeness,
  state,
});

test("fingerprints are deterministic across object key order", () => {
  assert.equal(
    fingerprintSnapshot(snapshot({ b: 2, a: { d: 4, c: 3 } })),
    fingerprintSnapshot(snapshot({ a: { c: 3, d: 4 }, b: 2 })),
  );
});

test("secret-bearing values are rejected", () => {
  assert.throws(
    () =>
      fingerprintSnapshot(
        snapshot({ server: { api_key: "should-never-enter-the-envelope" } }),
      ),
    /secret-bearing value is forbidden/,
  );
});

test("plugin enable is blocked without canonical identity and allowlist", () => {
  const current = snapshot({ plugins: [{ name: "example", status: "inactive" }] });
  const envelope = previewGovernedAction({
    actionId: "act-plugin-1",
    operation: "plugin.enable",
    profile: current.profile,
    resource: { kind: "plugin", name: "example" },
    payload: {},
    snapshot: current,
    expectedFingerprint: fingerprintSnapshot(current),
  });

  assert.equal(envelope.execute, false);
  assert.equal(envelope.state, "blocked");
  assert.ok(
    envelope.blockers.some((item) =>
      item.startsWith("canonical_plugin_key_missing"),
    ),
  );
  assert.ok(envelope.blockers.includes("exact_plugin_tool_allowlist_required"));
});

test("reviewed plugin enable can reach preview_ready but never an executor", () => {
  const current = snapshot({
    plugins: [
      {
        canonicalKey: "observability/example",
        source: "user",
        revision: "1".repeat(40),
        status: "inactive",
      },
    ],
  });
  const envelope = previewGovernedAction({
    actionId: "act-plugin-2",
    operation: "plugin.enable",
    profile: current.profile,
    resource: { kind: "plugin", name: "observability/example" },
    payload: {
      canonicalKey: "observability/example",
      reviewedContentDigest: "sha256:reviewed",
      allowedTools: ["example_read"],
      allowToolOverride: false,
      restartAcknowledged: true,
    },
    snapshot: current,
    expectedFingerprint: fingerprintSnapshot(current),
  });

  assert.equal(envelope.state, "preview_ready");
  assert.equal(envelope.execute, false);
  const authorization = authorizeAfterCanonicalReread(envelope, current, {
    confirmationPhrase: envelope.confirmation.phrase,
  });
  assert.equal(authorization.authorized, true);
  assert.equal(authorization.mutationInstruction, null);
});

test("canonical reread rejects stale state", () => {
  const current = snapshot({ servers: [{ name: "docs", enabled: false }] });
  const envelope = previewGovernedAction({
    actionId: "act-mcp-1",
    operation: "mcp.enable",
    profile: current.profile,
    resource: { kind: "mcp_server", name: "docs" },
    payload: {
      serverName: "docs",
      reviewedServerDigest: "sha256:reviewed",
      allowedTools: ["search"],
      restartAcknowledged: true,
    },
    snapshot: current,
    expectedFingerprint: fingerprintSnapshot(current),
  });
  const changed = snapshot({ servers: [{ name: "docs", enabled: true }] });

  assert.equal(envelope.state, "preview_ready");
  assert.deepEqual(authorizeAfterCanonicalReread(envelope, changed), {
    authorized: false,
    reason: "stale_state",
    expectedFingerprint: fingerprintSnapshot(current),
    rereadFingerprint: fingerprintSnapshot(changed),
  });
});

test("matching state still requires the typed confirmation phrase", () => {
  const current = snapshot({ servers: [{ name: "docs", enabled: false }] });
  const envelope = previewGovernedAction({
    actionId: "act-mcp-confirm",
    operation: "mcp.enable",
    profile: current.profile,
    resource: { kind: "mcp_server", name: "docs" },
    payload: {
      serverName: "docs",
      reviewedServerDigest: "sha256:reviewed",
      allowedTools: ["search"],
      restartAcknowledged: true,
    },
    snapshot: current,
    expectedFingerprint: fingerprintSnapshot(current),
  });

  assert.equal(envelope.state, "preview_ready");
  assert.equal(
    authorizeAfterCanonicalReread(envelope, current).reason,
    "typed_confirmation_missing_or_mismatched",
  );
});

test("whole-map MCP replace rejects redacted partial inventory", () => {
  const current = snapshot(
    { servers: [{ name: "docs", env: { ACCESS_TOKEN: "<redacted>" } }] },
    "redacted_partial",
  );
  const envelope = previewGovernedAction({
    actionId: "act-mcp-2",
    operation: "mcp.replace",
    profile: current.profile,
    resource: { kind: "mcp_collection" },
    payload: { priorCanonicalConfigDigest: "sha256:prior" },
    snapshot: current,
    expectedFingerprint: fingerprintSnapshot(current),
  });

  assert.equal(envelope.state, "blocked");
  assert.ok(
    envelope.blockers.some((item) =>
      item.startsWith("whole_map_replace_requires_full_canonical_config"),
    ),
  );
});

test("stdio MCP preview requires exact tools, digest, and local execution consent", () => {
  const current = snapshot({ servers: [] });
  const envelope = previewGovernedAction({
    actionId: "act-mcp-3",
    operation: "mcp.add",
    profile: current.profile,
    resource: { kind: "mcp_server", name: "local" },
    payload: { serverName: "local", transport: "stdio" },
    snapshot: current,
    expectedFingerprint: fingerprintSnapshot(current),
  });

  assert.equal(envelope.state, "blocked");
  assert.ok(envelope.blockers.includes("reviewed_mcp_config_digest_required"));
  assert.ok(envelope.blockers.includes("exact_mcp_tool_allowlist_required"));
  assert.ok(
    envelope.blockers.includes(
      "explicit_local_command_execution_consent_required",
    ),
  );
});

test("plugin update remains blocked because native update cannot pin a target", () => {
  const current = snapshot({
    plugins: [
      {
        canonicalKey: "example",
        revision: "1".repeat(40),
        status: "enabled",
      },
    ],
  });
  const envelope = previewGovernedAction({
    actionId: "act-plugin-3",
    operation: "plugin.update",
    profile: current.profile,
    resource: { kind: "plugin", name: "example" },
    payload: { canonicalKey: "example" },
    snapshot: current,
    expectedFingerprint: fingerprintSnapshot(current),
  });

  assert.equal(envelope.state, "blocked");
  assert.ok(envelope.blockers.includes("native_plugin_update_is_unpinned"));
  assert.ok(envelope.blockers.some((item) => item.startsWith("upstream_gap:")));
});

test("ambiguous post-mutation state is outcome_unknown and never auto-retried", () => {
  const before = snapshot({ enabled: false });
  const envelope = {
    actionId: "act-reconcile",
  };
  const result = reconcileAfterMutation({
    envelope,
    beforeFingerprint: fingerprintSnapshot(before),
    expectedAfterFingerprint: fingerprintSnapshot(snapshot({ enabled: true })),
    canonicalReread: snapshot({ enabled: false }),
    transport: { timedOut: true, definitiveFailure: false },
  });

  assert.equal(result.outcome, "outcome_unknown");
  assert.equal(result.retryAllowed, false);
});

test("operation inventory covers all audited management families", () => {
  assert.deepEqual(supportedOperations(), [
    "mcp.add",
    "mcp.authenticate",
    "mcp.catalog.install",
    "mcp.configure_tools",
    "mcp.disable",
    "mcp.enable",
    "mcp.list",
    "mcp.remove",
    "mcp.replace",
    "mcp.test",
    "plugin.disable",
    "plugin.enable",
    "plugin.install",
    "plugin.list",
    "plugin.remove",
    "plugin.update",
  ]);
});
