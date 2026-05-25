import {
  sanitizeChartHydrationStatsForDiagnostics,
} from "../charting/chartHydrationStats";
import {
  getBrokerStockAggregateDebugStats,
} from "../charting/useMassiveStockAggregateStream";

const readPerformanceMemory = () => {
  if (typeof performance === "undefined" || !performance.memory) {
    return null;
  }

  return {
    source: "performance.memory",
    confidence: "medium",
    usedJsHeapSize: performance.memory.usedJSHeapSize ?? null,
    totalJsHeapSize: performance.memory.totalJSHeapSize ?? null,
    jsHeapSizeLimit: performance.memory.jsHeapSizeLimit ?? null,
  };
};

export async function readBrowserMemoryMeasurement() {
  const isolation = {
    crossOriginIsolated: Boolean(window.crossOriginIsolated),
    memoryApiAvailable:
      typeof performance.measureUserAgentSpecificMemory === "function",
    memoryApiUsed: false,
    userAgent: navigator.userAgent,
  };

  let memory = { source: "heuristic", confidence: "low" };
  try {
    if (
      window.crossOriginIsolated &&
      typeof performance.measureUserAgentSpecificMemory === "function"
    ) {
      const measured = await performance.measureUserAgentSpecificMemory();
      memory = {
        source: "measureUserAgentSpecificMemory",
        confidence: "high",
        bytes: measured?.bytes ?? null,
        breakdownCount: Array.isArray(measured?.breakdown)
          ? measured.breakdown.length
          : 0,
      };
      isolation.memoryApiUsed = true;
    } else {
      memory = readPerformanceMemory() || memory;
    }
  } catch (error) {
    memory = {
      ...memory,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    memory,
    isolation,
  };
}

export async function collectBrowserResourceMetrics({
  workloadStats,
  hydrationCoordinatorStats,
  chartStats,
  optionState,
  memoryPressureState = null,
}) {
  const sampled =
    memoryPressureState?.measurement &&
    memoryPressureState?.measurement?.memory &&
    memoryPressureState?.measurement?.isolation
      ? memoryPressureState.measurement
      : await readBrowserMemoryMeasurement();
  const storageEstimate =
    navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  const cacheNames = window.caches?.keys ? await window.caches.keys().catch(() => []) : [];

  return {
    chartHydration: sanitizeChartHydrationStatsForDiagnostics(chartStats),
    memory: sampled.memory,
    isolation: sampled.isolation,
    memoryPressure: memoryPressureState
      ? {
          level: memoryPressureState.level,
          score: memoryPressureState.score,
          trend: memoryPressureState.trend,
          sourceQuality: memoryPressureState.sourceQuality,
          browserMemoryMb: memoryPressureState.browserMemoryMb,
          browserSource: memoryPressureState.browserSource,
          apiHeapUsedPercent: memoryPressureState.apiHeapUsedPercent,
          dominantDrivers: memoryPressureState.dominantDrivers,
          observedAt: memoryPressureState.observedAt,
        }
      : null,
    workload: {
      workloadStats,
      aggregateStream: getBrokerStockAggregateDebugStats(),
      hydrationCoordinatorStats,
      chartScopeCount: chartStats.activeScopeCount ?? chartStats.scopes.length,
      optionSession: {
        ticker: optionState.ticker,
        expiration: optionState.expiration,
        wsState: optionState.wsState,
        degraded: optionState.degraded,
      },
    },
    storage: {
      estimate: storageEstimate,
      cacheNames,
    },
    caches: {
      cacheNameCount: cacheNames.length,
    },
  };
}
