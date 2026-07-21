import assert from "node:assert/strict";
import test from "node:test";
import { hermesHealthDisplay } from "./health-status";
import type { HermesHealthSnapshot } from "./types";

const observedAt = "2026-07-20T23:00:00.000Z";

function snapshot(status: HermesHealthSnapshot["status"], overrides: Partial<HermesHealthSnapshot> = {}): HermesHealthSnapshot {
  return {
    enabled: true,
    status,
    version: null,
    profile: null,
    profileSource: null,
    gatewayState: null,
    checkedAt: observedAt,
    observationSource: "GET /health/detailed",
    message: "Probe result.",
    ...overrides,
  };
}

test("successful health displays its source and observation time", () => {
  const result = hermesHealthDisplay(snapshot("online", { version: "0.19.0" }), null, observedAt);
  assert.equal(result.label, "Hermes connected");
  assert.equal(result.state, "connected");
  assert.equal(result.tone, "healthy");
  assert.match(result.detail, /GET \/health\/detailed/);
  assert.match(result.detail, new RegExp(observedAt));
});

test("initial poll timeout remains unknown and never claims offline", () => {
  const result = hermesHealthDisplay(snapshot("probe_timeout", { message: "Hermes Agent health probe timed out." }), null, "2026-07-20T23:00:14.000Z");
  assert.equal(result.label, "Hermes health probe timed out");
  assert.equal(result.tone, "warning");
  assert.equal(result.state, "probe_timeout");
  assert.match(result.detail, /runtime state is unknown/i);
  assert.doesNotMatch(`${result.label} ${result.detail}`, /Hermes offline/i);
});

test("a timeout after success retains timestamped last-known evidence as stale", () => {
  const success = snapshot("online", { version: "0.19.0" });
  const timeout = snapshot("probe_timeout", {
    checkedAt: "2026-07-20T23:00:14.000Z",
    message: "Hermes Agent health probe timed out.",
  });
  const result = hermesHealthDisplay(timeout, success, timeout.checkedAt);
  assert.match(result.detail, /Agent 0\.19\.0 was last confirmed 14 seconds ago/);
  assert.match(result.detail, /evidence is stale/i);
  assert.equal(result.lastConfirmedAt, observedAt);
  assert.equal(result.state, "stale");
});

test("browser route failure is source-specific and not offline", () => {
  const result = hermesHealthDisplay(snapshot("probe_unavailable", {
    observationSource: "GET /api/hermes/health",
    message: "Cabinet could not reach the Hermes status route.",
  }), null, observedAt);
  assert.equal(result.label, "Hermes status probe unavailable");
  assert.match(result.detail, /GET \/api\/hermes\/health/);
  assert.doesNotMatch(`${result.label} ${result.detail}`, /offline/i);
});

test("authentication and missing configuration remain distinct", () => {
  assert.equal(hermesHealthDisplay(snapshot("authentication_failure"), null, observedAt).state, "authentication_failure");
  assert.equal(hermesHealthDisplay(snapshot("misconfigured"), null, observedAt).state, "not_configured");
});

test("offline wording requires an authoritative stopped snapshot", () => {
  const result = hermesHealthDisplay(snapshot("offline", { message: "Hermes Agent explicitly reported that the runtime is stopped." }), null, observedAt);
  assert.equal(result.label, "Hermes stopped");
  assert.equal(result.state, "authoritative_offline");
  assert.equal(result.tone, "failure");
});

test("a successful but aged Agent observation becomes stale instead of staying green", () => {
  const result = hermesHealthDisplay(snapshot("online", { version: "0.19.0" }), null, "2026-07-20T23:00:31.000Z");
  assert.equal(result.state, "stale");
  assert.equal(result.tone, "warning");
  assert.match(result.statusText, /last confirmed 31 seconds ago/i);
});
