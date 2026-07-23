import assert from "node:assert/strict";
import test from "node:test";

import { makeFixture, digest } from "./fixtures.js";
import {
  Coordinator,
  managementSurface,
  prepare,
  verifyCancelled,
} from "./governance.js";

function updateIntent(key = "update-1") {
  return {
    action: "update_schedule",
    targetId: "job-1",
    idempotencyKey: key,
    patch: { cadence: "0 10 * * *" },
  };
}

test("surface keeps enumeration and subsystem boundaries explicit", () => {
  const surface = managementSurface();
  assert.equal(surface.schedules.globalEnumeration, "desktop_management_only");
  assert.equal(surface.liveRuns.globalEnumeration, false);
  assert.equal(surface.approvals.exactRequestTargeting, false);
  assert.equal(surface.workers.separateFromAgentRuns, true);
});

test("typed confirmation and fresh readback produce a verified update", () => {
  const fixture = makeFixture();
  const plan = prepare(fixture, updateIntent());
  const result = new Coordinator().execute(fixture, plan, plan.confirmation);
  assert.equal(result.outcome, "verified");
  assert.equal(result.dispatches, 1);
  assert.equal(fixture.state.dispatchCount, 1);
});

test("create verifies the exact metadata projection without retaining payload content", () => {
  const fixture = makeFixture();
  const plan = prepare(fixture, {
    action: "create_schedule",
    targetId: "job-new",
    idempotencyKey: "create-1",
    profile: "default",
    name: "New fixture schedule",
    cadence: "0 11 * * *",
    payloadDigest: digest("new-fixture-payload"),
    payloadRef: "opaque:short-lived-reference",
  });
  assert.equal("payloadRef" in plan.intent, false);
  const result = new Coordinator().execute(fixture, plan, plan.confirmation);
  assert.equal(result.outcome, "verified");
  assert.equal(fixture.state.schedules.get("job-new").revision, 1);
});

test("stale target blocks before dispatch", () => {
  const fixture = makeFixture();
  const plan = prepare(fixture, updateIntent());
  fixture.state.schedules.get("job-1").revision += 1;
  const result = new Coordinator().execute(fixture, plan, plan.confirmation);
  assert.deepEqual(result, {
    outcome: "blocked",
    reason: "stale_target",
    dispatches: 0,
  });
  assert.equal(fixture.state.dispatchCount, 0);
});

test("confirmation mismatch blocks before dispatch", () => {
  const fixture = makeFixture();
  const plan = prepare(fixture, updateIntent());
  const result = new Coordinator().execute(fixture, plan, "CONFIRM something else");
  assert.equal(result.reason, "confirmation_mismatch");
  assert.equal(fixture.state.dispatchCount, 0);
});

test("receipt replay is idempotent and never redispatches", () => {
  const fixture = makeFixture();
  const plan = prepare(fixture, updateIntent("same-key"));
  const coordinator = new Coordinator();
  const first = coordinator.execute(fixture, plan, plan.confirmation);
  const second = coordinator.execute(fixture, plan, plan.confirmation);
  assert.equal(first.receiptId, second.receiptId);
  assert.equal(second.replayed, true);
  assert.equal(fixture.state.dispatchCount, 1);
});

test("transport loss after mutation is verified by durable readback", () => {
  const fixture = makeFixture({ failAfterMutation: true });
  const plan = prepare(fixture, {
    action: "trigger_schedule",
    targetId: "job-1",
    idempotencyKey: "trigger-1",
    executionId: "exec-1",
    correlationId: "corr-1",
  });
  const result = new Coordinator().execute(fixture, plan, plan.confirmation);
  assert.equal(result.outcome, "verified");
  assert.equal(result.transportError, "dispatch_result_unavailable");
  assert.equal(result.retryAllowed, false);
  assert.equal(fixture.state.dispatchCount, 1);
});

test("delete verifies absence and remains idempotent through its receipt", () => {
  const fixture = makeFixture();
  const plan = prepare(fixture, {
    action: "delete_schedule",
    targetId: "job-1",
    idempotencyKey: "delete-1",
  });
  const coordinator = new Coordinator();
  const first = coordinator.execute(fixture, plan, plan.confirmation);
  const replay = coordinator.execute(fixture, plan, plan.confirmation);
  assert.equal(first.outcome, "verified");
  assert.equal(replay.replayed, true);
  assert.equal(fixture.state.dispatchCount, 1);
});

test("ambiguous trigger is outcome_unknown and is not retried", () => {
  const fixture = makeFixture();
  fixture.dispatch = () => {
    fixture.state.dispatchCount += 1;
    throw new Error("timeout before a durable execution ID was observed");
  };
  const plan = prepare(fixture, {
    action: "trigger_schedule",
    targetId: "job-1",
    idempotencyKey: "trigger-unknown",
    correlationId: "corr-unknown",
  });
  const result = new Coordinator().execute(fixture, plan, plan.confirmation);
  assert.equal(result.outcome, "outcome_unknown");
  assert.equal(result.retryAllowed, false);
  assert.equal(fixture.state.dispatchCount, 1);
});

test("clarification resolution targets one request and keeps response content out of plan", () => {
  const fixture = makeFixture();
  const plan = prepare(fixture, {
    action: "resolve_clarification",
    targetId: "clarify-1",
    idempotencyKey: "clarify-answer-1",
    responseDigest: digest("fixture-response"),
    response: "must-not-enter-plan",
  });
  assert.equal("response" in plan.intent, false);
  const result = new Coordinator().execute(fixture, plan, plan.confirmation);
  assert.equal(result.outcome, "verified");
});

test("approval resolution is blocked because upstream can only resolve session FIFO", () => {
  const fixture = makeFixture();
  assert.throws(
    () =>
      prepare(fixture, {
        action: "resolve_approval",
        targetId: "approval-1",
        idempotencyKey: "approval-1",
      }),
    /cannot target an approval request ID/,
  );
  assert.equal(fixture.state.dispatchCount, 0);
});

test("run retry and resume are rejected as unsupported upstream capabilities", () => {
  const fixture = makeFixture();
  for (const action of ["retry_run", "resume_run"]) {
    assert.throws(
      () =>
        prepare(fixture, {
          action,
          targetId: "run-1",
          idempotencyKey: action,
        }),
      /unsupported upstream capability/,
    );
  }
});

test("run termination is disabled while cancellation verification remains exact", () => {
  const fixture = makeFixture();
  assert.throws(
    () =>
      prepare(fixture, {
        action: "cancel_run",
        targetId: "run-1",
        idempotencyKey: "cancel-1",
      }),
    /disabled by stream policy/,
  );
  assert.equal(verifyCancelled(fixture, "run-1").verified, false);
  fixture.state.runs.set("run-1", {
    id: "run-1",
    status: "cancelled",
    updatedAt: 101,
  });
  assert.equal(verifyCancelled(fixture, "run-1").verified, true);
  assert.equal(fixture.state.dispatchCount, 0);
});
