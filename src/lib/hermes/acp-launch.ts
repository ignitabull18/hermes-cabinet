import fs from "node:fs/promises";
import type { HermesExecutionServerConfig } from "./server-config";

export function buildHermesAcpLaunchEnvironment(
  config: HermesExecutionServerConfig,
  source: Readonly<Record<string, string | undefined>> = process.env,
): NodeJS.ProcessEnv {
  const allowed = ["HOME", "LOGNAME", "PATH", "SHELL", "TMPDIR", "USER", "LANG", "LC_ALL"];
  const nodeEnv = source.NODE_ENV;
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: nodeEnv === "development" || nodeEnv === "test"
      ? nodeEnv
      : "production",
    HERMES_ACP_NO_TOOLS: "1",
    HERMES_HOME: config.hermesHome,
    HERMES_PROFILE: config.profile,
  };
  for (const name of allowed) {
    if (source[name]) env[name] = source[name];
  }
  const credential = source[config.providerCredentialEnvName];
  if (!credential) throw new Error("Hermes ACP provider credential is unavailable.");
  env[config.providerCredentialEnvName] = credential;
  return env;
}

export async function assertHermesAcpExecutable(
  config: HermesExecutionServerConfig,
): Promise<void> {
  await fs.access(config.cliPath, fs.constants.X_OK);
}
