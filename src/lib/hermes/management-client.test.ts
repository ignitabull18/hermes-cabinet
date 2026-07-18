import test from "node:test";
import assert from "node:assert/strict";
import { HermesManagementClient } from "./management-client";
import type { HermesServerConfig } from "./server-config";

const secret = "HERMES_BROWSER_LEAK_CANARY_7f4d9c";
const config: HermesServerConfig = {
  apiBaseUrl: "http://hermes.test:8642",
  apiKey: secret,
  managementBaseUrl: "http://hermes.test:56314",
  profile: "operator-os",
  timeoutMs: 1_000,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("management health normalizes version and profile without returning credentials", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (url.endsWith("/health/detailed")) {
      return response({ status: "ok", version: "0.18.2", gateway_state: "running", raw_secret: secret });
    }
    return response({ profiles: ["default", "operator-os"], unrelated_secret: secret });
  };

  const result = await new HermesManagementClient(config, fetchImpl).health();

  assert.equal(result.status, "online");
  assert.equal(result.version, "0.18.2");
  assert.equal(result.profile, "operator-os");
  assert.equal(result.gatewayState, "running");
  assert.equal(requests[0]?.authorization, `Bearer ${secret}`);
  assert.equal(requests[1]?.authorization, null);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!JSON.stringify(result).toLowerCase().includes("authorization"));
});

test("management health distinguishes authentication, profile, and connection failures", async () => {
  const auth = await new HermesManagementClient(
    config,
    async () => response({ error: "invalid key" }, 401)
  ).health();
  assert.equal(auth.status, "authentication_failure");

  const unavailable = await new HermesManagementClient(
    config,
    async (input) =>
      String(input).endsWith("/health/detailed")
        ? response({ status: "ok", version: "0.18.2" })
        : response({ profiles: ["default"] })
  ).health();
  assert.equal(unavailable.status, "unavailable_profile");

  const offline = await new HermesManagementClient(config, async () => {
    throw new TypeError("connection refused");
  }).health();
  assert.equal(offline.status, "offline");
});
