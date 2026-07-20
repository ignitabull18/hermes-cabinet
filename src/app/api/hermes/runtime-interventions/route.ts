import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/request-gate";
import { sanitizeHermesText } from "@/lib/hermes/control-center-sanitizer";
import {
  getHermesRuntimeInterventionService,
  HermesRuntimeInterventionError,
} from "@/lib/hermes/governed-runtime-intervention";
import { readHermesServerConfig } from "@/lib/hermes/server-config";
import { getCabinetRuntimeMode } from "@/lib/runtime/runtime-config";

export const dynamic = "force-dynamic";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiAuth(request);
  if (unauthorized) return unauthorized;
  if (getCabinetRuntimeMode() !== "hermes") return NextResponse.json({ error: "Hermes runtime mode is disabled." }, { status: 404 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const service = getHermesRuntimeInterventionService(readHermesServerConfig());
    if (body.stage === "prepare") {
      const preview = await service.prepare({
        targetRunId: text(body.targetRunId),
        reason: text(body.reason),
        provenanceKind: body.provenanceKind === "live_runtime" ? "live_runtime" : "acceptance_fixture",
      });
      return NextResponse.json({ ok: true, preview }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.stage === "commit") {
      const result = await service.commit({
        previewId: text(body.previewId),
        targetRunId: text(body.targetRunId),
        confirmed: body.confirmed === true,
      });
      return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "A prepare or commit stage is required." }, { status: 400 });
  } catch (error) {
    const status = error instanceof HermesRuntimeInterventionError
      ? error.code === "fixture_forbidden" ? 403 : error.code.includes("stale") || error.code.includes("mismatch") ? 409 : 400
      : 502;
    return NextResponse.json(
      { error: error instanceof Error ? sanitizeHermesText(error.message, 200) : "Hermes intervention failed." },
      { status, headers: { "Cache-Control": "no-store" } }
    );
  }
}
