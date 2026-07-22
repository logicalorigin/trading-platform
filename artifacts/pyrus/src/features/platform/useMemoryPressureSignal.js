import { useEffect, useRef } from "react";
import { getLatestDiagnostics } from "@workspace/api-client-react";
import { isPyrusSafeQaMode } from "../../app/qa-mode";
import { getActiveChartBarStoreEntryCount } from "../charting/activeChartBarStore";
import { getChartHydrationStatsSnapshot } from "../charting/chartHydrationStats";
import { readBrowserMemoryMeasurement } from "./memoryPressureClient";
import { subscribeDiagnosticsStream } from "./diagnosticsStream";
import {
  buildMemoryPressureState,
  isPressureLevelAtLeast,
} from "./memoryPressureModel";
import {
  getMemoryPressureSnapshot,
  setMemoryPressureSnapshot,
  useMemoryPressureSnapshot,
} from "./memoryPressureStore";
import { getMarketFlowStoreEntryCount } from "./marketFlowStore";
import { getOptionQuoteSnapshotCacheSize } from "./live-streams";
import { getRuntimeTickerStoreEntryCount } from "./runtimeTickerStore";
import { getTradeFlowStoreEntryCount } from "./tradeFlowStore";
import { getTradeOptionChainStoreEntryCount } from "./tradeOptionChainStore";
import { useRuntimeWorkloadStats } from "./workloadStats";

const SAMPLE_INTERVALS_MS = {
  normal: 15_000,
  watch: 12_000,
  high: 5_000,
};

const SERVER_INTERVALS_MS = {
  normal: 30_000,
  watch: 20_000,
  high: 15_000,
};

const API_PRESSURE_EVENT = "pyrus:api-pressure";
const API_PRESSURE_HEADER_HOLD_MS = 15_000;
const SERVER_PRESSURE_LEVELS = new Set(["normal", "watch", "high"]);

const jitterMs = (baseMs) => {
  const variance = Math.round(baseMs * 0.12);
  const delta = Math.round(Math.random() * variance * 2 - variance);
  return Math.max(2_500, baseMs + delta);
};

const readResourceSnapshot = (payload) =>
  payload?.snapshots?.find?.(
    (entry) => entry?.subsystem === "resource-pressure",
  ) || null;

const normalizeServerPressureLevel = (summary) =>
  summary?.pressureLevel || summary?.level || null;

const normalizeServerResourceLevel = (summary) =>
  normalizePressureHeaderLevel(
    summary?.resourceLevel || summary?.apiResourcePressure?.resourceLevel,
  );

const normalizePressureHeaderLevel = (level) =>
  SERVER_PRESSURE_LEVELS.has(level) ? level : null;

const serverPressureDrivers = (summary) => {
  if (Array.isArray(summary?.pressureDrivers)) {
    return summary.pressureDrivers;
  }
  if (Array.isArray(summary?.dominantDrivers)) {
    return summary.dominantDrivers;
  }
  return [];
};

const MEMORY_PRESSURE_DRIVER_KINDS = new Set([
  "api-heap",
  "api-rss",
  "browser-memory",
]);

const isMemoryPressureDriver = (driver) =>
  MEMORY_PRESSURE_DRIVER_KINDS.has(driver?.kind);

const memoryPressureDrivers = (drivers) =>
  Array.isArray(drivers) ? drivers.filter(isMemoryPressureDriver) : [];

const maxMemoryPressureDriverLevel = (drivers) =>
  drivers.reduce((level, driver) => {
    const driverLevel = driver?.level || "normal";
    if (!isPressureLevelAtLeast(driverLevel, "watch")) {
      return level;
    }
    return !level || isPressureLevelAtLeast(driverLevel, level)
      ? driverLevel
      : level;
  }, null);

const mergePressureDrivers = (clientDrivers = [], serverDrivers = []) => {
  const next = [];
  const seen = new Set();
  [...memoryPressureDrivers(serverDrivers), ...clientDrivers].forEach(
    (driver) => {
      const kind = driver?.kind;
      if (!kind || seen.has(kind)) return;
      seen.add(kind);
      next.push(driver);
    },
  );
  return next;
};

export const mergeMemoryPressureServerSummary = ({
  footerMemoryPressure = null,
  resourceMetrics = null,
} = {}) => {
  if (!footerMemoryPressure && !resourceMetrics) {
    return null;
  }
  const footerDrivers = memoryPressureDrivers(
    serverPressureDrivers(footerMemoryPressure),
  );
  const resourceDrivers = memoryPressureDrivers(
    serverPressureDrivers(resourceMetrics),
  );
  const resourceMemoryLevel = maxMemoryPressureDriverLevel(resourceDrivers);
  const serverResourceLevel = normalizeServerResourceLevel(resourceMetrics);
  if (!footerMemoryPressure) {
    return {
      ...resourceMetrics,
      level: resourceMemoryLevel || "normal",
      resourceLevel: serverResourceLevel || resourceMemoryLevel || "normal",
      pressureDrivers: resourceDrivers,
      dominantDrivers: resourceDrivers,
    };
  }
  if (!resourceMetrics) {
    return {
      ...footerMemoryPressure,
      resourceLevel:
        normalizeServerResourceLevel(footerMemoryPressure) ||
        serverResourceLevel ||
        null,
      pressureDrivers: footerDrivers,
      dominantDrivers: footerDrivers,
    };
  }

  const footerLevel =
    normalizeServerPressureLevel(footerMemoryPressure) || "normal";
  const memoryResourceLevel = resourceMemoryLevel;
  const level =
    memoryResourceLevel &&
    isPressureLevelAtLeast(memoryResourceLevel, footerLevel)
      ? memoryResourceLevel
      : footerLevel;
  const pressureDrivers = resourceDrivers.length
    ? resourceDrivers
    : footerDrivers;

  return {
    ...footerMemoryPressure,
    ...resourceMetrics,
    level,
    resourceLevel:
      serverResourceLevel ||
      normalizeServerResourceLevel(footerMemoryPressure) ||
      null,
    apiHeapUsedPercent:
      footerMemoryPressure.apiHeapUsedPercent ??
      resourceMetrics.apiHeapUsedPercent ??
      resourceMetrics.heapUsedPercent ??
      null,
    apiRssMb:
      footerMemoryPressure.apiRssMb ??
      resourceMetrics.rssMb ??
      resourceMetrics.apiResourcePressure?.inputs?.rssMb ??
      null,
    apiRssThresholds:
      footerMemoryPressure.apiRssThresholds ??
      resourceMetrics.apiRssThresholds ??
      null,
    browserMemoryMb:
      footerMemoryPressure.browserMemoryMb ??
      resourceMetrics.browserMemoryMb ??
      null,
    browserMemoryLimitMb:
      footerMemoryPressure.browserMemoryLimitMb ??
      resourceMetrics.browserMemoryLimitMb ??
      null,
    sourceQuality:
      footerMemoryPressure.sourceQuality ??
      resourceMetrics.sourceQuality ??
      null,
    pressureDrivers,
    dominantDrivers: pressureDrivers,
  };
};

export const mergeMemoryPressureRuntimeState = (clientState, serverSummary) => {
  if (!serverSummary) {
    return clientState;
  }
  const clientLevel = clientState?.level || "normal";
  const serverDrivers = memoryPressureDrivers(
    serverPressureDrivers(serverSummary),
  );
  const serverLevel = maxMemoryPressureDriverLevel(serverDrivers);
  const drivers = mergePressureDrivers(
    clientState?.pressureDrivers,
    serverDrivers,
  );
  const dominantDrivers = drivers.filter((driver) =>
    isPressureLevelAtLeast(driver?.level, "watch"),
  );

  return {
    ...clientState,
    level:
      serverLevel && isPressureLevelAtLeast(serverLevel, clientLevel)
        ? serverLevel
        : clientLevel,
    browserMemoryMb:
      clientState?.browserMemoryMb ?? serverSummary.browserMemoryMb ?? null,
    browserMemoryLimitMb:
      clientState?.browserMemoryLimitMb ??
      serverSummary.browserMemoryLimitMb ??
      null,
    apiHeapUsedPercent:
      clientState?.apiHeapUsedPercent ??
      serverSummary.apiHeapUsedPercent ??
      null,
    apiRssMb:
      serverSummary.apiRssMb ??
      serverSummary.rssMb ??
      serverSummary.apiResourcePressure?.inputs?.rssMb ??
      null,
    apiRssThresholds:
      serverSummary.apiRssThresholds ?? clientState?.apiRssThresholds ?? null,
    apiP95LatencyMs:
      serverSummary.eventLoopP95Ms ??
      serverSummary.apiResourcePressure?.inputs?.apiP95LatencyMs ??
      null,
    sourceQuality:
      clientState?.sourceQuality === "low" && serverSummary.sourceQuality
        ? serverSummary.sourceQuality
        : clientState?.sourceQuality,
    pressureDrivers: drivers,
    dominantDrivers: dominantDrivers.length
      ? dominantDrivers
      : (clientState?.dominantDrivers ?? []),
  };
};

export const buildResponseHeaderPressureSummary = (
  detail = {},
  current = null,
) => {
  const pressureLevel = normalizePressureHeaderLevel(detail.pressureLevel);
  const resourceLevel =
    normalizePressureHeaderLevel(detail.resourceLevel) || pressureLevel;
  if (!pressureLevel && !resourceLevel) {
    return current;
  }
  const observedPressureLevel = pressureLevel || resourceLevel;
  const currentLevel = normalizePressureHeaderLevel(current?.level);
  const currentEffectiveLevel = normalizePressureHeaderLevel(
    current?.effectivePressureLevel ||
      current?.apiPressureLevel ||
      current?.pressureLevel,
  );
  const observedAt = detail.observedAt || new Date().toISOString();
  const observedAtMs = Date.parse(observedAt);
  const currentObservedAtMs = Date.parse(current?.observedAt || "");
  const holdCurrentEffectiveLevel =
    currentEffectiveLevel &&
    Number.isFinite(observedAtMs) &&
    Number.isFinite(currentObservedAtMs) &&
    observedAtMs - currentObservedAtMs <= API_PRESSURE_HEADER_HOLD_MS &&
    isPressureLevelAtLeast(currentEffectiveLevel, observedPressureLevel);
  const effectivePressureLevel = holdCurrentEffectiveLevel
    ? currentEffectiveLevel
    : observedPressureLevel;

  return {
    ...(current || {}),
    origin: "response-header",
    level:
      currentLevel &&
      isPressureLevelAtLeast(currentLevel, effectivePressureLevel)
        ? currentLevel
        : effectivePressureLevel,
    pressureLevel: effectivePressureLevel,
    resourceLevel,
    apiPressureLevel: effectivePressureLevel,
    effectivePressureLevel,
    lastHeaderPressureLevel: observedPressureLevel,
    sourceQuality: "response-header",
    routeClass: detail.routeClass || current?.routeClass || null,
    admissionAction: detail.admissionAction || current?.admissionAction || null,
    admissionReason: detail.admissionReason || current?.admissionReason || null,
    lastHeaderStatus: Number.isFinite(Number(detail.status))
      ? Number(detail.status)
      : (current?.lastHeaderStatus ?? null),
    lastHeaderMethod: detail.method || current?.lastHeaderMethod || null,
    lastHeaderUrl: detail.url || current?.lastHeaderUrl || null,
    observedAt,
  };
};

const bytesToMb = (value) => {
  if (value == null || value === "") return null;
  const bytes = Number(value);
  return Number.isFinite(bytes) ? bytes / 1024 / 1024 : null;
};

const browserMemoryFromMeasurement = (measurement) => ({
  browserMemoryMb:
    bytesToMb(measurement?.memory?.bytes) ??
    bytesToMb(measurement?.memory?.usedJsHeapSize),
  browserMemoryLimitMb: bytesToMb(measurement?.memory?.jsHeapSizeLimit),
});

export const clearDiagnosticsMemoryPressureSummary = (current) => {
  const server = current?.server || null;
  const responseHeaderServer =
    server?.origin === "response-header" ||
    server?.sourceQuality === "response-header"
      ? server
      : null;
  const hasDiagnosticsContribution =
    current?.diagnosticsMerged === true ||
    server?.origin === "diagnostics" ||
    (server && !responseHeaderServer);
  if (!hasDiagnosticsContribution) {
    return current;
  }
  const browserMemory = browserMemoryFromMeasurement(current.measurement);
  const clientOnly = buildMemoryPressureState(
    {
      observedAt: new Date().toISOString(),
      ...browserMemory,
      browserSource: current.measurement?.memory?.source,
      sourceQuality: current.measurement?.memory?.confidence,
      apiHeapUsedPercent: null,
      activeWorkloadCount: current.activeWorkloadCount,
      pollCount: current.pollCount,
      streamCount: current.streamCount,
      chartScopeCount: current.chartScopeCount,
      prependScopeCount: current.prependScopeCount,
      queryCount: current.queryCount,
      heavyQueryCount: current.heavyQueryCount,
      storeEntryCount: current.storeEntryCount,
    },
    { previousState: null, history: [] },
  );
  const retained = mergeMemoryPressureRuntimeState(
    clientOnly,
    responseHeaderServer,
  );
  return {
    ...retained,
    apiHeapUsedPercent: null,
    reducedMotionEnabled: current.reducedMotionEnabled,
    measurement: current.measurement,
    server: responseHeaderServer,
    diagnosticsMerged: false,
  };
};

const readLatestDiagnosticsSnapshot = (signal) =>
  getLatestDiagnostics(signal ? { signal } : undefined);

export const buildMemoryPressureServerSummaryFromDiagnostics = (payload) => {
  const resourceSnapshot = readResourceSnapshot(payload);
  const summary = mergeMemoryPressureServerSummary({
    footerMemoryPressure: payload?.footerMemoryPressure || null,
    resourceMetrics: resourceSnapshot?.metrics || null,
  });
  return summary ? { ...summary, origin: "diagnostics" } : null;
};

const readQueryDiagnostics = () => {
  try {
    return window.__PYRUS_MEMORY_DIAGNOSTICS__?.() || null;
  } catch {
    return null;
  }
};

const prefersReducedMotion = () =>
  Boolean(
    typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
  );

const memoryPressureWorkloadInputsChanged = (
  current,
  workloadStats,
  reducedMotionEnabled,
) => {
  const kindCounts = workloadStats.kindCounts || {};
  return (
    current.activeWorkloadCount !== workloadStats.activeCount ||
    current.pollCount !== (kindCounts.poll || 0) ||
    current.streamCount !== (kindCounts.stream || 0) ||
    current.reducedMotionEnabled !== reducedMotionEnabled
  );
};

export const useMemoryPressureMonitor = ({
  serverDiagnosticsEnabled = false,
} = {}) => {
  const safeQaMode = isPyrusSafeQaMode();
  const workloadStats = useRuntimeWorkloadStats(true);
  const historyRef = useRef([]);
  const latestRef = useRef(getMemoryPressureSnapshot());
  const nextServerRefreshAtRef = useRef(0);
  const workloadStatsRef = useRef(workloadStats);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleApiPressure = (event) => {
      const current = getMemoryPressureSnapshot();
      const serverSummary = buildResponseHeaderPressureSummary(
        event?.detail,
        current.server?.origin === "response-header" ||
          current.server?.sourceQuality === "response-header"
          ? current.server
          : null,
      );
      if (!serverSummary || serverSummary === current.server) {
        return;
      }
      const snapshot = {
        ...current,
        server: serverSummary,
        observedAt: current.observedAt || serverSummary.observedAt,
      };
      latestRef.current = snapshot;
      setMemoryPressureSnapshot(snapshot);
    };

    window.addEventListener(API_PRESSURE_EVENT, handleApiPressure);
    return () =>
      window.removeEventListener(API_PRESSURE_EVENT, handleApiPressure);
  }, []);

  useEffect(() => {
    workloadStatsRef.current = workloadStats;
    if (typeof window === "undefined") {
      return;
    }

    const current = getMemoryPressureSnapshot();
    const kindCounts = workloadStats.kindCounts || {};
    const reducedMotionEnabled = prefersReducedMotion();
    if (
      !memoryPressureWorkloadInputsChanged(
        current,
        workloadStats,
        reducedMotionEnabled,
      )
    ) {
      latestRef.current = current;
      return;
    }
    const next = buildMemoryPressureState(
      {
        observedAt: new Date().toISOString(),
        browserMemoryMb: current.browserMemoryMb,
        browserMemoryLimitMb: current.browserMemoryLimitMb,
        browserSource: current.browserSource,
        sourceQuality: current.sourceQuality,
        apiHeapUsedPercent: current.apiHeapUsedPercent,
        activeWorkloadCount: workloadStats.activeCount,
        pollCount: kindCounts.poll || 0,
        streamCount: kindCounts.stream || 0,
        chartScopeCount: current.chartScopeCount,
        prependScopeCount: current.prependScopeCount,
        queryCount: current.queryCount,
        heavyQueryCount: current.heavyQueryCount,
        storeEntryCount: current.storeEntryCount,
      },
      {
        previousState: current,
        history: historyRef.current,
      },
    );
    const mergedNext = mergeMemoryPressureRuntimeState(next, current.server);
    const snapshot = {
      ...mergedNext,
      reducedMotionEnabled,
      measurement: current.measurement,
      server: current.server,
      diagnosticsMerged: current.diagnosticsMerged === true,
    };
    latestRef.current = snapshot;
    setMemoryPressureSnapshot(snapshot);
  }, [workloadStats]);

  useEffect(() => {
    if (serverDiagnosticsEnabled && !safeQaMode) {
      return;
    }
    const current = getMemoryPressureSnapshot();
    const cleared = clearDiagnosticsMemoryPressureSummary(current);
    if (cleared === current) {
      latestRef.current = current;
      return;
    }
    historyRef.current = [];
    latestRef.current = cleared;
    setMemoryPressureSnapshot(cleared);
  }, [safeQaMode, serverDiagnosticsEnabled]);

  useEffect(() => {
    if (
      !serverDiagnosticsEnabled ||
      safeQaMode ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return undefined;
    }

    let closed = false;
    const applyDiagnosticsPayload = (payload) => {
      if (closed) return;
      const serverSummary = buildMemoryPressureServerSummaryFromDiagnostics(payload);
      if (!serverSummary) return;

      const current = getMemoryPressureSnapshot();
      const merged = mergeMemoryPressureRuntimeState(current, serverSummary);
      const snapshot = {
        ...merged,
        reducedMotionEnabled: prefersReducedMotion(),
        measurement: current.measurement,
        server: serverSummary,
        diagnosticsMerged: true,
        observedAt:
          current.observedAt ||
          serverSummary.observedAt ||
          new Date().toISOString(),
      };
      latestRef.current = snapshot;
      setMemoryPressureSnapshot(snapshot);
    };

    const unsubscribe = subscribeDiagnosticsStream(({ type, payload }) => {
      if (type === "snapshot") applyDiagnosticsPayload(payload);
    });

    return () => {
      closed = true;
      unsubscribe();
    };
  }, [safeQaMode, serverDiagnosticsEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    let cancelled = false;
    let timeoutId = null;
    const streamDiagnosticsAvailable =
      serverDiagnosticsEnabled &&
      !safeQaMode &&
      typeof window !== "undefined" &&
      typeof window.EventSource !== "undefined";

    const sample = async () => {
      const measurement = await readBrowserMemoryMeasurement();
      if (cancelled) {
        return;
      }

      let serverSummary =
        serverDiagnosticsEnabled ||
        latestRef.current.server?.origin === "response-header" ||
        latestRef.current.server?.sourceQuality === "response-header"
          ? latestRef.current.server || null
          : null;
      const now = Date.now();
      const currentLevel = latestRef.current.level || "normal";
      if (
        serverDiagnosticsEnabled &&
        !streamDiagnosticsAvailable &&
        !safeQaMode &&
        now >= nextServerRefreshAtRef.current
      ) {
        nextServerRefreshAtRef.current =
          now +
          jitterMs(
            SERVER_INTERVALS_MS[currentLevel] || SERVER_INTERVALS_MS.normal,
          );
        try {
          const diagnosticsPayload = await readLatestDiagnosticsSnapshot();
          if (!cancelled) {
            serverSummary =
              buildMemoryPressureServerSummaryFromDiagnostics(
                diagnosticsPayload,
              );
          }
        } catch {}
      }

      const queryDiagnostics = readQueryDiagnostics();
      const currentWorkloadStats = workloadStatsRef.current;
      const kindCounts = currentWorkloadStats.kindCounts || {};
      const chartStats = getChartHydrationStatsSnapshot();
      const { browserMemoryMb, browserMemoryLimitMb } =
        browserMemoryFromMeasurement(measurement);
      const storeEntryCount =
        getActiveChartBarStoreEntryCount() +
        getMarketFlowStoreEntryCount() +
        getTradeFlowStoreEntryCount() +
        getTradeOptionChainStoreEntryCount() +
        getRuntimeTickerStoreEntryCount() +
        getOptionQuoteSnapshotCacheSize();

      const next = buildMemoryPressureState(
        {
          observedAt: new Date().toISOString(),
          browserMemoryMb,
          browserMemoryLimitMb,
          browserSource: measurement.memory?.source,
          sourceQuality: measurement.memory?.confidence,
          apiHeapUsedPercent:
            serverSummary?.apiHeapUsedPercent ?? serverSummary?.heapUsedPercent,
          activeWorkloadCount: currentWorkloadStats.activeCount,
          pollCount: kindCounts.poll || 0,
          streamCount: kindCounts.stream || 0,
          chartScopeCount: chartStats.activeScopeCount ?? 0,
          prependScopeCount: chartStats.prependingScopeCount ?? 0,
          queryCount: Number(queryDiagnostics?.queryCount) || 0,
          heavyQueryCount: Number(queryDiagnostics?.heavyQueryCount) || 0,
          storeEntryCount,
        },
        {
          previousState: latestRef.current,
          history: historyRef.current,
        },
      );

      const mergedNext = mergeMemoryPressureRuntimeState(next, serverSummary);

      const snapshot = {
        ...mergedNext,
        reducedMotionEnabled: prefersReducedMotion(),
        measurement,
        server: serverSummary,
        diagnosticsMerged: serverSummary?.origin === "diagnostics",
      };

      historyRef.current = [
        ...historyRef.current.slice(-5),
        { score: mergedNext.score, level: mergedNext.level },
      ];
      latestRef.current = snapshot;
      setMemoryPressureSnapshot(snapshot);

      if (!cancelled) {
        timeoutId = window.setTimeout(
          sample,
          jitterMs(
            SAMPLE_INTERVALS_MS[mergedNext.level] || SAMPLE_INTERVALS_MS.normal,
          ),
        );
      }
    };

    sample();
    return () => {
      cancelled = true;
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [safeQaMode, serverDiagnosticsEnabled]);

  return useMemoryPressureSnapshot(true);
};
