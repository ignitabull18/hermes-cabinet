import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { load } from "js-yaml";

const SUPERMEMORY_LIMITATION =
  "Supermemory is configured in Hermes. Live memory data is not exposed by the installed Hermes read-only API.";

export type HermesLocalMemoryObservation = {
  state: "configured" | "not_configured" | "unavailable" | "unknown";
  observedAt: string;
  provider: "supermemory" | null;
  profile: string;
  credentialConfigured: boolean;
  installedPlugin: boolean;
  liveDataExposed: false;
  interface: "Hermes profile configuration + installed Agent API contract audit";
  summary: string;
};

function safeProfile(value: string): string {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value) ? value : "unknown";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasEnvField(contents: string, field: string): boolean {
  return contents.split(/\r?\n/).some((line) => {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    return match?.[1] === field;
  });
}

async function optionalRead(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Read only the minimum Hermes-owned configuration metadata needed to state
 * whether Supermemory is configured. Secret values and filesystem identities
 * never enter the returned model.
 */
export async function observeHermesLocalMemory(
  profileInput: string,
  options: { hermesHome?: string; observedAt?: string } = {},
): Promise<HermesLocalMemoryObservation> {
  const observedAt = options.observedAt ?? new Date().toISOString();
  const profile = safeProfile(profileInput);
  const interfaceIdentity = "Hermes profile configuration + installed Agent API contract audit" as const;
  if (profile === "unknown") {
    return {
      state: "unknown",
      observedAt,
      provider: null,
      profile,
      credentialConfigured: false,
      installedPlugin: false,
      liveDataExposed: false,
      interface: interfaceIdentity,
      summary: "Hermes memory configuration could not be inspected because the active profile identity is invalid.",
    };
  }

  const hermesHome = options.hermesHome ?? path.join(homedir(), ".hermes");
  const profileConfig = await optionalRead(path.join(hermesHome, "profiles", profile, "config.yaml"));
  if (profileConfig === null) {
    return {
      state: "unavailable",
      observedAt,
      provider: null,
      profile,
      credentialConfigured: false,
      installedPlugin: false,
      liveDataExposed: false,
      interface: interfaceIdentity,
      summary: "Hermes profile memory configuration is not safely observable on this Cabinet server.",
    };
  }

  let provider: string | null = null;
  try {
    const parsed = record(load(profileConfig));
    const memory = record(parsed.memory);
    provider = typeof memory.provider === "string" ? memory.provider.trim().toLowerCase() : null;
  } catch {
    return {
      state: "unknown",
      observedAt,
      provider: null,
      profile,
      credentialConfigured: false,
      installedPlugin: false,
      liveDataExposed: false,
      interface: interfaceIdentity,
      summary: "Hermes profile memory configuration could not be interpreted safely.",
    };
  }

  if (provider !== "supermemory") {
    return {
      state: "not_configured",
      observedAt,
      provider: null,
      profile,
      credentialConfigured: false,
      installedPlugin: false,
      liveDataExposed: false,
      interface: interfaceIdentity,
      summary: "Supermemory is not selected as the active Hermes memory provider.",
    };
  }

  const [globalEnvironment, profileEnvironment, installedPluginSource] = await Promise.all([
    optionalRead(path.join(hermesHome, ".env")),
    optionalRead(path.join(hermesHome, "profiles", profile, ".env")),
    optionalRead(path.join(hermesHome, "hermes-agent", "plugins", "memory", "supermemory", "plugin.yaml")),
  ]);
  const credentialConfigured = [globalEnvironment, profileEnvironment]
    .some((contents) => contents !== null && hasEnvField(contents, "SUPERMEMORY_API_KEY"));
  const installedPlugin = installedPluginSource !== null;
  const configured = credentialConfigured && installedPlugin;

  return {
    state: configured ? "configured" : "not_configured",
    observedAt,
    provider: "supermemory",
    profile,
    credentialConfigured,
    installedPlugin,
    liveDataExposed: false,
    interface: interfaceIdentity,
    summary: configured
      ? SUPERMEMORY_LIMITATION
      : "Supermemory is selected in Hermes, but its installed configuration is incomplete.",
  };
}

export { SUPERMEMORY_LIMITATION };
