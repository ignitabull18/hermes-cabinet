import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildHermesRuntimeInterventionFixtureProjection } from "./control-center-intervention-fixture";
import { hermesProjectionMatrixRows } from "./control-center-projection";
import {
  HermesRuntimeInterventionError,
  HermesRuntimeInterventionService,
  type HermesRuntimeInterventionClient,
} from "./governed-runtime-intervention";
import { HermesManagementRequestError, type HermesKanbanRunState } from "./management-client";

const NOW = new Date("2026-07-20T03:30:00.000Z");
const active = (overrides: Partial<HermesKanbanRunState> = {}): HermesKanbanRunState => ({
  runId: "17", taskId: "23", status: "running", startedAt: "2026-07-20T03:20:00.000Z",
  endedAt: null, outcome: null, claimIdentity: "private-claim-value", ...overrides,
});
const reclaimed = (): HermesKanbanRunState => active({ status: "reclaimed", endedAt: "2026-07-20T03:30:01.000Z", outcome: "reclaimed", claimIdentity: null });

class FakeClient implements HermesRuntimeInterventionClient {
  reads = 0;
  mutations = 0;
  reasons: string[] = [];
  states: HermesKanbanRunState[] = [active(), active(), reclaimed()];
  mutationError: Error | null = null;
  async readKanbanRun() { return this.states[Math.min(this.reads++, this.states.length - 1)]!; }
  async terminateKanbanRun(_runId: string, reason: string) {
    this.mutations += 1;
    this.reasons.push(reason);
    if (this.mutationError) throw this.mutationError;
    return { runId: "17", taskId: "23" };
  }
}

function setup() {
  const client = new FakeClient();
  return { client, service: new HermesRuntimeInterventionService(client, () => new Date(NOW)) };
}

test("preview is read-only, bounded, stable, and exposes no claim identity", async () => {
  const subject = setup();
  const first = await subject.service.prepare({ targetRunId: "17", reason: "Stop the duplicate worker safely", provenanceKind: "live_runtime" });
  const second = await subject.service.prepare({ targetRunId: "17", reason: "Stop the duplicate worker safely", provenanceKind: "live_runtime" });
  assert.equal(subject.client.mutations, 0);
  assert.equal(first.idempotencyIdentity, second.idempotencyIdentity);
  assert.equal(first.reversible, false);
  assert.equal(JSON.stringify(first).includes("private-claim-value"), false);
});

test("fixture provenance cannot prepare or execute a mutation", async () => {
  const subject = setup();
  await assert.rejects(
    subject.service.prepare({ targetRunId: "17", reason: "Fixture must remain read only", provenanceKind: "acceptance_fixture" }),
    (error: unknown) => error instanceof HermesRuntimeInterventionError && error.code === "fixture_forbidden"
  );
  assert.equal(subject.client.reads, 0);
  assert.equal(subject.client.mutations, 0);
});

test("commit requires explicit confirmation and exact target identity", async () => {
  const subject = setup();
  const preview = await subject.service.prepare({ targetRunId: "17", reason: "Stop the duplicate worker safely", provenanceKind: "live_runtime" });
  await assert.rejects(subject.service.commit({ previewId: preview.previewId, targetRunId: "17", confirmed: false }), /Explicit confirmation/);
  await assert.rejects(subject.service.commit({ previewId: preview.previewId, targetRunId: "18", confirmed: true }), /does not match/);
  assert.equal(subject.client.mutations, 0);
});

test("stale target state blocks execution before the mutation", async () => {
  const subject = setup();
  const preview = await subject.service.prepare({ targetRunId: "17", reason: "Stop the duplicate worker safely", provenanceKind: "live_runtime" });
  subject.client.states[1] = active({ claimIdentity: "replacement-claim" });
  const result = await subject.service.commit({ previewId: preview.previewId, targetRunId: "17", confirmed: true });
  assert.equal(result.status, "blocked");
  assert.equal(subject.client.mutations, 0);
});

test("successful result is verified from Hermes and duplicate commit executes exactly once", async () => {
  const subject = setup();
  const preview = await subject.service.prepare({ targetRunId: "17", reason: "Stop the duplicate worker safely", provenanceKind: "live_runtime" });
  const [first, duplicate] = await Promise.all([
    subject.service.commit({ previewId: preview.previewId, targetRunId: "17", confirmed: true }),
    subject.service.commit({ previewId: preview.previewId, targetRunId: "17", confirmed: true }),
  ]);
  assert.equal(first.status, "verified_success");
  assert.deepEqual(duplicate, first);
  assert.equal(subject.client.mutations, 1);
  assert.deepEqual(subject.client.reasons, ["Stop the duplicate worker safely"]);
});

test("accepted request without verified terminal state never claims success", async () => {
  const subject = setup();
  subject.client.states = [active(), active(), active()];
  const preview = await subject.service.prepare({ targetRunId: "17", reason: "Stop the duplicate worker safely", provenanceKind: "live_runtime" });
  const result = await subject.service.commit({ previewId: preview.previewId, targetRunId: "17", confirmed: true });
  assert.equal(result.status, "unknown");
  assert.match(result.summary, /not verified/i);
});

test("timeout and conflict remain visible without an automatic retry", async () => {
  for (const [error, expected] of [
    [new HermesManagementRequestError(504, "Hermes management request timed out."), "unknown"],
    [new HermesManagementRequestError(409, "Run already ended."), "blocked"],
  ] as const) {
    const subject = setup();
    subject.client.mutationError = error;
    const preview = await subject.service.prepare({ targetRunId: "17", reason: "Stop the duplicate worker safely", provenanceKind: "live_runtime" });
    const result = await subject.service.commit({ previewId: preview.previewId, targetRunId: "17", confirmed: true });
    const duplicate = await subject.service.commit({ previewId: preview.previewId, targetRunId: "17", confirmed: true });
    assert.equal(result.status, expected);
    assert.deepEqual(duplicate, result);
    assert.equal(subject.client.mutations, 1);
  }
});

test("bounded failure output redacts credentials and never returns raw payloads", async () => {
  const subject = setup();
  subject.client.mutationError = new Error("Authorization: Bearer secret-value https://user:token@example.test/run?api_key=secret");
  const preview = await subject.service.prepare({ targetRunId: "17", reason: "Stop the duplicate worker safely", provenanceKind: "live_runtime" });
  const result = await subject.service.commit({ previewId: preview.previewId, targetRunId: "17", confirmed: true });
  const serialized = JSON.stringify(result);
  assert.equal(result.status, "failed");
  assert.doesNotMatch(serialized, /secret-value|user:token|api_key=secret/);
  assert.ok(serialized.length < 700);
});

test("Phase 3B machine evidence is deterministic, complete, fixture-only, and sanitized", () => {
  const machine = JSON.parse(fs.readFileSync("docs/evidence/hermes-governed-runtime-interventions/acceptance-fixture-projection.json", "utf8")) as ReturnType<typeof buildHermesRuntimeInterventionFixtureProjection>;
  const rebuilt = buildHermesRuntimeInterventionFixtureProjection({
    implementationRevision: machine.evidenceProvenance.implementationRevision,
    artifactGeneratedAt: machine.evidenceProvenance.artifactGeneratedAt,
  });
  assert.deepEqual(machine, JSON.parse(JSON.stringify(rebuilt)));
  assert.deepEqual(hermesProjectionMatrixRows(machine), hermesProjectionMatrixRows(rebuilt));
  assert.equal(machine.capabilities.length, 48);
  assert.equal(new Set(machine.capabilities.map((item) => item.id)).size, 48);
  assert.equal(machine.provenance.label, "Acceptance fixture — no live mutation performed");
  assert.equal(machine.parity.liveVisibility.covered, 0);
  const run = machine.runtimeExecution.runs.find((item) => item.id === "Run 17");
  assert.deepEqual(run?.intervention, { category: "terminate_kanban_run", targetRunId: "17" });
  assert.doesNotMatch(JSON.stringify(machine), /private-claim|fixture-secret|worker_pid|task_title|authorization:|api_key/i);
});
