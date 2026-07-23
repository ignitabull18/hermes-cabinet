import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { HermesExecutionServerConfig } from "./server-config";
import {
  HermesAcpError,
  HermesAcpTransportCore,
  type HermesAcpTraceEvent,
  type HermesAcpTurnResult,
  validateHermesAcpExecutable,
} from "./acp-transport-core";

export {
  DEFAULT_HERMES_ACP_DEADLINES,
  HERMES_ACP_PROVIDER_CREDENTIAL,
  HermesAcpError,
  HermesAcpTransportCore,
  validateHermesAcpExecutable,
} from "./acp-transport-core";
export type {
  HermesAcpDeadlineStage,
  HermesAcpDeadlines,
  HermesAcpTraceEvent,
  HermesAcpTransportConfig,
  HermesAcpTurnResult,
} from "./acp-transport-core";

const clients = new Map<string, HermesAcpTransportCore>();
let shutdownHooksInstalled = false;

function identity(config: HermesExecutionServerConfig): string {
  return [
    config.cliPath,
    config.profile,
    config.providerCredentialEnvName,
  ].join("\0");
}

function removeClient(client: HermesAcpTransportCore): void {
  for (const [key, candidate] of clients) {
    if (candidate === client) clients.delete(key);
  }
}

function clientFor(config: HermesExecutionServerConfig): HermesAcpTransportCore {
  installShutdownHooks();
  const key = identity(config);
  const existing = clients.get(key);
  if (existing?.matches(config)) return existing;
  const created = new HermesAcpTransportCore(config);
  clients.set(key, created);
  return created;
}

function installShutdownHooks(): void {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;
  process.once("beforeExit", () => {
    void shutdownHermesAcpClients();
  });
  process.once("exit", () => {
    for (const client of clients.values()) {
      const child = client.process;
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
    }
    clients.clear();
  });
}

export async function shutdownHermesAcpClients(): Promise<void> {
  const active = [...new Set(clients.values())];
  clients.clear();
  await Promise.all(active.map((client) => client.shutdown()));
}

export async function runHermesAcpTurn(input: {
  config: HermesExecutionServerConfig;
  cwd: string;
  prompt: string;
  sessionId?: string | null;
  timeoutMs: number;
  onDelta?: (text: string) => Promise<void> | void;
  onSpawn?: (child: ChildProcessWithoutNullStreams) => void;
  onTrace?: (event: HermesAcpTraceEvent) => void;
  registerInterrupt?: (interrupt: () => Promise<void>) => void;
}): Promise<HermesAcpTurnResult> {
  if (input.config.noTools !== true) {
    throw new HermesAcpError(
      "configuration",
      "The Hermes ACP executable is unavailable.",
    );
  }

  const client = clientFor(input.config);
  input.registerInterrupt?.(async () => {
    await client.cancelActiveTurn();
    await client.shutdown();
  });
  try {
    return await client.runTurn({
      cwd: input.cwd,
      prompt: input.prompt,
      sessionId: input.sessionId,
      promptTotalMs: input.timeoutMs,
      onDelta: input.onDelta,
      onSpawn: input.onSpawn,
      onTrace: input.onTrace,
    });
  } catch (error) {
    removeClient(client);
    await client.shutdown();
    throw error instanceof HermesAcpError
      ? error
      : new HermesAcpError(
        "transport",
        "The Hermes execution process disconnected.",
        undefined,
        false,
        error,
      );
  }
}
