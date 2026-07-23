import { createHash } from "node:crypto";

const SUPPORTED_INSTALL_METHODS = new Set(["git", "docker", "nix", "nixos"]);
const APPLYABLE_IN_PLACE = new Set(["git"]);
const TERMINAL_OUTCOMES = new Set(["succeeded", "rolled_back", "not_applied"]);

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

function sha256(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function shortRevision(revision) {
  return revision ? revision.slice(0, 12) : "unknown";
}

function normalizeTests(tests = []) {
  return tests.map((test) => ({
    id: test.id,
    required: test.required !== false,
    status: test.status ?? "pending",
    evidence: test.evidence ?? null,
  }));
}

function collectBlockers(snapshot) {
  const blockers = [];
  const method = snapshot.installed.installMethod;

  if (!SUPPORTED_INSTALL_METHODS.has(method)) {
    blockers.push({
      code: "install_method_unknown",
      detail: "The install method is not an upstream-supported update route.",
    });
  } else if (!APPLYABLE_IN_PLACE.has(method)) {
    blockers.push({
      code: "install_method_external",
      detail: `The ${method} install must be updated by its owning package manager.`,
    });
  }

  if (!snapshot.installed.revision || !snapshot.target.revision) {
    blockers.push({
      code: "revision_unknown",
      detail: "Both current and target revisions must be immutable commit identifiers.",
    });
  }

  if (snapshot.installed.remoteAuthority !== "official") {
    blockers.push({
      code: "remote_not_official",
      detail: "The running checkout is not proven to track the official source.",
    });
  }

  const patches = snapshot.installed.localPatches;
  if (
    patches.localCommitCount > 0 ||
    patches.trackedChangeCount > 0 ||
    patches.untrackedPathCount > 0
  ) {
    blockers.push({
      code: "local_patches_require_decision",
      detail:
        "Local commits or working-tree content require an explicit preserve, port, or abandon decision.",
    });
  }

  if (!snapshot.rollback.revision) {
    blockers.push({
      code: "rollback_target_missing",
      detail: "A verified rollback revision has not been captured.",
    });
  }

  if (!snapshot.rollback.stateSnapshotVerified) {
    blockers.push({
      code: "state_snapshot_unverified",
      detail: "The pre-update state snapshot is absent or unverified.",
    });
  }

  if (!snapshot.machine.compatible) {
    blockers.push({
      code: "machine_contract_incompatible",
      detail: "The target has not passed the machine compatibility contract.",
    });
  }

  for (const companion of snapshot.companions) {
    if (companion.required && !companion.approved) {
      blockers.push({
        code: "companion_not_approved",
        companion: companion.id,
        detail: `Required ${companion.kind} companion has not been approved.`,
      });
    }
    if (companion.required && companion.compatibility !== "compatible") {
      blockers.push({
        code: "companion_incompatible",
        companion: companion.id,
        detail: `Required ${companion.kind} companion is ${companion.compatibility}.`,
      });
    }
  }

  for (const test of snapshot.sideBySideTests) {
    if (test.required && test.status !== "passed") {
      blockers.push({
        code: "side_by_side_test_incomplete",
        test: test.id,
        detail: `Required side-by-side test is ${test.status}.`,
      });
    }
  }

  return blockers;
}

function materialSnapshot(input) {
  return {
    installed: {
      version: input.installed.version,
      revision: input.installed.revision,
      branch: input.installed.branch,
      installMethod: input.installed.installMethod,
      remoteAuthority: input.installed.remoteAuthority,
      localPatches: {
        localCommitCount: input.installed.localPatches?.localCommitCount ?? 0,
        trackedChangeCount: input.installed.localPatches?.trackedChangeCount ?? 0,
        untrackedPathCount: input.installed.localPatches?.untrackedPathCount ?? 0,
        fingerprint: input.installed.localPatches?.fingerprint ?? null,
      },
    },
    target: {
      version: input.target.version,
      revision: input.target.revision,
      branch: input.target.branch,
      changedCommitCount: input.target.changedCommitCount,
      releaseNotesRef: input.target.releaseNotesRef ?? null,
    },
    machine: {
      os: input.machine.os,
      architecture: input.machine.architecture,
      python: input.machine.python,
      node: input.machine.node,
      compatible: input.machine.compatible === true,
      contractFingerprint: input.machine.contractFingerprint,
    },
    companions: (input.companions ?? []).map((companion) => ({
      id: companion.id,
      kind: companion.kind,
      revision: companion.revision,
      basedOn: companion.basedOn,
      required: companion.required === true,
      approved: companion.approved === true,
      compatibility: companion.compatibility ?? "untested",
      evidence: companion.evidence ?? null,
    })),
    sideBySideTests: normalizeTests(input.sideBySideTests),
    restart: {
      scope: [...(input.restart.scope ?? [])].sort(),
      expectedDowntimeSeconds: input.restart.expectedDowntimeSeconds ?? null,
      requiresDrain: input.restart.requiresDrain === true,
    },
    rollback: {
      revision: input.rollback.revision,
      stateSnapshotId: input.rollback.stateSnapshotId ?? null,
      stateSnapshotVerified: input.rollback.stateSnapshotVerified === true,
      strategy: input.rollback.strategy,
    },
  };
}

/**
 * Produce a deterministic, preview-only update intent.
 *
 * This module deliberately has no filesystem, process, network, restart, or
 * updater dispatch function. A future Cabinet adapter must re-read native
 * state and verify `fingerprint` immediately before any separately authorized
 * dispatch.
 */
export function prepareUpdatePreview(input) {
  const snapshot = materialSnapshot(input);
  const fingerprint = sha256(snapshot);
  const blockers = collectBlockers(snapshot);
  const confirmationPhrase =
    `UPDATE HERMES ${shortRevision(snapshot.installed.revision)} ` +
    `TO ${shortRevision(snapshot.target.revision)} ` +
    `ROLLBACK ${shortRevision(snapshot.rollback.revision)}`;

  return {
    schemaVersion: 1,
    operationId: `hermes-update:${fingerprint.slice(0, 24)}`,
    fingerprint,
    state: blockers.length ? "blocked" : "awaiting_confirmation",
    snapshot,
    changedCommits: {
      count: snapshot.target.changedCommitCount,
      releaseNotesRef: snapshot.target.releaseNotesRef,
    },
    restart: snapshot.restart,
    rollback: snapshot.rollback,
    blockers,
    confirmation: {
      phrase: confirmationPhrase,
      targetRevision: snapshot.target.revision,
      rollbackRevision: snapshot.rollback.revision,
      expectedFingerprint: fingerprint,
    },
    dispatchAvailable: false,
  };
}

export function validateConfirmation(preview, submission) {
  if (preview.state !== "awaiting_confirmation") {
    return { accepted: false, reason: "preview_not_confirmable" };
  }
  if (submission.fingerprint !== preview.fingerprint) {
    return { accepted: false, reason: "stale_preview" };
  }
  if (submission.phrase !== preview.confirmation.phrase) {
    return { accepted: false, reason: "confirmation_mismatch" };
  }
  return {
    accepted: true,
    reason: null,
    state: "ready_for_separately_authorized_dispatch",
    operationId: preview.operationId,
  };
}

/**
 * Classify a hypothetical apply attempt without retrying it.
 *
 * Once dispatch may have started, absence of a verified terminal revision is
 * `outcome_unknown`. The only permitted next action is native reconciliation.
 */
export function classifyApplyOutcome({
  dispatchAcknowledged,
  observedRevision,
  targetRevision,
  rollbackRevision,
  updaterExitCode,
  servicesHealthy,
}) {
  if (!dispatchAcknowledged) {
    return {
      state: "not_applied",
      retryAllowed: true,
      reconciliationRequired: false,
    };
  }

  if (observedRevision === targetRevision && updaterExitCode === 0 && servicesHealthy === true) {
    return {
      state: "succeeded",
      retryAllowed: false,
      reconciliationRequired: false,
    };
  }

  if (observedRevision === rollbackRevision && servicesHealthy === true) {
    return {
      state: "rolled_back",
      retryAllowed: false,
      reconciliationRequired: false,
    };
  }

  return {
    state: "outcome_unknown",
    retryAllowed: false,
    reconciliationRequired: true,
  };
}

export function reconcileOutcome(outcome, observation) {
  if (outcome.state !== "outcome_unknown") {
    return outcome;
  }

  const reconciled = classifyApplyOutcome({
    ...observation,
    dispatchAcknowledged: true,
  });

  if (!TERMINAL_OUTCOMES.has(reconciled.state)) {
    return outcome;
  }
  return reconciled;
}
