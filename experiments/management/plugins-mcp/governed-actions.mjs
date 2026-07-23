import { createHash } from "node:crypto";

export const ENVELOPE_VERSION = "cabinet.hermes.governed-action/v1";
export const PINNED_HERMES_REVISION =
  "55759cb2737cd3870f9de4693f66fa38eaf0dd2b";

const MUTATING_OPERATIONS = new Set([
  "plugin.install",
  "plugin.update",
  "plugin.enable",
  "plugin.disable",
  "plugin.remove",
  "mcp.add",
  "mcp.replace",
  "mcp.remove",
  "mcp.enable",
  "mcp.disable",
  "mcp.authenticate",
  "mcp.catalog.install",
  "mcp.configure_tools",
]);

const POLICIES = {
  "plugin.list": {
    risk: "read",
    contentBearing: true,
    restart: "none",
    interface: "GET /api/dashboard/plugins/hub",
  },
  "plugin.install": {
    risk: "critical",
    contentBearing: true,
    restart: "gateway_or_new_process",
    interface: "POST /api/dashboard/agent-plugins/install",
  },
  "plugin.update": {
    risk: "critical",
    contentBearing: true,
    restart: "gateway_or_new_process",
    interface: "POST /api/dashboard/agent-plugins/{name}/update",
    nativeGap:
      "Hermes performs an unpinned git pull --ff-only and exposes no target revision or rollback transaction.",
  },
  "plugin.enable": {
    risk: "critical",
    contentBearing: true,
    restart: "gateway_or_new_process",
    interface: "POST /api/dashboard/agent-plugins/{name}/enable",
  },
  "plugin.disable": {
    risk: "high",
    contentBearing: false,
    restart: "gateway_or_new_process",
    interface: "POST /api/dashboard/agent-plugins/{name}/disable",
  },
  "plugin.remove": {
    risk: "critical",
    contentBearing: false,
    restart: "gateway_or_new_process",
    interface: "DELETE /api/dashboard/agent-plugins/{name}",
  },
  "mcp.list": {
    risk: "read",
    contentBearing: true,
    restart: "none",
    interface: "GET /api/mcp/servers",
  },
  "mcp.test": {
    risk: "high",
    contentBearing: true,
    restart: "none",
    interface: "POST /api/mcp/servers/{name}/test",
  },
  "mcp.add": {
    risk: "critical",
    contentBearing: true,
    restart: "new_session_or_reload",
    interface: "POST /api/mcp/servers",
  },
  "mcp.replace": {
    risk: "critical",
    contentBearing: true,
    restart: "new_session_or_reload",
    interface: "PUT /api/mcp/servers",
  },
  "mcp.remove": {
    risk: "critical",
    contentBearing: false,
    restart: "new_session_or_reload",
    interface: "DELETE /api/mcp/servers/{name}",
  },
  "mcp.enable": {
    risk: "critical",
    contentBearing: true,
    restart: "new_session_or_reload",
    interface: "PUT /api/mcp/servers/{name}/enabled",
  },
  "mcp.disable": {
    risk: "high",
    contentBearing: false,
    restart: "new_session_or_reload",
    interface: "PUT /api/mcp/servers/{name}/enabled",
  },
  "mcp.authenticate": {
    risk: "critical",
    contentBearing: true,
    restart: "live_reconnect_when_same_profile",
    interface: "POST /api/mcp/servers/{name}/auth",
  },
  "mcp.catalog.install": {
    risk: "critical",
    contentBearing: true,
    restart: "new_session_or_reload",
    interface: "POST /api/mcp/catalog/install",
  },
  "mcp.configure_tools": {
    risk: "critical",
    contentBearing: true,
    restart: "new_session_or_reload",
    interface: "PUT /api/mcp/servers",
  },
};

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function assertSecretSafe(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretSafe(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (
      /(token|password|secret|private[_-]?key|authorization|api[_-]?key)/i.test(
        key,
      ) &&
      typeof child === "string" &&
      !["<present>", "<absent>", "<redacted>", "<provision-at-execution>"].includes(
        child,
      )
    ) {
      throw new TypeError(`secret-bearing value is forbidden at ${childPath}`);
    }
    assertSecretSafe(child, childPath);
  }
}

export function fingerprintSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new TypeError("snapshot is required");
  }
  requireString(snapshot.authority, "snapshot.authority");
  requireString(snapshot.profile, "snapshot.profile");
  requireString(snapshot.completeness, "snapshot.completeness");
  if (!Object.hasOwn(snapshot, "state")) {
    throw new TypeError("snapshot.state is required");
  }
  assertSecretSafe(snapshot.state);
  return sha256({
    authority: snapshot.authority,
    profile: snapshot.profile,
    completeness: snapshot.completeness,
    state: snapshot.state,
  });
}

function validatePluginPayload(operation, payload, blockers) {
  if (!operation.startsWith("plugin.") || operation === "plugin.list") return;
  if (!payload.canonicalKey) {
    blockers.push(
      "canonical_plugin_key_missing: Hermes hub rows expose manifest name but not the loader canonical key",
    );
  }

  if (operation === "plugin.install") {
    const source = payload.source ?? {};
    if (!source.url || !/^https:\/\/|^ssh:\/\//.test(source.url)) {
      blockers.push("plugin_source_not_allowlisted_https_or_ssh");
    }
    if (!/^[0-9a-f]{40}$/i.test(source.revision ?? "")) {
      blockers.push("immutable_plugin_revision_required");
    }
    if (!payload.reviewedContentDigest) {
      blockers.push("reviewed_plugin_content_digest_required");
    }
    if (payload.force === true) {
      blockers.push("force_install_forbidden_without_separate_remove_plan");
    }
  }

  if (operation === "plugin.enable") {
    if (!Array.isArray(payload.allowedTools)) {
      blockers.push("exact_plugin_tool_allowlist_required");
    }
    if (!payload.reviewedContentDigest) {
      blockers.push("reviewed_plugin_content_digest_required");
    }
    if (payload.allowToolOverride === true && payload.typedConfirmation !== payload.canonicalKey) {
      blockers.push("typed_confirmation_required_for_builtin_tool_override");
    }
  }

  if (operation === "plugin.update") {
    blockers.push("native_plugin_update_is_unpinned");
  }

  if (operation === "plugin.remove" && !payload.rollbackArtifactDigest) {
    blockers.push("rollback_artifact_required_before_plugin_removal");
  }
}

function validateMcpPayload(operation, payload, snapshot, blockers) {
  if (!operation.startsWith("mcp.") || operation === "mcp.list") return;
  if (!payload.serverName && operation !== "mcp.replace") {
    blockers.push("mcp_server_name_required");
  }

  if (["mcp.add", "mcp.catalog.install"].includes(operation)) {
    if (!payload.reviewedConfigDigest) {
      blockers.push("reviewed_mcp_config_digest_required");
    }
    if (!Array.isArray(payload.allowedTools)) {
      blockers.push("exact_mcp_tool_allowlist_required");
    }
    if (!payload.localExecutionConsent && payload.transport === "stdio") {
      blockers.push("explicit_local_command_execution_consent_required");
    }
  }

  if (["mcp.enable", "mcp.configure_tools"].includes(operation)) {
    if (!Array.isArray(payload.allowedTools)) {
      blockers.push("exact_mcp_tool_allowlist_required");
    }
    if (!payload.reviewedServerDigest) {
      blockers.push("reviewed_mcp_server_digest_required");
    }
  }

  if (operation === "mcp.replace") {
    if (snapshot.completeness !== "full_canonical_config") {
      blockers.push(
        "whole_map_replace_requires_full_canonical_config: GET /api/mcp/servers is a redacted partial projection",
      );
    }
    if (!payload.priorCanonicalConfigDigest) {
      blockers.push("prior_canonical_config_digest_required_for_replace_rollback");
    }
  }

  if (operation === "mcp.authenticate") {
    if (!Array.isArray(payload.requestedScopes)) {
      blockers.push("oauth_scope_inventory_required");
    }
    if (!payload.redirectUri) {
      blockers.push("oauth_redirect_uri_required");
    }
  }

  if (operation === "mcp.test" && payload.transport === "stdio") {
    if (!payload.localExecutionConsent) {
      blockers.push("mcp_test_can_execute_local_code");
    }
  }
}

function rollbackFor(operation, payload) {
  const map = {
    "plugin.install": {
      feasibility: "partial",
      action: "remove installed tree and restore pre-action plugin config",
      residuals: ["copied example files", "provisioned credentials", "executed install content"],
    },
    "plugin.update": {
      feasibility: "unsupported_native",
      action: "restore a pre-captured clean checkout at the exact prior commit",
      residuals: ["migration side effects", "external effects from loaded code"],
    },
    "plugin.enable": {
      feasibility: "compensating",
      action: "disable and restart every affected runtime",
      residuals: ["effects produced while enabled"],
    },
    "plugin.disable": {
      feasibility: "compensating",
      action: "re-enable the exact prior revision and restart affected runtimes",
      residuals: [],
    },
    "plugin.remove": {
      feasibility: "requires_artifact",
      action: "restore the exact pre-removal tree and config",
      residuals: ["credentials may have survived removal"],
    },
    "mcp.add": {
      feasibility: "partial",
      action: "remove server entry and reload affected runtimes",
      residuals: ["OAuth tokens", "profile .env values", "bootstrapped install tree"],
    },
    "mcp.replace": {
      feasibility: "requires_full_prior_state",
      action: "replace with the exact pre-action canonical map",
      residuals: ["credentials absent from redacted readback"],
    },
    "mcp.remove": {
      feasibility: "requires_full_prior_state",
      action: "restore exact config and credentials, then reload",
      residuals: ["removed OAuth manager state"],
    },
    "mcp.enable": {
      feasibility: "compensating",
      action: "disable and reload affected runtimes",
      residuals: ["tool effects produced while enabled"],
    },
    "mcp.disable": {
      feasibility: "compensating",
      action: "re-enable exact prior server config and reload",
      residuals: [],
    },
    "mcp.authenticate": {
      feasibility: "unsupported_native",
      action: "revoke at the authorization server and remove local token state",
      residuals: ["Hermes exposes re-authentication but no governed revoke endpoint"],
    },
    "mcp.catalog.install": {
      feasibility: "partial",
      action: "remove config and install tree, then reload",
      residuals: ["bootstrap side effects", "credentials", "OAuth tokens"],
    },
    "mcp.configure_tools": {
      feasibility: "compensating",
      action: "restore exact prior include/exclude filters and reload",
      residuals: [],
    },
  };
  return (
    map[operation] ?? {
      feasibility: "not_applicable",
      action: null,
      residuals: [],
    }
  );
}

export function previewGovernedAction({
  actionId,
  operation,
  profile,
  resource,
  payload = {},
  snapshot,
  expectedFingerprint,
  requestedBy = "cabinet-operator",
}) {
  const policy = POLICIES[operation];
  if (!policy) throw new TypeError(`unsupported operation: ${operation}`);
  requireString(actionId, "actionId");
  requireString(profile, "profile");
  assertSecretSafe(payload);

  const observedFingerprint = fingerprintSnapshot(snapshot);
  const blockers = [];
  const mutating = MUTATING_OPERATIONS.has(operation);

  if (snapshot.authority !== "hermes") {
    blockers.push("non_hermes_snapshot_forbidden");
  }
  if (snapshot.profile !== profile) {
    blockers.push("profile_scope_mismatch");
  }
  if (mutating && !expectedFingerprint) {
    blockers.push("expected_fingerprint_required");
  } else if (mutating && expectedFingerprint !== observedFingerprint) {
    blockers.push("stale_state_fingerprint");
  }
  if (mutating && snapshot.completeness === "projection_only") {
    blockers.push("authoritative_canonical_read_required");
  }
  if (mutating && policy.restart !== "none" && payload.restartAcknowledged !== true) {
    blockers.push(`restart_scope_not_acknowledged: ${policy.restart}`);
  }

  validatePluginPayload(operation, payload, blockers);
  validateMcpPayload(operation, payload, snapshot, blockers);
  if (policy.nativeGap) blockers.push(`upstream_gap: ${policy.nativeGap}`);

  const envelope = {
    version: ENVELOPE_VERSION,
    actionId,
    requestedBy,
    createdAt: new Date().toISOString(),
    execute: false,
    hermesRevision: PINNED_HERMES_REVISION,
    operation,
    interface: policy.interface,
    profile,
    resource,
    payload,
    preconditions: {
      authority: snapshot.authority,
      completeness: snapshot.completeness,
      observedFingerprint,
      expectedFingerprint: expectedFingerprint ?? null,
      canonicalRereadRequiredImmediatelyBeforeMutation: mutating,
    },
    risk: {
      level: policy.risk,
      contentBearing: policy.contentBearing,
      reasons: blockers.filter((item) =>
        /(content|tool|local|oauth|plugin|mcp|whole_map|update)/i.test(item),
      ),
    },
    restart: {
      scope: policy.restart,
      acknowledged: payload.restartAcknowledged === true,
    },
    confirmation: {
      required: mutating,
      phrase: mutating
        ? `${operation} ${profile}/${resource?.name ?? resource?.kind ?? "resource"}`
        : null,
    },
    rollback: rollbackFor(operation, payload),
    state: blockers.length ? "blocked" : "preview_ready",
    blockers,
  };

  envelope.envelopeDigest = sha256(envelope);
  return envelope;
}

export function authorizeAfterCanonicalReread(
  envelope,
  rereadSnapshot,
  { confirmationPhrase = null } = {},
) {
  if (!envelope || envelope.version !== ENVELOPE_VERSION) {
    throw new TypeError("invalid envelope");
  }
  if (envelope.execute !== false) {
    throw new TypeError("prototype envelopes must remain preview-only");
  }
  if (envelope.state !== "preview_ready") {
    return {
      authorized: false,
      reason: "preview_blocked",
      blockers: envelope.blockers ?? [],
    };
  }

  const rereadFingerprint = fingerprintSnapshot(rereadSnapshot);
  const expected = envelope.preconditions.expectedFingerprint;
  if (rereadFingerprint !== expected) {
    return {
      authorized: false,
      reason: "stale_state",
      expectedFingerprint: expected,
      rereadFingerprint,
    };
  }
  if (
    envelope.confirmation?.required &&
    confirmationPhrase !== envelope.confirmation.phrase
  ) {
    return {
      authorized: false,
      reason: "typed_confirmation_missing_or_mismatched",
      rereadFingerprint,
    };
  }
  return {
    authorized: true,
    reason: "canonical_state_matches",
    rereadFingerprint,
    mutationInstruction: null,
  };
}

export function reconcileAfterMutation({
  envelope,
  beforeFingerprint,
  expectedAfterFingerprint,
  canonicalReread,
  transport,
}) {
  const actualFingerprint = fingerprintSnapshot(canonicalReread);
  let outcome;
  if (actualFingerprint === expectedAfterFingerprint) {
    outcome = "verified_applied";
  } else if (actualFingerprint === beforeFingerprint) {
    outcome = transport?.definitiveFailure ? "verified_not_applied" : "outcome_unknown";
  } else {
    outcome = "outcome_unknown";
  }

  return {
    actionId: envelope.actionId,
    outcome,
    retryAllowed: false,
    beforeFingerprint,
    expectedAfterFingerprint,
    actualFingerprint,
    canonicalReread: true,
    note:
      outcome === "outcome_unknown"
        ? "Do not retry automatically. Re-inventory Hermes and require a new preview."
        : null,
  };
}

export function supportedOperations() {
  return Object.keys(POLICIES).sort();
}
