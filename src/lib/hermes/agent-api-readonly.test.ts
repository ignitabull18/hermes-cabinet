import test from "node:test";
import assert from "node:assert/strict";
import { collectAgentApiReadOnly, HERMES_AGENT_API_AUDIT_ONLY_INTERFACES, readKnownAgentRun } from "./agent-api-readonly";
import { readHermesReadOnlyServerConfig } from "./server-config";

const secret = "agent-api-secret-canary";
const config = readHermesReadOnlyServerConfig({
  CABINET_HERMES_API_URL: "http://127.0.0.1:8642",
  CABINET_HERMES_API_KEY: secret,
  CABINET_HERMES_PROFILE: "configured-profile-is-not-observed",
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("Agent API read-only collector uses Bearer auth, blocks redirects, and calls no mutation or content endpoints", async () => {
  const requests: Array<{ url: string; method: string; redirect: RequestRedirect | undefined; auth: string | null }> = [];
  const result = await collectAgentApiReadOnly(config, async (input, init) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET", redirect: init?.redirect, auth: new Headers(init?.headers).get("authorization") });
    if (url.endsWith("/v1/capabilities")) return response({ object: "capabilities", features: { session_resources: true } });
    if (url.includes("/api/sessions?")) return response({ object: "list", data: [], has_more: false });
    if (url.endsWith("/v1/models")) return response({ object: "list", data: [] });
    throw new Error("unexpected endpoint");
  });

  assert.equal(result.sessions.state, "connected_empty");
  assert.equal(result.models.state, "connected_empty");
  assert.equal(requests.length, 3);
  assert.ok(requests.every((item) => item.method === "GET" && item.redirect === "error" && item.auth === `Bearer ${secret}`));
  assert.ok(requests.every((item) => !/messages|events|runs\//.test(item.url)));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${secret}|configured-profile-is-not-observed`, "i"));
});

test("session projection preserves bounded lineage and usage while removing raw identity and content", async () => {
  const canaries = {
    id: "raw-session-id-secret",
    child: "raw-child-id-secret",
    title: "SECRET TITLE SHOULD NOT EGRESS",
    preview: "SECRET PREVIEW SHOULD NOT EGRESS",
    user: "owner@example.test",
  };
  const result = await collectAgentApiReadOnly(config, async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/capabilities")) return response({ object: "capabilities" });
    if (url.endsWith("/v1/models")) return response({ data: [{ id: "model-a", owned_by: "Hermes" }] });
    return response({ data: [
      { id: canaries.id, title: canaries.title, preview: canaries.preview, user_id: canaries.user, source: "api", model: "model-a", started_at: "2026-07-20T10:00:00Z", last_active: "2026-07-20T10:10:00Z", message_count: 3, tool_call_count: 2, input_tokens: 100, output_tokens: 20 },
      { id: canaries.child, parent_session_id: canaries.id, source: "api", model: "model-a", started_at: "2026-07-20T10:05:00Z", ended_at: "2026-07-20T10:09:00Z", actual_cost_usd: 0.02 },
    ], has_more: false });
  });
  assert.deepEqual(result.sessions.items.map((item) => [item.displayId, item.parentDisplayId, item.childCount, item.lifecycle]), [
    ["Session 1", null, 1, "unended"],
    ["Session 2", "Session 1", 0, "ended"],
  ]);
  assert.equal(result.sessions.items[0]?.messageCount, 3);
  assert.equal(result.sessions.items[1]?.actualCostUsd, 0.02);
  const serialized = JSON.stringify(result);
  for (const value of Object.values(canaries)) assert.equal(serialized.includes(value), false);
  assert.equal(serialized.includes("configured-profile-is-not-observed"), false);
});

test("missing parent becomes a nonsecret earlier-session label and oversized/control strings are bounded", async () => {
  const result = await collectAgentApiReadOnly(config, async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/capabilities")) return response({});
    if (url.endsWith("/v1/models")) return response({ data: [{ id: `\u001b[31m${"x".repeat(300)}`, owned_by: "Hermes\nowner" }] });
    return response({ data: [{ id: "child", parent_session_id: "absent-parent-secret", source: `\u001b[31m${"s".repeat(200)}` }] });
  });
  assert.equal(result.sessions.items[0]?.parentDisplayId, "Earlier session");
  assert.ok((result.sessions.items[0]?.source.length ?? 0) <= 48);
  assert.ok((result.models.items[0]?.displayId.length ?? 0) <= 96);
  assert.doesNotMatch(JSON.stringify(result), /\u001b|absent-parent-secret/);
});

test("source failures stay independent and never borrow overall Agent health", async () => {
  const result = await collectAgentApiReadOnly(config, async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/capabilities")) return response({ object: "capabilities" });
    if (url.endsWith("/v1/models")) return response({}, 404);
    return response({}, 503);
  });
  assert.equal(result.contract.state, "success");
  assert.equal(result.sessions.state, "failure");
  assert.equal(result.models.state, "unavailable");
});

test("authentication failure never includes response payloads or credentials", async () => {
  const result = await collectAgentApiReadOnly(config, async () => response({ detail: `Bearer ${secret}` }, 401));
  assert.equal(result.sessions.state, "authentication_failure");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test("known-run reads require an explicit identity and return bounded state without output payloads", async () => {
  let calls = 0;
  const result = await readKnownAgentRun(config, "known_run_1", async (input, init) => {
    calls += 1;
    assert.equal(String(input), "http://127.0.0.1:8642/v1/runs/known_run_1");
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    return response({ status: "completed", created_at: 1_784_400_000, updated_at: 1_784_400_300, output: "SECRET RESULT", error: null, usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 } });
  });
  assert.equal(calls, 1);
  assert.equal(result.state, "success");
  assert.equal(result.lifecycle, "completed");
  assert.equal(result.hasResult, true);
  assert.equal(result.totalTokens, 16);
  assert.doesNotMatch(JSON.stringify(result), /SECRET RESULT/);
  await assert.rejects(() => readKnownAgentRun(config, "", async () => response({})), /known Hermes run identity/i);
});

test("known-run not-found and unavailable states do not infer a global run list", async () => {
  const notFound = await readKnownAgentRun(config, "expired_run", async () => response({}, 404));
  const unavailable = await readKnownAgentRun(config, "known_run", async () => { throw new TypeError("offline"); });
  assert.equal(notFound.state, "not_found");
  assert.equal(unavailable.state, "unavailable");
  assert.equal("runs" in notFound, false);
  assert.equal("runs" in unavailable, false);
});

test("SSE and message history remain audit-only and SSE is explicitly a current stream", () => {
  assert.equal(HERMES_AGENT_API_AUDIT_ONLY_INTERFACES.sessionMessages.projection, "audit_only_content_bearing");
  assert.equal(HERMES_AGENT_API_AUDIT_ONLY_INTERFACES.runEvents.access, "known_id_live_stream");
  assert.equal(HERMES_AGENT_API_AUDIT_ONLY_INTERFACES.runEvents.projection, "audit_only_not_retrospective");
});
