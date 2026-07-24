import assert from "node:assert/strict";
import test from "node:test";

import { AcceptanceRecorder, selectRelevantBrowserIssues } from "./recorder";

test("Node conversation requests are counted without retaining conversation identity", () => {
  const recorder = new AcceptanceRecorder();
  recorder.request("POST", "/api/agents/conversations");
  recorder.request(
    "POST",
    "/api/agents/conversations/private-conversation-identity/continue",
  );

  assert.equal(recorder.network.total, 2);
  assert.equal(recorder.network.modelMessageRequests, 2);
  assert.equal(recorder.network.mutations, 2);
  assert.deepEqual(recorder.network.byPath, {
    "/api/agents/conversations": 1,
    "/api/agents/conversations/:id/continue": 1,
  });
  assert.doesNotMatch(
    JSON.stringify(recorder.network),
    /private-conversation-identity/,
  );
});

test("only phase-correlated controlled restart transport failures are non-relevant", () => {
  const issues = [
    {
      stage: "restart-route-persistence",
      source: "request" as const,
      severity: "warning" as const,
      summary: "expected_read_only_listener_loss",
      expectedControlledRestartTransport: true,
    },
    {
      stage: "restart-route-persistence",
      source: "console" as const,
      severity: "error" as const,
      summary: "Failed to load resource: net::ERR_CONNECTION_RESET",
    },
    {
      stage: "restart-route-persistence",
      source: "request" as const,
      severity: "error" as const,
      summary: "outside_restart_window",
    },
  ];
  assert.deepEqual(selectRelevantBrowserIssues(issues), issues.slice(1));
});
