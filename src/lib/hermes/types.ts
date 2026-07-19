export const HERMES_CONNECTION_STATES = [
  "online",
  "offline",
  "authentication_failure",
  "unavailable_profile",
  "misconfigured",
] as const;

export type HermesConnectionState =
  (typeof HERMES_CONNECTION_STATES)[number];

export type HermesHealthSnapshot = {
  enabled: boolean;
  status: HermesConnectionState;
  version: string | null;
  profile: string | null;
  gatewayState: string | null;
  checkedAt: string;
  message: string;
};

export type HermesApiHealth = {
  status?: unknown;
  version?: unknown;
  gateway_state?: unknown;
};

export type HermesManagementStatus = {
  profiles?: unknown;
};

export type HermesGatewayEvent = {
  type: string;
  session_id?: string;
  payload?: Record<string, unknown>;
};

export type HermesConversationStatus =
  | "idle"
  | "streaming"
  | "completed"
  | "interrupted"
  | "failed";

/**
 * Cabinet's rebuildable pointer into Hermes-owned conversation state.
 * Hermes remains authoritative for transcript and execution history.
 */
export type HermesConversationReference = {
  profile: string;
  sessionId: string;
  parentSessionId?: string;
  liveSessionId?: string;
  runId?: string;
  parentRunId?: string;
  eventSequence: number;
  status: HermesConversationStatus;
  artifactPaths: string[];
  updatedAt: string;
};
