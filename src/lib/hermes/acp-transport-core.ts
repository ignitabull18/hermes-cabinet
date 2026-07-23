import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const MAX_FRAME_BYTES = 1_048_576;

export const HERMES_ACP_PROVIDER_CREDENTIAL = "OLLAMA_API_KEY" as const;

export const DEFAULT_HERMES_ACP_DEADLINES = Object.freeze({
  launchMs: 10_000,
  initializationMs: 120_000,
  sessionMs: 30_000,
  promptFirstEventMs: 120_000,
  shutdownMs: 2_000,
  idleMs: 15 * 60 * 1_000,
});

export type HermesAcpDeadlines = {
  [Key in keyof typeof DEFAULT_HERMES_ACP_DEADLINES]: number;
};

export type HermesAcpDeadlineStage =
  | "launch"
  | "initialization"
  | "session_create"
  | "session_load"
  | "prompt_first_event"
  | "prompt_total"
  | "shutdown";

export type HermesAcpTraceStage =
  | "child_spawn_started"
  | "child_spawn_completed"
  | "acp_initialize_started"
  | "acp_initialize_completed"
  | "session_create_started"
  | "session_create_completed"
  | "session_load_started"
  | "session_load_completed"
  | "prompt_dispatched"
  | "first_notification"
  | "first_assistant_chunk"
  | "final_result"
  | "child_exit"
  | "shutdown";

export type HermesAcpTraceEvent = {
  stage: HermesAcpTraceStage;
  elapsedMs: number;
  deadlineMs?: number;
};

export type HermesAcpTransportConfig = {
  cliPath: string;
  profile: string;
  providerCredentialEnvName: typeof HERMES_ACP_PROVIDER_CREDENTIAL;
  noTools: true;
  deadlines?: Partial<HermesAcpDeadlines>;
};

export type HermesAcpTurnResult = {
  output: string;
  sessionId: string;
  stopReason: string;
  toolEventCount: number;
  duplicateChunkCount: number;
};

export class HermesAcpError extends Error {
  constructor(
    readonly kind:
      | "configuration"
      | "protocol"
      | "session_expired"
      | "timeout"
      | "transport"
      | "tool_event",
    message: string,
    readonly stage?: HermesAcpDeadlineStage,
    readonly promptDispatched = false,
    readonly cause?: unknown,
    readonly sessionId?: string,
  ) {
    super(message);
    this.name = "HermesAcpError";
  }
}

type TurnState = {
  sessionId: string;
  output: string;
  seen: Set<string>;
  toolEventCount: number;
  duplicateChunkCount: number;
  fatal: HermesAcpError | null;
  firstNotificationSeen: boolean;
  firstAssistantChunkSeen: boolean;
  onDelta?: (text: string) => Promise<void> | void;
  firstEvent: Deferred<void>;
  failure: Deferred<never>;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function monotonicMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

function boundedError(
  kind: HermesAcpError["kind"],
  stage?: HermesAcpDeadlineStage,
): string {
  if (kind === "timeout") {
    const label = stage?.replaceAll("_", " ") ?? "operation";
    return `Hermes ACP ${label} timed out.`;
  }
  if (kind === "session_expired") return "The Hermes session is no longer available.";
  if (kind === "tool_event") return "Hermes emitted a forbidden tool event.";
  if (kind === "configuration") return "The Hermes ACP executable is unavailable.";
  if (kind === "protocol") return "Hermes returned an invalid protocol response.";
  return "The Hermes execution process disconnected.";
}

function strictEnvironment(config: HermesAcpTransportConfig): NodeJS.ProcessEnv {
  const credential = process.env[HERMES_ACP_PROVIDER_CREDENTIAL];
  const home = process.env.HOME;
  if (
    config.providerCredentialEnvName !== HERMES_ACP_PROVIDER_CREDENTIAL
    || !credential
    || !home
  ) {
    throw new HermesAcpError("configuration", boundedError("configuration"));
  }

  const env: NodeJS.ProcessEnv = {
    HOME: home,
    HERMES_ACP_NO_TOOLS: "1",
    HERMES_PROFILE: config.profile,
    NODE_ENV: "production",
    [HERMES_ACP_PROVIDER_CREDENTIAL]: credential,
  };
  for (const name of ["PATH", "TMPDIR", "LANG", "LC_ALL"] as const) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  return env;
}

function resolvedDeadlines(config: HermesAcpTransportConfig): HermesAcpDeadlines {
  return { ...DEFAULT_HERMES_ACP_DEADLINES, ...config.deadlines };
}

export async function validateHermesAcpExecutable(
  config: HermesAcpTransportConfig,
): Promise<void> {
  try {
    await fs.access(config.cliPath, fs.constants.X_OK);
  } catch {
    throw new HermesAcpError("configuration", boundedError("configuration"));
  }
}

export class HermesAcpTransportCore {
  private child: ChildProcessWithoutNullStreams | null = null;
  private connection: acp.ClientConnection | null = null;
  private context: acp.ClientContext | null = null;
  private activeTurn: TurnState | null = null;
  private fatalInvariant: HermesAcpError | null = null;
  private protocolParseErrors = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly loadedSessions = new Map<string, string>();
  private turnQueue: Promise<void> = Promise.resolve();
  private readonly deadlines;

  constructor(readonly config: HermesAcpTransportConfig) {
    this.deadlines = resolvedDeadlines(config);
  }

  get process(): ChildProcessWithoutNullStreams | null {
    return this.child;
  }

  get active(): boolean {
    return !!this.child && !!this.connection && !this.connection.signal.aborted;
  }

  matches(config: HermesAcpTransportConfig): boolean {
    return this.config.cliPath === config.cliPath
      && this.config.profile === config.profile
      && this.config.providerCredentialEnvName === config.providerCredentialEnvName
      && config.noTools === true;
  }

  async runTurn(input: {
    cwd: string;
    prompt: string;
    sessionId?: string | null;
    promptTotalMs: number;
    onDelta?: (text: string) => Promise<void> | void;
    onSpawn?: (child: ChildProcessWithoutNullStreams) => void;
    onTrace?: (event: HermesAcpTraceEvent) => void;
  }): Promise<HermesAcpTurnResult> {
    const previous = this.turnQueue;
    const gate = deferred<void>();
    this.turnQueue = previous.then(() => gate.promise);
    await previous;
    try {
      return await this.runTurnExclusive(input);
    } finally {
      gate.resolve();
    }
  }

  async cancelActiveTurn(): Promise<void> {
    const turn = this.activeTurn;
    if (!turn || !this.context) return;
    try {
      await this.context.notify(acp.methods.agent.session.cancel, {
        sessionId: turn.sessionId,
      });
    } catch {
      // The caller still receives the transport or timeout failure.
    }
  }

  async shutdown(onTrace?: (event: HermesAcpTraceEvent) => void): Promise<void> {
    this.clearIdleTimer();
    const startedAt = performance.now();
    onTrace?.({
      stage: "shutdown",
      elapsedMs: monotonicMs(startedAt),
      deadlineMs: this.deadlines.shutdownMs,
    });
    const connection = this.connection;
    const child = this.child;
    this.connection = null;
    this.context = null;
    this.child = null;
    this.activeTurn = null;
    this.fatalInvariant = null;
    this.loadedSessions.clear();
    connection?.close();
    if (child) await this.terminateChild(child);
  }

  private async runTurnExclusive(input: {
    cwd: string;
    prompt: string;
    sessionId?: string | null;
    promptTotalMs: number;
    onDelta?: (text: string) => Promise<void> | void;
    onSpawn?: (child: ChildProcessWithoutNullStreams) => void;
    onTrace?: (event: HermesAcpTraceEvent) => void;
  }): Promise<HermesAcpTurnResult> {
    if (this.config.noTools !== true) {
      throw new HermesAcpError("configuration", boundedError("configuration"));
    }
    const startedAt = performance.now();
    const trace = (stage: HermesAcpTraceStage, deadlineMs?: number) => {
      input.onTrace?.({ stage, elapsedMs: monotonicMs(startedAt), deadlineMs });
    };

    try {
      await this.start(input.cwd, input.onSpawn, trace);
      const sessionId = await this.prepareSession(input.cwd, input.sessionId, trace);
      return await this.prompt({
        sessionId,
        prompt: input.prompt,
        promptTotalMs: input.promptTotalMs,
        onDelta: input.onDelta,
        trace,
      });
    } catch (error) {
      trace("shutdown", this.deadlines.shutdownMs);
      await this.shutdown();
      throw this.normalizeError(error);
    }
  }

  private async start(
    launchCwd: string,
    onSpawn: ((child: ChildProcessWithoutNullStreams) => void) | undefined,
    trace: (stage: HermesAcpTraceStage, deadlineMs?: number) => void,
  ): Promise<void> {
    this.clearIdleTimer();
    if (this.active && this.child) {
      onSpawn?.(this.child);
      return;
    }

    await validateHermesAcpExecutable(this.config);
    this.fatalInvariant = null;
    trace("child_spawn_started", this.deadlines.launchMs);
    const child = spawn(this.config.cliPath, [], {
      cwd: launchCwd,
      env: strictEnvironment(this.config),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    onSpawn?.(child);
    child.stderr.resume();

    await this.withDeadline(
      new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", () => reject(
          new HermesAcpError("configuration", boundedError("configuration")),
        ));
      }),
      "launch",
      this.deadlines.launchMs,
      false,
    );
    trace("child_spawn_completed");

    const failClosed = (): never => {
      const error = new HermesAcpError(
        "tool_event",
        boundedError("tool_event"),
        undefined,
        !!this.activeTurn,
      );
      this.fatalInvariant = error;
      if (this.activeTurn) {
        this.activeTurn.toolEventCount += 1;
        this.activeTurn.fatal = error;
        this.activeTurn.firstEvent.resolve();
        this.activeTurn.failure.reject(error);
      }
      throw error;
    };

    const app = acp
      .client({ name: "cabinet" })
      .onRequest(acp.methods.client.session.requestPermission, () => {
        if (this.activeTurn) {
          this.activeTurn.toolEventCount += 1;
          this.activeTurn.fatal = new HermesAcpError(
            "tool_event",
            boundedError("tool_event"),
            undefined,
            true,
          );
          this.activeTurn.firstEvent.resolve();
          this.activeTurn.failure.reject(this.activeTurn.fatal);
        }
        this.fatalInvariant = new HermesAcpError(
          "tool_event",
          boundedError("tool_event"),
          undefined,
          !!this.activeTurn,
        );
        return { outcome: { outcome: "cancelled" as const } };
      })
      .onRequest(acp.methods.client.fs.readTextFile, failClosed)
      .onRequest(acp.methods.client.fs.writeTextFile, failClosed)
      .onRequest(acp.methods.client.terminal.create, failClosed)
      .onRequest(acp.methods.client.terminal.output, failClosed)
      .onRequest(acp.methods.client.terminal.release, failClosed)
      .onRequest(acp.methods.client.terminal.waitForExit, failClosed)
      .onRequest(acp.methods.client.terminal.kill, failClosed)
      .onRequest(acp.methods.client.elicitation.create, failClosed)
      .onNotification(acp.methods.client.session.update, async ({ params }) => {
        const turn = this.activeTurn;
        if (!turn || params.sessionId !== turn.sessionId) return;
        turn.firstEvent.resolve();
        if (!turn.firstNotificationSeen) {
          turn.firstNotificationSeen = true;
          trace("first_notification");
        }
        const update = params.update;
        if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
          turn.toolEventCount += 1;
          turn.fatal = new HermesAcpError(
            "tool_event",
            boundedError("tool_event"),
            undefined,
            true,
          );
          turn.failure.reject(turn.fatal);
          return;
        }
        if (update.sessionUpdate !== "agent_message_chunk" || update.content.type !== "text") return;
        const signature = JSON.stringify(update);
        if (turn.seen.has(signature)) {
          turn.duplicateChunkCount += 1;
          return;
        }
        turn.seen.add(signature);
        turn.output += update.content.text;
        if (!turn.firstAssistantChunkSeen) {
          turn.firstAssistantChunkSeen = true;
          trace("first_assistant_chunk");
        }
        await turn.onDelta?.(update.content.text);
      });

    const output = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
    const input = (Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>)
      .pipeThrough(this.protocolFrameGuard());
    const connection = app.connect(acp.ndJsonStream(output, input));
    this.connection = connection;
    this.context = connection.agent;
    connection.closed
      .finally(() => {
        if (this.connection === connection) {
          this.connection = null;
          this.context = null;
          this.loadedSessions.clear();
          void this.terminateChild(child);
        }
      })
      .catch(() => undefined);
    child.once("exit", () => {
      trace("child_exit");
      if (this.child === child) {
        this.connection = null;
        this.context = null;
        this.child = null;
        this.loadedSessions.clear();
      }
    });

    trace("acp_initialize_started", this.deadlines.initializationMs);
    const initialized = await this.withDeadline(
      connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: {
          name: "cabinet",
          title: "Cabinet",
          version: "0.5.3",
        },
      }),
      "initialization",
      this.deadlines.initializationMs,
      false,
    );
    if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
      throw new HermesAcpError("protocol", boundedError("protocol"));
    }
    this.assertNoFatalInvariant();
    trace("acp_initialize_completed");
  }

  private async prepareSession(
    cwd: string,
    requestedSessionId: string | null | undefined,
    trace: (stage: HermesAcpTraceStage, deadlineMs?: number) => void,
  ): Promise<string> {
    if (!this.context) {
      throw new HermesAcpError("transport", boundedError("transport"));
    }

    const sessionId = requestedSessionId?.trim();
    if (sessionId) {
      const knownCwd = this.loadedSessions.get(sessionId);
      if (knownCwd && knownCwd !== cwd) {
        throw new HermesAcpError("protocol", boundedError("protocol"));
      }
      if (!knownCwd) {
        trace("session_load_started", this.deadlines.sessionMs);
        try {
          await this.withDeadline(
            this.context.request(acp.methods.agent.session.load, {
              cwd,
              mcpServers: [],
              sessionId,
            }),
            "session_load",
            this.deadlines.sessionMs,
            false,
          );
          this.assertNoFatalInvariant();
        } catch (error) {
          if (
            error instanceof HermesAcpError
            && (error.kind === "timeout"
              || error.kind === "tool_event"
              || error.kind === "configuration")
          ) {
            throw error;
          }
          throw new HermesAcpError(
            "session_expired",
            boundedError("session_expired"),
            undefined,
            false,
            error,
          );
        }
        this.loadedSessions.set(sessionId, cwd);
        trace("session_load_completed");
      }
      return sessionId;
    }

    trace("session_create_started", this.deadlines.sessionMs);
    const created = await this.withDeadline(
      this.context.request(acp.methods.agent.session.new, {
        cwd,
        mcpServers: [],
      }),
      "session_create",
      this.deadlines.sessionMs,
      false,
    );
    this.assertNoFatalInvariant();
    if (!created.sessionId) {
      throw new HermesAcpError("protocol", boundedError("protocol"));
    }
    this.loadedSessions.set(created.sessionId, cwd);
    trace("session_create_completed");
    return created.sessionId;
  }

  private async prompt(input: {
    sessionId: string;
    prompt: string;
    promptTotalMs: number;
    onDelta?: (text: string) => Promise<void> | void;
    trace: (stage: HermesAcpTraceStage, deadlineMs?: number) => void;
  }): Promise<HermesAcpTurnResult> {
    if (!this.context || this.activeTurn) {
      throw new HermesAcpError("transport", boundedError("transport"));
    }
    const state: TurnState = {
      sessionId: input.sessionId,
      output: "",
      seen: new Set(),
      toolEventCount: 0,
      duplicateChunkCount: 0,
      fatal: null,
      firstNotificationSeen: false,
      firstAssistantChunkSeen: false,
      onDelta: input.onDelta,
      firstEvent: deferred<void>(),
      failure: deferred<never>(),
    };
    this.activeTurn = state;
    input.trace("prompt_dispatched", input.promptTotalMs);

    const responsePromise = this.withDeadline(
      Promise.race([
        this.context.request(acp.methods.agent.session.prompt, {
          sessionId: input.sessionId,
          prompt: [{ type: "text", text: input.prompt }],
        }),
        state.failure.promise,
      ]),
      "prompt_total",
      input.promptTotalMs,
      true,
      () => this.cancelActiveTurn(),
    );

    try {
      await this.withDeadline(
        Promise.race([
          state.firstEvent.promise,
          responsePromise.then(() => undefined),
        ]),
        "prompt_first_event",
        Math.min(this.deadlines.promptFirstEventMs, input.promptTotalMs),
        true,
        () => this.cancelActiveTurn(),
      );
      const response = await responsePromise;
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      if (state.fatal) throw state.fatal;
      if (!state.output.trim()) {
        throw new HermesAcpError(
          "protocol",
          "Hermes completed without an assistant response.",
          undefined,
          true,
        );
      }
      input.trace("final_result");
      return {
        output: state.output,
        sessionId: input.sessionId,
        stopReason: response.stopReason,
        toolEventCount: state.toolEventCount,
        duplicateChunkCount: state.duplicateChunkCount,
      };
    } catch (error) {
      void responsePromise.catch(() => undefined);
      const normalized = this.normalizeError(error);
      throw new HermesAcpError(
        normalized.kind,
        normalized.message,
        normalized.stage,
        true,
        normalized.cause,
        input.sessionId,
      );
    } finally {
      this.activeTurn = null;
      this.scheduleIdleStop();
    }
  }

  private async withDeadline<T>(
    operation: Promise<T>,
    stage: HermesAcpDeadlineStage,
    timeoutMs: number,
    promptDispatched: boolean,
    onTimeout?: () => Promise<void>,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void onTimeout?.();
        reject(new HermesAcpError(
          "timeout",
          boundedError("timeout", stage),
          stage,
          promptDispatched,
        ));
      }, timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([operation, deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private normalizeError(error: unknown): HermesAcpError {
    if (error instanceof HermesAcpError) return error;
    if (this.protocolParseErrors > 0) {
      return new HermesAcpError("protocol", boundedError("protocol"), undefined, false, error);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/session.*(not found|unknown|expired|available)/i.test(message)) {
      return new HermesAcpError(
        "session_expired",
        boundedError("session_expired"),
        undefined,
        false,
        error,
      );
    }
    if (/json|parse|invalid|schema|protocol/i.test(message)) {
      this.protocolParseErrors += 1;
      return new HermesAcpError("protocol", boundedError("protocol"), undefined, false, error);
    }
    return new HermesAcpError("transport", boundedError("transport"), undefined, false, error);
  }

  private assertNoFatalInvariant(): void {
    if (this.fatalInvariant) throw this.fatalInvariant;
  }

  private async terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.stdin.end();
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        resolve();
      }, this.deadlines.shutdownMs)),
    ]);
  }

  private scheduleIdleStop(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      void this.shutdown();
    }, this.deadlines.idleMs);
    this.idleTimer.unref();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private protocolFrameGuard(): TransformStream<Uint8Array, Uint8Array> {
    const decoder = new TextDecoder();
    let buffer = "";
    return new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        buffer += decoder.decode(chunk, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) {
            try {
              if (Buffer.byteLength(line, "utf8") > MAX_FRAME_BYTES) {
                throw new Error("frame exceeds bound");
              }
              const value: unknown = JSON.parse(line);
              if (!value || typeof value !== "object" || Array.isArray(value)) {
                throw new Error("frame is not an object");
              }
            } catch {
              this.protocolParseErrors += 1;
              controller.error(new HermesAcpError("protocol", boundedError("protocol")));
              return;
            }
          }
          newline = buffer.indexOf("\n");
        }
        if (Buffer.byteLength(buffer, "utf8") > MAX_FRAME_BYTES) {
          this.protocolParseErrors += 1;
          controller.error(new HermesAcpError("protocol", boundedError("protocol")));
          return;
        }
        controller.enqueue(chunk);
      },
      flush: (controller) => {
        buffer += decoder.decode();
        if (buffer.trim()) {
          this.protocolParseErrors += 1;
          controller.error(new HermesAcpError("protocol", boundedError("protocol")));
        }
      },
    });
  }
}
