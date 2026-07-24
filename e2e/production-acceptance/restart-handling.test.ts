import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyRestartRequestFailure,
  ControlledRestartTracker,
  type RestartPhase,
} from "./restart-handling";

const phases: RestartPhase[] = [
  "restart_requested",
  "child_stopping",
  "listener_unavailable",
  "child_starting",
  "health_ready",
  "browser_reconnected",
  "acceptance_resumed",
];

test("controlled restart records the exact bounded phase sequence", () => {
  let time = 100;
  const tracker = new ControlledRestartTracker(() => time);
  for (const phase of phases) {
    tracker.transition(phase);
    time += 10;
  }
  assert.deepEqual(tracker.complete(), {
    phases,
    listenerUnavailableMs: 10,
    recoveryMs: 40,
    expectedRequestFailures: 0,
    expectedConsoleFailures: 0,
  });
});

test("read-only reset started before health is expected only inside the restart window", () => {
  assert.deepEqual(
    classifyRestartRequestFailure(
      { method: "GET", path: "/api/health", startedPhase: null },
      "listener_unavailable",
      "net::ERR_CONNECTION_RESET",
    ),
    { expected: true, reason: "expected_read_only_listener_loss" },
  );
  assert.deepEqual(
    classifyRestartRequestFailure(
      { method: "GET", path: "/api/health", startedPhase: "child_stopping" },
      "child_starting",
      "net::ERR_CONNECTION_RESET",
    ),
    { expected: true, reason: "expected_read_only_listener_loss" },
  );
  assert.deepEqual(
    classifyRestartRequestFailure(
      { method: "GET", path: "/api/health", startedPhase: "health_ready" },
      "health_ready",
      "net::ERR_CONNECTION_RESET",
    ),
    { expected: false, reason: "outside_restart_window" },
  );
});

test("consequential requests are never classified as expected or retried", () => {
  for (const [method, path] of [
    ["POST", "/api/agents/conversations"],
    ["POST", "/api/agents/conversations/id/continue"],
    ["POST", "/api/hermes/skills-management/remove"],
    ["POST", "/api/terminal"],
  ]) {
    assert.equal(
      classifyRestartRequestFailure(
        { method, path, startedPhase: "child_stopping" },
        "listener_unavailable",
        "net::ERR_CONNECTION_RESET",
      ).expected,
      false,
    );
  }
});

test("read-only conversation and Hermes projections may fail transiently but are never retried here", () => {
  for (const path of [
    "/api/agents/conversations/id",
    "/api/hermes/runs",
    "/api/hermes/skills-management",
  ]) {
    assert.equal(
      classifyRestartRequestFailure(
        { method: "GET", path, startedPhase: null },
        "listener_unavailable",
        "net::ERR_CONNECTION_RESET",
      ).expected,
      true,
    );
  }
});

test("non-reset errors and post-health resets remain product failures", () => {
  assert.equal(
    classifyRestartRequestFailure(
      { method: "GET", path: "/api/health", startedPhase: "child_stopping" },
      "listener_unavailable",
      "TypeError: invalid response",
    ).expected,
    false,
  );
  assert.equal(
    classifyRestartRequestFailure(
      { method: "GET", path: "/api/health", startedPhase: "child_stopping" },
      "browser_reconnected",
      "net::ERR_CONNECTION_RESET",
    ).expected,
    false,
  );
});

test("console resets require a correlated failed read-only request", () => {
  const tracker = new ControlledRestartTracker();
  tracker.transition("restart_requested");
  tracker.transition("child_stopping");
  const request = tracker.request("GET", "/api/health");
  tracker.transition("listener_unavailable");
  assert.equal(tracker.consoleTransportFailure("net::ERR_CONNECTION_RESET"), true);
  tracker.transition("child_starting");
  assert.equal(tracker.requestFailed(request, "net::ERR_CONNECTION_RESET").expected, true);
  tracker.transition("health_ready");
  tracker.transition("browser_reconnected");
  tracker.transition("acceptance_resumed");
  assert.doesNotThrow(() => tracker.complete());
});

test("uncorrelated reset and unhandled rejection fail closed", () => {
  const uncorrelated = new ControlledRestartTracker();
  uncorrelated.transition("restart_requested");
  uncorrelated.transition("child_stopping");
  uncorrelated.transition("listener_unavailable");
  uncorrelated.consoleTransportFailure("net::ERR_CONNECTION_RESET");
  uncorrelated.transition("child_starting");
  uncorrelated.transition("health_ready");
  uncorrelated.transition("browser_reconnected");
  uncorrelated.transition("acceptance_resumed");
  assert.throws(() => uncorrelated.complete(), /not correlated/);

  const unhandled = new ControlledRestartTracker();
  for (const phase of phases) unhandled.transition(phase);
  unhandled.unhandledError();
  assert.throws(() => unhandled.complete(), /unhandled browser error/);
});
