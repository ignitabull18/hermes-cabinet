import test from "node:test";
import assert from "node:assert/strict";
import {
  PreviewOnlyCoordinator,
  prepare,
  snapshotFingerprint,
} from "./governance.js";
import { fixtureSnapshot } from "./fixtures.js";

test("snapshot requires six distinct state planes", () => {
  const snapshot = fixtureSnapshot();
  assert.equal(snapshotFingerprint(snapshot).length, 64);
  const { effectiveRuntime: _, ...missing } = snapshot;
  assert.throws(() => snapshotFingerprint(missing), /effectiveRuntime/);
});

test("select-model preview binds exact target and preserves running-session truth", () => {
  const preview = prepare(fixtureSnapshot(), {
    action: "select_model",
    target: { provider: "provider-a", model: "model-a-large" },
  });
  assert.equal(preview.targetFingerprint.length, 64);
  assert.match(preview.confirmationPhrase, /^CONFIRM SELECT_MODEL/);
  assert.equal(
    preview.exactDiff.effectiveRuntime.after,
    "unchanged_until_new_session_or_explicit_session_switch",
  );
  assert.deepEqual(preview.dispatchPolicy, {
    maxDispatches: 1,
    automaticRetries: 0,
    timeoutOutcome: "outcome_unknown",
  });
});

test("provider change requires advertised model and ready account", () => {
  const snapshot = fixtureSnapshot();
  assert.throws(
    () =>
      prepare(snapshot, {
        action: "change_provider",
        target: { provider: "provider-b", model: "not-advertised" },
      }),
    /not advertised/,
  );
  const blocked = fixtureSnapshot({
    providerAccounts: snapshot.providerAccounts.map((row) =>
      row.id === "provider-b" ? { ...row, state: "unavailable" } : row,
    ),
  });
  assert.throws(
    () =>
      prepare(blocked, {
        action: "change_provider",
        target: { provider: "provider-b", model: "model-b" },
      }),
    /not canonically ready/,
  );
});

test("profile override is profile-bound", () => {
  assert.throws(
    () =>
      prepare(fixtureSnapshot(), {
        action: "apply_profile_override",
        target: {
          profile: "another-profile",
          provider: "provider-a",
          model: "model-a",
        },
      }),
    /profile target/,
  );
});

test("OAuth initiation excludes external flows and revoke excludes external credentials", () => {
  const snapshot = fixtureSnapshot();
  const oauth = prepare(snapshot, {
    action: "initiate_oauth",
    target: { provider: "provider-b" },
  });
  assert.equal(oauth.exactDiff.configuredDefault.after, "unchanged");
  assert.throws(
    () =>
      prepare(snapshot, {
        action: "initiate_oauth",
        target: { provider: "external" },
      }),
    /no Hermes-managed OAuth/,
  );
  assert.throws(
    () =>
      prepare(snapshot, {
        action: "revoke_provider",
        target: { provider: "external" },
      }),
    /externally managed/,
  );
});

test("commit blocks stale state before dispatch", async () => {
  const snapshot = fixtureSnapshot();
  const preview = prepare(snapshot, {
    action: "select_model",
    target: { provider: "provider-a", model: "model-a-large" },
  });
  let dispatches = 0;
  const stale = fixtureSnapshot({
    configuredDefault: {
      source: "fixture:profile-config",
      provider: "provider-b",
      model: "model-b",
    },
  });
  await assert.rejects(
    new PreviewOnlyCoordinator().commit({
      preview,
      confirmation: preview.confirmationPhrase,
      reread: async () => stale,
      dispatch: async () => {
        dispatches += 1;
      },
      verify: async () => ({ ok: true }),
    }),
    /stale canonical state/,
  );
  assert.equal(dispatches, 0);
});

test("ambiguous dispatch returns outcome_unknown and never retries", async () => {
  const snapshot = fixtureSnapshot();
  const preview = prepare(snapshot, {
    action: "initiate_oauth",
    target: { provider: "provider-b" },
  });
  let dispatches = 0;
  const receipt = await new PreviewOnlyCoordinator().commit({
    preview,
    confirmation: preview.confirmationPhrase,
    reread: async () => snapshot,
    dispatch: async () => {
      dispatches += 1;
      throw new Error("fixture timeout after write boundary");
    },
    verify: async () => ({ ok: false }),
  });
  assert.equal(receipt.status, "outcome_unknown");
  assert.equal(receipt.dispatchCount, 1);
  assert.equal(receipt.automaticRetries, 0);
  assert.equal(dispatches, 1);
});

test("receipt is idempotent and verified only after canonical readback", async () => {
  const snapshot = fixtureSnapshot();
  const post = fixtureSnapshot({
    configuredDefault: {
      source: "fixture:profile-config",
      provider: "provider-a",
      model: "model-a-large",
    },
  });
  const preview = prepare(snapshot, {
    action: "select_model",
    target: { provider: "provider-a", model: "model-a-large" },
  });
  const coordinator = new PreviewOnlyCoordinator();
  let reads = 0;
  let dispatches = 0;
  const invoke = () =>
    coordinator.commit({
      preview,
      confirmation: preview.confirmationPhrase,
      reread: async () => (++reads === 1 ? snapshot : post),
      dispatch: async () => {
        dispatches += 1;
        return { accepted: true };
      },
      verify: async ({ postState, target }) => ({
        ok:
          postState.configuredDefault.provider === target.provider &&
          postState.configuredDefault.model === target.model,
        source: postState.configuredDefault.source,
      }),
    });
  const first = await invoke();
  const second = await invoke();
  assert.equal(first.status, "verified");
  assert.equal(second, first);
  assert.equal(dispatches, 1);
  assert.equal(first.readback.source, "fixture:profile-config");
});
