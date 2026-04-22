import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bookmarkResearchBacktestResult } from "../../lib/brokerClient.js";
import { getStrategyLabel } from "../config/strategyPresets.js";
import { useResearchApiCreds } from "./useResearchApiCreds.js";
import {
  useResearchBarModel,
  useResearchChartModel,
} from "./useResearchChartModel.js";
import { useResearchControls } from "./useResearchControls.js";
import { useResearchExecution } from "./useResearchExecution.js";
import { useRayAlgoWatcher } from "./useRayAlgoWatcher.js";
import { useResearchOptionChart } from "./useResearchOptionChart.js";
import { useResearchOptionReplay } from "./useResearchOptionReplay.js";
import { useResearchRuntimeHealth } from "./useResearchRuntimeHealth.js";
import { useResearchSpotHistory } from "./useResearchSpotHistory.js";
import { getResearchTradeSelectionId } from "../trades/selection.js";
import { getBarTimeMs } from "../market/time.js";
import {
  CHART_WINDOW_MODE_FULL,
  resolveChartWindowDisplayState,
  resolveAutoTimeframeByRange,
  resolveDefaultVisibleRangeForTimeframe,
  resolveRangeDays,
  resolveSignalOverlayTimeframe,
} from "../chart/timeframeModel.js";
import { mergeRayAlgoSettings } from "../config/rayalgoSettings.js";
import {
  listRayAlgoScoringTimeframes,
  normalizeRayAlgoScoringConfig,
} from "../engine/rayalgoScoring.js";
import { compileBacktestV2RuntimeBridge } from "../config/backtestV2RuntimeBridge.js";
import { diffResearchSetupSnapshots } from "../history/setupDiff.js";
import { shouldPreferSyncResearchChartModel } from "../chart/researchChartModelWindow.js";
import {
  buildSpotChartBaseSeriesModeKey,
  buildSpotChartRangePresetKey,
  resolveSpotChartModelWindowMode,
} from "./researchWorkbenchViewModelUtils.js";

const VIEWPORT_LINK_WHEEL_DEFER_MS = 360;
const SPOT_VIEWPORT_MODEL_SETTLE_MS = 420;
const MIN_INITIAL_ONE_MINUTE_HISTORY_DAYS = 45;
const MAX_INITIAL_ONE_MINUTE_HISTORY_DAYS = 60;

function isTradeClosed(trade) {
  return Boolean(String(trade?.et || "").trim());
}

const OPTION_EXECUTION_MODE = "option_history";

function canRenderReplayTrade(trade) {
  return isTradeClosed(trade)
    && Boolean(String(trade?.optionTicker || "").trim())
    && Number.isFinite(Number(trade?.oe));
}

function viewportLinkMatches(left, right) {
  return String(left?.chartId || "") === String(right?.chartId || "")
    && String(left?.source || "") === String(right?.source || "")
    && Number(left?.token) === Number(right?.token)
    && Number(left?.visibleBars) === Number(right?.visibleBars)
    && Number(left?.timeBounds?.startMs) === Number(right?.timeBounds?.startMs)
    && Number(left?.timeBounds?.endMs) === Number(right?.timeBounds?.endMs);
}

function isDeferredViewportLinkSource(source) {
  const normalized = String(source || "").trim().toLowerCase();
  return normalized === "chart-wheel" || normalized === "chart-drag";
}

function createViewportLinkStore() {
  let snapshot = null;
  const listeners = new Set();
  return {
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSnapshot(nextSnapshot) {
      const normalized = nextSnapshot?.timeBounds
        ? {
            chartId: String(nextSnapshot.chartId || ""),
            source: String(nextSnapshot.source || "user"),
            token: Number(nextSnapshot.token) || 0,
            visibleBars: Math.max(0, Number(nextSnapshot.visibleBars) || 0),
            timeBounds: {
              startMs: Number(nextSnapshot.timeBounds.startMs),
              endMs: Number(nextSnapshot.timeBounds.endMs),
            },
          }
        : null;
      if (viewportLinkMatches(snapshot, normalized)) {
        return;
      }
      snapshot = normalized;
      listeners.forEach((listener) => listener());
    },
    reset() {
      if (snapshot == null) {
        return;
      }
      snapshot = null;
      listeners.forEach((listener) => listener());
    },
  };
}

function pickDefaultSelectedTrade(trades = []) {
  const list = Array.isArray(trades) ? trades : [];
  if (!list.length) {
    return null;
  }

  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (canRenderReplayTrade(list[index])) {
      return list[index];
    }
  }

  return list[list.length - 1] || null;
}

function runtimeHealthMatches(left, right) {
  return String(left?.status || "") === String(right?.status || "")
    && String(left?.reason || "") === String(right?.reason || "")
    && String(left?.message || "") === String(right?.message || "")
    && String(left?.baseDataMode || "") === String(right?.baseDataMode || "");
}

function timeBoundsMatch(left, right) {
  return Number(left?.startMs) === Number(right?.startMs)
    && Number(left?.endMs) === Number(right?.endMs);
}

function resolveLoadedHistoryDateWindow(spotDataMeta, liveBars) {
  const coverage = spotDataMeta?.coverage || {};
  const fallbackStart = Array.isArray(liveBars) && liveBars.length ? liveBars[0]?.date : null;
  const fallbackEnd = Array.isArray(liveBars) && liveBars.length ? liveBars[liveBars.length - 1]?.date : null;
  const startDate = String(coverage?.intradayStart || fallbackStart || "").trim();
  const endDate = String(coverage?.intradayEnd || fallbackEnd || "").trim();
  if (!startDate || !endDate) {
    return null;
  }
  return { startDate, endDate };
}

function resolveLoadedTimeBoundsFromBars(bars = [], tfMin = 1) {
  const list = Array.isArray(bars) ? bars : [];
  if (!list.length) {
    return null;
  }
  const firstStartMs = Number(getBarTimeMs(list[0]));
  const lastStartMs = Number(getBarTimeMs(list[list.length - 1]));
  const fallbackTfMin = Math.max(1, Number(tfMin) || 1);
  const lastEndMs = Number.isFinite(lastStartMs)
    ? lastStartMs + (fallbackTfMin * 60 * 1000)
    : Number.NaN;
  if (!Number.isFinite(firstStartMs) || !Number.isFinite(lastEndMs) || lastEndMs <= firstStartMs) {
    return null;
  }
  return {
    startMs: firstStartMs,
    endMs: lastEndMs,
  };
}

export function useResearchWorkbenchViewModel({
  isActive = true,
  navigateToSurface = null,
} = {}) {
  const controls = useResearchControls();
  const [selectedTradeId, setSelectedTradeId] = useState(null);
  const [hoveredTradeId, setHoveredTradeId] = useState(null);
  const [viewportLeaderChartId, setViewportLeaderChartId] = useState("spot");
  const [selectionLinkEvent, setSelectionLinkEvent] = useState({
    token: 0,
    sourceChartId: null,
  });
  const lastAutoSelectedCompletedRunIdRef = useRef(null);
  const lastSavedBacktestRunIdRef = useRef(0);
  const lastArchivedOptimizerRunIdRef = useRef(0);
  const hasRestoredSavedRunRef = useRef(false);
  const pendingRestoreRunRef = useRef(null);
  const [executedBacktestSetupSnapshot, setExecutedBacktestSetupSnapshot] = useState(null);
  const [lastSavedResultId, setLastSavedResultId] = useState(null);
  const [spotChartRuntime, setSpotChartRuntime] = useState(null);
  const [spotAutoTimeBounds, setSpotAutoTimeBounds] = useState(null);
  const [spotViewportTimeBounds, setSpotViewportTimeBounds] = useState(null);
  const [spotVisibleBars, setSpotVisibleBars] = useState(null);
  const [surfaceNotice, setSurfaceNotice] = useState({ token: 0, text: null });
  const viewportSnapshotsRef = useRef({
    spot: null,
    option: null,
  });
  const viewportLinkStoreRef = useRef(null);
  const lastWatcherLeaderSignatureRef = useRef(null);
  const pendingViewportLinkRef = useRef(null);
  const viewportLinkFrameRef = useRef(null);
  const viewportLinkIdleTimerRef = useRef(null);
  const pendingSpotAutoTimeBoundsRef = useRef(null);
  const pendingSpotViewportTimeBoundsRef = useRef(null);
  const pendingSpotVisibleBarsRef = useRef(null);
  const spotAutoTimeBoundsFrameRef = useRef(null);
  const spotAutoTimeBoundsIdleTimerRef = useRef(null);
  const viewportLinkTokenRef = useRef(0);
  const selectedTradeRef = useRef(null);
  const pushSurfaceNotice = useCallback((text) => {
    const normalizedText = String(text || "").trim();
    if (!normalizedText) {
      return;
    }
    setSurfaceNotice((previous) => ({
      token: previous.token + 1,
      text: normalizedText,
    }));
  }, []);
  if (!viewportLinkStoreRef.current) {
    viewportLinkStoreRef.current = createViewportLinkStore();
  }
  const chartsLinked = controls.chartsLinked;
  const requestedSpotChartTf = useMemo(() => {
    if (controls.candleTf !== "auto") {
      return controls.candleTf;
    }
    return resolveAutoTimeframeByRange(controls.chartRange);
  }, [controls.candleTf, controls.chartRange]);
  const predictedSignalTimeframe = useMemo(() => {
    // This early preload prediction runs before barModel exists, so keep it optimistic.
    return resolveSignalOverlayTimeframe(
      controls.indicatorOverlays.signals.timeframe,
      requestedSpotChartTf,
      1,
    ) || "5m";
  }, [controls.indicatorOverlays.signals.timeframe, requestedSpotChartTf]);
  const precursorScoringTimeframes = useMemo(() => {
    if (String(controls.strategy || "").trim().toLowerCase() !== "rayalgo") {
      return [];
    }
    return listRayAlgoScoringTimeframes(normalizeRayAlgoScoringConfig({
      activeTimeframe: predictedSignalTimeframe,
      ...(controls.rayalgoScoringConfig || {}),
    })).filter((timeframe) => String(timeframe || "").trim() !== String(predictedSignalTimeframe || "").trim());
  }, [controls.rayalgoScoringConfig, controls.strategy, predictedSignalTimeframe]);
  const requestedInitialIntradayDays = useMemo(() => {
    const wantsLowIntraday = [
      requestedSpotChartTf,
      predictedSignalTimeframe,
      controls.indicatorOverlays.signals?.timeframe,
      controls.indicatorOverlays.shading?.timeframe,
      ...precursorScoringTimeframes,
    ].some((value) => {
      const normalized = String(value || "").trim().toLowerCase();
      return normalized === "1m" || normalized === "2m";
    });
    if (!wantsLowIntraday) {
      return null;
    }
    const rangeDays = resolveRangeDays(controls.chartRange, 0);
    if (controls.chartWindowMode === "all") {
      return MAX_INITIAL_ONE_MINUTE_HISTORY_DAYS;
    }
    if (!Number.isFinite(rangeDays) || rangeDays <= 0) {
      return MIN_INITIAL_ONE_MINUTE_HISTORY_DAYS;
    }
    return Math.min(
      MAX_INITIAL_ONE_MINUTE_HISTORY_DAYS,
      Math.max(MIN_INITIAL_ONE_MINUTE_HISTORY_DAYS, Math.round(rangeDays)),
    );
  }, [
    controls.chartRange,
    controls.chartWindowMode,
    controls.indicatorOverlays.shading?.timeframe,
    controls.indicatorOverlays.signals?.timeframe,
    predictedSignalTimeframe,
    precursorScoringTimeframes,
    requestedSpotChartTf,
  ]);
  const preferredSpotHistoryTf = useMemo(() => {
    const wantsLowIntraday = [
      requestedSpotChartTf,
      predictedSignalTimeframe,
      controls.indicatorOverlays.signals?.timeframe,
      controls.indicatorOverlays.shading?.timeframe,
      ...precursorScoringTimeframes,
    ].some((value) => {
      const normalized = String(value || "").trim().toLowerCase();
      return normalized === "1m" || normalized === "2m";
    });
    if (wantsLowIntraday) {
      return "1m";
    }
    return String(requestedSpotChartTf || "").trim().toLowerCase() === "5m" ? "5m" : "1m";
  }, [
    controls.chartRange,
    controls.indicatorOverlays.shading?.timeframe,
    controls.indicatorOverlays.signals?.timeframe,
    predictedSignalTimeframe,
    precursorScoringTimeframes,
    requestedSpotChartTf,
  ]);
  const { apiCreds, apiCredStatus } = useResearchApiCreds({ isActive });
  const spotHistory = useResearchSpotHistory({
    marketSymbol: controls.marketSymbol,
    isActive,
    initialIntradayDays: requestedInitialIntradayDays,
    preferredIntradayTf: preferredSpotHistoryTf,
    apiKey: apiCreds.MASSIVE_API_KEY || apiCreds.POLYGON_API_KEY || "",
  });
  const loadedHistoryDateWindow = useMemo(
    () => resolveLoadedHistoryDateWindow(spotHistory.spotDataMeta, spotHistory.liveBars),
    [spotHistory.liveBars, spotHistory.spotDataMeta],
  );

  useEffect(() => {
    const startDate = String(controls.stagedConfigUiState?.runSettings?.startDate || "").trim();
    const endDate = String(controls.stagedConfigUiState?.runSettings?.endDate || "").trim();
    if (!loadedHistoryDateWindow) {
      return;
    }
    if (!startDate) {
      controls.setStagedConfigField("runSettings.startDate", loadedHistoryDateWindow.startDate);
    }
    if (!endDate) {
      controls.setStagedConfigField("runSettings.endDate", loadedHistoryDateWindow.endDate);
    }
  }, [
    controls.setStagedConfigField,
    controls.stagedConfigUiState?.runSettings?.endDate,
    controls.stagedConfigUiState?.runSettings?.startDate,
    loadedHistoryDateWindow,
  ]);

  const openAccountsSurface = useCallback(() => {
    if (typeof navigateToSurface === "function") {
      navigateToSurface("positions");
    }
  }, [navigateToSurface]);

  const barModel = useResearchBarModel({
    liveBars: spotHistory.liveBars,
    dailyBars: spotHistory.dailyBars,
    dataSource: spotHistory.dataSource,
    dataError: spotHistory.dataError,
    hasLoadedSpotHistory: spotHistory.hasLoadedSpotHistory,
    spotDataMeta: spotHistory.spotDataMeta,
  });

  const resolvedSpotCandleTf = useMemo(() => {
    if (controls.candleTf !== "auto") {
      return controls.candleTf;
    }
    return resolveAutoTimeframeByRange(controls.chartRange);
  }, [controls.candleTf, controls.chartRange]);
  const defaultSpotWindowRange = useMemo(
    () => resolveDefaultVisibleRangeForTimeframe(
      controls.candleTf === "auto" ? resolvedSpotCandleTf : controls.candleTf,
      controls.chartRange,
    ),
    [controls.candleTf, controls.chartRange, resolvedSpotCandleTf],
  );
  const chartWindowModeForModel = useMemo(() => {
    return resolveSpotChartModelWindowMode({
      chartWindowMode: controls.chartWindowMode,
      candleTf: controls.candleTf,
      hasViewportTimeBounds: Boolean(spotViewportTimeBounds),
    });
  }, [controls.candleTf, controls.chartWindowMode, spotViewportTimeBounds]);
  const spotChartRangePresetKey = useMemo(() => buildSpotChartRangePresetKey({
    chartRange: controls.chartRange,
    chartWindowMode: controls.chartWindowMode,
    chartPresetVersion: controls.chartPresetVersion,
  }), [
    controls.chartPresetVersion,
    controls.chartRange,
    controls.chartWindowMode,
  ]);
  const resolvedSignalTimeframe = useMemo(
    () => resolveSignalOverlayTimeframe(controls.indicatorOverlays.signals.timeframe, resolvedSpotCandleTf, barModel.tfMin) || "5m",
    [barModel.tfMin, controls.indicatorOverlays.signals.timeframe, resolvedSpotCandleTf],
  );
  const resolvedShadingTimeframe = useMemo(
    () => resolveSignalOverlayTimeframe(controls.indicatorOverlays.shading.timeframe, resolvedSpotCandleTf, barModel.tfMin) || resolvedSignalTimeframe,
    [barModel.tfMin, controls.indicatorOverlays.shading.timeframe, resolvedSignalTimeframe, resolvedSpotCandleTf],
  );
  const requestedIndicatorOverlayTimeframes = useMemo(
    () => {
      const next = new Set([resolvedSignalTimeframe, resolvedShadingTimeframe]);
      if (controls.rayalgoSettings?.infoPanel?.visible) {
        [
          controls.rayalgoSettings?.confirmation?.mtf1,
          controls.rayalgoSettings?.confirmation?.mtf2,
          controls.rayalgoSettings?.confirmation?.mtf3,
        ].forEach((timeframe) => {
          const normalized = String(timeframe || "").trim();
          if (normalized) {
            next.add(normalized);
          }
        });
      }
      return Array.from(next);
    },
    [
      controls.rayalgoSettings?.confirmation?.mtf1,
      controls.rayalgoSettings?.confirmation?.mtf2,
      controls.rayalgoSettings?.confirmation?.mtf3,
      controls.rayalgoSettings?.infoPanel?.visible,
      resolvedShadingTimeframe,
      resolvedSignalTimeframe,
    ],
  );
  const compiledBacktestV2 = useMemo(() => compileBacktestV2RuntimeBridge({
    stageConfig: controls.stagedConfigUiState,
    signalTimeframe: resolvedSignalTimeframe,
    fallbackRiskStopPolicy: "disabled",
  }), [
    controls.stagedConfigUiState,
    resolvedSignalTimeframe,
  ]);
  const baseResearchSetupSnapshot = useMemo(() => ({
    topRail: {
      marketSymbol: controls.marketSymbol,
      strategy: controls.strategy,
      executionFidelity: controls.executionFidelity,
      optionCandleTf: controls.optionCandleTf,
      chartsLinked: controls.chartsLinked,
    },
    rayalgo: {
      candleTf: controls.candleTf,
      chartRange: controls.chartRange,
      chartWindowMode: controls.chartWindowMode,
      indicatorSelections: controls.indicatorSelections,
      indicatorOverlays: controls.indicatorOverlays,
      rayalgoSettings: controls.rayalgoSettings,
      rayalgoWatcher: controls.rayalgoWatcher,
      stagedConfigUi: controls.stagedConfigUiState,
      selectedRayalgoBundleId: controls.selectedRayalgoBundle?.id || null,
      scoringConfig: controls.rayalgoScoringConfig,
      scoringContext: controls.rayalgoScoringConfig || null,
    },
  }), [
    controls.candleTf,
    controls.chartRange,
    controls.chartWindowMode,
    controls.chartsLinked,
    controls.executionFidelity,
    controls.indicatorOverlays,
    controls.indicatorSelections,
    controls.marketSymbol,
    controls.optionCandleTf,
    controls.rayalgoScoringConfig,
    controls.rayalgoSettings,
    controls.rayalgoWatcher,
    controls.selectedRayalgoBundle?.id,
    controls.stagedConfigUiState,
    controls.strategy,
  ]);
  const optionReplay = useResearchOptionReplay({
    apiCreds,
    apiCredStatus,
    executionMode: OPTION_EXECUTION_MODE,
    optionSelectionSpec: compiledBacktestV2.optionSelectionSpec || compiledBacktestV2.legacyOverrides.optionSelectionSpec,
  });

  const execution = useResearchExecution({
    isActive,
    marketSymbol: controls.marketSymbol,
    bars: barModel.bars,
    capital: controls.capital,
    executionFidelity: controls.executionFidelity,
    strategy: controls.strategy,
    dte: controls.dte,
    iv: controls.iv,
    slPct: controls.slPct,
    tpPct: controls.tpPct,
    trailStartPct: controls.trailStartPct,
    trailPct: controls.trailPct,
    zombieBars: controls.zombieBars,
    minConviction: controls.minConviction,
    allowShorts: controls.allowShorts,
    kellyFrac: controls.kellyFrac,
    regimeFilter: controls.regimeFilter,
    maxPos: controls.maxPos,
    sessionBlocks: controls.sessionBlocks,
    tfMin: barModel.tfMin,
    regimeAdapt: controls.regimeAdapt,
    commPerContract: controls.commPerContract,
    slipBps: controls.slipBps,
    tradeDays: controls.tradeDays,
    signalTimeframe: resolvedSignalTimeframe,
    shadingTimeframe: resolvedShadingTimeframe,
    requestedIndicatorOverlayTimeframes,
    rayalgoSettings: controls.rayalgoSettings,
    rayalgoScoringConfig: controls.rayalgoScoringConfig,
    backtestV2StageConfig: controls.stagedConfigUiState,
    backtestV2RuntimeBridge: compiledBacktestV2,
    optionRuntimeConfig: optionReplay.optionRuntimeConfig,
    setupSnapshot: baseResearchSetupSnapshot,
    resultMeta: {
      selectionSummaryLabel: optionReplay.selectionSummaryLabel,
      replaySampleLabel: optionReplay.selectionSummaryLabel,
      dataSource: spotHistory.dataSource,
      spotDataMeta: spotHistory.spotDataMeta,
      selectedBundle: controls.selectedRayalgoBundle,
      isCustom: controls.isSelectedRayalgoBundleCustom,
    },
  });
  const runLaunchBlockReason = useMemo(() => {
    if (!String(controls.marketSymbol || "").trim()) {
      return "Choose a market symbol before running the backtest.";
    }
    if (optionReplay.optionRuntimeConfig?.executionMode === OPTION_EXECUTION_MODE) {
      if (spotHistory.dataSource === "loading" && !spotHistory.hasLoadedSpotHistory) {
        return "Loading real spot history before the backtest can run.";
      }
      if (!spotHistory.hasLoadedSpotHistory || execution.executionBarCount < 50) {
        return spotHistory.dataError || "Load real spot history before running the backtest.";
      }
    }
    return null;
  }, [
    controls.marketSymbol,
    execution.executionBarCount,
    optionReplay.optionRuntimeConfig?.executionMode,
    spotHistory.dataError,
    spotHistory.dataSource,
    spotHistory.hasLoadedSpotHistory,
  ]);
  const runBacktestFromWorkbench = useCallback(() => {
    if (runLaunchBlockReason) {
      pushSurfaceNotice(runLaunchBlockReason);
      return { ok: false, reason: runLaunchBlockReason };
    }
    return execution.runBacktestNow();
  }, [execution.runBacktestNow, pushSurfaceNotice, runLaunchBlockReason]);

  const currentResearchSetupSnapshot = useMemo(() => ({
    ...baseResearchSetupSnapshot,
    rayalgo: {
      ...(baseResearchSetupSnapshot?.rayalgo || {}),
      scoringContext: execution.rayalgoScoringContext || null,
    },
  }), [baseResearchSetupSnapshot, execution.rayalgoScoringContext]);

  const rayalgoWatcher = useRayAlgoWatcher({
    marketSymbol: controls.marketSymbol,
    isActive,
    strategy: controls.strategy,
    bars: barModel.bars,
    tfMin: barModel.tfMin,
    capital: controls.capital,
    executionFidelity: controls.executionFidelity,
    dte: controls.dte,
    iv: controls.iv,
    slPct: controls.slPct,
    tpPct: controls.tpPct,
    trailStartPct: controls.trailStartPct,
    trailPct: controls.trailPct,
    zombieBars: controls.zombieBars,
    minConviction: controls.minConviction,
    allowShorts: controls.allowShorts,
    kellyFrac: controls.kellyFrac,
    regimeFilter: controls.regimeFilter,
    maxPos: controls.maxPos,
    sessionBlocks: controls.sessionBlocks,
    tradeDays: controls.tradeDays,
    regimeAdapt: controls.regimeAdapt,
    commPerContract: controls.commPerContract,
    slipBps: controls.slipBps,
    rayalgoSettings: controls.rayalgoSettings,
    currentSignalTimeframe: resolvedSignalTimeframe,
    backtestV2RuntimeBridge: compiledBacktestV2,
  });

  useEffect(() => {
    if (String(controls.strategy || "").trim().toLowerCase() !== "rayalgo") {
      return;
    }
    const selectedBundleId = controls.selectedRayalgoBundle?.id || null;
    const evaluationSummary = execution.bundleEvaluation?.summary || null;
    if (!selectedBundleId || !evaluationSummary || controls.isSelectedRayalgoBundleCustom) {
      return;
    }
    controls.updateRayalgoBundleEvaluation(selectedBundleId, evaluationSummary);
  }, [
    controls.isSelectedRayalgoBundleCustom,
    controls.selectedRayalgoBundle?.id,
    controls.strategy,
    controls.updateRayalgoBundleEvaluation,
    execution.bundleEvaluation?.summary,
  ]);

  useEffect(() => {
    const completedRunId = Number(execution.completedRunId) || 0;
    if (!completedRunId || execution.replayRunStatus !== "ready") {
      return;
    }
    setExecutedBacktestSetupSnapshot(currentResearchSetupSnapshot);
  }, [currentResearchSetupSnapshot, execution.completedRunId, execution.replayRunStatus]);

  const saveCurrentBacktestRun = useCallback(() => {
    const latestResult = execution.latestResultRecord || null;
    if (execution.replayRunStatus !== "ready" || !latestResult) {
      return { ok: false, reason: "Wait for the active backtest to finish before saving." };
    }
    if (!executedBacktestSetupSnapshot && !latestResult?.setup) {
      return { ok: false, reason: "No completed run snapshot is available to save yet." };
    }
    if (latestResult?.bookmarkedAt) {
      return { ok: false, reason: "This backtest run is already saved." };
    }
    if (latestResult?.resultId && latestResult.resultId === lastSavedResultId) {
      return { ok: false, reason: "This backtest run is already saved." };
    }

    const entry = controls.appendResearchRunHistory({
      runId: latestResult.resultId || `${controls.marketSymbol.toLowerCase()}-backtest-${Date.now()}`,
      resultId: latestResult.resultId || null,
      createdAt: latestResult.createdAt || Date.now(),
      marketSymbol: latestResult.marketSymbol || controls.marketSymbol,
      setup: latestResult.setup || latestResult.setupSnapshot || executedBacktestSetupSnapshot,
      selectedBundle: controls.selectedRayalgoBundle,
      isCustom: controls.isSelectedRayalgoBundleCustom,
      metrics: latestResult.metrics || execution.metrics,
      trades: latestResult.trades || execution.trades,
      equity: latestResult.equity || execution.equity,
      skippedTrades: latestResult.skippedTrades || execution.skippedTrades,
      skippedByReason: latestResult.skippedByReason || execution.skippedByReason,
      bundleEvaluation: execution.bundleEvaluation,
      replayMeta: {
        selectionSummaryLabel: latestResult?.replayMeta?.selectionSummaryLabel || optionReplay.selectionSummaryLabel,
        replayRunStatus: latestResult?.replayMeta?.replayRunStatus || execution.replayRunStatus,
        replayRunError: latestResult?.replayMeta?.replayRunError || execution.replayRunError,
        replayDatasetSummary: latestResult?.replayMeta?.replayDatasetSummary || execution.replayDatasetSummary,
        replaySampleLabel: latestResult?.replayMeta?.replaySampleLabel || execution.replaySampleLabel,
      },
      riskStop: latestResult.riskStop || execution.riskStop,
      rayalgoScoringContext: latestResult.rayalgoScoringContext || execution.rayalgoScoringContext,
      dataSource: latestResult?.resultMeta?.dataSource || spotHistory.dataSource,
      spotDataMeta: latestResult?.resultMeta?.spotDataMeta || spotHistory.spotDataMeta,
      bookmarkedAt: latestResult?.bookmarkedAt || null,
    });
    if (latestResult?.resultId) {
      setLastSavedResultId(latestResult.resultId);
      bookmarkResearchBacktestResult(latestResult.resultId).catch(() => {});
    }
    lastSavedBacktestRunIdRef.current = Number(execution.completedRunId) || Date.now();
    return { ok: true, entry };
  }, [
    controls.appendResearchRunHistory,
    controls.isSelectedRayalgoBundleCustom,
    controls.marketSymbol,
    controls.selectedRayalgoBundle,
    executedBacktestSetupSnapshot,
    execution.bundleEvaluation,
    execution.completedRunId,
    execution.equity,
    execution.latestResultRecord,
    execution.metrics,
    execution.rayalgoScoringContext,
    execution.replayDatasetSummary,
    execution.replayRunError,
    execution.replayRunStatus,
    execution.replaySampleLabel,
    execution.riskStop,
    execution.skippedByReason,
    execution.skippedTrades,
    execution.trades,
    optionReplay.selectionSummaryLabel,
    spotHistory.dataSource,
    spotHistory.spotDataMeta,
    lastSavedResultId,
  ]);

  const loadHistoryRun = useCallback((entry = null) => {
    const setup = entry?.setup || entry?.setupSnapshot || entry || null;
    if (!setup) {
      return { ok: false, reason: "Saved run setup is unavailable." };
    }
    const setupDiffs = diffResearchSetupSnapshots(currentResearchSetupSnapshot, setup);
    if (!setupDiffs.length) {
      const runResult = runBacktestFromWorkbench();
      return { ok: Boolean(runResult?.ok), immediate: true, reason: runResult?.reason || null };
    }
    execution.runBacktestOnNextDraftChange();
    controls.applyResearchSetupSnapshot(setup);
    return { ok: true, immediate: false };
  }, [controls.applyResearchSetupSnapshot, currentResearchSetupSnapshot, execution.runBacktestOnNextDraftChange, runBacktestFromWorkbench]);

  const openStoredBacktestResult = useCallback(async (entry = null) => {
    if (!entry) {
      return { ok: false, reason: "Stored result is unavailable." };
    }
    const setup = entry.setup || entry.setupSnapshot || null;
    if (setup) {
      setExecutedBacktestSetupSnapshot(setup);
    }
    const result = await execution.openStoredResultRecord(entry);
    const hydratedSetup = result?.record?.setup || result?.record?.setupSnapshot || setup || null;
    if (hydratedSetup) {
      setExecutedBacktestSetupSnapshot(hydratedSetup);
    }
    return result;
  }, [execution.openStoredResultRecord]);

  useEffect(() => {
    if (hasRestoredSavedRunRef.current) {
      return;
    }
    if (execution.displayedResultRecord || execution.latestResultRecord) {
      hasRestoredSavedRunRef.current = true;
      return;
    }
    const latestSavedRun = controls.researchRunHistory[0] || null;
    if (!latestSavedRun?.setup) {
      return;
    }
    const setupDiffs = diffResearchSetupSnapshots(currentResearchSetupSnapshot, latestSavedRun.setup);
    if (setupDiffs.length) {
      pendingRestoreRunRef.current = latestSavedRun;
      controls.applyResearchSetupSnapshot(latestSavedRun.setup);
      return;
    }
    hasRestoredSavedRunRef.current = true;
    pendingRestoreRunRef.current = null;
    setExecutedBacktestSetupSnapshot(latestSavedRun.setup);
    execution.restoreSavedRun(latestSavedRun);
  }, [
    controls.applyResearchSetupSnapshot,
    controls.researchRunHistory,
    currentResearchSetupSnapshot,
    execution.displayedResultRecord,
    execution.latestResultRecord,
    execution.openStoredResultRecord,
    execution.restoreSavedRun,
  ]);

  useEffect(() => {
    const pendingRestoreRun = pendingRestoreRunRef.current;
    if (!pendingRestoreRun?.setup) {
      return;
    }
    const setupDiffs = diffResearchSetupSnapshots(currentResearchSetupSnapshot, pendingRestoreRun.setup);
    if (setupDiffs.length) {
      return;
    }
    pendingRestoreRunRef.current = null;
    hasRestoredSavedRunRef.current = true;
    setExecutedBacktestSetupSnapshot(pendingRestoreRun.setup);
    execution.restoreSavedRun(pendingRestoreRun);
  }, [currentResearchSetupSnapshot, execution.openStoredResultRecord, execution.restoreSavedRun]);

  useEffect(() => {
    const completedOptimizerJobId = String(execution.activeOptimizerJob?.jobId || "").trim();
    if (!completedOptimizerJobId || execution.activeOptimizerJob?.status !== "completed") {
      return;
    }
    if (completedOptimizerJobId === String(lastArchivedOptimizerRunIdRef.current || "")) {
      return;
    }
    lastArchivedOptimizerRunIdRef.current = completedOptimizerJobId;
    if (!Array.isArray(execution.optResults) || !execution.optResults.length) {
      return;
    }
    controls.appendResearchOptimizerHistory({
      batchId: completedOptimizerJobId,
      createdAt: Date.now(),
      marketSymbol: controls.marketSymbol,
      setup: currentResearchSetupSnapshot,
      selectedBundle: controls.selectedRayalgoBundle,
      isCustom: controls.isSelectedRayalgoBundleCustom,
      results: execution.optResults,
    });
  }, [
    execution.activeOptimizerJob?.jobId,
    execution.activeOptimizerJob?.status,
    controls.appendResearchOptimizerHistory,
    controls.isSelectedRayalgoBundleCustom,
    controls.marketSymbol,
    controls.selectedRayalgoBundle,
    currentResearchSetupSnapshot,
    execution.optResults,
  ]);

  useEffect(() => {
    if (!execution.trades.length) {
      lastAutoSelectedCompletedRunIdRef.current = execution.completedRunId;
      if (selectedTradeId != null) {
        setSelectedTradeId(null);
      }
      if (hoveredTradeId != null) {
        setHoveredTradeId(null);
      }
      return;
    }

    const hasCurrentSelection = execution.trades.some((trade) => getResearchTradeSelectionId(trade) === selectedTradeId);
    const hasCurrentHover = execution.trades.some((trade) => getResearchTradeSelectionId(trade) === hoveredTradeId);

    if (lastAutoSelectedCompletedRunIdRef.current !== execution.completedRunId) {
      lastAutoSelectedCompletedRunIdRef.current = execution.completedRunId;
      if (selectedTradeId && !hasCurrentSelection) {
        setSelectedTradeId(null);
      }
      if (hoveredTradeId && !hasCurrentHover) {
        setHoveredTradeId(null);
      }
      return;
    }

    if (selectedTradeId && !hasCurrentSelection) {
      setSelectedTradeId(null);
    }
    if (hoveredTradeId && !hasCurrentHover) {
      setHoveredTradeId(null);
    }
  }, [execution.completedRunId, execution.trades, hoveredTradeId, selectedTradeId]);

  const applyStoredOptimizerCandidate = useCallback((candidate, setup = null) => {
    if (setup) {
      controls.applyResearchSetupSnapshot(setup);
    }
    controls.applyOptimizerResult(candidate);
  }, [controls.applyOptimizerResult, controls.applyResearchSetupSnapshot]);

  const saveStoredHistoryRunAsBundle = useCallback((entry) => {
    const normalizedStrategy = String(entry?.setup?.topRail?.strategy || entry?.strategy || "").trim().toLowerCase();
    if (normalizedStrategy !== "rayalgo") {
      return {
        ok: false,
        reason: "Only RayAlgo history runs can be saved as RayAlgo bundle variants.",
      };
    }

    const summary = entry?.bundleEvaluation?.summary || {};
    const savedBundle = controls.saveRayalgoBundleVariant({
      setup: entry?.setup || null,
      selectedBundle: controls.rayalgoBundleLibrary.find((bundle) => bundle.id === entry?.bundleContext?.bundleId) || null,
      evaluation: {
        tierSuggestion: summary.tierSuggestion || entry?.bundleContext?.tier || "test",
        trades: summary.trades ?? entry?.metrics?.n ?? null,
        expectancyR: summary.expectancyR ?? entry?.metrics?.exp ?? null,
        maxDrawdownPct: summary.maxDrawdownPct ?? entry?.metrics?.dd ?? null,
        winRatePct: summary.winRatePct ?? entry?.metrics?.wr ?? null,
        profitFactor: summary.profitFactor ?? entry?.metrics?.pf ?? null,
        netReturnPct: summary.netReturnPct ?? entry?.metrics?.roi ?? null,
        avgHoldBars: summary.avgHoldBars ?? entry?.metrics?.avgBars ?? null,
        holdoutExpectancyR: summary.holdoutExpectancyR ?? null,
        holdoutProfitFactor: summary.holdoutProfitFactor ?? null,
        holdoutMaxDrawdownPct: summary.holdoutMaxDrawdownPct ?? null,
        sessionBadges: summary.sessionBadges || [],
        regimeBadges: summary.regimeBadges || [],
        statusText: summary.statusText || "Saved from archived history evidence.",
        experimentalEligible: Boolean(summary.experimentalEligible),
        coreEligible: Boolean(summary.coreEligible),
      },
      note: "Archived run saved as a RayAlgo bundle variant from history review.",
      notes: [
        "History run",
        entry?.replayMeta?.selectionSummaryLabel || "",
      ].filter(Boolean),
    });

    return savedBundle
      ? { ok: true, bundle: savedBundle }
      : { ok: false, reason: "Unable to save the archived setup as a bundle." };
  }, [controls.rayalgoBundleLibrary, controls.saveRayalgoBundleVariant]);

  useEffect(() => {
    const leaderSignature = rayalgoWatcher.leader?.signature || null;
    if (String(controls.strategy || "").trim().toLowerCase() !== "rayalgo") {
      lastWatcherLeaderSignatureRef.current = null;
      return;
    }
    if (!leaderSignature) {
      return;
    }
    if (lastWatcherLeaderSignatureRef.current == null) {
      lastWatcherLeaderSignatureRef.current = leaderSignature;
      return;
    }
    if (leaderSignature === lastWatcherLeaderSignatureRef.current) {
      return;
    }
    lastWatcherLeaderSignatureRef.current = leaderSignature;
    if (!controls.rayalgoWatcher.autoRankAndPin) {
      setSurfaceNotice((previous) => ({
        token: previous.token + 1,
        text: `Best-fit leader changed to ${rayalgoWatcher.leader.summaryLabel}.`,
      }));
    }
  }, [
    controls.rayalgoWatcher.autoRankAndPin,
    controls.strategy,
    rayalgoWatcher.leader?.signature,
    rayalgoWatcher.leader?.summaryLabel,
  ]);

  useEffect(() => {
    if (!controls.rayalgoWatcher.autoRankAndPin || !rayalgoWatcher.leader || String(controls.strategy || "").trim().toLowerCase() !== "rayalgo") {
      return;
    }
    controls.setIndicatorOverlays((previous) => {
      const next = {
        ...previous,
        signals: { ...previous.signals, visible: true, mode: "pinned", timeframe: rayalgoWatcher.leader.signalTimeframe },
        shading: { ...previous.shading, visible: true, timeframe: rayalgoWatcher.leader.shadingTimeframe, mode: "until_opposite_signal" },
      };
      if (JSON.stringify(next) === JSON.stringify(previous)) {
        return previous;
      }
      return next;
    });
    controls.setRayalgoSettings((previous) => {
      const next = mergeRayAlgoSettings(previous, rayalgoWatcher.leader.rayalgoSettings);
      if (JSON.stringify(next) === JSON.stringify(previous)) {
        return previous;
      }
      return next;
    });
  }, [
    controls.rayalgoWatcher.autoRankAndPin,
    controls.setIndicatorOverlays,
    controls.setRayalgoSettings,
    controls.strategy,
    rayalgoWatcher.leader?.signature,
    rayalgoWatcher.leader?.rayalgoSettings,
    rayalgoWatcher.leader?.shadingTimeframe,
    rayalgoWatcher.leader?.signalTimeframe,
  ]);

  const selectedTrade = useMemo(() => {
    if (selectedTradeId) {
      return execution.trades.find((trade) => getResearchTradeSelectionId(trade) === selectedTradeId) || null;
    }
    return null;
  }, [execution.trades, selectedTradeId]);

  useEffect(() => {
    selectedTradeRef.current = selectedTrade;
  }, [selectedTrade]);

  const chartModel = useResearchChartModel({
    bars: barModel.bars,
    dailyBars: barModel.dailyBars,
    chartRange: controls.chartRange,
    chartWindowMode: chartWindowModeForModel,
    candleTf: controls.candleTf,
    strategy: controls.strategy,
    executionMode: OPTION_EXECUTION_MODE,
    trades: execution.trades,
    selectedTrade,
    indicatorOverlayTape: execution.indicatorOverlayTape,
    indicatorOverlayTapesByTf: execution.indicatorOverlayTapesByTf,
    signalTimeframe: controls.indicatorOverlays.signals.timeframe,
    shadingTimeframe: controls.indicatorOverlays.shading.timeframe,
    autoTimeBounds: spotAutoTimeBounds,
    viewportTimeBounds: spotViewportTimeBounds,
    indicatorSelections: controls.indicatorSelections,
    rayalgoSettings: controls.rayalgoSettings,
    isActive,
  });
  const spotChartBaseSeriesModeKey = useMemo(() => buildSpotChartBaseSeriesModeKey({
    effectiveTf: chartModel.effectiveTf,
  }), [chartModel.effectiveTf]);
  const runtimeHealth = useResearchRuntimeHealth({
    isActive,
    chartRuntime: spotChartRuntime,
    chartModelRuntime: chartModel.runtimeHealth,
  });
  const loadedSpotTimeBounds = useMemo(
    () => resolveLoadedTimeBoundsFromBars(barModel.bars, barModel.tfMin),
    [barModel.bars, barModel.tfMin],
  );
  const windowDisplayState = useMemo(() => resolveChartWindowDisplayState({
    timeBounds: spotViewportTimeBounds,
    visibleBars: spotVisibleBars,
    effectiveTf: chartModel.effectiveTf,
    chartRange: controls.chartRange,
    chartWindowMode: controls.chartWindowMode,
    loadedTimeBounds: loadedSpotTimeBounds,
  }), [
    chartModel.effectiveTf,
    barModel.bars,
    barModel.tfMin,
    controls.chartRange,
    controls.chartWindowMode,
    loadedSpotTimeBounds,
    spotViewportTimeBounds,
    spotVisibleBars,
  ]);
  const showResetSpotWindow = useMemo(
    () => controls.chartWindowMode === "all"
      || (windowDisplayState.hasViewportBounds
        && windowDisplayState.menuValue !== controls.chartRange),
    [controls.chartRange, controls.chartWindowMode, windowDisplayState.hasViewportBounds, windowDisplayState.menuValue],
  );
  const allowFullIntervalSeries = useMemo(
    () => controls.candleTf !== "auto"
      && windowDisplayState.isFull
      && !spotHistory.hasOlderHistory,
    [controls.candleTf, spotHistory.hasOlderHistory, windowDisplayState.isFull],
  );
  const applySpotInterval = useCallback((nextTf) => {
    const normalizedTf = String(nextTf || "").trim() || "auto";
    controls.setCandleTf(normalizedTf);
    if (normalizedTf !== "auto") {
      controls.setChartRange(resolveDefaultVisibleRangeForTimeframe(normalizedTf, controls.chartRange));
    }
    if (controls.chartWindowMode !== "all") {
      controls.setChartWindowMode("default");
    }
    controls.bumpChartPresetVersion();
  }, [
    controls.bumpChartPresetVersion,
    controls.chartRange,
    controls.chartWindowMode,
    controls.setCandleTf,
    controls.setChartRange,
    controls.setChartWindowMode,
  ]);

  const applySpotWindowPreset = useCallback((nextRange) => {
    const normalizedRange = String(nextRange || "").trim().toLowerCase();
    if (normalizedRange === CHART_WINDOW_MODE_FULL) {
      controls.setChartWindowMode("all");
      controls.bumpChartPresetVersion();
      if (shouldPreferSyncResearchChartModel({ chartWindowMode: "all", modelBars: barModel.bars })) {
        const loadedBarCount = Array.isArray(barModel.bars) ? barModel.bars.length : 0;
        const tfLabel = String(chartModel.effectiveTf || controls.candleTf || "chart").trim() || "chart";
        pushSurfaceNotice(
          `Full is showing ${loadedBarCount.toLocaleString()} loaded ${tfLabel} bars. This mode uses more memory and may feel heavier; large datasets now use the lower-memory sync path.`,
        );
      }
      return;
    }
    const nextPreset = String(nextRange || "").trim() || controls.chartRange;
    controls.setChartRange(nextPreset);
    controls.setChartWindowMode("default");
    controls.bumpChartPresetVersion();
  }, [
    barModel.bars,
    controls.bumpChartPresetVersion,
    controls.candleTf,
    controls.chartRange,
    controls.setChartRange,
    controls.setChartWindowMode,
    chartModel.effectiveTf,
    pushSurfaceNotice,
  ]);

  const resetSpotChartWindow = useCallback(() => {
    controls.setChartRange(String(controls.chartRange || "").trim() || defaultSpotWindowRange);
    controls.setChartWindowMode("default");
    controls.bumpChartPresetVersion();
  }, [
    controls.bumpChartPresetVersion,
    controls.chartRange,
    controls.setChartRange,
    controls.setChartWindowMode,
    defaultSpotWindowRange,
  ]);

  useEffect(() => {
    pendingSpotAutoTimeBoundsRef.current = null;
    pendingSpotViewportTimeBoundsRef.current = null;
    pendingSpotVisibleBarsRef.current = null;
    if (typeof window !== "undefined") {
      if (spotAutoTimeBoundsFrameRef.current != null) {
        window.cancelAnimationFrame(spotAutoTimeBoundsFrameRef.current);
        spotAutoTimeBoundsFrameRef.current = null;
      }
      if (spotAutoTimeBoundsIdleTimerRef.current != null) {
        window.clearTimeout(spotAutoTimeBoundsIdleTimerRef.current);
        spotAutoTimeBoundsIdleTimerRef.current = null;
      }
    }
    setSpotAutoTimeBounds(null);
    setSpotViewportTimeBounds(null);
    setSpotVisibleBars(null);
  }, [controls.candleTf, controls.chartRange, controls.chartPresetVersion]);

  const hoveredTrade = useMemo(() => {
    if (hoveredTradeId) {
      return execution.trades.find((trade) => getResearchTradeSelectionId(trade) === hoveredTradeId) || null;
    }
    return null;
  }, [execution.trades, hoveredTradeId]);

  const effectiveSelectedTradeId = useMemo(
    () => (selectedTrade ? getResearchTradeSelectionId(selectedTrade) : null),
    [selectedTrade],
  );
  const effectiveHoveredTradeId = useMemo(
    () => (hoveredTrade ? getResearchTradeSelectionId(hoveredTrade) : null),
    [hoveredTrade],
  );
  const optionChart = useResearchOptionChart({
    selectedTrade,
    executionMode: OPTION_EXECUTION_MODE,
    marketSymbol: controls.marketSymbol,
    optionSelectionSpec: optionReplay.optionRuntimeConfig?.optionSelectionSpec,
    optionCandleTf: controls.optionCandleTf,
    apiCreds,
    spotBars: barModel.bars,
    indicatorOverlayTape: chartModel.signalTf && execution.indicatorOverlayTapesByTf?.[chartModel.signalTf]
      ? execution.indicatorOverlayTapesByTf[chartModel.signalTf]
      : execution.indicatorOverlayTape,
    indicatorWindowTape: chartModel.shadingTf && execution.indicatorOverlayTapesByTf?.[chartModel.shadingTf]
      ? execution.indicatorOverlayTapesByTf[chartModel.shadingTf]
      : execution.indicatorOverlayTape,
    defaultIv: controls.iv,
  });

  const selectTradeById = useCallback((nextTradeId, options = {}) => {
    const normalizedTradeId = typeof nextTradeId === "string" && nextTradeId.trim()
      ? nextTradeId.trim()
      : null;
    setSelectedTradeId(normalizedTradeId);
    const sourceChartId = String(options?.sourceChartId || "").trim().toLowerCase() || null;
    if (sourceChartId) {
      setSelectionLinkEvent((previous) => ({
        token: previous.token + 1,
        sourceChartId,
      }));
    }
  }, [controls]);

  const hoverTradeById = useCallback((nextTradeId) => {
    const normalizedTradeId = typeof nextTradeId === "string" && nextTradeId.trim()
      ? nextTradeId.trim()
      : null;
    setHoveredTradeId((previous) => (previous === normalizedTradeId ? previous : normalizedTradeId));
  }, []);

  const handleSpotChartRuntimeChange = useCallback((nextRuntime) => {
    setSpotChartRuntime((previous) => (runtimeHealthMatches(previous, nextRuntime) ? previous : nextRuntime));
  }, []);

  const flushPendingViewportLink = useCallback(() => {
    const nextPayload = pendingViewportLinkRef.current;
    pendingViewportLinkRef.current = null;
    if (!nextPayload) {
      return;
    }
    viewportLinkTokenRef.current += 1;
    viewportLinkStoreRef.current.setSnapshot({
      ...nextPayload,
      token: viewportLinkTokenRef.current,
    });
  }, []);

  const flushPendingSpotAutoTimeBounds = useCallback(() => {
    const nextAutoTimeBounds = pendingSpotAutoTimeBoundsRef.current;
    const nextViewportTimeBounds = pendingSpotViewportTimeBoundsRef.current;
    const nextVisibleBars = pendingSpotVisibleBarsRef.current;
    pendingSpotAutoTimeBoundsRef.current = null;
    pendingSpotViewportTimeBoundsRef.current = null;
    pendingSpotVisibleBarsRef.current = null;
    setSpotVisibleBars((previous) => (
      Number(previous) === Number(nextVisibleBars) ? previous : nextVisibleBars
    ));
    if (nextViewportTimeBounds) {
      setSpotViewportTimeBounds((previous) => (
        timeBoundsMatch(previous, nextViewportTimeBounds)
          ? previous
          : nextViewportTimeBounds
      ));
    }
    if (nextAutoTimeBounds) {
      setSpotAutoTimeBounds((previous) => (
        timeBoundsMatch(previous, nextAutoTimeBounds)
          ? previous
          : nextAutoTimeBounds
      ));
    }
  }, []);

  const publishViewportLinkEvent = useCallback((payload) => {
    const chartId = String(payload?.chartId || "").trim().toLowerCase();
    const startMs = Number(payload?.timeBounds?.startMs);
    const endMs = Number(payload?.timeBounds?.endMs);
    const visibleBars = Math.max(0, Number(payload?.visibleBars) || 0);
    if (!chartId || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return;
    }
    const normalizedPayload = {
      chartId,
      visibleBars,
      timeBounds: {
        startMs,
        endMs,
      },
      source: String(payload?.source || "user"),
      rightPaddingBars: Math.max(0, Number(payload?.rightPaddingBars) || 0),
    };
    viewportSnapshotsRef.current[chartId] = normalizedPayload;
    if (chartId === "spot") {
      pendingSpotViewportTimeBoundsRef.current = normalizedPayload.timeBounds;
      pendingSpotVisibleBarsRef.current = normalizedPayload.visibleBars;
      const nextWindowDisplayState = resolveChartWindowDisplayState({
        timeBounds: normalizedPayload.timeBounds,
        visibleBars: normalizedPayload.visibleBars,
        effectiveTf: chartModel.effectiveTf,
        chartRange: controls.chartRange,
        chartWindowMode: controls.chartWindowMode,
        loadedTimeBounds: loadedSpotTimeBounds,
      });
      if (typeof window === "undefined") {
        flushPendingSpotAutoTimeBounds();
      } else if (isDeferredViewportLinkSource(normalizedPayload.source)) {
        if (spotAutoTimeBoundsFrameRef.current != null) {
          window.cancelAnimationFrame(spotAutoTimeBoundsFrameRef.current);
          spotAutoTimeBoundsFrameRef.current = null;
        }
        if (spotAutoTimeBoundsIdleTimerRef.current != null) {
          window.clearTimeout(spotAutoTimeBoundsIdleTimerRef.current);
        }
        spotAutoTimeBoundsIdleTimerRef.current = window.setTimeout(() => {
          spotAutoTimeBoundsIdleTimerRef.current = null;
          flushPendingSpotAutoTimeBounds();
        }, SPOT_VIEWPORT_MODEL_SETTLE_MS);
      } else {
        if (spotAutoTimeBoundsIdleTimerRef.current != null) {
          window.clearTimeout(spotAutoTimeBoundsIdleTimerRef.current);
          spotAutoTimeBoundsIdleTimerRef.current = null;
        }
        if (spotAutoTimeBoundsFrameRef.current != null) {
          window.cancelAnimationFrame(spotAutoTimeBoundsFrameRef.current);
          spotAutoTimeBoundsFrameRef.current = null;
        }
        spotAutoTimeBoundsFrameRef.current = window.requestAnimationFrame(() => {
          spotAutoTimeBoundsFrameRef.current = null;
          flushPendingSpotAutoTimeBounds();
        });
      }
    }
    if (chartId !== "spot") {
      return;
    }
    setViewportLeaderChartId((previous) => (previous === "spot" ? previous : "spot"));
    if (!chartsLinked || !selectedTradeRef.current) {
      return;
    }
    pendingViewportLinkRef.current = normalizedPayload;
    if (typeof window === "undefined") {
      flushPendingViewportLink();
      return;
    }
    if (isDeferredViewportLinkSource(normalizedPayload.source)) {
      if (viewportLinkFrameRef.current != null) {
        window.cancelAnimationFrame(viewportLinkFrameRef.current);
        viewportLinkFrameRef.current = null;
      }
      if (viewportLinkIdleTimerRef.current != null) {
        window.clearTimeout(viewportLinkIdleTimerRef.current);
      }
      viewportLinkIdleTimerRef.current = window.setTimeout(() => {
        viewportLinkIdleTimerRef.current = null;
        flushPendingViewportLink();
      }, VIEWPORT_LINK_WHEEL_DEFER_MS);
      return;
    }
    if (viewportLinkIdleTimerRef.current != null) {
      window.clearTimeout(viewportLinkIdleTimerRef.current);
      viewportLinkIdleTimerRef.current = null;
    }
    if (viewportLinkFrameRef.current != null) {
      return;
    }
    viewportLinkFrameRef.current = window.requestAnimationFrame(() => {
      viewportLinkFrameRef.current = null;
      flushPendingViewportLink();
    });
  }, [
    chartModel.effectiveTf,
    chartsLinked,
    controls.chartRange,
    controls.chartWindowMode,
    flushPendingSpotAutoTimeBounds,
    flushPendingViewportLink,
    loadedSpotTimeBounds,
  ]);

  useEffect(() => () => {
    if (viewportLinkFrameRef.current != null && typeof window !== "undefined") {
      window.cancelAnimationFrame(viewportLinkFrameRef.current);
      viewportLinkFrameRef.current = null;
    }
    if (viewportLinkIdleTimerRef.current != null && typeof window !== "undefined") {
      window.clearTimeout(viewportLinkIdleTimerRef.current);
      viewportLinkIdleTimerRef.current = null;
    }
    if (spotAutoTimeBoundsFrameRef.current != null && typeof window !== "undefined") {
      window.cancelAnimationFrame(spotAutoTimeBoundsFrameRef.current);
      spotAutoTimeBoundsFrameRef.current = null;
    }
    if (spotAutoTimeBoundsIdleTimerRef.current != null && typeof window !== "undefined") {
      window.clearTimeout(spotAutoTimeBoundsIdleTimerRef.current);
      spotAutoTimeBoundsIdleTimerRef.current = null;
    }
  }, []);

  const setChartsLinked = useCallback((nextLinked, options = {}) => {
    const enabled = Boolean(nextLinked);
    controls.setChartsLinked(enabled);
    if (!enabled) {
      pendingViewportLinkRef.current = null;
      if (viewportLinkFrameRef.current != null && typeof window !== "undefined") {
        window.cancelAnimationFrame(viewportLinkFrameRef.current);
        viewportLinkFrameRef.current = null;
      }
      if (viewportLinkIdleTimerRef.current != null && typeof window !== "undefined") {
        window.clearTimeout(viewportLinkIdleTimerRef.current);
        viewportLinkIdleTimerRef.current = null;
      }
      viewportLinkStoreRef.current.reset();
      return;
    }
    const leaderChartId = "spot";
    const leaderSnapshot = viewportSnapshotsRef.current.spot || null;
    if (!leaderSnapshot?.timeBounds) {
      return;
    }
    viewportLinkTokenRef.current += 1;
    viewportLinkStoreRef.current.setSnapshot({
      chartId: leaderChartId,
      timeBounds: leaderSnapshot.timeBounds,
      source: "relink",
      rightPaddingBars: Math.max(0, Number(leaderSnapshot.rightPaddingBars) || 0),
      token: viewportLinkTokenRef.current,
    });
    setViewportLeaderChartId(leaderChartId);
  }, [controls.setChartsLinked]);

  useEffect(() => {
    if (!chartsLinked || !selectedTrade) {
      return;
    }
    const leaderSnapshot = viewportSnapshotsRef.current.spot || null;
    if (!leaderSnapshot?.timeBounds) {
      return;
    }
    pendingViewportLinkRef.current = leaderSnapshot;
    if (viewportLinkFrameRef.current != null && typeof window !== "undefined") {
      window.cancelAnimationFrame(viewportLinkFrameRef.current);
      viewportLinkFrameRef.current = null;
    }
    if (viewportLinkIdleTimerRef.current != null && typeof window !== "undefined") {
      window.clearTimeout(viewportLinkIdleTimerRef.current);
      viewportLinkIdleTimerRef.current = null;
    }
    flushPendingViewportLink();
  }, [chartsLinked, flushPendingViewportLink, selectedTrade]);

  useEffect(() => {
    const stats = chartModel.tradeResolutionStats;
    if (import.meta.env.DEV && stats && (stats.totalBoundarySnapCount > 0 || stats.totalUnresolvedCount > 0)) {
      console.debug("[ResearchWorkbench] trade overlay resolution stats", {
        stats,
        chartRange: controls.chartRange,
        effectiveTf: chartModel.effectiveTf,
        symbol: controls.marketSymbol,
      });
    }
  }, [
    chartModel.effectiveTf,
    chartModel.tradeResolutionStats,
    controls.chartRange,
    controls.marketSymbol,
  ]);

  useEffect(() => {
    if (import.meta.env.DEV && chartModel.indicatorOverlayFallbackCount > 0) {
      console.debug("[ResearchWorkbench] indicator overlay nearest-fallback resolutions", {
        count: chartModel.indicatorOverlayFallbackCount,
        chartRange: controls.chartRange,
        effectiveTf: chartModel.effectiveTf,
        symbol: controls.marketSymbol,
      });
    }
  }, [
    chartModel.effectiveTf,
    chartModel.indicatorOverlayFallbackCount,
    controls.chartRange,
    controls.marketSymbol,
  ]);

  const hasTradeOverlays = chartModel.tradeOverlays.length > 0;
  const hasIndicatorOverlays = chartModel.indicatorEvents.length > 0
    || chartModel.indicatorZones.length > 0
    || chartModel.indicatorWindows.length > 0;
  const sharedChartCoordinationModel = {
    chartsLinked,
    setChartsLinked,
    viewportLeaderChartId,
    onViewportChange: publishViewportLinkEvent,
  };

  return {
    marketSymbol: controls.marketSymbol,
    headerProps: {
      marketSymbol: controls.marketSymbol,
      dataSource: spotHistory.dataSource,
      fetchSpotBars: spotHistory.reloadSpotBars,
      spotStatus: barModel.spotStatus,
      executionMode: OPTION_EXECUTION_MODE,
      optionTicker: execution.replaySampleTicker,
      replaySelectionLabel: optionReplay.selectionSummaryLabel,
      liveQuote: spotHistory.liveQuote,
    },
    topControlsProps: {
      marketSymbol: controls.marketSymbol,
      equityModel: {
        capital: controls.capital,
        metrics: execution.metrics,
        merged: execution.merged,
        eqDomain: execution.eqDomain,
        snap: execution.snap,
        onPinSnap: execution.pinSnap,
        onClearSnap: execution.clearSnap,
        skippedTrades: execution.skippedTrades,
      },
      stagedConfigModel: {
        state: controls.stagedConfigUiState,
        setField: controls.setStagedConfigField,
        resetSection: controls.resetStagedConfigSection,
        resetAll: controls.resetStagedConfigUi,
      },
      runModel: {
        runStatus: execution.replayRunStatus,
        runError: execution.replayRunError,
        runIsStale: execution.runIsStale,
        hasQueuedRerun: execution.hasQueuedRerun,
        activeJob: execution.activeBacktestJob,
        canSaveRun: execution.replayRunStatus === "ready"
          && Boolean(execution.latestResultRecord)
          && !execution.latestResultRecord?.bookmarkedAt
          && execution.latestResultRecord?.resultId !== lastSavedResultId
          && Boolean(execution.latestResultRecord?.setup || executedBacktestSetupSnapshot),
        onRunBacktest: runBacktestFromWorkbench,
        onCancelBacktest: execution.cancelActiveBacktestRun,
        runDisabled: Boolean(runLaunchBlockReason),
        runDisabledReason: runLaunchBlockReason,
        onSaveRun: saveCurrentBacktestRun,
        backtestProgress: execution.backtestProgress,
      },
    },
    chartPanelProps: {
      controlsModel: {
        marketSymbol: controls.marketSymbol,
        setMarketSymbol: controls.setMarketSymbol,
        reloadSpotBars: spotHistory.reloadSpotBars,
        candleTf: controls.candleTf,
        spotChartType: controls.spotChartType,
        setSpotChartType: controls.setSpotChartType,
        rayalgoCandleColorMode: controls.rayalgoCandleColorMode,
        setRayalgoCandleColorMode: controls.setRayalgoCandleColorMode,
        applySpotInterval,
        effectiveTf: chartModel.effectiveTf,
        chartRange: controls.chartRange,
        chartWindowMode: controls.chartWindowMode,
        windowDisplayLabel: windowDisplayState.label,
        windowMenuValue: windowDisplayState.menuValue,
        showResetSpotWindow,
        applySpotWindowPreset,
        resetSpotChartWindow,
        executionFidelity: controls.executionFidelity,
        setExecutionFidelity: controls.setExecutionFidelity,
        setIndicatorSelections: controls.setIndicatorSelections,
        indicatorSelections: controls.indicatorSelections,
        indicatorOverlays: controls.indicatorOverlays,
        setIndicatorOverlays: controls.setIndicatorOverlays,
        rayalgoSettings: controls.rayalgoSettings,
        setRayalgoSettings: controls.setRayalgoSettings,
        mergeRayalgoSettings: controls.mergeRayalgoSettings,
        rayalgoWatcherSettings: controls.rayalgoWatcher,
        setRayalgoWatcher: controls.setRayalgoWatcher,
        currentRayalgoBundles: controls.currentRayalgoBundles,
        selectedRayalgoBundle: controls.selectedRayalgoBundle,
        setSelectedRayalgoBundleId: controls.setSelectedRayalgoBundleId,
        isSelectedRayalgoBundleCustom: controls.isSelectedRayalgoBundleCustom,
        applyRayalgoBundle: controls.applyRayalgoBundle,
        revertSelectedRayalgoBundle: controls.revertSelectedRayalgoBundle,
        saveRayalgoBundleVariant: controls.saveRayalgoBundleVariant,
        rayalgoBundleEvaluation: execution.bundleEvaluation,
        setRayalgoBundleTier: controls.setRayalgoBundleTier,
        watcherModel: rayalgoWatcher,
        signalOverlaySupportedTimeframes: execution.indicatorOverlaySupportedTimeframes,
        resolvedSignalTf: chartModel.signalTf,
        resolvedShadingTf: chartModel.shadingTf,
        signalTimeframeState: chartModel.signalTimeframeState,
        shadingTimeframeState: chartModel.shadingTimeframeState,
      },
      statusModel: {
        regimes: execution.regimes,
        dataSource: spotHistory.dataSource,
        dataError: spotHistory.dataError,
        liveBarCount: Array.isArray(spotHistory.liveBars) ? spotHistory.liveBars.length : 0,
        spotDataMeta: spotHistory.spotDataMeta,
        spotStatus: barModel.spotStatus,
        chartSourceLabel: barModel.chartSourceLabel,
        runtimeHealth: runtimeHealth.runtimeHealth,
        hasOlderHistory: spotHistory.hasOlderHistory,
        isLoadingOlderHistory: spotHistory.isLoadingOlderHistory,
        historyLoadMode: spotHistory.historyLoadMode,
        indicatorOverlayTapesByTf: execution.indicatorOverlayTapesByTf,
        spotOverlayModeLabel: hasTradeOverlays && hasIndicatorOverlays
          ? "Trades + indicators"
          : hasIndicatorOverlays
            ? "Indicator overlays"
            : hasTradeOverlays
              ? "Trade overlays"
              : "No overlays",
        surfaceNotice,
      },
      chartModel: {
        spotChartBars: chartModel.chartBars,
        spotChartBarRanges: chartModel.chartBarRanges,
        defaultVisibleLogicalRange: chartModel.defaultVisibleLogicalRange,
        spotTradeOverlays: chartModel.tradeOverlays,
        spotTradeMarkerGroups: chartModel.tradeMarkerGroups,
        spotEntriesByBarIndex: chartModel.entriesByBarIndex,
        spotExitsByBarIndex: chartModel.exitsByBarIndex,
        spotIndicatorMarkerPayload: chartModel.indicatorMarkerPayload,
        spotIndicatorZones: chartModel.indicatorZones,
        spotIndicatorWindows: chartModel.indicatorWindows,
        spotSignalTf: chartModel.signalTf,
        spotShadingTf: chartModel.shadingTf,
        spotStudySpecs: chartModel.studySpecs,
        spotStudyVisibility: chartModel.studyVisibility,
        spotStudyLowerPaneCount: chartModel.studyLowerPaneCount,
        spotSmcMarkers: chartModel.smcMarkers,
        strategy: controls.strategy,
        rangePresetKey: spotChartRangePresetKey,
        baseSeriesModeKey: spotChartBaseSeriesModeKey,
        allowFullIntervalSeries,
        chartType: controls.spotChartType,
        rayalgoCandleColorMode: controls.rayalgoCandleColorMode,
        marketSymbol: controls.marketSymbol,
        spotChartEmptyStateLabel: barModel.chartEmptyStateLabel,
        selectedTradeId: effectiveSelectedTradeId,
        hoveredTradeId: effectiveHoveredTradeId,
        onSelectTrade: selectTradeById,
        onHoverTrade: hoverTradeById,
        showSignals: Boolean(controls.indicatorOverlays.signals?.visible),
        showZones: Boolean(controls.indicatorOverlays.shading?.visible),
        hasOlderHistory: spotHistory.hasOlderHistory,
        isLoadingOlderHistory: spotHistory.isLoadingOlderHistory,
        historyLoadMode: spotHistory.historyLoadMode,
        onRequestOlderHistory: spotHistory.loadOlderSpotBars,
        onRuntimeHealthChange: handleSpotChartRuntimeChange,
        linkedViewportRequest: null,
        coordinationModel: {
          ...sharedChartCoordinationModel,
          chartId: "spot",
        },
      },
    },
    optionPanelProps: {
      marketSymbol: controls.marketSymbol,
      selectedTrade,
      selectedTradeId: effectiveSelectedTradeId,
      optionChartBars: optionChart.optionChartBars,
      optionChartBarRanges: optionChart.optionChartBarRanges,
      optionDefaultVisibleLogicalRange: optionChart.optionDefaultVisibleLogicalRange,
      optionTradeOverlays: optionChart.optionTradeOverlays,
      optionEntriesByBarIndex: optionChart.optionEntriesByBarIndex,
      optionExitsByBarIndex: optionChart.optionExitsByBarIndex,
      optionIndicatorMarkerPayload: optionChart.optionIndicatorMarkerPayload,
      optionIndicatorZones: optionChart.optionIndicatorZones,
      optionIndicatorWindows: optionChart.optionIndicatorWindows,
      optionChartStatus: optionChart.optionChartStatus,
      optionChartError: optionChart.optionChartError,
      optionChartSourceLabel: optionChart.optionChartSourceLabel,
      optionChartEmptyStateLabel: optionChart.optionChartEmptyStateLabel,
      contractSelectionLabel: optionReplay.selectionSummaryLabel,
      resolvedOptionContract: optionChart.resolvedOptionContract,
      resolvedOptionTicker: optionChart.resolvedOptionTicker,
      optionResolutionMeta: optionChart.optionResolutionMeta,
      optionCandleTf: controls.optionCandleTf,
      setOptionCandleTf: controls.setOptionCandleTf,
      optionChartType: controls.optionChartType,
      setOptionChartType: controls.setOptionChartType,
      rayalgoCandleColorMode: controls.rayalgoCandleColorMode,
      showSignals: Boolean(controls.indicatorOverlays.signals?.visible),
      showZones: Boolean(controls.indicatorOverlays.shading?.visible),
      linkedViewportStore: chartsLinked ? viewportLinkStoreRef.current : null,
      coordinationModel: {
        ...sharedChartCoordinationModel,
        chartId: "option",
        selectionLinkToken: selectionLinkEvent.token,
        selectionLinkSourceChartId: selectionLinkEvent.sourceChartId,
      },
    },
    insightsProps: {
      capital: controls.capital,
      metrics: execution.metrics,
      merged: execution.merged,
      eqDomain: execution.eqDomain,
      snap: execution.snap,
      onPinSnap: execution.pinSnap,
      onClearSnap: execution.clearSnap,
      exitBreakdown: execution.exitBreakdown,
      regimeStats: execution.regimeStats,
      bottomTab: execution.bottomTab,
      onSelectTab: execution.selectBottomTab,
      onRunOptimize: execution.runOptimize,
      optRunning: execution.optRunning,
      optError: execution.optError,
      tradePnls: execution.displayTradePnls,
      pnlDist: execution.displayPnlDist,
      hourly: execution.hourly,
      recoMatrix: execution.recoMatrix,
      recoComputing: execution.recoComputing,
      recoError: execution.recoError,
      onComputeReco: execution.computeReco,
      tfMin: barModel.tfMin,
      strategy: controls.strategy,
      onSelectStrategy: controls.selectStrategy,
      strategyPresets: controls.strategyPresets,
      strategyLabel: getStrategyLabel,
      barsLength: barModel.bars.length,
      dataSource: spotHistory.dataSource,
      spotDataMeta: spotHistory.spotDataMeta,
      trades: execution.displayTrades,
      skippedTrades: execution.skippedTrades,
      skippedByReason: execution.skippedByReason,
      replayRunStatus: execution.replayRunStatus,
      replayRunError: execution.replayRunError,
      backtestProgress: execution.backtestProgress,
      liveRunState: execution.liveRunState,
      activeBacktestJob: execution.activeBacktestJob,
      activeOptimizerJob: execution.activeOptimizerJob,
      displayedResultRecord: execution.displayedResultRecord,
      recentBacktestJobs: execution.recentBacktestJobs,
      recentBacktestResults: execution.recentBacktestResults,
      recentOptimizerJobs: execution.recentOptimizerJobs,
      inputImpact: execution.inputImpact,
      onRunInputImpact: execution.runInputImpact,
      rayalgoScoreStudy: execution.rayalgoScoreStudy,
      onRunRayalgoScoringComparison: execution.runRayalgoScoringComparison,
      onRunRayalgoScoreStudy: execution.runRayalgoScoreStudy,
      onQueueRayalgoScoreStudy: execution.queueRayalgoScoreStudyRun,
      onCancelRayalgoScoreStudy: execution.cancelRayalgoScoreStudyRun,
      onRefreshRayalgoScoreStudyCatalog: execution.refreshRayalgoScoreStudyCatalog,
      onSelectRayalgoScoreStudyPreset: execution.selectRayalgoScoreStudyPreset,
      onSelectRayalgoScoreStudyRun: execution.selectRayalgoScoreStudyRun,
      onToggleRayalgoScoreStudyComparisonRun: execution.toggleRayalgoScoreStudyComparisonRun,
      onLoadRayalgoScoreStudyRunDetail: execution.loadRayalgoScoreStudyRunDetail,
      onImportRayalgoScoreStudyLocalArtifact: execution.importRayalgoScoreStudyLocalArtifact,
      stagedConfigModel: {
        state: controls.stagedConfigUiState,
        setField: controls.setStagedConfigField,
        resetSection: controls.resetStagedConfigSection,
      },
      runtimeData: {
        marketSymbol: controls.marketSymbol,
        dataSource: spotHistory.dataSource,
        dataError: spotHistory.dataError,
        hasLoadedSpotHistory: spotHistory.hasLoadedSpotHistory,
        spotDataMeta: spotHistory.spotDataMeta,
        loadedBars: barModel.bars.length,
        liveBarCount: Array.isArray(spotHistory.liveBars) ? spotHistory.liveBars.length : 0,
        hasOlderHistory: spotHistory.hasOlderHistory,
        isLoadingOlderHistory: spotHistory.isLoadingOlderHistory,
        historyLoadMode: spotHistory.historyLoadMode,
        executionFidelity: controls.executionFidelity,
        replayCredentialsReady: optionReplay.replayCredentialsReady,
        replayCredentialSource: optionReplay.replayCredentialSource,
        selectionSummaryLabel: optionReplay.selectionSummaryLabel,
        replayRunStatus: execution.replayRunStatus,
        replayRunError: execution.replayRunError,
        replayDatasetSummary: execution.replayDatasetSummary,
        replaySampleLabel: execution.replaySampleLabel,
        replaySkippedByReason: execution.skippedByReason,
        runIsStale: execution.runIsStale,
        hasQueuedRerun: execution.hasQueuedRerun,
        rayalgoScoringContext: execution.rayalgoScoringContext,
        rayalgoLatestSignal: execution.rayalgoLatestSignal,
        rayalgoScoringComparison: execution.rayalgoScoringComparison,
        canOpenAccounts: typeof navigateToSurface === "function",
        onOpenAccounts: openAccountsSurface,
      },
      logPage: execution.logPage,
      setLogPage: execution.setLogPage,
      selectedTradeId: effectiveSelectedTradeId,
      onSelectTrade: selectTradeById,
      optResults: execution.optResults,
      onApplyOpt: controls.applyOptimizerResult,
      onSaveOptBundle: controls.saveOptimizerResultAsRayalgoBundle,
      onSaveHistoryBundle: saveStoredHistoryRunAsBundle,
      onPromoteBundle: controls.setRayalgoBundleTier,
      runHistory: controls.researchRunHistory,
      optimizerHistory: controls.optimizerHistory,
      rayalgoBundles: controls.rayalgoBundleLibrary,
      currentSetupSnapshot: currentResearchSetupSnapshot,
      currentBundleContext: {
        bundleId: controls.selectedRayalgoBundle?.id || null,
        label: controls.selectedRayalgoBundle?.label || null,
        tier: controls.selectedRayalgoBundle?.evaluation?.tier || "test",
        isCustom: controls.isSelectedRayalgoBundleCustom,
      },
      onLoadHistoryRun: loadHistoryRun,
      onOpenStoredResult: openStoredBacktestResult,
      onApplyHistoryOptimizer: applyStoredOptimizerCandidate,
      onClearRunHistory: controls.clearResearchRunHistory,
      onClearOptimizerHistory: controls.clearResearchOptimizerHistory,
    },
  };
}

if (import.meta.hot && typeof window !== "undefined") {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}
