import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { NextRequest } from "next/server";

import { GET } from "./route";
import { SUPERMEMORY_LIMITATION } from "@/lib/hermes/local-memory-observation";

const originalFetch = globalThis.fetch;
const managedEnv = [
  "KB_PASSWORD",
  "CABINET_RUNTIME_MODE",
  "CABINET_HERMES_API_URL",
  "CABINET_HERMES_API_KEY",
  "CABINET_HERMES_MANAGEMENT_URL",
  "CABINET_HERMES_MANAGEMENT_TOKEN",
  "CABINET_HERMES_GATEWAY_URL",
  "CABINET_HERMES_GATEWAY_TOKEN",
  "CABINET_HERMES_PROFILE",
  "CABINET_HERMES_INTERVENTIONS_ENABLED",
] as const;
const originalEnv = Object.fromEntries(managedEnv.map((name) => [name, process.env[name]]));

function request(): NextRequest {
  return new NextRequest("http://127.0.0.1:4000/api/hermes/cockpit");
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function configureAgentApi(): void {
  delete process.env.KB_PASSWORD;
  process.env.CABINET_RUNTIME_MODE = "hermes";
  process.env.CABINET_HERMES_API_URL = "http://127.0.0.1:8642";
  process.env.CABINET_HERMES_API_KEY = "cockpit-route-secret";
  process.env.CABINET_HERMES_PROFILE = "operator-os";
  process.env.CABINET_HERMES_INTERVENTIONS_ENABLED = "false";
  delete process.env.CABINET_HERMES_MANAGEMENT_URL;
  delete process.env.CABINET_HERMES_MANAGEMENT_TOKEN;
  delete process.env.CABINET_HERMES_GATEWAY_URL;
  delete process.env.CABINET_HERMES_GATEWAY_TOKEN;
}

function agentResponse(url: string): Response {
  if (url.endsWith("/health/detailed")) {
    return response({ status: "ok", version: "0.19.0", active_profile: "operator-os" });
  }
  if (url.includes("/api/sessions?")) {
    return response({ object: "list", data: [], has_more: false, limit: 100, offset: 0 });
  }
  return response({ object: "list", data: [] });
}

beforeEach(configureAgentApi);

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of managedEnv) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("cockpit renders a partial projection when Management is not configured", async () => {
  const upstreamRequests: Array<{ method: string; url: string }> = [];
  globalThis.fetch = async (input, init) => {
    upstreamRequests.push({ method: init?.method ?? "GET", url: String(input) });
    return agentResponse(String(input));
  };

  const result = await GET(request());
  const body = await result.json();
  const serialized = JSON.stringify(body);

  assert.equal(result.status, 200);
  assert.equal(body.health.status, "online");
  assert.equal(body.management.status, "not_configured");
  assert.equal(
    body.management.message,
    "Hermes Management is not configured. Management-backed intelligence is unavailable.",
  );
  assert.equal(body.sourceCoverage.hermesJobs.status, "unavailable");
  assert.ok(["partial", "unavailable"].includes(body.sourceCoverage.supermemory.status));
  if (body.sourceCoverage.supermemory.status === "partial") {
    assert.equal(
      body.sourceCoverage.supermemory.message,
      SUPERMEMORY_LIMITATION,
    );
  }
  assert.ok(["connected", "connected_empty"].includes(body.sourceCoverage.manualRisks.status));
  assert.equal(body.profile, "operator-os");
  assert.doesNotMatch(serialized, /Missing server configuration|CABINET_HERMES_MANAGEMENT|cockpit-route-secret/);
  assert.ok(upstreamRequests.length > 0);
  assert.ok(upstreamRequests.every((item) => item.method === "GET"));
  assert.ok(upstreamRequests.every((item) => item.url.startsWith("http://127.0.0.1:8642/")));
});

test("cockpit keeps a configured Management authentication rejection distinct", async () => {
  process.env.CABINET_HERMES_MANAGEMENT_URL = "http://127.0.0.1:56314";
  process.env.CABINET_HERMES_MANAGEMENT_TOKEN = "management-route-secret";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("http://127.0.0.1:56314/")) return response({ detail: "rejected" }, 401);
    return agentResponse(url);
  };

  const result = await GET(request());
  const body = await result.json();
  const serialized = JSON.stringify(body);

  assert.equal(result.status, 200);
  assert.equal(body.health.status, "online");
  assert.equal(body.management.status, "authentication_failure");
  assert.equal(
    body.management.message,
    "Hermes Management authentication failed. Management-backed intelligence is unavailable.",
  );
  assert.doesNotMatch(serialized, /CABINET_HERMES_MANAGEMENT|management-route-secret|cockpit-route-secret/);
});
