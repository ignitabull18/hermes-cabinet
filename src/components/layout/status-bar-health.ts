import type { HermesAgentOperationalState } from "@/lib/hermes/health-status";
import type { ServiceLevel } from "@/stores/health-store";

export type OverallOperationalState = "checking" | "operational" | "degraded" | "offline";

export function deriveStatusBarOperationalState(input: {
  hermesMode: boolean;
  appLevel: ServiceLevel;
  daemonLevel: ServiceLevel;
  legacyProviderReady: boolean;
  hermesAgentState: HermesAgentOperationalState;
}): OverallOperationalState {
  if (input.appLevel === "unknown") return "checking";
  if (input.appLevel === "down") return "offline";
  if (input.appLevel !== "ok") return "degraded";

  if (input.hermesMode) {
    return input.hermesAgentState === "connected" ? "operational" : "degraded";
  }

  if (input.daemonLevel === "unknown") return "checking";
  return input.daemonLevel !== "down" && input.legacyProviderReady
    ? "operational"
    : "degraded";
}
