import { create } from "zustand";
import { dedupFetch } from "@/lib/api/dedup-fetch";

import type { InstallKind } from "@/types/update";

export type ServiceLevel = "unknown" | "ok" | "degraded" | "down";
export type { InstallKind };

interface HealthState {
  appMissCount: number; // -1 = no poll completed yet
  daemonMissCount: number;
  // Wall-clock timestamps for the most recent poll *attempt* and the most
  // recent successful response. The popover renders these so users can see
  // when we last actually heard from each service — not just whether it's
  // up "right now."
  lastDaemonPollAt: number | null;
  lastDaemonOkAt: number | null;
  lastAppPollAt: number | null;
  lastAppOkAt: number | null;
  installKind: InstallKind;
  bannerDismissedAt: number | null; // ms; reappears after 60s if still down
  subscribers: number;
  intervalId: ReturnType<typeof setInterval> | null;
  visibilityHandler: (() => void) | null;
  pollOnce: (options?: { includeDaemon?: boolean }) => Promise<void>;
  startPolling: (options?: { includeDaemon?: boolean }) => () => void;
  dismissBanner: () => void;
}

// Two consecutive misses flips us from "degraded" to "down" — single dropped
// polls happen all the time during dev (port reuse, fast refresh) and would
// thrash the banner if we surfaced them eagerly.
const DOWN_THRESHOLD = 2;
// 5s polling: audit #092 asked for a tighter loop than the original 10s so
// daemon transitions are reflected within ~10s (one full miss-counter cycle).
// The endpoints are local, the calls are deduped, and the loop pauses while
// the tab is hidden — load impact is negligible.
const POLL_INTERVAL_MS = 5_000;
const BANNER_REAPPEAR_MS = 60_000;

function levelFor(missCount: number): ServiceLevel {
  if (missCount < 0) return "unknown";
  if (missCount === 0) return "ok";
  if (missCount < DOWN_THRESHOLD) return "degraded";
  return "down";
}

export const useHealthStore = create<HealthState>((set, get) => ({
  appMissCount: -1,
  daemonMissCount: -1,
  lastDaemonPollAt: null,
  lastDaemonOkAt: null,
  lastAppPollAt: null,
  lastAppOkAt: null,
  installKind: "source-custom",
  bannerDismissedAt: null,
  subscribers: 0,
  intervalId: null,
  visibilityHandler: null,

  pollOnce: async ({ includeDaemon = true } = {}) => {
    const [appRes, daemonRes] = await Promise.allSettled(
      healthPollPaths(includeDaemon).map((url) => dedupFetch(url, { cache: "no-store" })),
    );
    const appOk = appRes.status === "fulfilled" && appRes.value.ok;
    const daemonOk = includeDaemon && daemonRes?.status === "fulfilled" && daemonRes.value.ok;
    const now = Date.now();

    let nextInstallKind: InstallKind | null = null;
    if (appOk && appRes.status === "fulfilled") {
      try {
        const data = await appRes.value.clone().json();
        if (data && typeof data.installKind === "string") {
          nextInstallKind = data.installKind as InstallKind;
        }
      } catch {
        /* ignore */
      }
    }

    set((s) => ({
      appMissCount: appOk ? 0 : Math.max(s.appMissCount, 0) + 1,
      daemonMissCount: includeDaemon ? (daemonOk ? 0 : Math.max(s.daemonMissCount, 0) + 1) : s.daemonMissCount,
      lastAppPollAt: now,
      lastDaemonPollAt: includeDaemon ? now : s.lastDaemonPollAt,
      lastAppOkAt: appOk ? now : s.lastAppOkAt,
      lastDaemonOkAt: includeDaemon && daemonOk ? now : s.lastDaemonOkAt,
      installKind: nextInstallKind ?? s.installKind,
    }));
  },

  startPolling: ({ includeDaemon = true } = {}) => {
    const { subscribers, intervalId, pollOnce } = get();
    set({ subscribers: subscribers + 1 });

    if (intervalId === null) {
      void pollOnce({ includeDaemon });
      const id = setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
        void get().pollOnce({ includeDaemon });
      }, POLL_INTERVAL_MS);
      set({ intervalId: id });

      if (typeof document !== "undefined") {
        const onVisibility = () => {
          if (document.visibilityState === "visible") void get().pollOnce({ includeDaemon });
        };
        document.addEventListener("visibilitychange", onVisibility);
        set({ visibilityHandler: onVisibility });
      }
    }

    return () => {
      const next = get().subscribers - 1;
      if (next <= 0) {
        const id = get().intervalId;
        if (id !== null) clearInterval(id);
        const visibilityHandler = get().visibilityHandler;
        if (visibilityHandler && typeof document !== "undefined") {
          document.removeEventListener("visibilitychange", visibilityHandler);
        }
        set({ subscribers: 0, intervalId: null, visibilityHandler: null });
      } else {
        set({ subscribers: next });
      }
    };
  },

  dismissBanner: () => set({ bannerDismissedAt: Date.now() }),
}));

export function healthPollPaths(includeDaemon: boolean): string[] {
  return includeDaemon ? ["/api/health", "/api/health/daemon"] : ["/api/health"];
}

export function selectAppLevel(s: HealthState): ServiceLevel {
  return levelFor(s.appMissCount);
}

export function selectDaemonLevel(s: HealthState): ServiceLevel {
  return levelFor(s.daemonMissCount);
}

export function selectShowDaemonDownBanner(s: HealthState): boolean {
  if (levelFor(s.daemonMissCount) !== "down") return false;
  if (s.bannerDismissedAt === null) return true;
  return Date.now() - s.bannerDismissedAt > BANNER_REAPPEAR_MS;
}
