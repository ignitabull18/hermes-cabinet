import type { HermesReadOnlyServerConfig, HermesServerConfig } from "./server-config";

export type HermesAgentApiSourceState =
  | "success"
  | "connected_empty"
  | "unavailable"
  | "authentication_failure"
  | "failure";

export type HermesAgentApiSession = {
  displayId: string;
  parentDisplayId: string | null;
  childCount: number;
  source: string;
  model: string | null;
  lifecycle: "ended" | "unended";
  startedAt: string | null;
  endedAt: string | null;
  lastActiveAt: string | null;
  messageCount: number | null;
  toolCallCount: number | null;
  apiCallCount: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
};

export type HermesAgentApiReadOnlySnapshot = {
  checkedAt: string;
  contract: {
    state: HermesAgentApiSourceState;
    observedAt: string;
    summary: string;
    interface: "/v1/capabilities";
  };
  sessions: {
    state: HermesAgentApiSourceState;
    observedAt: string;
    summary: string;
    interface: "/api/sessions?limit=100&offset=0&include_children=true";
    hasMore: boolean | null;
    items: HermesAgentApiSession[];
  };
  models: {
    state: HermesAgentApiSourceState;
    observedAt: string;
    summary: string;
    interface: "/v1/models";
    items: Array<{ displayId: string; ownedBy: string | null }>;
  };
};

type Fetch = typeof fetch;

export const HERMES_AGENT_API_AUDIT_ONLY_INTERFACES = {
  sessionDetail: { method: "GET", path: "/api/sessions/{session_id}", access: "known_id", projection: "audit_only" },
  sessionMessages: { method: "GET", path: "/api/sessions/{session_id}/messages", access: "known_id", projection: "audit_only_content_bearing" },
  runEvents: { method: "GET", path: "/v1/runs/{run_id}/events", access: "known_id_live_stream", projection: "audit_only_not_retrospective" },
} as const;

export type HermesKnownRunRead = {
  state: "success" | "not_found" | "unavailable" | "authentication_failure" | "failure";
  observedAt: string;
  interface: "/v1/runs/{run_id}";
  runId: string;
  lifecycle: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  hasResult: boolean;
  hasFailure: boolean;
  summary: string;
};

const MAX_SESSIONS = 100;
const MAX_MODELS = 100;

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function array(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function bounded(input: unknown, fallback: string, max = 96): string {
  if (typeof input !== "string") return fallback;
  const clean = input.replace(/[\u0000-\u001f\u007f-\u009f\u001b]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return fallback;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function timestamp(input: unknown): string | null {
  if (typeof input === "number" && Number.isFinite(input)) {
    const date = new Date(input > 10_000_000_000 ? input : input * 1_000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof input !== "string" || !input.trim()) return null;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function finite(input: unknown): number | null {
  return typeof input === "number" && Number.isFinite(input) ? input : null;
}

function integer(input: unknown): number | null {
  const result = finite(input);
  return result === null ? null : Math.max(0, Math.round(result));
}

function rawIdentity(input: unknown): string | null {
  if (typeof input === "number" && Number.isSafeInteger(input)) return String(input);
  if (typeof input !== "string" || !input.trim()) return null;
  return input.trim();
}

function unavailableSnapshot(now: string, state: HermesAgentApiSourceState, summary: string): HermesAgentApiReadOnlySnapshot {
  return {
    checkedAt: now,
    contract: { state, observedAt: now, summary, interface: "/v1/capabilities" },
    sessions: { state, observedAt: now, summary, interface: "/api/sessions?limit=100&offset=0&include_children=true", hasMore: null, items: [] },
    models: { state, observedAt: now, summary, interface: "/v1/models", items: [] },
  };
}

export async function collectAgentApiReadOnly(
  config: HermesServerConfig | HermesReadOnlyServerConfig,
  fetchImpl: Fetch = fetch,
): Promise<HermesAgentApiReadOnlySnapshot> {
  const now = new Date().toISOString();
  if (!config.apiBaseUrl || !config.apiKey || config.sourceStates.agent_api !== "ready_to_probe") {
    return unavailableSnapshot(now, "unavailable", "Hermes Agent API is not configured for this review.");
  }

  const request = async (path: string): Promise<{ state: HermesAgentApiSourceState; observedAt: string; value: unknown; summary: string }> => {
    const observedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(`${config.apiBaseUrl}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        return { state: "authentication_failure", observedAt, value: null, summary: "Hermes Agent API rejected the configured server credential." };
      }
      if (!response.ok) {
        return { state: response.status === 404 ? "unavailable" : "failure", observedAt, value: null, summary: `Hermes Agent API read-only source failed with HTTP ${response.status}.` };
      }
      return { state: "success", observedAt, value: await response.json(), summary: "Hermes Agent API read-only source responded." };
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
      return { state: "failure", observedAt, value: null, summary: timeout ? "Hermes Agent API read-only source timed out." : "Hermes Agent API read-only source is unreachable." };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const [contractRaw, sessionsRaw, modelsRaw] = await Promise.all([
    request("/v1/capabilities"),
    request(`/api/sessions?limit=${MAX_SESSIONS}&offset=0&include_children=true`),
    request("/v1/models"),
  ]);

  const sessionRecords = array(record(sessionsRaw.value).data).slice(0, MAX_SESSIONS).map(record);
  const identities = sessionRecords.map((item) => rawIdentity(item.id));
  const displayByIdentity = new Map<string, string>();
  identities.forEach((id, index) => { if (id && !displayByIdentity.has(id)) displayByIdentity.set(id, `Session ${index + 1}`); });
  const childCounts = new Map<string, number>();
  for (const item of sessionRecords) {
    const parent = rawIdentity(item.parent_session_id);
    if (parent) childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1);
  }
  const sessions = sessionRecords.map((item, index): HermesAgentApiSession => {
    const id = identities[index];
    const parent = rawIdentity(item.parent_session_id);
    const endedAt = timestamp(item.ended_at);
    return {
      displayId: id ? displayByIdentity.get(id) ?? `Session ${index + 1}` : `Session ${index + 1}`,
      parentDisplayId: parent ? displayByIdentity.get(parent) ?? "Earlier session" : null,
      childCount: id ? childCounts.get(id) ?? 0 : 0,
      source: bounded(item.source, "Unknown source", 48),
      model: typeof item.model === "string" ? bounded(item.model, "Unknown model", 96) : null,
      lifecycle: endedAt ? "ended" : "unended",
      startedAt: timestamp(item.started_at),
      endedAt,
      lastActiveAt: timestamp(item.last_active),
      messageCount: integer(item.message_count),
      toolCallCount: integer(item.tool_call_count),
      apiCallCount: integer(item.api_call_count),
      inputTokens: integer(item.input_tokens),
      outputTokens: integer(item.output_tokens),
      estimatedCostUsd: finite(item.estimated_cost_usd),
      actualCostUsd: finite(item.actual_cost_usd),
    };
  });

  const modelRecords = array(record(modelsRaw.value).data).slice(0, MAX_MODELS).map(record);
  const models = modelRecords.map((item, index) => ({
    displayId: bounded(item.id, `Model ${index + 1}`, 96),
    ownedBy: typeof item.owned_by === "string" ? bounded(item.owned_by, "Hermes", 64) : null,
  }));

  return {
    checkedAt: now,
    contract: {
      state: contractRaw.state,
      observedAt: contractRaw.observedAt,
      summary: contractRaw.state === "success" ? "Installed Hermes Agent capability contract responded." : contractRaw.summary,
      interface: "/v1/capabilities",
    },
    sessions: {
      state: sessionsRaw.state === "success" ? (sessions.length ? "success" : "connected_empty") : sessionsRaw.state,
      observedAt: sessionsRaw.observedAt,
      summary: sessionsRaw.state === "success" ? `Hermes Agent reported ${sessions.length} bounded session records.` : sessionsRaw.summary,
      interface: "/api/sessions?limit=100&offset=0&include_children=true",
      hasMore: typeof record(sessionsRaw.value).has_more === "boolean" ? record(sessionsRaw.value).has_more as boolean : null,
      items: sessions,
    },
    models: {
      state: modelsRaw.state === "success" ? (models.length ? "success" : "connected_empty") : modelsRaw.state,
      observedAt: modelsRaw.observedAt,
      summary: modelsRaw.state === "success" ? `Hermes Agent advertised ${models.length} model identities.` : modelsRaw.summary,
      interface: "/v1/models",
      items: models,
    },
  };
}

/** Reads one already-known run. This is deliberately not a discovery or enumeration interface. */
export async function readKnownAgentRun(
  config: HermesServerConfig | HermesReadOnlyServerConfig,
  knownRunId: string,
  fetchImpl: Fetch = fetch,
): Promise<HermesKnownRunRead> {
  const observedAt = new Date().toISOString();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(knownRunId)) throw new Error("A bounded known Hermes run identity is required.");
  const base = { observedAt, interface: "/v1/runs/{run_id}" as const, runId: knownRunId };
  if (!config.apiBaseUrl || !config.apiKey || config.sourceStates.agent_api !== "ready_to_probe") {
    return { ...base, state: "unavailable", lifecycle: null, createdAt: null, updatedAt: null, inputTokens: null, outputTokens: null, totalTokens: null, hasResult: false, hasFailure: false, summary: "Hermes Agent API is not configured for this known-run read." };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(`${config.apiBaseUrl}/v1/runs/${encodeURIComponent(knownRunId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) return { ...base, state: "authentication_failure", lifecycle: null, createdAt: null, updatedAt: null, inputTokens: null, outputTokens: null, totalTokens: null, hasResult: false, hasFailure: false, summary: "Hermes Agent API rejected the configured server credential." };
    if (response.status === 404) return { ...base, state: "not_found", lifecycle: null, createdAt: null, updatedAt: null, inputTokens: null, outputTokens: null, totalTokens: null, hasResult: false, hasFailure: false, summary: "The known Hermes run is not available in the installed runtime cache." };
    if (!response.ok) return { ...base, state: "failure", lifecycle: null, createdAt: null, updatedAt: null, inputTokens: null, outputTokens: null, totalTokens: null, hasResult: false, hasFailure: false, summary: `The known Hermes run read failed with HTTP ${response.status}.` };
    const raw = record(await response.json());
    const usage = record(raw.usage);
    return {
      ...base,
      state: "success",
      lifecycle: typeof raw.status === "string" ? bounded(raw.status, "unknown", 40) : null,
      createdAt: timestamp(raw.created_at),
      updatedAt: timestamp(raw.updated_at),
      inputTokens: integer(usage.input_tokens),
      outputTokens: integer(usage.output_tokens),
      totalTokens: integer(usage.total_tokens),
      hasResult: raw.output !== null && raw.output !== undefined,
      hasFailure: raw.error !== null && raw.error !== undefined,
      summary: "Hermes Agent returned bounded state for the explicitly known run.",
    };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    return { ...base, state: "unavailable", lifecycle: null, createdAt: null, updatedAt: null, inputTokens: null, outputTokens: null, totalTokens: null, hasResult: false, hasFailure: false, summary: timeout ? "The known Hermes run read timed out." : "The known Hermes run source is unreachable." };
  } finally {
    clearTimeout(timeoutId);
  }
}
