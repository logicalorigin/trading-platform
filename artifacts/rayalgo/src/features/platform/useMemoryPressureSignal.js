import { useEffect, useRef } from "react";
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
import { platformJsonRequest } from "./platformJsonRequest";
import { usePageVisible } from "./usePageVisible";
import { getTradeFlowStoreEntryCount } from "./tradeFlowStore";
import { getTradeOptionChainStoreEntryCount } from "./tradeOptionChainStore";
import { getRuntimeWorkloadStats } from "./workloadStats";

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

const jitterMs = (baseMs) => {
  const variance = Math.round(baseMs * 0.12);
  const delta = Math.round((Math.random() * variance * 2) - variance);
  return Math.max(2_500, baseMs + delta);
};

const readResourceSnapshot = (payload) =>
  payload?.snapshots?.find?.((entry) => entry?.subsystem === "resource-pressure") ||
  null;

const readQueryDiagnostics = () => {
  try {
    return window.__RAYALGO_MEMORY_DIAGNOSTICS__?.() || null;
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
  const historyRef = useRef([]);
  const latestRef = useRef(getMemoryPressureSnapshot());
  const nextServerRefreshAtRef = useRef(0);

  useEffect(() => {
    if (!pageVisible || typeof window === "undefined") {
      return undefined;
    }

    let cancelled = false;
    let timeoutId = null;

    const sample = async () => {
      const measurement = await readBrowserMemoryMeasurement();
      if (cancelled) {
        return;
      }

      let serverSummary = latestRef.current.server || null;
      const now = Date.now();
      const currentLevel = latestRef.current.level || "normal";
      if (now >= nextServerRefreshAtRef.current) {
        nextServerRefreshAtRef.current =
          now + jitterMs(SERVER_INTERVALS_MS[currentLevel] || SERVER_INTERVALS_MS.normal);
        try {
          const diagnosticsPayload = await platformJsonRequest("/api/diagnostics/latest", {
            timeoutMs: 4_000,
          });
          if (!cancelled) {
            const resourceSnapshot = readResourceSnapshot(diagnosticsPayload);
            serverSummary =
              diagnosticsPayload?.footerMemoryPressure || resourceSnapshot?.metrics || null;
          }
        } catch {}
      }

      const queryDiagnostics = readQueryDiagnostics();
      const workloadStats = getRuntimeWorkloadStats();
      const kindCounts = workloadStats.kindCounts || {};
      const chartStats = getChartHydrationStatsSnapshot();
      const browserMemoryMb =
        Number.isFinite(Number(measurement.memory?.bytes))
          ? Number(measurement.memory.bytes) / 1024 / 1024
          : Number.isFinite(Number(measurement.memory?.usedJsHeapSize))
            ? Number(measurement.memory.usedJsHeapSize) / 1024 / 1024
            : null;
      const storeEntryCount =
        getActiveChartBarStoreEntryCount() +
        getMarketFlowStoreEntryCount() +
        getTradeFlowStoreEntryCount() +
        getTradeOptionChainStoreEntryCount();

      const next = buildMemoryPressureState(
        {
          observedAt: new Date().toISOString(),
          browserMemoryMb,
          browserSource: measurement.memory?.source,
          sourceQuality: measurement.memory?.confidence,
          apiHeapUsedPercent: serverSummary?.apiHeapUsedPercent ?? serverSummary?.heapUsedPercent,
          activeWorkloadCount: workloadStats.activeCount,
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

      const mergedNext = {
        ...next,
        level:
          serverSummary?.level &&
          isPressureLevelAtLeast(serverSummary.level, next.level)
            ? serverSummary.level
            : next.level,
        browserMemoryMb:
          next.browserMemoryMb ?? serverSummary?.browserMemoryMb ?? null,
        apiHeapUsedPercent:
          next.apiHeapUsedPercent ?? serverSummary?.apiHeapUsedPercent ?? null,
        sourceQuality:
          next.sourceQuality === "low" && serverSummary?.sourceQuality
            ? serverSummary.sourceQuality
            : next.sourceQuality,
      };

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
  }, [pageVisible]);

  return useMemoryPressureSnapshot(true);
};
