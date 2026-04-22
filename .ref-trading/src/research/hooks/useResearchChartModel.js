import { useEffect, useMemo, useRef, useState } from "react";
import { clearRuntimeActivity, upsertRuntimeActivity } from "../../lib/runtimeDiagnostics.js";
import { deriveChartTfMin } from "../chart/displayModel.js";
import {
  resolveAutoTimeframeByRange,
  resolveOverlayTimeframeSelection,
} from "../chart/timeframeModel.js";
import { buildResearchChartModel } from "../chart/researchChartModelCore.js";
import { resolveResearchChartSourceSlice, shouldPreferSyncResearchChartModel, shouldUseDailyBarsOnly } from "../chart/researchChartModelWindow.js";
import { INDICATOR_REGISTRY } from "../chart/indicatorRegistry.js";
import {
  normalizeResearchStrategy,
} from "../config/strategyPresets.js";
import { formatMarketTimestamp } from "../market/time.js";

const EMPTY_CHART_MODEL = {
  chartBars: [],
  chartBarRanges: [],
  defaultVisibleLogicalRange: null,
  tradeOverlays: [],
  entriesByBarIndex: {},
  exitsByBarIndex: {},
  tradeResolutionStats: {
    entry: { exact: 0, boundarySnap: 0, unresolved: 0 },
    exit: { exact: 0, boundarySnap: 0, unresolved: 0 },
    totalBoundarySnapCount: 0,
    totalUnresolvedCount: 0,
  },
  overlayFallbackCount: 0,
  indicatorEvents: [],
  indicatorZones: [],
  indicatorWindows: [],
  indicatorOverlayFallbackCount: 0,
  indicatorMarkerPayload: {
    overviewMarkers: [],
    markersByTradeId: {},
    timeToTradeIds: new Map(),
  },
  studyVisibility: Object.fromEntries(INDICATOR_REGISTRY.map((indicator) => [indicator.id, false])),
  studySpecs: [],
  smcMarkers: [],
  lowerPaneCount: 0,
  tradeMarkerGroups: {
    entryGroups: [],
    exitGroups: [],
    timeToTradeIds: new Map(),
  },
  debugPerf: null,
};
const EMPTY_MODEL_RUNTIME = {
  status: "idle",
  path: null,
  totalMs: 0,
  message: null,
};
const RESEARCH_CHART_MODEL_ACTIVITY_ID = "research.backtest.chart-model";

export function useResearchBarModel({
  liveBars,
  dailyBars,
  dataSource,
  dataError,
  hasLoadedSpotHistory,
  spotDataMeta,
} = {}) {
  const bars = useMemo(() => {
    if (Array.isArray(liveBars) && liveBars.length > 0) {
      return liveBars;
    }
    return [];
  }, [liveBars]);

  const chartDataStamp = useMemo(() => {
    const lastBar = bars[bars.length - 1];
    if (!lastBar) {
      return null;
    }
    if (lastBar.ts) {
      return lastBar.ts;
    }
    return Number.isFinite(Number(lastBar.time)) ? formatMarketTimestamp(Number(lastBar.time)) : null;
  }, [bars]);

  const chartSourceLabel = useMemo(() => {
    if (Array.isArray(liveBars) && liveBars.length > 0) {
      const sourceText =
        dataSource === "massive"
          ? "Massive"
          : dataSource === "market"
            ? "Broker"
            : dataSource === "loading"
              ? "Refreshing"
              : dataSource === "error"
                ? "Unavailable"
                : "Bars";
      return chartDataStamp ? `${sourceText} · ${chartDataStamp}` : sourceText;
    }
    if (dataSource === "loading") {
      return "Loading market bars...";
    }
    if (dataSource === "error") {
      return "No real spot bars";
    }
    return chartDataStamp ? `Bars · ${chartDataStamp}` : "Bars unavailable";
  }, [chartDataStamp, dataSource, liveBars]);

  const chartEmptyStateLabel = useMemo(() => {
    if (dataSource === "error") {
      return dataError || "Spot history unavailable.";
    }
    if (dataSource === "loading") {
      return "Loading market bars...";
    }
    return "No chart data.";
  }, [dataError, dataSource]);

  const spotStatus = useMemo(() => {
    if (dataSource === "loading") {
      return {
        label: hasLoadedSpotHistory ? "… Refresh" : "… Loading",
        title: "Refreshing server-backed market history.",
        background: "#eff6ff",
        color: "#1d4ed8",
        border: "#bfdbfe",
      };
    }
    if (dataSource === "massive") {
      const sourceLabel = spotDataMeta?.source || "massive-equity-history";
      return {
        label: "● Massive",
        title: `${sourceLabel}${spotDataMeta?.stale ? " (cached/stale)" : ""}`,
        background: "#ecfeff",
        color: "#0f766e",
        border: "#99f6e4",
      };
    }
    if (dataSource === "market") {
      const sourceLabel = spotDataMeta?.source || "broker-market-bars";
      return {
        label: "● Broker",
        title: `${sourceLabel}${spotDataMeta?.stale ? " (cached/stale)" : ""}`,
        background: "#ecfdf5",
        color: "#059669",
        border: "#a7f3d0",
      };
    }
    if (dataSource === "error") {
      return {
        label: "! Error",
        title: dataError || "Failed to load real spot history.",
        background: "#fef2f2",
        color: "#dc2626",
        border: "#fecaca",
      };
    }
    return {
      label: "… Idle",
      title: "Waiting for real market history.",
      background: "#f8fafc",
      color: "#64748b",
      border: "#cbd5e1",
    };
  }, [dataError, dataSource, hasLoadedSpotHistory, spotDataMeta]);

  const tfMin = useMemo(() => deriveChartTfMin(bars), [bars]);

  return {
    bars,
    dailyBars,
    chartSourceLabel,
    chartEmptyStateLabel,
    spotStatus,
    tfMin,
  };
}

export function useResearchChartModel({
  bars,
  dailyBars,
  chartRange,
  chartWindowMode = "default",
  candleTf,
  strategy,
  executionMode,
  trades,
  indicatorOverlayTape,
  indicatorOverlayTapesByTf = null,
  signalTimeframe = "follow_chart",
  shadingTimeframe = "follow_chart",
  autoTimeBounds = null,
  viewportTimeBounds = null,
  indicatorSelections = [],
  rayalgoSettings = null,
  selectedTrade = null,
  isActive = true,
} = {}) {
  const normalizedStrategy = useMemo(
    () => normalizeResearchStrategy(strategy),
    [strategy],
  );
  const tfMin = useMemo(() => deriveChartTfMin(bars || []), [bars]);
  const effectiveTf = useMemo(() => {
    if (candleTf !== "auto") {
      return candleTf;
    }
    return resolveAutoTimeframeByRange(chartRange);
  }, [candleTf, chartRange]);
  const signalTimeframeState = useMemo(
    () => resolveOverlayTimeframeSelection(signalTimeframe, effectiveTf, tfMin),
    [effectiveTf, signalTimeframe, tfMin],
  );
  const shadingTimeframeState = useMemo(
    () => resolveOverlayTimeframeSelection(shadingTimeframe, effectiveTf, tfMin),
    [effectiveTf, shadingTimeframe, tfMin],
  );
  const resolvedSignalTf = signalTimeframeState.effective;
  const resolvedShadingTf = shadingTimeframeState.effective;
  const resolvedIndicatorEventTape = useMemo(() => {
    if (resolvedSignalTf && indicatorOverlayTapesByTf?.[resolvedSignalTf]) {
      return indicatorOverlayTapesByTf[resolvedSignalTf];
    }
    return indicatorOverlayTape;
  }, [indicatorOverlayTape, indicatorOverlayTapesByTf, resolvedSignalTf]);
  const resolvedIndicatorWindowTape = useMemo(() => {
    if (resolvedShadingTf && indicatorOverlayTapesByTf?.[resolvedShadingTf]) {
      return indicatorOverlayTapesByTf[resolvedShadingTf];
    }
    return resolvedIndicatorEventTape;
  }, [indicatorOverlayTapesByTf, resolvedIndicatorEventTape, resolvedShadingTf]);
  const sourceSlice = useMemo(() => resolveResearchChartSourceSlice({
    bars,
    chartRange,
    chartWindowMode,
    effectiveTf,
    tfMin,
    viewportTimeBounds,
    autoTimeBounds,
    selectedTrade,
  }), [autoTimeBounds, bars, chartRange, chartWindowMode, effectiveTf, selectedTrade, tfMin, viewportTimeBounds]);
  const useDailyOnly = useMemo(
    () => shouldUseDailyBarsOnly({ effectiveTf, dailyBars }),
    [dailyBars, effectiveTf],
  );
  const modelBars = useMemo(() => {
    if (useDailyOnly) {
      return [];
    }
    const sourceBars = Array.isArray(bars) ? bars : [];
    if (!sourceBars.length) {
      return [];
    }
    const startIndex = Number(sourceSlice?.startIndex);
    const endIndex = Number(sourceSlice?.endIndex);
    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || endIndex < startIndex) {
      return [];
    }
    if (startIndex === 0 && endIndex === sourceBars.length - 1) {
      return sourceBars;
    }
    return sourceBars.slice(startIndex, endIndex + 1);
  }, [bars, sourceSlice?.endIndex, sourceSlice?.startIndex, useDailyOnly]);
  const modelDailyBars = useMemo(
    () => (Array.isArray(dailyBars) ? dailyBars : []),
    [dailyBars],
  );
  const preferSyncModel = useMemo(
    () => shouldPreferSyncResearchChartModel({ chartWindowMode, modelBars }),
    [chartWindowMode, modelBars],
  );
  const workerRef = useRef(null);
  const requestIdRef = useRef(0);
  const [modelState, setModelState] = useState(EMPTY_CHART_MODEL);
  const [modelRuntime, setModelRuntime] = useState(EMPTY_MODEL_RUNTIME);

  useEffect(() => {
    if (!isActive || typeof Worker === "undefined") {
      const worker = workerRef.current;
      workerRef.current = null;
      if (worker) {
        worker.terminate();
      }
      return undefined;
    }
    const worker = new Worker(new URL("../chart/researchChartModelWorker.js", import.meta.url), { type: "module" });
    workerRef.current = worker;
    return () => {
      workerRef.current = null;
      worker.terminate();
    };
  }, [isActive]);

  useEffect(() => {
    if (!isActive) {
      requestIdRef.current += 1;
      setModelState(EMPTY_CHART_MODEL);
      setModelRuntime(EMPTY_MODEL_RUNTIME);
      clearRuntimeActivity(RESEARCH_CHART_MODEL_ACTIVITY_ID);
      return;
    }

    const hasModelBars = Array.isArray(modelBars) && modelBars.length > 0;
    const hasModelDailyBars = Array.isArray(modelDailyBars) && modelDailyBars.length > 0;
    if (!hasModelBars && !hasModelDailyBars) {
      requestIdRef.current += 1;
      setModelState(EMPTY_CHART_MODEL);
      setModelRuntime(EMPTY_MODEL_RUNTIME);
      clearRuntimeActivity(RESEARCH_CHART_MODEL_ACTIVITY_ID);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const payload = {
      bars: modelBars,
      dailyBars: modelDailyBars,
      chartRange,
      chartWindowMode,
      effectiveTf,
      tfMin,
      strategy: normalizedStrategy,
      executionMode,
      chartPriceContext: "spot",
      trades,
      indicatorOverlayTape: resolvedIndicatorEventTape,
      indicatorWindowTape: resolvedIndicatorWindowTape,
      indicatorSelections,
      rayalgoSettings,
    };
    const worker = preferSyncModel ? null : workerRef.current;
    upsertRuntimeActivity(RESEARCH_CHART_MODEL_ACTIVITY_ID, {
      kind: "research-compute",
      label: "Research chart model",
      surface: "research-backtest",
      meta: {
        phase: "building",
        requestId,
        strategy: normalizedStrategy,
        effectiveTf,
        chartWindowMode,
        modelBars: modelBars.length,
        modelDailyBars: modelDailyBars.length,
        path: worker ? "worker" : (preferSyncModel ? "sync-large-all-candles" : "sync"),
      },
    });

    if (!worker) {
      const syncModel = buildResearchChartModel(payload);
      const syncModelTotalMs = Number(syncModel?.debugPerf?.totalMs) || 0;
      const syncModelIsDegraded = syncModelTotalMs >= 64;
      setModelState(syncModel);
      setModelRuntime({
        status: syncModelIsDegraded ? "degraded" : "ok",
        path: preferSyncModel ? "sync-large-all-candles" : "sync",
        totalMs: syncModelTotalMs,
        message: syncModelIsDegraded
          ? (preferSyncModel
            ? "All-candles mode is using synchronous chart generation to reduce memory pressure."
            : "Chart model fell back to synchronous generation.")
          : null,
      });
      upsertRuntimeActivity(RESEARCH_CHART_MODEL_ACTIVITY_ID, {
        kind: "research-compute",
        label: "Research chart model",
        surface: "research-backtest",
        meta: {
          phase: "ready",
          requestId,
          strategy: normalizedStrategy,
          effectiveTf,
          chartWindowMode,
          modelBars: modelBars.length,
          path: preferSyncModel ? "sync-large-all-candles" : "sync",
          totalMs: syncModelTotalMs,
          degraded: syncModelIsDegraded,
        },
      });
      if (import.meta.env.DEV && syncModel?.debugPerf?.totalMs >= 16) {
        console.debug("[ResearchChart] sync model build", syncModel.debugPerf);
      }
      return;
    }

    const handleMessage = (event) => {
      const message = event?.data || {};
      if (Number(message?.requestId) !== requestIdRef.current) {
        return;
      }
      if (!message?.ok) {
        console.error("[ResearchChart] worker model build failed:", message?.error || "Unknown error");
        const fallbackModel = buildResearchChartModel(payload);
        setModelState(fallbackModel);
        setModelRuntime({
          status: "degraded",
          path: "fallback-sync",
          totalMs: Number(fallbackModel?.debugPerf?.totalMs) || 0,
          message: message?.error || "Chart model worker failed and fell back to sync generation.",
        });
        upsertRuntimeActivity(RESEARCH_CHART_MODEL_ACTIVITY_ID, {
          kind: "research-compute",
          label: "Research chart model",
          surface: "research-backtest",
          meta: {
            phase: "fallback-sync",
            requestId,
            strategy: normalizedStrategy,
            effectiveTf,
            chartWindowMode,
            modelBars: modelBars.length,
            totalMs: Number(fallbackModel?.debugPerf?.totalMs) || 0,
            error: message?.error || "Worker model build failed.",
          },
        });
        return;
      }
      setModelState(message.model || EMPTY_CHART_MODEL);
      const workerTotalMs = Number(message?.model?.debugPerf?.totalMs) || 0;
      const workerDegraded = workerTotalMs >= 120;
      setModelRuntime({
        status: workerDegraded ? "degraded" : "ok",
        path: "worker",
        totalMs: workerTotalMs,
        message: workerDegraded
          ? "Chart model worker is taking longer than normal."
          : null,
      });
      upsertRuntimeActivity(RESEARCH_CHART_MODEL_ACTIVITY_ID, {
        kind: "research-compute",
        label: "Research chart model",
        surface: "research-backtest",
        meta: {
          phase: "ready",
          requestId,
          strategy: normalizedStrategy,
          effectiveTf,
          chartWindowMode,
          modelBars: modelBars.length,
          path: "worker",
          totalMs: workerTotalMs,
          degraded: workerDegraded,
        },
      });
      if (import.meta.env.DEV && message?.model?.debugPerf?.totalMs >= 16) {
        console.debug("[ResearchChart] worker model build", message.model.debugPerf);
      }
    };

    const handleError = (error) => {
      if (requestId !== requestIdRef.current) {
        return;
      }
      console.error("[ResearchChart] worker crashed, falling back to sync model build:", error);
      const fallbackModel = buildResearchChartModel(payload);
      setModelState(fallbackModel);
      setModelRuntime({
        status: "degraded",
        path: "fallback-sync",
        totalMs: Number(fallbackModel?.debugPerf?.totalMs) || 0,
        message: error?.message || "Chart model worker crashed and fell back to sync generation.",
      });
      upsertRuntimeActivity(RESEARCH_CHART_MODEL_ACTIVITY_ID, {
        kind: "research-compute",
        label: "Research chart model",
        surface: "research-backtest",
        meta: {
          phase: "worker-error",
          requestId,
          strategy: normalizedStrategy,
          effectiveTf,
          chartWindowMode,
          modelBars: modelBars.length,
          totalMs: Number(fallbackModel?.debugPerf?.totalMs) || 0,
          error: error?.message || "Chart model worker crashed.",
        },
      });
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    worker.postMessage({
      requestId,
      ...payload,
    });

    return () => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
    };
  }, [
    chartRange,
    chartWindowMode,
    effectiveTf,
    executionMode,
    isActive,
    modelBars,
    modelDailyBars,
    normalizedStrategy,
    preferSyncModel,
    resolvedIndicatorEventTape,
    resolvedIndicatorWindowTape,
    tfMin,
    trades,
    indicatorSelections,
    rayalgoSettings,
  ]);

  useEffect(() => () => clearRuntimeActivity(RESEARCH_CHART_MODEL_ACTIVITY_ID), []);

  return {
    effectiveTf,
    signalTf: resolvedSignalTf,
    shadingTf: resolvedShadingTf,
    signalTimeframeState,
    shadingTimeframeState,
    chartBars: modelState.chartBars,
    chartBarRanges: modelState.chartBarRanges,
    defaultVisibleLogicalRange: modelState.defaultVisibleLogicalRange,
    tradeOverlays: modelState.tradeOverlays,
    entriesByBarIndex: modelState.entriesByBarIndex,
    exitsByBarIndex: modelState.exitsByBarIndex,
    tradeResolutionStats: modelState.tradeResolutionStats,
    overlayFallbackCount: modelState.overlayFallbackCount,
    indicatorEvents: modelState.indicatorEvents,
    indicatorZones: modelState.indicatorZones,
    indicatorWindows: modelState.indicatorWindows,
    indicatorOverlayFallbackCount: modelState.indicatorOverlayFallbackCount,
    indicatorMarkerPayload: modelState.indicatorMarkerPayload,
    studyVisibility: modelState.studyVisibility,
    studySpecs: modelState.studySpecs,
    smcMarkers: modelState.smcMarkers,
    studyLowerPaneCount: modelState.lowerPaneCount,
    tradeMarkerGroups: modelState.tradeMarkerGroups,
    debugPerf: modelState.debugPerf,
    runtimeHealth: modelRuntime,
  };
}
