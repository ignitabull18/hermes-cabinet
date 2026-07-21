import type { HermesHealthSnapshot } from "./types";

export type HermesHealthDisplay = {
  state: HermesAgentOperationalState;
  label: string;
  statusText: string;
  detail: string;
  tone: "neutral" | "healthy" | "warning" | "failure";
  currentSource: string;
  currentObservedAt: string;
  lastConfirmedAt: string | null;
  lastConfirmedVersion: string | null;
};

export type HermesAgentOperationalState =
  | "connected"
  | "stale"
  | "probe_unavailable"
  | "probe_timeout"
  | "authentication_failure"
  | "not_configured"
  | "authoritative_offline"
  | "unknown";

const FRESH_AGENT_OBSERVATION_MS = 30_000;

function ageLabel(observedAt: string, now: string): string {
  const elapsed = Date.parse(now) - Date.parse(observedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "at an unknown time";
  const seconds = Math.max(0, Math.floor(elapsed / 1_000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"} ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
}

export function hermesHealthDisplay(
  snapshot: HermesHealthSnapshot | null,
  lastConfirmed: HermesHealthSnapshot | null,
  now = new Date().toISOString(),
): HermesHealthDisplay {
  if (!snapshot) {
    return {
      state: "unknown",
      label: "Hermes status unknown",
      statusText: "Unknown — awaiting a source-specific Agent observation",
      detail: "Checking Hermes connectivity.",
      tone: "neutral",
      currentSource: "GET /api/hermes/health",
      currentObservedAt: now,
      lastConfirmedAt: null,
      lastConfirmedVersion: null,
    };
  }

  const sourceDetail = `Source ${snapshot.observationSource}, observed ${snapshot.checkedAt}.`;
  const ageMs = Date.parse(now) - Date.parse(snapshot.checkedAt);
  if (snapshot.status === "online" && (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > FRESH_AGENT_OBSERVATION_MS)) {
    return {
      state: "stale",
      label: "Hermes evidence stale",
      statusText: `Stale — Agent ${snapshot.version ?? "version unknown"} was last confirmed ${ageLabel(snapshot.checkedAt, now)}`,
      detail: `${snapshot.message} The successful observation is stale. ${sourceDetail}`,
      tone: "warning",
      currentSource: snapshot.observationSource,
      currentObservedAt: snapshot.checkedAt,
      lastConfirmedAt: snapshot.checkedAt,
      lastConfirmedVersion: snapshot.version,
    };
  }
  if (snapshot.status === "probe_timeout" || snapshot.status === "probe_unavailable") {
    const label = snapshot.status === "probe_timeout" ? "Hermes health probe timed out" : "Hermes status probe unavailable";
    const stale = lastConfirmed?.status === "online"
      ? ` Agent ${lastConfirmed.version ?? "version unknown"} was last confirmed ${ageLabel(lastConfirmed.checkedAt, now)} by ${lastConfirmed.observationSource}; that evidence is stale.`
      : " No prior successful observation is available; runtime state is unknown.";
    return {
      state: lastConfirmed?.status === "online" ? "stale" : snapshot.status,
      label,
      statusText: lastConfirmed?.status === "online"
        ? `Health probe unavailable — last confirmed ${ageLabel(lastConfirmed.checkedAt, now)}`
        : snapshot.status === "probe_timeout"
          ? "Health probe timed out — runtime state unknown"
          : "Health probe unavailable — runtime state unknown",
      detail: `${snapshot.message}${stale} ${sourceDetail}`,
      tone: "warning",
      currentSource: snapshot.observationSource,
      currentObservedAt: snapshot.checkedAt,
      lastConfirmedAt: lastConfirmed?.status === "online" ? lastConfirmed.checkedAt : null,
      lastConfirmedVersion: lastConfirmed?.status === "online" ? lastConfirmed.version : null,
    };
  }

  const presentation = {
    online: ["connected", "Hermes connected", `Connected — ${snapshot.version ?? "version unknown"}`, "healthy"],
    offline: ["authoritative_offline", "Hermes stopped", "Authoritatively offline", "failure"],
    authentication_failure: ["authentication_failure", "Hermes authentication failed", "Authentication rejected — Jeremy action required", "failure"],
    unavailable_profile: ["unknown", "Hermes profile unavailable", "Profile unavailable — runtime state unknown", "warning"],
    misconfigured: ["not_configured", "Hermes not configured", "Not configured", "warning"],
  } as const;
  const [state, label, statusText, tone] = presentation[snapshot.status];
  return {
    state,
    label,
    statusText,
    detail: `${snapshot.message} ${sourceDetail}`,
    tone,
    currentSource: snapshot.observationSource,
    currentObservedAt: snapshot.checkedAt,
    lastConfirmedAt: snapshot.status === "online" ? snapshot.checkedAt : null,
    lastConfirmedVersion: snapshot.status === "online" ? snapshot.version : null,
  };
}
