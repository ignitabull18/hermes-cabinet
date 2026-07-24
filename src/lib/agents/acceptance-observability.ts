import { createHash } from "node:crypto";

export type AcceptanceReadinessState =
  | "ready"
  | "blocked"
  | "unknown";

export type AcceptanceProviderHttpStatus =
  | "none"
  | "2xx"
  | "4xx"
  | "5xx"
  | "network";

export type AcceptanceFailureClass =
  | "none"
  | "readiness"
  | "provider_not_found"
  | "provider_authentication"
  | "provider_rate_limit"
  | "provider_failure"
  | "transport"
  | "timeout"
  | "unknown";

export interface AcceptanceRuntimeObservation {
  readinessState: AcceptanceReadinessState;
  provider: string | null;
  model: string | null;
  modelRequestsAttempted: number;
  providerRetries: number;
  fallbackAttempts: number;
  lastProviderHttpStatus: AcceptanceProviderHttpStatus;
  lastFailureClass: AcceptanceFailureClass;
  acpChildState: "not_started" | "running" | "exited" | "unknown";
  responseExactness: {
    initial: AcceptanceResponseExactness;
    followUp: AcceptanceResponseExactness;
  };
}

export interface AcceptanceResponseExactness {
  rawModelFinalExact: boolean | null;
  acpNormalizedExact: boolean | null;
}

const observations = new Map<string, AcceptanceRuntimeObservation>();

function emptyResponseExactness(): AcceptanceResponseExactness {
  return {
    rawModelFinalExact: null,
    acpNormalizedExact: null,
  };
}

function boundedIdentity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) return null;
  if (!/^[a-zA-Z0-9._:/+-]+$/.test(normalized)) return null;
  return normalized;
}

function boundedCount(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : 0;
}

export function acceptanceObservabilityEnabled(): boolean {
  return (
    process.env.CABINET_ACCEPTANCE_OBSERVABILITY === "1" &&
    process.env.CABINET_ACCEPTANCE_ISOLATED === "1" &&
    process.env.CABINET_RUNTIME_MODE === "hermes"
  );
}

export function recordAcceptanceRuntimeObservation(
  conversationId: string,
  value: Partial<AcceptanceRuntimeObservation>,
): void {
  if (!acceptanceObservabilityEnabled()) return;
  const current = observations.get(conversationId) ?? {
    readinessState: "unknown",
    provider: null,
    model: null,
    modelRequestsAttempted: 0,
    providerRetries: 0,
    fallbackAttempts: 0,
    lastProviderHttpStatus: "none",
    lastFailureClass: "none",
    acpChildState: "unknown",
    responseExactness: {
      initial: emptyResponseExactness(),
      followUp: emptyResponseExactness(),
    },
  };
  observations.set(conversationId, {
    readinessState:
      value.readinessState === "ready" || value.readinessState === "blocked"
        ? value.readinessState
        : current.readinessState,
    provider:
      value.provider === undefined
        ? current.provider
        : boundedIdentity(value.provider),
    model:
      value.model === undefined
        ? current.model
        : boundedIdentity(value.model),
    modelRequestsAttempted:
      value.modelRequestsAttempted === undefined
        ? current.modelRequestsAttempted
        : boundedCount(value.modelRequestsAttempted),
    providerRetries:
      value.providerRetries === undefined
        ? current.providerRetries
        : boundedCount(value.providerRetries),
    fallbackAttempts:
      value.fallbackAttempts === undefined
        ? current.fallbackAttempts
        : boundedCount(value.fallbackAttempts),
    lastProviderHttpStatus:
      value.lastProviderHttpStatus ?? current.lastProviderHttpStatus,
    lastFailureClass: value.lastFailureClass ?? current.lastFailureClass,
    acpChildState: value.acpChildState ?? current.acpChildState,
    responseExactness: value.responseExactness ?? current.responseExactness,
  });
}

function exactAgainstAcceptanceHash(value: string | null | undefined): boolean | null {
  if (typeof value !== "string") return null;
  const expected = process.env.CABINET_ACCEPTANCE_EXPECTED_RESPONSE_SHA256;
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) return null;
  return createHash("sha256").update(value).digest("hex") === expected;
}

export function recordAcceptanceResponseExactness(
  conversationId: string,
  turn: "initial" | "followUp",
  value: {
    rawModelFinal?: string | null;
    acpNormalized?: string | null;
  },
): void {
  if (!acceptanceObservabilityEnabled()) return;
  const current = observations.get(conversationId);
  if (!current) return;
  observations.set(conversationId, {
    ...current,
    responseExactness: {
      ...current.responseExactness,
      [turn]: {
        rawModelFinalExact: exactAgainstAcceptanceHash(value.rawModelFinal),
        acpNormalizedExact: exactAgainstAcceptanceHash(value.acpNormalized),
      },
    },
  });
}

export function readAcceptanceRuntimeObservation(
  conversationId: string,
): AcceptanceRuntimeObservation | null {
  if (!acceptanceObservabilityEnabled()) return null;
  const observation = observations.get(conversationId);
  return observation
    ? {
        ...observation,
        responseExactness: {
          initial: { ...observation.responseExactness.initial },
          followUp: { ...observation.responseExactness.followUp },
        },
      }
    : null;
}

export function clearAcceptanceRuntimeObservation(
  conversationId: string,
): void {
  observations.delete(conversationId);
}
