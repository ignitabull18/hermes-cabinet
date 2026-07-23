import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyApplyOutcome,
  prepareUpdatePreview,
  reconcileOutcome,
  validateConfirmation,
} from "../src/update-preview.mjs";

const installedRevision = "55759cb2737cd3870f9de4693f66fa38eaf0dd2b";
const targetRevision = "01b0451909eaada46c455387706ddf21ca1e113c";

function readyInput() {
  return {
    installed: {
      version: "0.19.0",
      revision: installedRevision,
      branch: "main",
      installMethod: "git",
      remoteAuthority: "official",
      localPatches: {
        localCommitCount: 0,
        trackedChangeCount: 0,
        untrackedPathCount: 0,
        fingerprint: "clean",
      },
    },
    target: {
      version: "0.19.0",
      revision: targetRevision,
      branch: "main",
      changedCommitCount: 265,
      releaseNotesRef: `official-compare:${installedRevision}...${targetRevision}`,
    },
    machine: {
      os: "darwin",
      architecture: "arm64",
      python: "3.13",
      node: "managed",
      compatible: true,
      contractFingerprint: "fixture-machine-contract",
    },
    companions: [
      {
        id: "skills-cli",
        kind: "skills",
        revision: "78a803a013547794a295d674982f1fe0515f5713",
        basedOn: "d7b36070ef807841699ad32c5b6af547fee3ff64",
        required: true,
        approved: true,
        compatibility: "compatible",
        evidence: "side-by-side:skills-contract",
      },
      {
        id: "cabinet-acp",
        kind: "acp",
        revision: "139214139446dd705423589afb0c9ba072e4bafe",
        basedOn: installedRevision,
        required: true,
        approved: true,
        compatibility: "compatible",
        evidence: "side-by-side:acp-contract",
      },
    ],
    sideBySideTests: [
      { id: "cli-contract", required: true, status: "passed", evidence: "fixture" },
      { id: "acp-contract", required: true, status: "passed", evidence: "fixture" },
      { id: "skills-canary-read-only", required: true, status: "passed", evidence: "fixture" },
      { id: "gateway-restart-drain", required: true, status: "passed", evidence: "fixture" },
      { id: "rollback-rehearsal", required: true, status: "passed", evidence: "fixture" },
    ],
    restart: {
      scope: ["desktop-backend", "gateway:all-running-profiles"],
      expectedDowntimeSeconds: 60,
      requiresDrain: true,
    },
    rollback: {
      revision: installedRevision,
      stateSnapshotId: "fixture-snapshot",
      stateSnapshotVerified: true,
      strategy: "side-by-side-promote-and-pointer-revert",
    },
  };
}

test("prepare is deterministic and never exposes an apply dispatcher", () => {
  const first = prepareUpdatePreview(readyInput());
  const second = prepareUpdatePreview(readyInput());

  assert.equal(first.state, "awaiting_confirmation");
  assert.equal(first.operationId, second.operationId);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.dispatchAvailable, false);
  assert.equal("apply" in first, false);
});

test("local source content blocks the update before confirmation", () => {
  const input = readyInput();
  input.installed.localPatches.untrackedPathCount = 1;
  input.installed.localPatches.fingerprint = "has-local-content";

  const preview = prepareUpdatePreview(input);

  assert.equal(preview.state, "blocked");
  assert.ok(preview.blockers.some((blocker) => blocker.code === "local_patches_require_decision"));
});

test("external package-manager installs cannot use in-place dispatch", () => {
  const input = readyInput();
  input.installed.installMethod = "nix";

  const preview = prepareUpdatePreview(input);

  assert.ok(preview.blockers.some((blocker) => blocker.code === "install_method_external"));
});

test("untested required companion and pending side-by-side test both block", () => {
  const input = readyInput();
  input.companions[0].compatibility = "untested";
  input.companions[0].approved = false;
  input.sideBySideTests[1].status = "pending";

  const preview = prepareUpdatePreview(input);

  assert.ok(preview.blockers.some((blocker) => blocker.code === "companion_incompatible"));
  assert.ok(preview.blockers.some((blocker) => blocker.code === "companion_not_approved"));
  assert.ok(preview.blockers.some((blocker) => blocker.code === "side_by_side_test_incomplete"));
});

test("typed confirmation binds exact phrase and current fingerprint", () => {
  const preview = prepareUpdatePreview(readyInput());

  assert.deepEqual(
    validateConfirmation(preview, {
      phrase: preview.confirmation.phrase,
      fingerprint: preview.fingerprint,
    }),
    {
      accepted: true,
      reason: null,
      state: "ready_for_separately_authorized_dispatch",
      operationId: preview.operationId,
    },
  );
  assert.equal(
    validateConfirmation(preview, {
      phrase: preview.confirmation.phrase,
      fingerprint: "stale",
    }).reason,
    "stale_preview",
  );
});

test("ambiguous post-dispatch state is outcome_unknown and cannot be retried", () => {
  const outcome = classifyApplyOutcome({
    dispatchAcknowledged: true,
    observedRevision: null,
    targetRevision,
    rollbackRevision: installedRevision,
    updaterExitCode: null,
    servicesHealthy: null,
  });

  assert.deepEqual(outcome, {
    state: "outcome_unknown",
    retryAllowed: false,
    reconciliationRequired: true,
  });
});

test("native reconciliation can resolve outcome_unknown without redispatch", () => {
  const unknown = {
    state: "outcome_unknown",
    retryAllowed: false,
    reconciliationRequired: true,
  };

  const reconciled = reconcileOutcome(unknown, {
    observedRevision: targetRevision,
    targetRevision,
    rollbackRevision: installedRevision,
    updaterExitCode: 0,
    servicesHealthy: true,
  });

  assert.deepEqual(reconciled, {
    state: "succeeded",
    retryAllowed: false,
    reconciliationRequired: false,
  });
});
