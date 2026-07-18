export type HermesServerConfig = {
  apiBaseUrl: string;
  apiKey: string;
  managementBaseUrl: string;
  profile: string;
  timeoutMs: number;
};

export class HermesConfigurationError extends Error {
  readonly code = "HERMES_MISCONFIGURED";

  constructor(message: string) {
    super(message);
    this.name = "HermesConfigurationError";
  }
}

function required(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new HermesConfigurationError(`Missing server configuration: ${name}`);
  }
  return normalized;
}

function baseUrl(name: string, value: string | undefined): string {
  const raw = required(name, value);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HermesConfigurationError(
      `Invalid server configuration: ${name} must be an HTTP(S) URL`
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HermesConfigurationError(
      `Invalid server configuration: ${name} must be an HTTP(S) URL`
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function timeout(value: string | undefined): number {
  if (!value?.trim()) return 3_000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 250 || parsed > 30_000) {
    throw new HermesConfigurationError(
      "Invalid server configuration: CABINET_HERMES_TIMEOUT_MS must be an integer from 250 to 30000"
    );
  }
  return parsed;
}

export function readHermesServerConfig(
  env: Readonly<Record<string, string | undefined>> = process.env
): HermesServerConfig {
  return {
    apiBaseUrl: baseUrl("CABINET_HERMES_API_URL", env.CABINET_HERMES_API_URL),
    apiKey: required("CABINET_HERMES_API_KEY", env.CABINET_HERMES_API_KEY),
    managementBaseUrl: baseUrl(
      "CABINET_HERMES_MANAGEMENT_URL",
      env.CABINET_HERMES_MANAGEMENT_URL
    ),
    profile: required("CABINET_HERMES_PROFILE", env.CABINET_HERMES_PROFILE),
    timeoutMs: timeout(env.CABINET_HERMES_TIMEOUT_MS),
  };
}
