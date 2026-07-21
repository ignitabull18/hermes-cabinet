import { validateHermesUpstreamUrl } from "./upstream-url";

export type HermesReadinessStatus = "present" | "absent" | "invalid";
export type HermesReadinessSourceState = "ready_to_probe" | "incomplete" | "invalid" | "unavailable";
export type HermesReadinessSourceId = "agent_api" | "management" | "gateway";

export type HermesReadinessVariable = {
  name: string;
  requiredForInitialLiveReview: boolean;
  status: HermesReadinessStatus;
  sourceType: "server_environment" | "approved_equivalent" | "default" | "none";
  safeEndpointIdentity: string | null;
};

export type HermesReadinessSource = {
  id: HermesReadinessSourceId;
  configured: boolean;
  state: HermesReadinessSourceState;
  variables: string[];
  safeEndpointIdentity: string | null;
};

export type HermesLiveReadiness = {
  readyForAnyLiveRead: boolean;
  fullCoverageReady: boolean;
  interventionsEnabled: false;
  sources: HermesReadinessSource[];
  variables: HermesReadinessVariable[];
  missing: string[];
  invalid: string[];
};

type ServerEnvironment = Readonly<Record<string, string | undefined>>;

function present(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function endpointVariable(name: string, value: string | undefined, required: boolean): HermesReadinessVariable {
  if (!present(value)) {
    return {
      name,
      requiredForInitialLiveReview: required,
      status: "absent",
      sourceType: "none",
      safeEndpointIdentity: null,
    };
  }
  try {
    const endpoint = validateHermesUpstreamUrl(name, value!);
    return {
      name,
      requiredForInitialLiveReview: required,
      status: "present",
      sourceType: "server_environment",
      safeEndpointIdentity: endpoint.safeOrigin,
    };
  } catch {
    return {
      name,
      requiredForInitialLiveReview: required,
      status: "invalid",
      sourceType: "server_environment",
      safeEndpointIdentity: null,
    };
  }
}

function secretVariable(
  name: string,
  value: string | undefined,
  required: boolean,
  equivalentValue?: string | undefined,
): HermesReadinessVariable {
  const direct = present(value);
  const equivalent = present(equivalentValue);
  return {
    name,
    requiredForInitialLiveReview: required,
    status: direct || equivalent ? "present" : "absent",
    sourceType: direct ? "server_environment" : equivalent ? "approved_equivalent" : "none",
    safeEndpointIdentity: null,
  };
}

function plainVariable(name: string, value: string | undefined, required: boolean): HermesReadinessVariable {
  return {
    name,
    requiredForInitialLiveReview: required,
    status: present(value) ? "present" : "absent",
    sourceType: present(value) ? "server_environment" : "none",
    safeEndpointIdentity: null,
  };
}

function timeoutVariable(value: string | undefined): HermesReadinessVariable {
  if (!present(value)) {
    return {
      name: "CABINET_HERMES_TIMEOUT_MS",
      requiredForInitialLiveReview: false,
      status: "absent",
      sourceType: "default",
      safeEndpointIdentity: null,
    };
  }
  const parsed = Number(value);
  return {
    name: "CABINET_HERMES_TIMEOUT_MS",
    requiredForInitialLiveReview: false,
    status: Number.isInteger(parsed) && parsed >= 250 && parsed <= 30_000 ? "present" : "invalid",
    sourceType: "server_environment",
    safeEndpointIdentity: null,
  };
}

function interventionVariable(value: string | undefined): HermesReadinessVariable {
  const normalized = value?.trim().toLowerCase();
  return {
    name: "CABINET_HERMES_INTERVENTIONS_ENABLED",
    requiredForInitialLiveReview: false,
    status: normalized === undefined || normalized === "" ? "absent" : normalized === "false" ? "present" : "invalid",
    sourceType: normalized === undefined || normalized === "" ? "default" : "server_environment",
    safeEndpointIdentity: null,
  };
}

function source(
  id: HermesReadinessSourceId,
  variableNames: string[],
  variables: HermesReadinessVariable[],
): HermesReadinessSource {
  const members = variableNames.map((name) => variables.find((item) => item.name === name)!);
  const presentCount = members.filter((item) => item.status === "present").length;
  const invalid = members.some((item) => item.status === "invalid");
  const configured = presentCount === members.length && !invalid;
  const state: HermesReadinessSourceState = invalid
    ? "invalid"
    : configured
      ? "ready_to_probe"
      : presentCount === 0
        ? "unavailable"
        : "incomplete";
  return {
    id,
    configured,
    state,
    variables: variableNames,
    safeEndpointIdentity: members.find((item) => item.safeEndpointIdentity)?.safeEndpointIdentity ?? null,
  };
}

/** Returns a bounded, secret-free, source-specific live-read readiness projection. */
export function assessHermesLiveReadiness(env: ServerEnvironment = process.env): HermesLiveReadiness {
  const variables = [
    endpointVariable("CABINET_HERMES_API_URL", env.CABINET_HERMES_API_URL, true),
    secretVariable("CABINET_HERMES_API_KEY", env.CABINET_HERMES_API_KEY, true),
    endpointVariable("CABINET_HERMES_MANAGEMENT_URL", env.CABINET_HERMES_MANAGEMENT_URL, true),
    secretVariable(
      "CABINET_HERMES_MANAGEMENT_TOKEN",
      env.CABINET_HERMES_MANAGEMENT_TOKEN,
      true,
      env.HERMES_DASHBOARD_SESSION_TOKEN,
    ),
    plainVariable("CABINET_HERMES_PROFILE", env.CABINET_HERMES_PROFILE, true),
    endpointVariable("CABINET_HERMES_GATEWAY_URL", env.CABINET_HERMES_GATEWAY_URL, false),
    secretVariable("CABINET_HERMES_GATEWAY_TOKEN", env.CABINET_HERMES_GATEWAY_TOKEN, false),
    timeoutVariable(env.CABINET_HERMES_TIMEOUT_MS),
    interventionVariable(env.CABINET_HERMES_INTERVENTIONS_ENABLED),
  ];
  const sources = [
    source("agent_api", ["CABINET_HERMES_API_URL", "CABINET_HERMES_API_KEY"], variables),
    source(
      "management",
      ["CABINET_HERMES_MANAGEMENT_URL", "CABINET_HERMES_MANAGEMENT_TOKEN", "CABINET_HERMES_PROFILE"],
      variables,
    ),
    source("gateway", ["CABINET_HERMES_GATEWAY_URL", "CABINET_HERMES_GATEWAY_TOKEN"], variables),
  ];
  const invalid = variables.filter((variable) => variable.status === "invalid").map((variable) => variable.name);
  const missing = variables
    .filter((variable) => variable.status === "absent" && variable.sourceType === "none")
    .map((variable) => variable.name);
  const apiReady = sources.find((item) => item.id === "agent_api")?.state === "ready_to_probe";
  const managementReady = sources.find((item) => item.id === "management")?.state === "ready_to_probe";
  return {
    readyForAnyLiveRead: apiReady || managementReady,
    fullCoverageReady: sources.every((item) => item.state === "ready_to_probe") && invalid.length === 0,
    interventionsEnabled: false,
    sources,
    variables,
    missing,
    invalid,
  };
}
