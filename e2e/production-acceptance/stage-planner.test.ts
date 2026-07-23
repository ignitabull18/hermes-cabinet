import assert from "node:assert/strict";
import test from "node:test";

import type { AcceptanceCheck } from "./contracts";
import {
  dependencyStatus,
  independentStagesAfterFailure,
  summarizeRouteInventory,
  type AcceptanceStage,
} from "./stage-planner";

const failedConversation: AcceptanceCheck = {
  id: "live-two-turn-contract",
  area: "conversation",
  status: "failed",
  summary: "Deliberate fixture failure.",
};

test("conversation-dependent stages are BLOCKED after a primary conversation failure", () => {
  assert.deepEqual(
    dependencyStatus(
      {
        id: "conversation-direct-reload",
        area: "conversation",
        dependsOn: ["live-two-turn-contract"],
      },
      [failedConversation],
    ),
    {
      status: "blocked",
      summary: "Blocked by live-two-turn-contract:failed.",
    },
  );
});

test("missing prerequisite results are NOT_RUN rather than BLOCKED", () => {
  assert.deepEqual(
    dependencyStatus(
      {
        id: "conversation-direct-reload",
        area: "conversation",
        dependsOn: ["live-two-turn-contract"],
      },
      [],
    ),
    {
      status: "not_run",
      summary: "Prerequisite result missing: live-two-turn-contract.",
    },
  );
});

test("independent routes continue after a conversation failure", () => {
  const stages: AcceptanceStage[] = [
    {
      id: "conversation-direct-reload",
      area: "conversation",
      dependsOn: ["live-two-turn-contract"],
    },
    { id: "settings-route", area: "routes" },
    { id: "mobile-room", area: "responsive" },
  ];
  assert.deepEqual(independentStagesAfterFailure(stages, "live-two-turn-contract"), [
    "settings-route",
    "mobile-room",
  ]);
});

test("route inventory remains BLOCKED when only conversation-dependent routes are blocked", () => {
  const summary = summarizeRouteInventory([
    {
      route: "/settings",
      source: "fixture",
      kind: "static",
      discovered: true,
      exercised: true,
      status: "passed",
    },
    {
      route: "/agents/conversations/:id",
      source: "required",
      kind: "dynamic",
      discovered: true,
      exercised: false,
      status: "blocked",
    },
  ]);
  assert.equal(summary.status, "blocked");
  assert.deepEqual(summary.incomplete.map((entry) => entry.route), [
    "/agents/conversations/:id",
  ]);
  assert.deepEqual(summary.independentlyIncomplete, []);
});

test("route inventory reports independently failed and not-run routes", () => {
  const failedSummary = summarizeRouteInventory([
    {
      route: "/settings",
      source: "fixture",
      kind: "static",
      discovered: true,
      exercised: true,
      status: "failed",
    },
    {
      route: "/tasks/:id",
      source: "required",
      kind: "dynamic",
      discovered: true,
      exercised: false,
      status: "blocked",
    },
  ]);
  assert.equal(failedSummary.status, "failed");
  assert.deepEqual(failedSummary.independentlyIncomplete.map((entry) => entry.route), [
    "/settings",
  ]);

  const notRunSummary = summarizeRouteInventory([
    {
      route: "/search",
      source: "fixture",
      kind: "static",
      discovered: true,
      exercised: false,
      status: "not_run",
    },
  ]);
  assert.equal(notRunSummary.status, "not_run");
  assert.deepEqual(notRunSummary.independentlyIncomplete.map((entry) => entry.route), [
    "/search",
  ]);
});
