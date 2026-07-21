import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { load } from "js-yaml";

const SUPERMEMORY_LIMITATION =
  "Supermemory is selected in Hermes configuration. The loaded provider and live runtime availability remain unknown because the installed read-only Agent API exposes no memory-status contract.";

export type HermesLocalMemoryObservation = {
  state: "metadata_detected" | "not_selected" | "unavailable" | "unknown";
  observedAt: string;
  configuredProfile: string;
  observedActiveProfile: null;
  configuredProviderSelection: "supermemory" | null;
  detectedPluginManifest: boolean;
  observedLoadedProvider: null;
  observedRuntimeAvailability: "unknown";
  credentialState: "not_inspected";
  liveDataExposed: false;
  interface: "Hermes configured-profile metadata + installed plugin manifest metadata";
  summary: string;
};

type ObservationOptions = {
  hermesHome?: string;
  observedAt?: string;
  readText?: (file: string) => Promise<string>;
  fileExists?: (file: string) => Promise<boolean>;
};

function safeProfile(value: string): string {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value) ? value : "unknown";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function defaultFileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads only non-secret Hermes configuration metadata. Environment files are
 * deliberately outside this observer's contract: credential ownership stays
 * with Hermes and Cabinet never inspects credential presence or value.
 */
export async function observeHermesLocalMemory(
  profileInput: string,
  options: ObservationOptions = {},
): Promise<HermesLocalMemoryObservation> {
  const observedAt = options.observedAt ?? new Date().toISOString();
  const configuredProfile = safeProfile(profileInput);
  const interfaceIdentity = "Hermes configured-profile metadata + installed plugin manifest metadata" as const;
  const base = {
    observedAt,
    configuredProfile,
    observedActiveProfile: null,
    configuredProviderSelection: null,
    detectedPluginManifest: false,
    observedLoadedProvider: null,
    observedRuntimeAvailability: "unknown" as const,
    credentialState: "not_inspected" as const,
    liveDataExposed: false as const,
    interface: interfaceIdentity,
  };

  if (configuredProfile === "unknown") {
    return { ...base, state: "unknown", summary: "Hermes memory metadata could not be inspected because the configured profile identity is invalid." };
  }

  const hermesHome = options.hermesHome ?? path.join(homedir(), ".hermes");
  const readText = options.readText ?? ((file: string) => readFile(file, "utf8"));
  const fileExists = options.fileExists ?? defaultFileExists;
  let profileConfig: string;
  try {
    profileConfig = await readText(path.join(hermesHome, "profiles", configuredProfile, "config.yaml"));
  } catch {
    return { ...base, state: "unavailable", summary: "Hermes configured-profile memory metadata is not safely observable on this Cabinet server." };
  }

  let provider: string | null = null;
  try {
    const parsed = record(load(profileConfig));
    const memory = record(parsed.memory);
    provider = typeof memory.provider === "string" ? memory.provider.trim().toLowerCase() : null;
  } catch {
    return { ...base, state: "unknown", summary: "Hermes configured-profile memory metadata could not be interpreted safely." };
  }

  if (provider !== "supermemory") {
    return { ...base, state: "not_selected", summary: "Supermemory is not selected in the configured Hermes profile." };
  }

  const detectedPluginManifest = await fileExists(
    path.join(hermesHome, "hermes-agent", "plugins", "memory", "supermemory", "plugin.yaml"),
  );
  return {
    ...base,
    state: "metadata_detected",
    configuredProviderSelection: "supermemory",
    detectedPluginManifest,
    summary: SUPERMEMORY_LIMITATION,
  };
}

export { SUPERMEMORY_LIMITATION };
