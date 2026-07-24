export type RestartPhase =
  | "restart_requested"
  | "child_stopping"
  | "listener_unavailable"
  | "child_starting"
  | "health_ready"
  | "browser_reconnected"
  | "acceptance_resumed";

const RESTART_PHASES: RestartPhase[] = [
  "restart_requested",
  "child_stopping",
  "listener_unavailable",
  "child_starting",
  "health_ready",
  "browser_reconnected",
  "acceptance_resumed",
];

const TRANSIENT_TRANSPORT_FAILURE =
  /ERR_CONNECTION_(?:RESET|REFUSED)|ERR_INCOMPLETE_CHUNKED_ENCODING/;

export type RestartRequest = {
  method: string;
  path: string;
  startedPhase: RestartPhase | null;
};

export type RestartFailureClassification = {
  expected: boolean;
  reason:
    | "expected_read_only_listener_loss"
    | "outside_restart_window"
    | "request_started_after_health"
    | "non_transient_failure"
    | "consequential_request";
};

export type ExpectedRestartRequestFailure = RestartRequest & {
  failedPhase: RestartPhase;
  errorText: string;
};

type PhaseRecord = {
  phase: RestartPhase;
  at: number;
};

function isReadOnly(method: string): boolean {
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function beforeHealth(phase: RestartPhase | null): boolean {
  return phase !== null && RESTART_PHASES.indexOf(phase) < RESTART_PHASES.indexOf("health_ready");
}

export function classifyRestartRequestFailure(
  request: RestartRequest,
  failedPhase: RestartPhase | null,
  errorText: string,
): RestartFailureClassification {
  if (!beforeHealth(failedPhase)) {
    return { expected: false, reason: "outside_restart_window" };
  }
  // A null start phase means the read began before restart_requested. It is
  // still eligible because it crossed the recorded listener-loss boundary.
  if (request.startedPhase !== null && !beforeHealth(request.startedPhase)) {
    return { expected: false, reason: "request_started_after_health" };
  }
  if (!TRANSIENT_TRANSPORT_FAILURE.test(errorText)) {
    return { expected: false, reason: "non_transient_failure" };
  }
  if (!isReadOnly(request.method)) {
    return { expected: false, reason: "consequential_request" };
  }
  return { expected: true, reason: "expected_read_only_listener_loss" };
}

export class ControlledRestartTracker {
  private currentPhase: RestartPhase | null = null;
  private readonly phases: PhaseRecord[] = [];
  private expectedRequestFailures = 0;
  private readonly expectedRequestFailureDetails: ExpectedRestartRequestFailure[] = [];
  private expectedConsoleFailures = 0;
  private unhandledErrors = 0;

  constructor(private readonly now: () => number = Date.now) {}

  get phase(): RestartPhase | null {
    return this.currentPhase;
  }

  transition(phase: RestartPhase): void {
    const expectedIndex = this.phases.length;
    if (RESTART_PHASES[expectedIndex] !== phase) {
      throw new Error(
        `Invalid controlled-restart transition: expected ${RESTART_PHASES[expectedIndex] ?? "completion"}.`,
      );
    }
    this.currentPhase = phase;
    this.phases.push({ phase, at: this.now() });
  }

  request(method: string, path: string): RestartRequest {
    return { method, path, startedPhase: this.currentPhase };
  }

  requestFailed(request: RestartRequest, errorText: string): RestartFailureClassification {
    const classification = classifyRestartRequestFailure(
      request,
      this.currentPhase,
      errorText,
    );
    if (classification.expected && this.currentPhase) {
      this.expectedRequestFailures += 1;
      this.expectedRequestFailureDetails.push({
        ...request,
        failedPhase: this.currentPhase,
        errorText,
      });
    }
    return classification;
  }

  consoleTransportFailure(errorText: string): boolean {
    if (!beforeHealth(this.currentPhase) || !TRANSIENT_TRANSPORT_FAILURE.test(errorText)) {
      return false;
    }
    this.expectedConsoleFailures += 1;
    return true;
  }

  unhandledError(): void {
    this.unhandledErrors += 1;
  }

  complete(): {
    phases: RestartPhase[];
    listenerUnavailableMs: number;
    recoveryMs: number;
    expectedRequestFailures: number;
    expectedRequestFailureDetails: ExpectedRestartRequestFailure[];
    expectedConsoleFailures: number;
  } {
    if (this.phases.length !== RESTART_PHASES.length) {
      throw new Error("Controlled restart did not reach acceptance_resumed.");
    }
    if (this.unhandledErrors > 0) {
      throw new Error("Controlled restart produced an unhandled browser error.");
    }
    if (this.expectedConsoleFailures > this.expectedRequestFailures) {
      throw new Error("Controlled restart console reset was not correlated to a failed read-only request.");
    }
    const at = (phase: RestartPhase) =>
      this.phases.find((record) => record.phase === phase)?.at ?? 0;
    return {
      phases: this.phases.map((record) => record.phase),
      listenerUnavailableMs: at("child_starting") - at("listener_unavailable"),
      recoveryMs: at("health_ready") - at("restart_requested"),
      expectedRequestFailures: this.expectedRequestFailures,
      expectedRequestFailureDetails: this.expectedRequestFailureDetails,
      expectedConsoleFailures: this.expectedConsoleFailures,
    };
  }
}
