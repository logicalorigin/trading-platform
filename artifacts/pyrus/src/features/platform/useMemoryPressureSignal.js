import { useEffect, useRef } from "react";
import { getLatestDiagnostics } from "@workspace/api-client-react";
import { isPyrusSafeQaMode } from "../../app/qa-mode";
import { getActiveChartBarStoreEntryCount } from "../charting/activeChartBarStore";
import { getChartHydrationStatsSnapshot } from "../charting/chartHydrationStats";
import { readBrowserMemoryMeasurement } from "./memoryPressureClient";
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
import { usePageVisible } from "./usePageVisible";
import { getTradeFlowStoreEntryCount } from "./tradeFlowStore";
import { getTradeOptionChainStoreEntryCount } from "./tradeOptionChainStore";
import { useRuntimeWorkloadStats } from "./workloadStats";

const SAMPLE_INTERVALS_MS = {
  normal: 15_000,
  watch: 12_000,
  high: 5_000,
  critical: 5_000,
};

const SERVER_INTERVALS_MS = {
  normal: 30_000,
  watch: 20_000,
  high: 15_000,
  critical: 15_000,
};

const API_PRESSURE_EVENT = "pyrus:api-pressure";
const API_PRESSURE_HEADER_HOLD_MS = 15_000;
const DIAGNOSTICS_STREAM_URL = "/api/diagnostics/stream";
const SERVER_PRESSURE_LEVELS = new Set(["normal", "watch", "high", "critical"]);

const jitterMs = (baseMs) => {
  const variance = Math.round(baseMs * 0.12);
  const delta = Math.round((Math.random() * variance * 2) - variance);
  return Math.max(2_500, baseMs + delta);
};

const readResourceSnapshot = (payload) =>
  payload?.snapshots?.find?.((entry) => entry?.subsystem === "resource-pressure") ||
  null;

const normalizeServerPressureLevel = (summary) =>
  summary?.pressureLevel || summary?.level || null;

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
  [...memoryPressureDrivers(serverDrivers), ...clientDrivers].forEach((driver) => {
    const kind = driver?.kind;
    if (!kind || seen.has(kind)) return;
    seen.add(kind);
    next.push(driver);
  });
  return next;
};

export const mergeMemoryPressureServerSummary = ({
  footerMemoryPressure = null,
  resourceMetrics = null,
} = {}) => {
  if (!footerMemoryPressure && !resourceMetrics) {
    return null;
  }
  const footerDrivers = memoryPressureDrivers(serverPressureDrivers(footerMemoryPressure));
  const resourceDrivers = memoryPressureDrivers(serverPressureDrivers(resourceMetrics));
  const resourceMemoryLevel = maxMemoryPressureDriverLevel(resourceDrivers);
  if (!footerMemoryPressure) {
    return {
      ...resourceMetrics,
      level: resourceMemoryLevel || "normal",
      pressureDrivers: resourceDrivers,
      dominantDrivers: resourceDrivers,
    };
  }
  if (!resourceMetrics) {
    return {
      ...footerMemoryPressure,
      pressureDrivers: footerDrivers,
      dominantDrivers: footerDrivers,
    };
  }

  const footerLevel = normalizeServerPressureLevel(footerMemoryPressure) || "normal";
  const resourceLevel = resourceMemoryLevel;
  const level =
    resourceLevel && isPressureLevelAtLeast(resourceLevel, footerLevel)
      ? resourceLevel
      : footerLevel;
  const pressureDrivers = resourceDrivers.length ? resourceDrivers : footerDrivers;

  return {
    ...footerMemoryPressure,
    ...resourceMetrics,
    level,
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
      footerMemoryPressure.browserMemoryMb ?? resourceMetrics.browserMemoryMb ?? null,
    browserMemoryLimitMb:
      footerMemoryPressure.browserMemoryLimitMb ??
      resourceMetrics.browserMemoryLimitMb ??
      null,
    sourceQuality:
      footerMemoryPressure.sourceQuality ?? resourceMetrics.sourceQuality ?? null,
    pressureDrivers,
    dominantDrivers: pressureDrivers,
  };
};

export const mergeMemoryPressureRuntimeState = (clientState, serverSummary) => {
  if (!serverSummary) {
    return clientState;
  }
  const clientLevel = clientState?.level || "normal";
  const serverDrivers = memoryPressureDrivers(serverPressureDrivers(serverSummary));
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
      clientState?.browserMemoryLimitMb ?? serverSummary.browserMemoryLimitMb ?? null,
    apiHeapUsedPercent:
      clientState?.apiHeapUsedPercent ?? serverSummary.apiHeapUsedPercent ?? null,
    apiRssMb:
      serverSummary.apiRssMb ??
      serverSummary.rssMb ??
      serverSummary.apiResourcePressure?.inputs?.rssMb ??
      null,
    apiRssThresholds: serverSummary.apiRssThresholds ?? clientState?.apiRssThresholds ?? null,
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
      : clientState?.dominantDrivers ?? [],
  };
};

export const buildResponseHeaderPressureSummary = (detail = {}, current = null) => {
  const pressureLevel = normalizePressureHeaderLevel(detail.pressureLevel);
  if (!pressureLevel) {
    return current;
  }
  const currentLevel = normalizePressureHeaderLevel(current?.level);
  const currentEffectiveLevel = normalizePressureHeaderLevel(
    current?.effectivePressureLevel || current?.apiPressureLevel || current?.pressureLevel,
  );
  const observedAt = detail.observedAt || new Date().toISOString();
  const observedAtMs = Date.parse(observedAt);
  const currentObservedAtMs = Date.parse(current?.observedAt || "");
  const holdCurrentEffectiveLevel =
    currentEffectiveLevel &&
    Number.isFinite(observedAtMs) &&
    Number.isFinite(currentObservedAtMs) &&
    observedAtMs - currentObservedAtMs <= API_PRESSURE_HEADER_HOLD_MS &&
    isPressureLevelAtLeast(currentEffectiveLevel, pressureLevel);
  const effectivePressureLevel = holdCurrentEffectiveLevel
    ? currentEffectiveLevel
    : pressureLevel;

  return {
    ...(current || {}),
    level:
      currentLevel && isPressureLevelAtLeast(currentLevel, effectivePressureLevel)
        ? currentLevel
        : effectivePressureLevel,
    pressureLevel: effectivePressureLevel,
    apiPressureLevel: effectivePressureLevel,
    effectivePressureLevel,
    lastHeaderPressureLevel: pressureLevel,
    sourceQuality: "response-header",
    admissionAction: detail.admissionAction || current?.admissionAction || null,
    admissionReason: detail.admissionReason || current?.admissionReason || null,
    lastHeaderStatus:
      Number.isFinite(Number(detail.status))
        ? Number(detail.status)
        : current?.lastHeaderStatus ?? null,
    lastHeaderMethod: detail.method || current?.lastHeaderMethod || null,
    lastHeaderUrl: detail.url || current?.lastHeaderUrl || null,
    observedAt,
  };
};

const readLatestDiagnosticsSnapshot = (signal) =>
  getLatestDiagnostics(signal ? { signal } : undefined);

export const buildMemoryPressureServerSummaryFromDiagnostics = (payload) => {
  const resourceSnapshot = readResourceSnapshot(payload);
  return mergeMemoryPressureServerSummary({
    footerMemoryPressure: payload?.footerMemoryPressure || null,
    resourceMetrics: resourceSnapshot?.metrics || null,
  });
};

const readQueryDiagnostics = () => {
  try {
    return (
      window.__PYRUS_MEMORY_DIAGNOSTICS__?.() ||
      window.__PYRUS_MEMORY_DIAGNOSTICS__?.() ||
      null
    );
  } catch {
    return null;
  }
};

const prefersReducedMotion = () =>
  Boolean(
    typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
  );

export const useMemoryPressureMonitor = () => {
  const pageVisible = usePageVisible();
  const safeQaMode = isPyrusSafeQaMode();
  const workloadStats = useRuntimeWorkloadStats(pageVisible);
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
        current.server || null,
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
    return () => window.removeEventListener(API_PRESSURE_EVENT, handleApiPressure);
  }, []);

  useEffect(() => {
    workloadStatsRef.current = workloadStats;
    if (!pageVisible || typeof window === "undefined") {
      return;
    }

    const current = getMemoryPressureSnapshot();
    const kindCounts = workloadStats.kindCounts || {};
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
      reducedMotionEnabled: prefersReducedMotion(),
      measurement: current.measurement,
      server: current.server,
    };
    latestRef.current = snapshot;
    setMemoryPressureSnapshot(snapshot);
  }, [pageVisible, workloadStats]);

  useEffect(() => {
    if (
      !pageVisible ||
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
        observedAt: current.observedAt || serverSummary.observedAt || new Date().toISOString(),
      };
      latestRef.current = snapshot;
      setMemoryPressureSnapshot(snapshot);
    };

    const parseAndApply = (event, readPayload) => {
      try {
        const payload = JSON.parse(event.data);
        applyDiagnosticsPayload(readPayload(payload));
      } catch {
        // EventSource will deliver the next valid snapshot or reconnect.
      }
    };

    const source = new window.EventSource(DIAGNOSTICS_STREAM_URL);
    source.addEventListener("ready", (event) => {
      parseAndApply(event, (payload) => payload?.latest);
    });
    source.addEventListener("snapshot", (event) => {
      parseAndApply(event, (payload) => payload);
    });

    return () => {
      closed = true;
      source.close();
    };
  }, [pageVisible, safeQaMode]);

  useEffect(() => {
    if (!pageVisible || typeof window === "undefined") {
      return undefined;
    }

    let cancelled = false;
    let timeoutId = null;
    const streamDiagnosticsAvailable =
      !safeQaMode &&
      typeof window !== "undefined" &&
      typeof window.EventSource !== "undefined";

    const sample = async () => {
      const measurement = await readBrowserMemoryMeasurement();
      if (cancelled) {
        return;
      }

      let serverSummary = latestRef.current.server || null;
      const now = Date.now();
      const currentLevel = latestRef.current.level || "normal";
      if (!streamDiagnosticsAvailable && !safeQaMode && now >= nextServerRefreshAtRef.current) {
        nextServerRefreshAtRef.current =
          now + jitterMs(SERVER_INTERVALS_MS[currentLevel] || SERVER_INTERVALS_MS.normal);
        try {
          const diagnosticsPayload = await readLatestDiagnosticsSnapshot();
          if (!cancelled) {
            serverSummary =
              buildMemoryPressureServerSummaryFromDiagnostics(diagnosticsPayload);
          }
        } catch {}
      }

      const queryDiagnostics = readQueryDiagnostics();
      const currentWorkloadStats = workloadStatsRef.current;
      const kindCounts = currentWorkloadStats.kindCounts || {};
      const chartStats = getChartHydrationStatsSnapshot();
      const browserMemoryMb =
        Number.isFinite(Number(measurement.memory?.bytes))
          ? Number(measurement.memory.bytes) / 1024 / 1024
          : Number.isFinite(Number(measurement.memory?.usedJsHeapSize))
            ? Number(measurement.memory.usedJsHeapSize) / 1024 / 1024
            : null;
      const browserMemoryLimitMb =
        Number.isFinite(Number(measurement.memory?.jsHeapSizeLimit))
          ? Number(measurement.memory.jsHeapSizeLimit) / 1024 / 1024
          : null;
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
          apiHeapUsedPercent: serverSummary?.apiHeapUsedPercent ?? serverSummary?.heapUsedPercent,
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
  }, [pageVisible, safeQaMode]);

  return useMemoryPressureSnapshot(true);
};
