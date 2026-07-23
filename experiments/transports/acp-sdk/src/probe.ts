import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { performance } from "node:perf_hooks";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as acp from "@agentclientprotocol/sdk";

const execFileAsync = promisify(execFile);
const MAX_FRAME_BYTES = 1_048_576;

export const ACCEPTANCE_PROMPT =
  "This is a local Cabinet transport acceptance test. Do not use tools or contact external systems. Reply with exactly CABINET_TRANSPORT_OK.";
export const ACCEPTANCE_FOLLOW_UP =
  "Reply with the exact transport token from your previous response.";

type TurnState = {
  sessionId: string;
  output: string;
  seen: Set<string>;
  duplicateEventCount: number;
  toolEventCount: number;
  firstTokenAt: number | null;
  fatal: Error | null;
};

export type ProbeMetrics = {
  startupLatencyMs: number;
  firstTokenLatencyMs: number | null;
  totalLatencyMs: number;
  streamEventCount: number;
  duplicateEventCount: number;
  protocolParseErrors: number;
  toolEventCount: number;
  cancellationCount: number;
  childRssBytes: number | null;
};

export type ProbeTurnResult = {
  output: string;
  sessionId: string;
  stopReason: string;
  processId: number;
  metrics: ProbeMetrics;
};

export type ProbeOptions = {
  command: string;
  args?: string[];
  cwd: string;
  timeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
};

export class AcpProbeError extends Error {
  constructor(
    readonly kind: "configuration" | "protocol" | "timeout" | "transport" | "tool_event",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AcpProbeError";
  }
}

function safeEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const allowed = ["HOME", "LOGNAME", "PATH", "SHELL", "TMPDIR", "USER", "LANG", "LC_ALL"];
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    HERMES_ACP_NO_TOOLS: "1",
  };
  for (const name of allowed) {
    if (process.env[name]) env[name] = process.env[name];
  }
  for (const [name, value] of Object.entries(extra)) {
    if (value !== undefined) env[name] = value;
  }
  env.HERMES_ACP_NO_TOOLS = "1";
  return env;
}

async function readRssBytes(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("/bin/ps", ["-o", "rss=", "-p", String(pid)]);
    const kib = Number.parseInt(stdout.trim(), 10);
    return Number.isFinite(kib) ? kib * 1024 : null;
  } catch {
    return null;
  }
}

export class PersistentAcpSdkProbe {
  private child: ChildProcessWithoutNullStreams | null = null;
  private connection: acp.ClientConnection | null = null;
  private context: acp.ClientContext | null = null;
  private activeTurn: TurnState | null = null;
  private startupLatencyMs = 0;
  private protocolParseErrors = 0;
  private cancellationCount = 0;
  private streamEventCount = 0;
  private initializedCapabilities: acp.AgentCapabilities | undefined;

  constructor(private readonly options: ProbeOptions) {}

  get processId(): number | null {
    return this.child?.pid ?? null;
  }

  get agentCapabilities(): acp.AgentCapabilities | undefined {
    return this.initializedCapabilities;
  }

  get diagnostics() {
    return {
      protocolParseErrors: this.protocolParseErrors,
      cancellationCount: this.cancellationCount,
      streamEventCount: this.streamEventCount,
    };
  }

  async start(): Promise<void> {
    if (this.child && this.connection && !this.connection.signal.aborted) return;
    const startedAt = performance.now();
    const child = spawn(this.options.command, this.options.args ?? [], {
      cwd: this.options.cwd,
      env: safeEnvironment(this.options.environment),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stderr.resume();
    const spawned = new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", (error) => reject(
        new AcpProbeError("configuration", "ACP process could not be started.", error),
      ));
    });
    await spawned;

    const forbiddenClientMethod = (message: string) => {
      const turn = this.activeTurn;
      if (turn) {
        turn.toolEventCount += 1;
        turn.fatal = new AcpProbeError("tool_event", message);
      }
      throw new AcpProbeError("tool_event", message);
    };
    const app = acp
      .client({ name: "hermes-cabinet-acp-sdk-probe" })
      .onRequest(acp.methods.client.session.requestPermission, () => {
        const turn = this.activeTurn;
        if (turn) {
          turn.toolEventCount += 1;
          turn.fatal = new AcpProbeError("tool_event", "ACP agent requested forbidden permission.");
        }
        return { outcome: { outcome: "cancelled" as const } };
      })
      .onRequest(acp.methods.client.fs.readTextFile, () => {
        return forbiddenClientMethod("ACP agent requested forbidden file access.");
      })
      .onRequest(acp.methods.client.fs.writeTextFile, () => {
        return forbiddenClientMethod("ACP agent requested forbidden file access.");
      })
      .onRequest(acp.methods.client.terminal.create, () => {
        return forbiddenClientMethod("ACP agent requested a forbidden terminal.");
      })
      .onRequest(acp.methods.client.terminal.output, () => {
        return forbiddenClientMethod("ACP agent requested forbidden terminal output.");
      })
      .onRequest(acp.methods.client.terminal.release, () => {
        return forbiddenClientMethod("ACP agent requested forbidden terminal release.");
      })
      .onRequest(acp.methods.client.terminal.waitForExit, () => {
        return forbiddenClientMethod("ACP agent requested a forbidden terminal wait.");
      })
      .onRequest(acp.methods.client.terminal.kill, () => {
        return forbiddenClientMethod("ACP agent requested forbidden terminal termination.");
      })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        const turn = this.activeTurn;
        if (!turn || params.sessionId !== turn.sessionId) return;
        this.streamEventCount += 1;
        const update = params.update;
        if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
          turn.toolEventCount += 1;
          turn.fatal = new AcpProbeError("tool_event", "ACP agent emitted a forbidden tool event.");
          return;
        }
        if (update.sessionUpdate !== "agent_message_chunk" || update.content.type !== "text") return;
        const signature = JSON.stringify(update);
        if (turn.seen.has(signature)) {
          turn.duplicateEventCount += 1;
          return;
        }
        turn.seen.add(signature);
        if (turn.firstTokenAt === null) turn.firstTokenAt = performance.now();
        turn.output += update.content.text;
      });

    const input = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
    const output = (Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>)
      .pipeThrough(this.protocolFrameGuard());
    const connection = app.connect(acp.ndJsonStream(input, output));
    this.connection = connection;
    this.context = connection.agent;
    connection.closed.then(() => {
      if (this.connection === connection) {
        this.connection = null;
        this.context = null;
      }
    }).catch(() => undefined);

    try {
      const initialized = await this.withTimeout(
        connection.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: {
            name: "hermes-cabinet-acp-sdk-probe",
            title: "Hermes Cabinet ACP SDK Probe",
            version: "0.0.0",
          },
        }),
        this.options.timeoutMs ?? 10_000,
        "ACP initialization timed out.",
      );
      if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
        throw new AcpProbeError(
          "protocol",
          `Unsupported ACP protocol version ${initialized.protocolVersion}.`,
        );
      }
      this.initializedCapabilities = initialized.agentCapabilities;
      this.startupLatencyMs = performance.now() - startedAt;
    } catch (error) {
      await this.stop();
      throw this.normalizeError(error);
    }
  }

  async newSession(): Promise<string> {
    await this.start();
    const response = await this.request(acp.methods.agent.session.new, {
      cwd: this.options.cwd,
      mcpServers: [],
    });
    return response.sessionId;
  }

  async loadSession(sessionId: string): Promise<void> {
    await this.start();
    await this.request(acp.methods.agent.session.load, {
      cwd: this.options.cwd,
      mcpServers: [],
      sessionId,
    });
  }

  async prompt(sessionId: string, prompt: string, timeoutMs = this.options.timeoutMs ?? 30_000): Promise<ProbeTurnResult> {
    await this.start();
    if (this.activeTurn) throw new AcpProbeError("configuration", "Only one active session turn is supported.");
    const startedAt = performance.now();
    const streamEventStart = this.streamEventCount;
    const state: TurnState = {
      sessionId,
      output: "",
      seen: new Set(),
      duplicateEventCount: 0,
      toolEventCount: 0,
      firstTokenAt: null,
      fatal: null,
    };
    this.activeTurn = state;
    try {
      const response = await this.withTimeout(
        this.request(acp.methods.agent.session.prompt, {
          sessionId,
          prompt: [{ type: "text", text: prompt }],
        }),
        timeoutMs,
        "ACP prompt timed out.",
        async () => {
          this.cancellationCount += 1;
          await this.context?.notify(acp.methods.agent.session.cancel, { sessionId });
        },
      );
      // The SDK resolves the prompt response independently from notification
      // handler completion. Give already-read session/update callbacks one
      // bounded event-loop window to drain before evaluating the turn.
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      if (state.fatal) throw state.fatal;
      if (!state.output.trim()) {
        throw new AcpProbeError("protocol", "ACP turn completed without assistant text.");
      }
      const endedAt = performance.now();
      const pid = this.processId;
      if (!pid) throw new AcpProbeError("transport", "ACP process exited before metrics were recorded.");
      return {
        output: state.output,
        sessionId,
        stopReason: response.stopReason,
        processId: pid,
        metrics: {
          startupLatencyMs: this.startupLatencyMs,
          firstTokenLatencyMs: state.firstTokenAt === null ? null : state.firstTokenAt - startedAt,
          totalLatencyMs: endedAt - startedAt,
          streamEventCount: this.streamEventCount - streamEventStart,
          duplicateEventCount: state.duplicateEventCount,
          protocolParseErrors: this.protocolParseErrors,
          toolEventCount: state.toolEventCount,
          cancellationCount: this.cancellationCount,
          childRssBytes: await readRssBytes(pid),
        },
      };
    } catch (error) {
      throw this.normalizeError(error);
    } finally {
      this.activeTurn = null;
    }
  }

  async restartAndLoad(sessionId: string): Promise<void> {
    await this.stop();
    await this.start();
    await this.loadSession(sessionId);
  }

  async killForTest(): Promise<void> {
    const child = this.child;
    if (!child) return;
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }

  async stop(): Promise<void> {
    const connection = this.connection;
    const child = this.child;
    this.connection = null;
    this.context = null;
    this.child = null;
    connection?.close();
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        resolve();
      }, 1_000)),
    ]);
  }

  private async request<Method extends acp.AgentRequestMethod>(
    method: Method,
    params: acp.AgentRequestParamsByMethod[Method],
  ): Promise<acp.AgentRequestResponsesByMethod[Method]> {
    const context = this.context;
    if (!context) throw new AcpProbeError("transport", "ACP connection is not active.");
    try {
      return await context.request(method, params);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    message: string,
    onTimeout?: () => Promise<void>,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void onTimeout?.().finally(() => reject(new AcpProbeError("timeout", message)));
        if (!onTimeout) reject(new AcpProbeError("timeout", message));
      }, timeoutMs);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private normalizeError(error: unknown): AcpProbeError {
    if (error instanceof AcpProbeError) return error;
    if (this.protocolParseErrors > 0) {
      return new AcpProbeError("protocol", "ACP SDK rejected an invalid protocol frame.", error);
    }
    const text = error instanceof Error ? error.message : String(error);
    if (/json|parse|invalid|schema|protocol/i.test(text)) {
      this.protocolParseErrors += 1;
      return new AcpProbeError("protocol", "ACP SDK rejected an invalid protocol frame.", error);
    }
    return new AcpProbeError("transport", "ACP process disconnected.", error);
  }

  private protocolFrameGuard(): TransformStream<Uint8Array, Uint8Array> {
    const decoder = new TextDecoder();
    let buffer = "";
    return new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        buffer += decoder.decode(chunk, { stream: true });
        if (Buffer.byteLength(buffer, "utf8") > MAX_FRAME_BYTES) {
          this.protocolParseErrors += 1;
          controller.error(new AcpProbeError("protocol", "ACP frame exceeded the bounded size."));
          return;
        }
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) {
            try {
              const value: unknown = JSON.parse(line);
              if (!value || typeof value !== "object" || Array.isArray(value)) {
                throw new Error("frame is not an object");
              }
            } catch (error) {
              this.protocolParseErrors += 1;
              controller.error(
                new AcpProbeError("protocol", "ACP SDK rejected an invalid protocol frame.", error),
              );
              return;
            }
          }
          newline = buffer.indexOf("\n");
        }
        controller.enqueue(chunk);
      },
      flush: (controller) => {
        buffer += decoder.decode();
        if (buffer.trim()) {
          this.protocolParseErrors += 1;
          controller.error(new AcpProbeError("protocol", "ACP process ended with an incomplete frame."));
        }
      },
    });
  }
}
