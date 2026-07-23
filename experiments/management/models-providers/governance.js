import { createHash, randomUUID } from "node:crypto";

export const AUDITED_HERMES_REVISION =
  "55759cb2737cd3870f9de4693f66fa38eaf0dd2b";

const ACTIONS = new Set([
  "select_model",
  "change_provider",
  "apply_profile_override",
  "initiate_oauth",
  "revoke_provider",
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

export function fingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

function assertSnapshot(snapshot) {
  if (snapshot?.schema !== "hermes.models-providers.snapshot/v1") {
    throw new Error("unsupported canonical snapshot");
  }
  if (snapshot.hermesRevision !== AUDITED_HERMES_REVISION) {
    throw new Error("unaudited Hermes revision");
  }
  for (const key of [
    "modelCatalog",
    "configuredDefault",
    "effectiveRuntime",
    "providerAccounts",
    "profileOverride",
    "historicalAudit",
  ]) {
    if (!(key in snapshot)) throw new Error(`missing state plane: ${key}`);
  }
}

export function snapshotFingerprint(snapshot) {
  assertSnapshot(snapshot);
  return fingerprint(snapshot);
}

function catalogProvider(snapshot, provider) {
  return snapshot.modelCatalog.providers.find((row) => row.id === provider);
}

function accountProvider(snapshot, provider) {
  return snapshot.providerAccounts.find((row) => row.id === provider);
}

function validateIntent(snapshot, action, target) {
  if (!ACTIONS.has(action)) throw new Error(`unsupported action: ${action}`);
  if (!target || typeof target !== "object") throw new Error("target is required");

  if (["select_model", "change_provider", "apply_profile_override"].includes(action)) {
    const provider = catalogProvider(snapshot, target.provider);
    if (!provider) throw new Error("target provider is not in the advertised catalog");
    if (!provider.models.includes(target.model)) {
      throw new Error("target model is not advertised for the target provider");
    }
  }

  if (action === "change_provider") {
    const account = accountProvider(snapshot, target.provider);
    if (!account || account.state !== "ready") {
      throw new Error("target provider account is not canonically ready");
    }
  }

  if (action === "apply_profile_override" && target.profile !== snapshot.profile) {
    throw new Error("profile target does not match the canonical snapshot");
  }

  if (action === "initiate_oauth") {
    const account = accountProvider(snapshot, target.provider);
    if (!account || !["pkce", "device_code"].includes(account.authFlow)) {
      throw new Error("provider has no Hermes-managed OAuth initiation contract");
    }
  }

  if (action === "revoke_provider") {
    const account = accountProvider(snapshot, target.provider);
    if (!account || account.state === "absent") {
      throw new Error("provider account is already absent");
    }
    if (!account.disconnectable) {
      throw new Error("provider credentials are externally managed");
    }
  }
}

function exactDiff(snapshot, action, target) {
  if (action === "select_model" || action === "change_provider") {
    return {
      configuredDefault: {
        before: snapshot.configuredDefault,
        after: { provider: target.provider, model: target.model },
      },
      effectiveRuntime: {
        before: snapshot.effectiveRuntime,
        after: "unchanged_until_new_session_or_explicit_session_switch",
      },
    };
  }
  if (action === "apply_profile_override") {
    return {
      profileOverride: {
        before: snapshot.profileOverride,
        after: {
          profile: target.profile,
          provider: target.provider,
          model: target.model,
        },
      },
    };
  }
  if (action === "initiate_oauth") {
    return {
      providerAccount: {
        before: accountProvider(snapshot, target.provider),
        after: "pending_operator_authorization",
      },
      configuredDefault: { before: snapshot.configuredDefault, after: "unchanged" },
    };
  }
  return {
    providerAccount: {
      before: accountProvider(snapshot, target.provider),
      after: { id: target.provider, state: "absent" },
    },
    configuredDefault: {
      before: snapshot.configuredDefault,
      after: "Hermes_may_reset_if_revoked_provider_is_configured",
    },
  };
}

export function prepare(snapshot, { action, target }) {
  assertSnapshot(snapshot);
  validateIntent(snapshot, action, target);
  const targetFingerprint = fingerprint({
    hermesRevision: snapshot.hermesRevision,
    profile: snapshot.profile,
    action,
    target,
    snapshotFingerprint: snapshotFingerprint(snapshot),
  });
  const targetLabel =
    action === "initiate_oauth" || action === "revoke_provider"
      ? target.provider
      : `${target.provider}:${target.model}`;
  const confirmationPhrase =
    `CONFIRM ${action.toUpperCase()} ${snapshot.profile} ${targetLabel} ${targetFingerprint.slice(0, 12)}`;
  return Object.freeze({
    schema: "hermes.models-providers.preview/v1",
    previewId: randomUUID(),
    action,
    target: stable(target),
    profile: snapshot.profile,
    hermesRevision: snapshot.hermesRevision,
    snapshotFingerprint: snapshotFingerprint(snapshot),
    targetFingerprint,
    exactDiff: exactDiff(snapshot, action, target),
    confirmationPhrase,
    dispatchPolicy: {
      maxDispatches: 1,
      automaticRetries: 0,
      timeoutOutcome: "outcome_unknown",
    },
    readbackRequired: true,
  });
}

export class PreviewOnlyCoordinator {
  constructor() {
    this.receipts = new Map();
  }

  async commit({ preview, confirmation, reread, dispatch, verify }) {
    if (this.receipts.has(preview.previewId)) {
      return this.receipts.get(preview.previewId);
    }
    if (confirmation !== preview.confirmationPhrase) {
      throw new Error("typed confirmation mismatch");
    }

    const fresh = await reread();
    if (snapshotFingerprint(fresh) !== preview.snapshotFingerprint) {
      throw new Error("stale canonical state");
    }
    const rebuilt = prepare(fresh, {
      action: preview.action,
      target: preview.target,
    });
    if (rebuilt.targetFingerprint !== preview.targetFingerprint) {
      throw new Error("target fingerprint mismatch");
    }

    let dispatched = 0;
    let dispatchResult;
    try {
      dispatched += 1;
      dispatchResult = await dispatch({
        action: preview.action,
        target: preview.target,
        targetFingerprint: preview.targetFingerprint,
      });
    } catch (error) {
      const receipt = Object.freeze({
        previewId: preview.previewId,
        targetFingerprint: preview.targetFingerprint,
        status: "outcome_unknown",
        dispatchCount: dispatched,
        automaticRetries: 0,
        readback: "required_before_any_further_attempt",
        errorClass: error?.name || "Error",
      });
      this.receipts.set(preview.previewId, receipt);
      return receipt;
    }

    const postState = await reread();
    const verification = await verify({
      action: preview.action,
      target: preview.target,
      dispatchResult,
      postState,
    });
    const receipt = Object.freeze({
      previewId: preview.previewId,
      targetFingerprint: preview.targetFingerprint,
      status: verification.ok ? "verified" : "failed",
      dispatchCount: dispatched,
      automaticRetries: 0,
      readback: verification,
    });
    this.receipts.set(preview.previewId, receipt);
    return receipt;
  }
}
