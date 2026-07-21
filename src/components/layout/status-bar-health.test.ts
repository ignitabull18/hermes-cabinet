import assert from "node:assert/strict";
import test from "node:test";
import { deriveStatusBarOperationalState } from "./status-bar-health";

const base = {
  appLevel: "ok" as const,
  daemonLevel: "down" as const,
  legacyProviderReady: true,
};

test("Hermes mode is green only with fresh source-specific Agent evidence", () => {
  assert.equal(deriveStatusBarOperationalState({ ...base, hermesMode: true, hermesAgentState: "connected" }), "operational");
  assert.equal(deriveStatusBarOperationalState({ ...base, hermesMode: true, hermesAgentState: "unknown" }), "degraded");
  assert.equal(deriveStatusBarOperationalState({ ...base, hermesMode: true, hermesAgentState: "stale" }), "degraded");
  assert.equal(deriveStatusBarOperationalState({ ...base, hermesMode: true, hermesAgentState: "probe_timeout" }), "degraded");
});

test("authoritative Agent failures are degraded while an app failure is offline", () => {
  assert.equal(deriveStatusBarOperationalState({ ...base, hermesMode: true, hermesAgentState: "authentication_failure" }), "degraded");
  assert.equal(deriveStatusBarOperationalState({ ...base, hermesMode: true, hermesAgentState: "authoritative_offline" }), "degraded");
  assert.equal(deriveStatusBarOperationalState({ ...base, appLevel: "down", hermesMode: true, hermesAgentState: "connected" }), "offline");
  assert.equal(deriveStatusBarOperationalState({ ...base, appLevel: "degraded", hermesMode: true, hermesAgentState: "connected" }), "degraded");
});

test("legacy mode retains daemon and provider requirements", () => {
  assert.equal(deriveStatusBarOperationalState({ ...base, daemonLevel: "ok", hermesMode: false, hermesAgentState: "unknown" }), "operational");
  assert.equal(deriveStatusBarOperationalState({ ...base, hermesMode: false, hermesAgentState: "connected" }), "degraded");
  assert.equal(deriveStatusBarOperationalState({ ...base, daemonLevel: "ok", legacyProviderReady: false, hermesMode: false, hermesAgentState: "connected" }), "degraded");
});
