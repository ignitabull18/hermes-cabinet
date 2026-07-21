import assert from "node:assert/strict";
import test from "node:test";
import { healthPollPaths } from "./health-store";

test("Hermes mode polling excludes the legacy daemon endpoint", () => {
  assert.deepEqual(healthPollPaths(false), ["/api/health"]);
});

test("legacy mode polling retains the daemon endpoint", () => {
  assert.deepEqual(healthPollPaths(true), ["/api/health", "/api/health/daemon"]);
});
