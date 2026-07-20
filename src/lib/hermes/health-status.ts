import type { HermesHealthSnapshot } from "./types";

export type HermesHealthDisplay = {
  label: string;
  detail: string;
  tone: "neutral" | "healthy" | "warning" | "failure";
  currentSource: string;
  currentObservedAt: string;
  lastConfirmedAt: string | null;
  lastConfirmedVersion: string | null;
};

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
      label: "Hermes connecting",
      detail: "Checking Hermes connectivity.",
      tone: "neutral",
      currentSource: "GET /api/hermes/health",
      currentObservedAt: now,
      lastConfirmedAt: null,
      lastConfirmedVersion: null,
    };
  }

  const sourceDetail = `Source ${snapshot.observationSource}, observed ${snapshot.checkedAt}.`;
  if (snapshot.status === "probe_timeout" || snapshot.status === "probe_unavailable") {
    const label = snapshot.status === "probe_timeout" ? "Hermes health probe timed out" : "Hermes status probe unavailable";
    const stale = lastConfirmed?.status === "online"
      ? ` Agent ${lastConfirmed.version ?? "version unknown"} was last confirmed ${ageLabel(lastConfirmed.checkedAt, now)} by ${lastConfirmed.observationSource}; that evidence is stale.`
      : " No prior successful observation is available; runtime state is unknown.";
    return {
      label,
      detail: `${snapshot.message}${stale} ${sourceDetail}`,
      tone: "warning",
      currentSource: snapshot.observationSource,
      currentObservedAt: snapshot.checkedAt,
      lastConfirmedAt: lastConfirmed?.status === "online" ? lastConfirmed.checkedAt : null,
      lastConfirmedVersion: lastConfirmed?.status === "online" ? lastConfirmed.version : null,
    };
  }

  const presentation = {
    online: ["Hermes online", "healthy"],
    offline: ["Hermes stopped", "failure"],
    authentication_failure: ["Hermes authentication failed", "failure"],
    unavailable_profile: ["Hermes profile unavailable", "warning"],
    misconfigured: ["Hermes setup incomplete", "warning"],
  } as const;
  const [label, tone] = presentation[snapshot.status];
  return {
    label,
    detail: `${snapshot.message} ${sourceDetail}`,
    tone,
    currentSource: snapshot.observationSource,
    currentObservedAt: snapshot.checkedAt,
    lastConfirmedAt: snapshot.status === "online" ? snapshot.checkedAt : null,
    lastConfirmedVersion: snapshot.status === "online" ? snapshot.version : null,
  };
}
