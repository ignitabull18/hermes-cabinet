import assert from "node:assert/strict";
import test from "node:test";

import {
  DispatchLedger,
  GovernanceError,
  prepareChange,
  readState,
} from "./contract.mjs";

const installedRevision = "55759cb2737cd3870f9de4693f66fa38eaf0dd2b";

function fixture() {
  return {
    installedRevision,
    profiles: [
      {
        name: "default",
        settings: { "display.skin": "default" },
        service: { gatewayRunning: false },
      },
      {
        name: "worker",
        settings: { "terminal.backend": "local" },
        service: { gatewayRunning: true },
      },
    ],
    active: { sticky: "default", current: "default" },
  };
}

test("readState is deterministic and does not accept secret-bearing fields", () => {
  const first = readState(fixture());
  const reordered = fixture();
  reordered.profiles.reverse();
  assert.equal(readState(reordered).revision, first.revision);

  const unsafe = fixture();
  unsafe.profiles[0].settings.api_token = "do-not-read";
  assert.throws(
    () => readState(unsafe),
    (error) => error instanceof GovernanceError && error.code === "secret_field",
  );
});

test("prepare rejects stale state and produces an exact diff and typed phrase", () => {
  const state = readState(fixture());
  assert.throws(
    () =>
      prepareChange(state, {
        operation: "settings.patch",
        target: "worker",
        baseRevision: "stale",
        patch: { "terminal.backend": "docker" },
      }),
    (error) => error instanceof GovernanceError && error.code === "stale_state",
  );

  const prepared = prepareChange(state, {
    operation: "settings.patch",
    target: "worker",
    baseRevision: state.revision,
    patch: { "terminal.backend": "docker" },
  });
  assert.match(
    prepared.confirmationPhrase,
    /^APPLY HERMES SETTINGS\.PATCH worker [0-9a-f]{12}$/,
  );
  assert.equal(prepared.nativeDispatch.path, "/api/config?profile=worker");
  assert.equal(prepared.restart.automatic, false);
  assert.ok(prepared.diff.changedPaths.some((path) => path.includes("settings")));
});

test("profile selection distinguishes sticky active from current process and requires relaunch", () => {
  const state = readState(fixture());
  const prepared = prepareChange(state, {
    operation: "profile.select",
    target: "worker",
    baseRevision: state.revision,
  });
  assert.equal(prepared.expectedState.active.sticky, "worker");
  assert.equal(prepared.expectedState.active.current, "default");
  assert.equal(prepared.restart.required, true);
});

test("delete refuses the default and the running process profile", () => {
  const state = readState(fixture());
  for (const target of ["default"]) {
    assert.throws(
      () =>
        prepareChange(state, {
          operation: "profile.delete",
          target,
          baseRevision: state.revision,
        }),
      GovernanceError,
    );
  }

  const running = fixture();
  running.active.current = "worker";
  const runningState = readState(running);
  assert.throws(
    () =>
      prepareChange(runningState, {
        operation: "profile.delete",
        target: "worker",
        baseRevision: runningState.revision,
      }),
    (error) => error instanceof GovernanceError && error.code === "active_process_conflict",
  );
});

test("one dispatch is retained and canonical reread decides the outcome", async () => {
  const state = readState(fixture());
  const prepared = prepareChange(state, {
    operation: "profile.select",
    target: "worker",
    baseRevision: state.revision,
  });
  const ledger = new DispatchLedger();
  let dispatches = 0;
  const native = async () => {
    dispatches += 1;
    throw new Error("transport closed after dispatch");
  };
  const reread = async () => prepared.expectedState;

  const first = await ledger.dispatch(
    prepared,
    prepared.confirmationPhrase,
    native,
    reread,
  );
  const second = await ledger.dispatch(
    prepared,
    prepared.confirmationPhrase,
    native,
    reread,
  );
  assert.equal(dispatches, 1);
  assert.equal(first.phase, "verified");
  assert.equal(first.nativeOutcome, "outcome_unknown");
  assert.deepEqual(second, first);
  assert.equal(first.retryAllowed, false);
});

test("wrong confirmation blocks dispatch", async () => {
  const state = readState(fixture());
  const prepared = prepareChange(state, {
    operation: "profile.create",
    target: "new-worker",
    baseRevision: state.revision,
    settings: {},
  });
  const ledger = new DispatchLedger();
  await assert.rejects(
    ledger.dispatch(prepared, "wrong", async () => ({ ok: true }), async () => state),
    (error) => error instanceof GovernanceError && error.code === "confirmation_mismatch",
  );
});
