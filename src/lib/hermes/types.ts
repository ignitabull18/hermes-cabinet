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
