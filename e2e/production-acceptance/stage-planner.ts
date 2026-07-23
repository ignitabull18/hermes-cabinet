import type {
  AcceptanceCheck,
  AcceptanceStatus,
  RouteChecklistEntry,
} from "./contracts";

export interface AcceptanceStage {
  id: string;
  area: string;
  dependsOn?: string[];
}

export function dependencyStatus(
  stage: AcceptanceStage,
  checks: readonly AcceptanceCheck[],
): { status: Extract<AcceptanceStatus, "blocked" | "not_run">; summary: string } | null {
  if (!stage.dependsOn?.length) return null;
  const byId = new Map(checks.map((check) => [check.id, check]));
  const missing = stage.dependsOn.filter((id) => !byId.has(id));
  if (missing.length) {
    return {
      status: "not_run",
      summary: `Prerequisite result missing: ${missing.join(", ")}.`,
    };
  }
  const blocked = stage.dependsOn
    .map((id) => byId.get(id)!)
    .filter((check) => check.status !== "passed");
  if (!blocked.length) return null;
  return {
    status: "blocked",
    summary: `Blocked by ${blocked.map((check) => `${check.id}:${check.status}`).join(", ")}.`,
  };
}

export function independentStagesAfterFailure(
  stages: readonly AcceptanceStage[],
  failedStageId: string,
): string[] {
  return stages
    .filter((stage) => !stage.dependsOn?.includes(failedStageId))
    .map((stage) => stage.id);
}

export function summarizeRouteInventory(
  routes: readonly RouteChecklistEntry[],
): {
  status: AcceptanceStatus;
  incomplete: RouteChecklistEntry[];
  independentlyIncomplete: RouteChecklistEntry[];
} {
  const incomplete = routes.filter((entry) => entry.status !== "passed");
  const independentlyIncomplete = incomplete.filter(
    (entry) => entry.status === "failed" || entry.status === "not_run",
  );
  const status: AcceptanceStatus = incomplete.some((entry) => entry.status === "failed")
    ? "failed"
    : incomplete.some((entry) => entry.status === "not_run")
      ? "not_run"
      : incomplete.some((entry) => entry.status === "blocked")
        ? "blocked"
        : "passed";
  return { status, incomplete, independentlyIncomplete };
}
