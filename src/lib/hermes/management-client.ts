import type {
  HermesApiHealth,
  HermesHealthSnapshot,
  HermesManagementStatus,
} from "./types";
import type { HermesServerConfig } from "./server-config";

type Fetch = typeof fetch;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function snapshot(
  config: HermesServerConfig,
  status: HermesHealthSnapshot["status"],
  message: string,
  values: Partial<Pick<HermesHealthSnapshot, "version" | "gatewayState">> = {}
): HermesHealthSnapshot {
  return {
    enabled: true,
    status,
    version: values.version ?? null,
    profile: config.profile,
    gatewayState: values.gatewayState ?? null,
    checkedAt: new Date().toISOString(),
    message,
  };
}

export class HermesManagementClient {
  constructor(
    private readonly config: HermesServerConfig,
    private readonly fetchImpl: Fetch = fetch
  ) {}

  async health(): Promise<HermesHealthSnapshot> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const healthResponse = await this.fetchImpl(
        `${this.config.apiBaseUrl}/health/detailed`,
        {
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            Accept: "application/json",
          },
          cache: "no-store",
          signal: controller.signal,
        }
      );

      if (healthResponse.status === 401 || healthResponse.status === 403) {
        return snapshot(
          this.config,
          "authentication_failure",
          "Hermes rejected the configured server credential."
        );
      }
      if (!healthResponse.ok) {
        return snapshot(
          this.config,
          "offline",
          `Hermes health request failed with HTTP ${healthResponse.status}.`
        );
      }

      const health = (await healthResponse.json()) as HermesApiHealth;
      const version = text(health.version);
      const gatewayState = text(health.gateway_state);

      const profileResponse = await this.fetchImpl(
        `${this.config.managementBaseUrl}/api/status`,
        {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        }
      );
      if (!profileResponse.ok) {
        return snapshot(
          this.config,
          "offline",
          `Hermes profile discovery failed with HTTP ${profileResponse.status}.`,
          { version, gatewayState }
        );
      }

      const management = (await profileResponse.json()) as HermesManagementStatus;
      const profiles = Array.isArray(management.profiles)
        ? management.profiles.filter((profile): profile is string =>
            typeof profile === "string"
          )
        : [];
      if (!profiles.includes(this.config.profile)) {
        return snapshot(
          this.config,
          "unavailable_profile",
          `Configured Hermes profile ${JSON.stringify(this.config.profile)} is unavailable.`,
          { version, gatewayState }
        );
      }

      return snapshot(this.config, "online", "Hermes is online.", {
        version,
        gatewayState,
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError");
      return snapshot(
        this.config,
        "offline",
        timedOut
          ? "Hermes health request timed out."
          : "Hermes is unreachable."
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
