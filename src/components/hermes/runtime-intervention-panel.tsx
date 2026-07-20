"use client";

import { useMemo, useState } from "react";
import { ShieldAlert, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { HermesControlCenterSnapshot } from "@/lib/hermes/control-center-types";
import type {
  HermesRuntimeInterventionPreview,
  HermesRuntimeInterventionResult,
} from "@/lib/hermes/governed-runtime-intervention";
import type { HermesExecutionRun } from "@/lib/hermes/runtime-execution";

type ApiResponse = {
  ok?: boolean;
  preview?: HermesRuntimeInterventionPreview;
  result?: HermesRuntimeInterventionResult;
  error?: string;
};

function fixturePreview(run: HermesExecutionRun, snapshot: HermesControlCenterSnapshot, reason: string): HermesRuntimeInterventionPreview {
  return {
    previewId: "fixture-only-no-operation",
    idempotencyIdentity: "fixture-only-no-operation",
    action: "terminate_kanban_run",
    targetRunId: run.intervention?.targetRunId ?? "unavailable",
    targetTaskId: "Hidden in fixture preview",
    currentState: run.state,
    reason: reason.trim() || "Acceptance review only. No live request will be sent.",
    expectedConsequence: "A live commit would stop this worker, mark the run reclaimed, clear its claim, and return its task to ready.",
    reversible: false,
    evidenceObservedAt: run.lastTransitionAt ?? snapshot.checkedAt,
    expiresAt: snapshot.checkedAt,
  };
}

function PreviewFacts({ preview }: { preview: HermesRuntimeInterventionPreview }) {
  const facts = [
    ["Action", "Terminate one active Kanban run"],
    ["Target", `Run ${preview.targetRunId}`],
    ["Current state", preview.currentState],
    ["Reason", preview.reason],
    ["Expected consequence", preview.expectedConsequence],
    ["Reversible", "No"],
    ["Evidence time", preview.evidenceObservedAt],
    ["Idempotency identity", preview.idempotencyIdentity],
  ] as const;
  return (
    <dl className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-xs" data-testid="hermes-intervention-preview">
      {facts.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-words font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RuntimeInterventionPanel({
  run,
  snapshot,
  onRefresh,
}: {
  run: HermesExecutionRun;
  snapshot: HermesControlCenterSnapshot;
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState<HermesRuntimeInterventionPreview | null>(null);
  const [result, setResult] = useState<HermesRuntimeInterventionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isFixture = snapshot.provenance.kind === "acceptance_fixture";
  const confirmationText = useMemo(() => `TERMINATE ${run.intervention?.targetRunId ?? "RUN"}`, [run.intervention?.targetRunId]);
  if (!run.intervention) return null;

  const reset = () => {
    setReason("");
    setConfirmation("");
    setPreview(null);
    setResult(null);
    setError(null);
    setBusy(false);
  };

  const prepare = async () => {
    setError(null);
    if (isFixture) {
      setPreview(fixturePreview(run, snapshot, reason));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/hermes/runtime-interventions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "prepare", targetRunId: run.intervention?.targetRunId, reason, provenanceKind: snapshot.provenance.kind }),
      });
      const body = await response.json() as ApiResponse;
      if (!response.ok || !body.preview) throw new Error(body.error || "Hermes could not prepare the intervention.");
      setPreview(body.preview);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Hermes could not prepare the intervention.");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview || confirmation !== confirmationText || isFixture) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/hermes/runtime-interventions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "commit", previewId: preview.previewId, targetRunId: preview.targetRunId, confirmed: true }),
      });
      const body = await response.json() as ApiResponse;
      if (!response.ok || !body.result) throw new Error(body.error || "Hermes could not complete the intervention.");
      setResult(body.result);
      await onRefresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Hermes could not complete the intervention.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3" data-testid="hermes-runtime-intervention">
      <div>
        <h3 className="text-sm font-semibold">Governed intervention</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">One run only. Preview first, then Jeremy explicitly commits.</p>
      </div>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ShieldAlert data-icon="inline-start" />{isFixture ? "Review safety preview" : "Prepare termination"}
      </Button>
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
        <DialogContent className="sm:max-w-lg" data-testid="hermes-intervention-dialog">
          <DialogHeader>
            <div className="flex items-center gap-2"><Badge variant="destructive">Consequential</Badge><Badge variant="outline">One run</Badge></div>
            <DialogTitle>Terminate Hermes run {run.intervention.targetRunId}</DialogTitle>
            <DialogDescription>Hermes prepares; Jeremy commits. Opening and previewing this dialog performs no mutation.</DialogDescription>
          </DialogHeader>

          {isFixture ? (
            <Alert className="border-warning/40 bg-warning/5" data-testid="hermes-intervention-fixture-block">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>Acceptance fixture — no live mutation performed</AlertTitle>
              <AlertDescription>The commit path is disabled for fixture evidence.</AlertDescription>
            </Alert>
          ) : null}

          {!preview ? (
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="hermes-termination-reason">Reason</label>
              <Textarea id="hermes-termination-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why must this specific run stop?" maxLength={240} rows={3} />
              <p className="text-xs text-muted-foreground">This bounded reason is recorded with the Hermes run transition.</p>
            </div>
          ) : <PreviewFacts preview={preview} />}

          {preview && !isFixture && !result ? (
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="hermes-termination-confirmation">Type {confirmationText} to confirm</label>
              <Input id="hermes-termination-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
            </div>
          ) : null}

          {result ? (
            <Alert variant={result.status === "verified_success" ? "default" : "destructive"} data-testid="hermes-intervention-result">
              {result.status !== "verified_success" ? <TriangleAlert aria-hidden="true" /> : null}
              <AlertTitle>{result.status === "verified_success" ? "Verified by Hermes" : "Intervention not verified"}</AlertTitle>
              <AlertDescription>{result.summary}</AlertDescription>
            </Alert>
          ) : null}
          {error ? <Alert variant="destructive" role="alert"><TriangleAlert aria-hidden="true" /><AlertTitle>Intervention stopped</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            {!preview ? <Button onClick={() => void prepare()} disabled={busy || (!isFixture && reason.trim().length < 8)}>{busy ? "Preparing..." : "Prepare preview"}</Button> : null}
            {preview && !result ? <Button variant="destructive" onClick={() => void commit()} disabled={busy || isFixture || confirmation !== confirmationText}>{busy ? "Committing once..." : "Confirm and terminate"}</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
