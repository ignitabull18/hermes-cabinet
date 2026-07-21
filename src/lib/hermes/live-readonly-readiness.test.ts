import test from "node:test";
import assert from "node:assert/strict";
import { assessHermesLiveReadiness } from "./live-readonly-readiness";

const configured = {
  CABINET_HERMES_API_URL: "http://127.0.0.1:8642",
  CABINET_HERMES_API_KEY: "api-key-secret-value",
  CABINET_HERMES_MANAGEMENT_URL: "http://localhost:56314",
  CABINET_HERMES_MANAGEMENT_TOKEN: "management-token-secret-value",
  CABINET_HERMES_GATEWAY_URL: "http://[::1]:8645",
  CABINET_HERMES_GATEWAY_TOKEN: "gateway-token-secret-value",
  CABINET_HERMES_PROFILE: "operator-os",
  CABINET_HERMES_TIMEOUT_MS: "3000",
  CABINET_HERMES_INTERVENTIONS_ENABLED: "false",
};

test("readiness reports independent ready source groups and credential-free endpoint identities", () => {
  const readiness = assessHermesLiveReadiness(configured);
  assert.equal(readiness.readyForAnyLiveRead, true);
  assert.equal(readiness.fullCoverageReady, true);
  assert.equal(readiness.interventionsEnabled, false);
  assert.deepEqual(readiness.sources.map((source) => [source.id, source.configured, source.state]), [
    ["agent_api", true, "ready_to_probe"],
    ["management", true, "ready_to_probe"],
    ["gateway", true, "ready_to_probe"],
  ]);
  assert.deepEqual(
    readiness.sources.map((source) => source.safeEndpointIdentity),
    ["http://127.0.0.1:8642", "http://localhost:56314", "http://[::1]:8645"],
  );
  const serialized = JSON.stringify(readiness);
  for (const forbidden of [
    "api-key-secret-value",
    "management-token-secret-value",
    "gateway-token-secret-value",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden));
  }
});

test("API and management can become ready without Gateway", () => {
  const readiness = assessHermesLiveReadiness({
    CABINET_HERMES_API_URL: configured.CABINET_HERMES_API_URL,
    CABINET_HERMES_API_KEY: configured.CABINET_HERMES_API_KEY,
    CABINET_HERMES_MANAGEMENT_URL: configured.CABINET_HERMES_MANAGEMENT_URL,
    CABINET_HERMES_MANAGEMENT_TOKEN: configured.CABINET_HERMES_MANAGEMENT_TOKEN,
    CABINET_HERMES_PROFILE: configured.CABINET_HERMES_PROFILE,
  });
  assert.equal(readiness.readyForAnyLiveRead, true);
  assert.equal(readiness.fullCoverageReady, false);
  assert.equal(readiness.sources.find((source) => source.id === "agent_api")?.state, "ready_to_probe");
  assert.equal(readiness.sources.find((source) => source.id === "management")?.state, "ready_to_probe");
  assert.equal(readiness.sources.find((source) => source.id === "gateway")?.state, "unavailable");
});

test("one complete source can be probed while other sources remain incomplete or unavailable", () => {
  const readiness = assessHermesLiveReadiness({
    CABINET_HERMES_API_URL: configured.CABINET_HERMES_API_URL,
    CABINET_HERMES_API_KEY: configured.CABINET_HERMES_API_KEY,
    CABINET_HERMES_MANAGEMENT_URL: configured.CABINET_HERMES_MANAGEMENT_URL,
  });
  assert.equal(readiness.readyForAnyLiveRead, true);
  assert.equal(readiness.sources.find((source) => source.id === "agent_api")?.state, "ready_to_probe");
  assert.equal(readiness.sources.find((source) => source.id === "management")?.state, "incomplete");
  assert.equal(readiness.sources.find((source) => source.id === "gateway")?.state, "unavailable");
});

test("approved management token equivalent satisfies only the management group without egress", () => {
  const readiness = assessHermesLiveReadiness({
    CABINET_HERMES_MANAGEMENT_URL: configured.CABINET_HERMES_MANAGEMENT_URL,
    HERMES_DASHBOARD_SESSION_TOKEN: "approved-equivalent-secret",
    CABINET_HERMES_PROFILE: configured.CABINET_HERMES_PROFILE,
  });
  const management = readiness.variables.find((item) => item.name === "CABINET_HERMES_MANAGEMENT_TOKEN");
  assert.equal(management?.status, "present");
  assert.equal(management?.sourceType, "approved_equivalent");
  assert.equal(readiness.readyForAnyLiveRead, true);
  assert.doesNotMatch(JSON.stringify(readiness), /approved-equivalent-secret|HERMES_DASHBOARD_SESSION_TOKEN/);
});

test("invalid source configuration remains source-specific and secret-free", () => {
  const canary = "readiness-secret-canary";
  const readiness = assessHermesLiveReadiness({
    ...configured,
    CABINET_HERMES_API_URL: `https://user:${canary}@example.com/path?token=${canary}`,
    CABINET_HERMES_TIMEOUT_MS: "50",
  });
  assert.equal(readiness.readyForAnyLiveRead, true);
  assert.equal(readiness.fullCoverageReady, false);
  assert.equal(readiness.sources.find((source) => source.id === "agent_api")?.state, "invalid");
  assert.equal(readiness.sources.find((source) => source.id === "management")?.state, "ready_to_probe");
  assert.deepEqual(readiness.invalid, ["CABINET_HERMES_API_URL", "CABINET_HERMES_TIMEOUT_MS"]);
  assert.doesNotMatch(JSON.stringify(readiness), new RegExp(`${canary}|example\\.com|user`));
});

test("attempted intervention enablement blocks acceptance without changing source readiness", () => {
  const readiness = assessHermesLiveReadiness({
    ...configured,
    CABINET_HERMES_INTERVENTIONS_ENABLED: "true",
    interventionsEnabled: "true",
    NEXT_PUBLIC_CABINET_HERMES_INTERVENTIONS_ENABLED: "true",
  });
  assert.equal(readiness.readyForAnyLiveRead, true);
  assert.equal(readiness.fullCoverageReady, false);
  assert.equal(readiness.interventionsEnabled, false);
  assert.deepEqual(readiness.invalid, ["CABINET_HERMES_INTERVENTIONS_ENABLED"]);
});
