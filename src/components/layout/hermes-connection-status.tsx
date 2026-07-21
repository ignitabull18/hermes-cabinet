"use client";

import { AlertTriangle, CircleDot, Loader2, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { hermesHealthDisplay } from "@/lib/hermes/health-status";
import type { HermesHealthSnapshot } from "@/lib/hermes/types";

export function HermesConnectionStatus() {
  const [snapshot, setSnapshot] = useState<HermesHealthSnapshot | null>(null);
  const [lastConfirmed, setLastConfirmed] = useState<HermesHealthSnapshot | null>(null);
  const [connecting, setConnecting] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/hermes/health", { cache: "no-store" });
      const data = (await response.json()) as HermesHealthSnapshot;
      setSnapshot(data);
      if (data.status === "online") setLastConfirmed(data);
    } catch {
      setSnapshot({
        enabled: true,
        status: "probe_unavailable",
        version: null,
        profile: null,
        profileSource: null,
        gatewayState: null,
        checkedAt: new Date().toISOString(),
        observationSource: "GET /api/hermes/health",
        message: "Cabinet could not reach the Hermes status route.",
      });
    } finally {
      setConnecting(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (snapshot?.enabled === false) return null;

  const display = hermesHealthDisplay(connecting ? null : snapshot, lastConfirmed);
  const online = display.tone === "healthy";
  const failure = display.tone === "failure";
  const title = [display.detail, snapshot?.version && `Version ${snapshot.version}`, snapshot?.profile && `Profile ${snapshot.profile}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={() => {
        setConnecting(true);
        void refresh();
      }}
      className={`flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors ${
        connecting
          ? "text-muted-foreground hover:bg-muted/40"
          : online
            ? "text-green-500 hover:bg-green-500/10"
            : failure
              ? "text-red-500 hover:bg-red-500/10"
              : "text-amber-500 hover:bg-amber-500/10"
      }`}
      title={title}
      aria-label={`${display.label}. ${title}`}
      data-hermes-probe-source={display.currentSource}
      data-hermes-probe-observed-at={display.currentObservedAt}
      data-hermes-last-confirmed-at={display.lastConfirmedAt ?? undefined}
    >
      {connecting ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : online ? (
        <CircleDot className="h-3 w-3" aria-hidden="true" />
      ) : failure ? (
        <XCircle className="h-3 w-3" aria-hidden="true" />
      ) : (
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      )}
      <span className="@max-[920px]:hidden">{display.label}</span>
    </button>
  );
}
