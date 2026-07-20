import { createHash } from "node:crypto";
import { sanitizeHermesText } from "./control-center-sanitizer";
import {
  HermesManagementClient,
  HermesManagementRequestError,
  type HermesKanbanRunState,
} from "./management-client";
import type { HermesServerConfig } from "./server-config";

export const HERMES_RUNTIME_INTERVENTION_ACTION = "terminate_kanban_run" as const;
const PREVIEW_TTL_MS = 120_000;

export type HermesRuntimeInterventionPreview = {
  previewId: string;
  idempotencyIdentity: string;
  action: typeof HERMES_RUNTIME_INTERVENTION_ACTION;
  targetRunId: string;
  targetTaskId: string;
  currentState: string;
  reason: string;
  expectedConsequence: string;
  reversible: false;
  evidenceObservedAt: string;
  expiresAt: string;
};

export type HermesRuntimeInterventionResult = {
  idempotencyIdentity: string;
  targetRunId: string;
  status: "verified_success" | "blocked" | "failed" | "unknown";
  summary: string;
  verifiedAt: string;
};

export type HermesRuntimeInterventionClient = Pick<HermesManagementClient, "readKanbanRun" | "terminateKanbanRun">;

type StoredPreview = {
  public: HermesRuntimeInterventionPreview;
  stateFingerprint: string;
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stateFingerprint(run: HermesKanbanRunState): string {
  return hash(JSON.stringify({
    action: HERMES_RUNTIME_INTERVENTION_ACTION,
    runId: run.runId,
    taskId: run.taskId,
    status: run.status,
    startedAt: run.startedAt,
    claimIdentity: run.claimIdentity,
  }));
}

function boundedReason(value: string): string {
  const normalized = sanitizeHermesText(value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim(), 240);
  if (normalized.length < 8) throw new HermesRuntimeInterventionError("invalid_request", "A specific reason of at least 8 characters is required.");
  return normalized;
}

function isActive(run: HermesKanbanRunState): boolean {
  return run.status.toLowerCase() === "running" && run.endedAt === null && Boolean(run.claimIdentity);
}

function boundedFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "Hermes could not complete the intervention.";
  return sanitizeHermesText(message, 200);
}

export class HermesRuntimeInterventionError extends Error {
  constructor(
    readonly code: "invalid_request" | "fixture_forbidden" | "stale_target" | "target_mismatch" | "preview_expired" | "not_confirmed",
    message: string
  ) {
    super(message);
    this.name = "HermesRuntimeInterventionError";
  }
}

export class HermesRuntimeInterventionService {
  private readonly previews = new Map<string, StoredPreview>();
  private readonly commits = new Map<string, Promise<HermesRuntimeInterventionResult>>();

  constructor(
    private readonly client: HermesRuntimeInterventionClient,
    private readonly now: () => Date = () => new Date()
  ) {}

  async prepare(input: { targetRunId: string; reason: string; provenanceKind: "live_runtime" | "acceptance_fixture" }): Promise<HermesRuntimeInterventionPreview> {
    if (input.provenanceKind !== "live_runtime") {
      throw new HermesRuntimeInterventionError("fixture_forbidden", "Acceptance fixtures cannot prepare or execute Hermes mutations.");
    }
    const targetRunId = input.targetRunId.trim();
    if (!/^\d+$/.test(targetRunId)) throw new HermesRuntimeInterventionError("invalid_request", "A numeric Hermes run identity is required.");
    const reason = boundedReason(input.reason);
    const run = await this.client.readKanbanRun(targetRunId);
    if (!isActive(run)) throw new HermesRuntimeInterventionError("stale_target", "Hermes no longer reports this run as actively claimed.");
    const evidenceObservedAt = this.now().toISOString();
    const fingerprint = stateFingerprint(run);
    const idempotencyIdentity = `hermes-terminate-${hash(JSON.stringify({ fingerprint, reason })).slice(0, 32)}`;
    const preview: HermesRuntimeInterventionPreview = {
      previewId: idempotencyIdentity,
      idempotencyIdentity,
      action: HERMES_RUNTIME_INTERVENTION_ACTION,
      targetRunId: run.runId,
      targetTaskId: run.taskId,
      currentState: run.status,
      reason,
      expectedConsequence: "Hermes will stop this worker, mark the run reclaimed, clear its claim, and return its task to ready.",
      reversible: false,
      evidenceObservedAt,
      expiresAt: new Date(this.now().getTime() + PREVIEW_TTL_MS).toISOString(),
    };
    this.previews.set(preview.previewId, { public: preview, stateFingerprint: fingerprint });
    return preview;
  }

  async commit(input: { previewId: string; targetRunId: string; confirmed: boolean }): Promise<HermesRuntimeInterventionResult> {
    if (!input.confirmed) throw new HermesRuntimeInterventionError("not_confirmed", "Explicit confirmation is required immediately before execution.");
    const stored = this.previews.get(input.previewId);
    if (!stored) throw new HermesRuntimeInterventionError("preview_expired", "The prepared intervention is unavailable. Prepare a new preview.");
    if (stored.public.targetRunId !== input.targetRunId) throw new HermesRuntimeInterventionError("target_mismatch", "The confirmed target does not match the prepared run.");
    if (Date.parse(stored.public.expiresAt) < this.now().getTime()) throw new HermesRuntimeInterventionError("preview_expired", "The prepared state is stale. Prepare a new preview.");
    const existing = this.commits.get(stored.public.idempotencyIdentity);
    if (existing) return existing;
    const operation = this.execute(stored);
    this.commits.set(stored.public.idempotencyIdentity, operation);
    return operation;
  }

  private async execute(stored: StoredPreview): Promise<HermesRuntimeInterventionResult> {
    const verifiedAt = () => this.now().toISOString();
    try {
      const current = await this.client.readKanbanRun(stored.public.targetRunId);
      if (!isActive(current) || stateFingerprint(current) !== stored.stateFingerprint) {
        return { idempotencyIdentity: stored.public.idempotencyIdentity, targetRunId: stored.public.targetRunId, status: "blocked", summary: "Hermes state changed after preview. Nothing was executed.", verifiedAt: verifiedAt() };
      }
      await this.client.terminateKanbanRun(stored.public.targetRunId, stored.public.reason);
      const result = await this.client.readKanbanRun(stored.public.targetRunId);
      const verified = result.endedAt !== null && (result.status.toLowerCase() === "reclaimed" || result.outcome?.toLowerCase() === "reclaimed");
      return verified
        ? { idempotencyIdentity: stored.public.idempotencyIdentity, targetRunId: stored.public.targetRunId, status: "verified_success", summary: "Hermes verified that the run was reclaimed and its task returned to ready.", verifiedAt: verifiedAt() }
        : { idempotencyIdentity: stored.public.idempotencyIdentity, targetRunId: stored.public.targetRunId, status: "unknown", summary: "Hermes accepted the request, but the expected terminal state was not verified. No retry was attempted.", verifiedAt: verifiedAt() };
    } catch (error) {
      const timedOut = error instanceof HermesManagementRequestError && error.status === 504;
      const conflict = error instanceof HermesManagementRequestError && error.status === 409;
      return {
        idempotencyIdentity: stored.public.idempotencyIdentity,
        targetRunId: stored.public.targetRunId,
        status: timedOut ? "unknown" : conflict ? "blocked" : "failed",
        summary: timedOut ? "Hermes timed out. Success is not assumed and no retry was attempted." : conflict ? "Hermes rejected the stale or conflicting run state. Nothing was retried." : boundedFailure(error),
        verifiedAt: verifiedAt(),
      };
    }
  }
}

const serviceKey = Symbol.for("cabinet.hermes.runtime-intervention-service");
type ServiceGlobal = typeof globalThis & { [serviceKey]?: { configIdentity: string; service: HermesRuntimeInterventionService } };

export function getHermesRuntimeInterventionService(config: HermesServerConfig): HermesRuntimeInterventionService {
  const target = globalThis as ServiceGlobal;
  const configIdentity = hash(`${config.managementBaseUrl}|${config.profile}|${config.timeoutMs}`);
  if (!target[serviceKey] || target[serviceKey]?.configIdentity !== configIdentity) {
    target[serviceKey] = { configIdentity, service: new HermesRuntimeInterventionService(new HermesManagementClient(config)) };
  }
  return target[serviceKey]!.service;
}
