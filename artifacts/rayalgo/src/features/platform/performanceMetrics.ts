import { useEffect } from "react";

const API_TIMING_EVENT = "rayalgo:api-request-timing";
export const SCREEN_READY_EVENT = "rayalgo:screen-ready";
const REPORT_INTERVAL_MS = 30_000;
const MAX_API_TIMINGS = 160;
const MAX_SCREEN_TIMINGS = 80;
const MAX_LONG_TASKS = 80;
const SLOW_API_TIMING_MS = 1_000;
const SLOW_SCREEN_READY_MS = 1_500;

type ApiTimingSample = {
  method: string;
  path: string;
  url: string;
  ok: boolean;
  status: number | null;
  errorName: string | null;
  durationMs: number;
  observedAt: string;
};

type ScreenTimingSample = {
  screenId: string;
  source: string;
  durationMs: number;
  startedAtMs: number;
  readyAtMs: number;
  observedAt: string;
};

type LongTaskSample = {
  name: string;
  durationMs: number;
  startedAtMs: number;
  observedAt: string;
};

type PendingScreenStart = {
  startedAt: number;
  source: string;
};

const nowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const nowIso = () => new Date().toISOString();

const metrics = {
  installed: false,
  appStartedAt: nowMs(),
  appStartedAtIso: nowIso(),
  firstScreenReadyAt: 0,
  firstScreenId: "",
  lastReportAt: 0,
  pendingScreens: new Map<string, PendingScreenStart>(),
  apiTimings: [] as ApiTimingSample[],
  screenTimings: [] as ScreenTimingSample[],
  longTasks: [] as LongTaskSample[],
};

const pushBounded = <T>(target: T[], value: T, max: number) => {
  target.push(value);
  if (target.length > max) {
    target.splice(0, target.length - max);
  }
};

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const summarizeTimings = <T extends { durationMs: number }>(
  samples: T[],
  slowThresholdMs: number,
) => {
  const durations = samples
    .map((sample) => sample.durationMs)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const percentile = (value: number) => {
    if (!durations.length) return null;
    const index = Math.min(
      durations.length - 1,
      Math.max(0, Math.ceil((value / 100) * durations.length) - 1),
    );
    return Math.round(durations[index] ?? 0);
  };

  return {
    count: durations.length,
    p50Ms: percentile(50),
    p95Ms: percentile(95),
    maxMs: durations.length ? Math.round(durations[durations.length - 1] ?? 0) : null,
    slowCount: durations.filter((durationMs) => durationMs >= slowThresholdMs).length,
  };
};

const topApiTimingsByPath = (samples: ApiTimingSample[]) => {
  const byPath = new Map<string, ApiTimingSample[]>();
  samples.forEach((sample) => {
    if (sample.path === "/api/diagnostics/client-metrics") {
      return;
    }
    const current = byPath.get(sample.path) ?? [];
    current.push(sample);
    byPath.set(sample.path, current);
  });

  return Array.from(byPath.entries())
    .map(([path, pathSamples]) => ({
      path,
      ...summarizeTimings(pathSamples, SLOW_API_TIMING_MS),
      errorCount: pathSamples.filter((sample) => !sample.ok).length,
      lastStatus: pathSamples[pathSamples.length - 1]?.status ?? null,
    }))
    .sort((left, right) => (right.p95Ms ?? 0) - (left.p95Ms ?? 0))
    .slice(0, 8);
};

const topScreenTimings = (samples: ScreenTimingSample[]) => {
  const byScreen = new Map<string, ScreenTimingSample[]>();
  samples.forEach((sample) => {
    const current = byScreen.get(sample.screenId) ?? [];
    current.push(sample);
    byScreen.set(sample.screenId, current);
  });

  return Array.from(byScreen.entries())
    .map(([screenId, screenSamples]) => ({
      screenId,
      ...summarizeTimings(screenSamples, SLOW_SCREEN_READY_MS),
      lastReadyMs: Math.round(screenSamples[screenSamples.length - 1]?.durationMs ?? 0),
    }))
    .sort((left, right) => (right.p95Ms ?? 0) - (left.p95Ms ?? 0))
    .slice(0, 8);
};

const handleApiTiming = (event: Event) => {
  const detail = asRecord((event as CustomEvent).detail);
  const path = asString(detail.path);
  const durationMs = asNumber(detail.durationMs);

  if (!path || durationMs === null || path === "/api/diagnostics/client-metrics") {
    return;
  }

  pushBounded(
    metrics.apiTimings,
    {
      method: asString(detail.method) ?? "GET",
      path,
      url: asString(detail.url) ?? path,
      ok: detail.ok === true,
      status: asNumber(detail.status),
      errorName: asString(detail.errorName),
      durationMs,
      observedAt: asString(detail.observedAt) ?? nowIso(),
    },
    MAX_API_TIMINGS,
  );
};

const installLongTaskObserver = () => {
  if (
    typeof PerformanceObserver === "undefined" ||
    typeof PerformanceObserver.supportedEntryTypes === "undefined" ||
    !PerformanceObserver.supportedEntryTypes.includes("longtask")
  ) {
    return () => {};
  }

  const observer = new PerformanceObserver((list) => {
    list.getEntries().forEach((entry) => {
      pushBounded(
        metrics.longTasks,
        {
          name: entry.name || "longtask",
          durationMs: Math.round(entry.duration),
          startedAtMs: Math.round(entry.startTime),
          observedAt: nowIso(),
        },
        MAX_LONG_TASKS,
      );
    });
  });
  try {
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    observer.disconnect();
    return () => {};
  }
  return () => observer.disconnect();
};

export const installRayalgoPerformanceMetrics = () => {
  if (metrics.installed || typeof window === "undefined") {
    return;
  }

  metrics.installed = true;
  if (!metrics.appStartedAt) {
    metrics.appStartedAt = nowMs();
    metrics.appStartedAtIso = nowIso();
  }
  window.addEventListener(API_TIMING_EVENT, handleApiTiming);
  const disconnectLongTaskObserver = installLongTaskObserver();

  window.addEventListener("beforeunload", () => {
    window.removeEventListener(API_TIMING_EVENT, handleApiTiming);
    disconnectLongTaskObserver();
  }, { once: true });
};

export const markScreenSwitchStart = (
  screenId: string,
  source = "navigation",
) => {
  if (!screenId) return;
  installRayalgoPerformanceMetrics();
  if (metrics.pendingScreens.has(screenId)) {
    return;
  }
  Array.from(metrics.pendingScreens.keys()).forEach((pendingScreenId) => {
    if (pendingScreenId !== screenId) {
      metrics.pendingScreens.delete(pendingScreenId);
    }
  });
  metrics.pendingScreens.set(screenId, {
    startedAt: nowMs(),
    source,
  });
};

export const markScreenReady = (screenId: string) => {
  if (!screenId) return;
  installRayalgoPerformanceMetrics();
  const fallbackStart =
    metrics.firstScreenReadyAt === 0
      ? { startedAt: metrics.appStartedAt || nowMs(), source: "initial" }
      : null;
  const pending = metrics.pendingScreens.get(screenId) ?? fallbackStart;

  if (!pending) {
    return;
  }

  const readyAt = nowMs();
  const sample: ScreenTimingSample = {
    screenId,
    source: pending.source,
    durationMs: Math.max(0, Math.round(readyAt - pending.startedAt)),
    startedAtMs: Math.round(pending.startedAt),
    readyAtMs: Math.round(readyAt),
    observedAt: nowIso(),
  };
  pushBounded(metrics.screenTimings, sample, MAX_SCREEN_TIMINGS);
  metrics.pendingScreens.delete(screenId);

  if (metrics.firstScreenReadyAt === 0) {
    metrics.firstScreenReadyAt = readyAt;
    metrics.firstScreenId = screenId;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SCREEN_READY_EVENT, { detail: sample }));
    }
  }
};

export const hasRayalgoFirstScreenReady = () => metrics.firstScreenReadyAt > 0;

export const buildRayalgoPerformanceMetricsPayload = (reason = "interval") => {
  const apiSummary = summarizeTimings(
    metrics.apiTimings.filter(
      (sample) => sample.path !== "/api/diagnostics/client-metrics",
    ),
    SLOW_API_TIMING_MS,
  );
  const screenSummary = summarizeTimings(
    metrics.screenTimings,
    SLOW_SCREEN_READY_MS,
  );
  const longTaskSummary = summarizeTimings(metrics.longTasks, 50);

  return {
    navigation: {
      reason,
      appStartedAt: metrics.appStartedAtIso,
      firstScreenId: metrics.firstScreenId || null,
      firstScreenReadyMs:
        metrics.firstScreenReadyAt > 0 && metrics.appStartedAt > 0
          ? Math.round(metrics.firstScreenReadyAt - metrics.appStartedAt)
          : null,
      reportedAt: nowIso(),
    },
    screens: {
      ...screenSummary,
      topScreens: topScreenTimings(metrics.screenTimings),
      recent: metrics.screenTimings.slice(-12),
    },
    longTasks: {
      ...longTaskSummary,
      recent: metrics.longTasks.slice(-12),
    },
    apiTimings: {
      ...apiSummary,
      topRoutes: topApiTimingsByPath(metrics.apiTimings),
      recent: metrics.apiTimings
        .filter((sample) => sample.path !== "/api/diagnostics/client-metrics")
        .slice(-20),
    },
    raw: {
      pendingScreens: Array.from(metrics.pendingScreens.keys()),
    },
  };
};

const hasReportableMetrics = () =>
  metrics.screenTimings.length > 0 ||
  metrics.apiTimings.some(
    (sample) => sample.path !== "/api/diagnostics/client-metrics",
  ) ||
  metrics.longTasks.length > 0;

const postPerformanceMetrics = (reason: string) => {
  if (typeof fetch !== "function" || !hasReportableMetrics()) {
    return;
  }

  metrics.lastReportAt = Date.now();
  fetch("/api/diagnostics/client-metrics", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(buildRayalgoPerformanceMetricsPayload(reason)),
    keepalive: reason === "visibility-hidden",
  }).catch(() => {});
};

export const useRayalgoPerformanceMetricsReporter = () => {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return undefined;
    }

    installRayalgoPerformanceMetrics();

    const intervalId = window.setInterval(() => {
      postPerformanceMetrics("interval");
    }, REPORT_INTERVAL_MS);
    const handleFirstReady = () => {
      window.setTimeout(() => postPerformanceMetrics("first-screen-ready"), 500);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        postPerformanceMetrics("visibility-hidden");
      }
    };

    window.addEventListener(SCREEN_READY_EVENT, handleFirstReady);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener(SCREEN_READY_EVENT, handleFirstReady);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);
};
