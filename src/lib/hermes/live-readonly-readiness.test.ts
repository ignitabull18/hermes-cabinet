import test from "node:test";
import assert from "node:assert/strict";
import { assessHermesLiveReadiness } from "./live-readonly-readiness";

const configured = {
  CABINET_HERMES_API_URL: "http://api-user:api-password@127.0.0.1:8642/private?access_token=api-query-secret",
  CABINET_HERMES_API_KEY: "api-key-secret-value",
  CABINET_HERMES_MANAGEMENT_URL: "http://management-user:management-password@127.0.0.1:56314/admin?code=oauth-secret",
  CABINET_HERMES_MANAGEMENT_TOKEN: "management-token-secret-value",
  CABINET_HERMES_GATEWAY_URL: "http://gateway-user:gateway-password@127.0.0.1:8645/ws?token=gateway-query-secret",
  CABINET_HERMES_GATEWAY_TOKEN: "gateway-token-secret-value",
  CABINET_HERMES_PROFILE: "operator-os",
  CABINET_HERMES_TIMEOUT_MS: "3000",
  CABINET_HERMES_INTERVENTIONS_ENABLED: "false",
};

test("readiness reports only status, source type, and credential-free endpoint identity", () => {
  const readiness = assessHermesLiveReadiness(configured);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.interventionsEnabled, false);
  assert.deepEqual(
    readiness.variables.filter((item) => item.safeEndpointIdentity).map((item) => item.safeEndpointIdentity),
    ["http://127.0.0.1:8642", "http://127.0.0.1:56314", "http://127.0.0.1:8645"],
  );
  const serialized = JSON.stringify(readiness);
  for (const forbidden of [
    "api-user",
    "api-password",
    "api-query-secret",
    "api-key-secret-value",
    "management-user",
    "management-password",
    "oauth-secret",
    "management-token-secret-value",
    "gateway-user",
    "gateway-password",
    "gateway-query-secret",
    "gateway-token-secret-value",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden));
  }
});

test("readiness identifies missing required configuration without revealing values", () => {
  const readiness = assessHermesLiveReadiness({});
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.missing, [
    "CABINET_HERMES_API_URL",
    "CABINET_HERMES_API_KEY",
    "CABINET_HERMES_MANAGEMENT_URL",
    "CABINET_HERMES_MANAGEMENT_TOKEN",
    "CABINET_HERMES_GATEWAY_URL",
    "CABINET_HERMES_GATEWAY_TOKEN",
    "CABINET_HERMES_PROFILE",
  ]);
  assert.equal(readiness.variables.find((item) => item.name === "CABINET_HERMES_TIMEOUT_MS")?.sourceType, "default");
  assert.equal(readiness.variables.find((item) => item.name === "CABINET_HERMES_INTERVENTIONS_ENABLED")?.sourceType, "default");
});

test("approved management token equivalent satisfies readiness without naming or returning it", () => {
  const readiness = assessHermesLiveReadiness({
    ...configured,
    CABINET_HERMES_MANAGEMENT_TOKEN: undefined,
    HERMES_DASHBOARD_SESSION_TOKEN: "approved-equivalent-secret",
  });
  const management = readiness.variables.find((item) => item.name === "CABINET_HERMES_MANAGEMENT_TOKEN");
  assert.equal(management?.status, "present");
  assert.equal(management?.sourceType, "approved_equivalent");
  assert.doesNotMatch(JSON.stringify(readiness), /approved-equivalent-secret|HERMES_DASHBOARD_SESSION_TOKEN/);
});

test("invalid endpoints, timeouts, and attempted intervention enablement block live acceptance", () => {
  const readiness = assessHermesLiveReadiness({
    ...configured,
    CABINET_HERMES_API_URL: "file:///Users/local-user/.config/hermes/credentials.json",
    CABINET_HERMES_TIMEOUT_MS: "50",
    CABINET_HERMES_INTERVENTIONS_ENABLED: "true",
  });
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.invalid, [
    "CABINET_HERMES_API_URL",
    "CABINET_HERMES_TIMEOUT_MS",
    "CABINET_HERMES_INTERVENTIONS_ENABLED",
  ]);
  assert.doesNotMatch(JSON.stringify(readiness), /local-user|credentials\.json/);
});

test("intervention browser fields cannot participate in server readiness", () => {
  const readiness = assessHermesLiveReadiness({
    ...configured,
    interventionsEnabled: "true",
    NEXT_PUBLIC_CABINET_HERMES_INTERVENTIONS_ENABLED: "true",
  });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.interventionsEnabled, false);
});
