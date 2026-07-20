export type HermesReadinessStatus = "present" | "absent" | "invalid";

export type HermesReadinessVariable = {
  name: string;
  requiredForLiveReview: boolean;
  status: HermesReadinessStatus;
  sourceType: "server_environment" | "approved_equivalent" | "default" | "none";
  safeEndpointIdentity: string | null;
};

export type HermesLiveReadiness = {
  ready: boolean;
  interventionsEnabled: false;
  variables: HermesReadinessVariable[];
  missing: string[];
  invalid: string[];
};

type ServerEnvironment = Readonly<Record<string, string | undefined>>;

function present(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function safeEndpointIdentity(value: string | undefined): {
  status: HermesReadinessStatus;
  identity: string | null;
} {
  if (!present(value)) return { status: "absent", identity: null };
  try {
    const parsed = new URL(value!);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { status: "invalid", identity: null };
    }
    return { status: "present", identity: parsed.origin.slice(0, 160) };
  } catch {
    return { status: "invalid", identity: null };
  }
}

function endpointVariable(name: string, value: string | undefined): HermesReadinessVariable {
  const endpoint = safeEndpointIdentity(value);
  return {
    name,
    requiredForLiveReview: true,
    status: endpoint.status,
    sourceType: endpoint.status === "absent" ? "none" : "server_environment",
    safeEndpointIdentity: endpoint.identity,
  };
}

function secretVariable(
  name: string,
  value: string | undefined,
  equivalentValue?: string | undefined,
): HermesReadinessVariable {
  const direct = present(value);
  const equivalent = present(equivalentValue);
  return {
    name,
    requiredForLiveReview: true,
    status: direct || equivalent ? "present" : "absent",
    sourceType: direct ? "server_environment" : equivalent ? "approved_equivalent" : "none",
    safeEndpointIdentity: null,
  };
}

function plainVariable(name: string, value: string | undefined): HermesReadinessVariable {
  return {
    name,
    requiredForLiveReview: true,
    status: present(value) ? "present" : "absent",
    sourceType: present(value) ? "server_environment" : "none",
    safeEndpointIdentity: null,
  };
}

function timeoutVariable(value: string | undefined): HermesReadinessVariable {
  if (!present(value)) {
    return {
      name: "CABINET_HERMES_TIMEOUT_MS",
      requiredForLiveReview: false,
      status: "absent",
      sourceType: "default",
      safeEndpointIdentity: null,
    };
  }
  const parsed = Number(value);
  return {
    name: "CABINET_HERMES_TIMEOUT_MS",
    requiredForLiveReview: false,
    status: Number.isInteger(parsed) && parsed >= 250 && parsed <= 30_000 ? "present" : "invalid",
    sourceType: "server_environment",
    safeEndpointIdentity: null,
  };
}

function interventionVariable(value: string | undefined): HermesReadinessVariable {
  const normalized = value?.trim().toLowerCase();
  return {
    name: "CABINET_HERMES_INTERVENTIONS_ENABLED",
    requiredForLiveReview: false,
    status: normalized === undefined || normalized === "" ? "absent" : normalized === "false" ? "present" : "invalid",
    sourceType: normalized === undefined || normalized === "" ? "default" : "server_environment",
    safeEndpointIdentity: null,
  };
}

/**
 * Returns a bounded, secret-free readiness projection. It deliberately never
 * returns configuration values, token fingerprints, paths, or secret lengths.
 */
export function assessHermesLiveReadiness(env: ServerEnvironment = process.env): HermesLiveReadiness {
  const variables = [
    endpointVariable("CABINET_HERMES_API_URL", env.CABINET_HERMES_API_URL),
    secretVariable("CABINET_HERMES_API_KEY", env.CABINET_HERMES_API_KEY),
    endpointVariable("CABINET_HERMES_MANAGEMENT_URL", env.CABINET_HERMES_MANAGEMENT_URL),
    secretVariable(
      "CABINET_HERMES_MANAGEMENT_TOKEN",
      env.CABINET_HERMES_MANAGEMENT_TOKEN,
      env.HERMES_DASHBOARD_SESSION_TOKEN,
    ),
    endpointVariable("CABINET_HERMES_GATEWAY_URL", env.CABINET_HERMES_GATEWAY_URL),
    secretVariable("CABINET_HERMES_GATEWAY_TOKEN", env.CABINET_HERMES_GATEWAY_TOKEN),
    plainVariable("CABINET_HERMES_PROFILE", env.CABINET_HERMES_PROFILE),
    timeoutVariable(env.CABINET_HERMES_TIMEOUT_MS),
    interventionVariable(env.CABINET_HERMES_INTERVENTIONS_ENABLED),
  ];
  const required = variables.filter((variable) => variable.requiredForLiveReview);
  const missing = required.filter((variable) => variable.status === "absent").map((variable) => variable.name);
  const invalid = variables.filter((variable) => variable.status === "invalid").map((variable) => variable.name);
  return {
    ready: missing.length === 0 && invalid.length === 0,
    interventionsEnabled: false,
    variables,
    missing,
    invalid,
  };
}
