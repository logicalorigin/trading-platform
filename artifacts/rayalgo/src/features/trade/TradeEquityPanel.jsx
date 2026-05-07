import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getBars as getBarsRequest } from "@workspace/api-client-react";
import {
  DISPLAY_CHART_OUTSIDE_RTH,
  resolveDisplayChartPrice,
} from "../charting/displayChartSession";
import { RayReplicaSettingsMenu } from "../charting/RayReplicaSettingsMenu";
import { ResearchChartFrame } from "../charting/ResearchChartFrame";
import {
  ResearchChartWidgetFooter,
  ResearchChartWidgetHeader,
  ResearchChartWidgetSidebar,
} from "../charting/ResearchChartWidgetChrome";
import {
  expandLocalRollupLimit,
  resolveLocalRollupBaseTimeframe,
  rollupMarketBars,
} from "../charting/timeframeRollups";
import { flowEventsToChartEventConversion } from "../charting/chartEvents";
import {
  getChartBarLimit,
  getChartBrokerRecentWindowMinutes,
  getInitialChartBarLimit,
  normalizeChartTimeframe,
} from "../charting/timeframes";
import { recordChartBarScopeState } from "../charting/chartHydrationStats";
import { resolveSpotChartFrameLayout } from "../charting/spotChartFrameLayout";
import {
  useBrokerStreamedBars,
  usePrependableHistoricalBars,
} from "../charting/useMassiveStreamedStockBars";
import { useDrawingHistory } from "../charting/useDrawingHistory";
import { useIndicatorLibrary } from "../charting/pineScripts";
import {
  buildTradeBarsFromApi,
  describeBrokerChartSource,
  describeBrokerChartStatus,
  resolveBrokerChartSourceState,
  useDisplayChartPriceFallbackBars,
} from "../charting/chartApiBars";
import {
  buildRayReplicaIndicatorSettings,
  isRayReplicaIndicatorSelected,
  resolvePersistedIndicatorPreset,
  resolvePersistedRayReplicaSettings,
} from "../charting/chartIndicatorPersistence";
import {
  buildChartBarScopeKey,
  measureChartBarsRequest,
  useDebouncedVisibleRangeExpansion,
  useMeasuredChartModel,
  useProgressiveChartBarLimit,
  useUnderfilledChartBackfill,
} from "../charting/chartHydrationRuntime";
import {
  isChartBarsPayloadCacheStale,
  normalizeChartBarsPagePayload,
} from "../charting/chartBarsPayloads";
import { useChartTimeframeFavorites } from "../charting/useChartTimeframeFavorites";
import {
  BARS_QUERY_DEFAULTS,
  BARS_REQUEST_PRIORITY,
  buildBarsRequestOptions,
} from "../platform/queryDefaults";
import {
  ensureTradeTickerInfo,
  useRuntimeTickerSnapshot,
} from "../platform/runtimeTickerStore";
import { useSignalMonitorStateForSymbol } from "../platform/signalMonitorStore";
import { resolveSignalFrameState } from "../platform/signalFrameState";
import { useTradeFlowSnapshot } from "../platform/tradeFlowStore";
import {
  DEFAULT_TRADE_EQUITY_STUDIES,
  TRADE_EQUITY_INDICATOR_PRESET_VERSION,
  TRADE_TIMEFRAMES,
  buildTradeBarsPageQueryKey as buildBarsPageQueryKey,
} from "./tradeChartState";
import { _initialState, persistState } from "../../lib/workspaceState";
import { T, getCurrentTheme } from "../../lib/uiTokens";

export const TradeEquityPanel = ({
  ticker,
  flowEvents,
  historicalDataEnabled = true,
  stockAggregateStreamingEnabled = false,
  dataTestId = "trade-equity-chart",
  compact = false,
  surfaceUiStateKey = "trade-equity-chart",
  viewportLayoutKey = null,
  onOpenSearch,
  searchOpen,
  onSearchOpenChange,
  searchContent,
  workspaceChart = null,
  onWorkspaceChartChange,
  referenceLines = [],
  showSignalFrameBorder = true,
}) => {
  const queryClient = useQueryClient();
  const parentFlowEventsProvided = flowEvents !== undefined;
  const tradeFlowSnapshot = useTradeFlowSnapshot(ticker, {
    subscribe: !parentFlowEventsProvided,
  });
  const effectiveFlowEvents = useMemo(
    () =>
      parentFlowEventsProvided
        ? Array.isArray(flowEvents)
          ? flowEvents
          : []
        : tradeFlowSnapshot.events || [],
    [flowEvents, parentFlowEventsProvided, tradeFlowSnapshot.events],
  );
  const tickerFallback = useMemo(
    () => ensureTradeTickerInfo(ticker, ticker),
    [ticker],
  );
  const tickerInfo = useRuntimeTickerSnapshot(ticker, tickerFallback);
  const signalState = useSignalMonitorStateForSymbol(ticker, {
    subscribeToUpdates: showSignalFrameBorder,
  });
  const signalFrameState = useMemo(
    () => (showSignalFrameBorder ? resolveSignalFrameState(signalState, T) : null),
    [showSignalFrameBorder, signalState],
  );
  const hasAnchoredTickerSearch =
    typeof onSearchOpenChange === "function" && searchContent != null;
  const { studies: availableStudies, indicatorRegistry } =
    useIndicatorLibrary();
  const [tf, setTf] = useState(workspaceChart?.timeframe || "5m");
  const {
    favoriteTimeframes: primaryFavoriteTimeframes,
    toggleFavoriteTimeframe: togglePrimaryFavoriteTimeframe,
  } = useChartTimeframeFavorites("primary");
  const [drawMode, setDrawMode] = useState(null);
  const [selectedIndicators, setSelectedIndicators] = useState(() =>
    resolvePersistedIndicatorPreset({
      indicators: _initialState.tradeEquitySelectedIndicators,
      defaults: DEFAULT_TRADE_EQUITY_STUDIES,
      persistedVersion: _initialState.tradeEquityIndicatorPresetVersion,
      currentVersion: TRADE_EQUITY_INDICATOR_PRESET_VERSION,
    }),
  );
  const [rayReplicaSettings, setRayReplicaSettings] = useState(() =>
    resolvePersistedRayReplicaSettings(_initialState.tradeEquityRayReplicaSettings),
  );
  useEffect(() => {
    if (workspaceChart?.timeframe && workspaceChart.timeframe !== tf) {
      setTf(workspaceChart.timeframe);
    }
  }, [ticker, workspaceChart?.timeframe]);
  const spotChartFrameLayout = resolveSpotChartFrameLayout(compact);
  const indicatorSettings = useMemo(
    () => buildRayReplicaIndicatorSettings(rayReplicaSettings),
    [rayReplicaSettings],
  );
  const prewarmedFavoriteTimeframesRef = useRef(null);
  const { drawings, addDrawing, clearDrawings, undo, redo, canUndo, canRedo } =
    useDrawingHistory();
  const rollupBaseTimeframe = useMemo(
    () =>
      resolveLocalRollupBaseTimeframe(
        tf,
        getChartBarLimit(tf, "primary"),
        "primary",
      ),
    [tf],
  );
  const baseBarsScopeKey = buildChartBarScopeKey(
    "trade-equity-base-bars",
    ticker,
    rollupBaseTimeframe,
  );
  const chartHydrationScopeKey = buildChartBarScopeKey(
    "trade-equity-chart",
    ticker,
    tf,
  );
  const progressiveBars = useProgressiveChartBarLimit({
    scopeKey: buildChartBarScopeKey("trade-equity-bars", ticker),
    timeframe: tf,
    role: "primary",
    enabled: Boolean(historicalDataEnabled && ticker),
    warmTargetLimit: useCallback(
      (limit) => {
        const expandedLimit = expandLocalRollupLimit(
          limit,
          tf,
          rollupBaseTimeframe,
        );
        const brokerRecentWindowMinutes =
          getChartBrokerRecentWindowMinutes(
            rollupBaseTimeframe,
            expandedLimit,
          );

        return queryClient.prefetchQuery({
          queryKey: [
            "trade-equity-bars",
            ticker,
            rollupBaseTimeframe,
            expandedLimit,
            brokerRecentWindowMinutes,
          ],
          queryFn: () =>
            measureChartBarsRequest({
              scopeKey: chartHydrationScopeKey,
              metric: "barsRequestMs",
              request: () =>
                getBarsRequest({
                  symbol: ticker,
                  timeframe: rollupBaseTimeframe,
                  limit: expandedLimit,
                  outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
                  source: "trades",
                  allowHistoricalSynthesis: false,
                  brokerRecentWindowMinutes,
                },
                buildBarsRequestOptions(BARS_REQUEST_PRIORITY.active),
              ),
            }),
          ...BARS_QUERY_DEFAULTS,
        });
      },
      [chartHydrationScopeKey, queryClient, rollupBaseTimeframe, tf, ticker],
    ),
  });
  const baseRequestedLimit = useMemo(
    () =>
      expandLocalRollupLimit(
        progressiveBars.requestedLimit,
        tf,
        rollupBaseTimeframe,
      ),
    [progressiveBars.requestedLimit, rollupBaseTimeframe, tf],
  );
  const baseBrokerRecentWindowMinutes = useMemo(
    () =>
      getChartBrokerRecentWindowMinutes(
        rollupBaseTimeframe,
        baseRequestedLimit,
      ),
    [baseRequestedLimit, rollupBaseTimeframe],
  );
  const barsQuery = useQuery({
    queryKey: [
      "trade-equity-bars",
      ticker,
      rollupBaseTimeframe,
      baseRequestedLimit,
      baseBrokerRecentWindowMinutes,
    ],
    queryFn: () =>
      measureChartBarsRequest({
        scopeKey: chartHydrationScopeKey,
        metric: "barsRequestMs",
        request: () =>
          getBarsRequest({
            symbol: ticker,
            timeframe: rollupBaseTimeframe,
            limit: baseRequestedLimit,
            outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
            source: "trades",
            allowHistoricalSynthesis: false,
            brokerRecentWindowMinutes: baseBrokerRecentWindowMinutes,
          },
          buildBarsRequestOptions(BARS_REQUEST_PRIORITY.active),
        ),
      }),
    enabled: Boolean(historicalDataEnabled && ticker),
    ...BARS_QUERY_DEFAULTS,
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const baseBarsPage = useMemo(
    () =>
      normalizeChartBarsPagePayload(barsQuery.data, {
        context: "trade-equity-base",
        scopeKey: chartHydrationScopeKey,
      }),
    [barsQuery.data, chartHydrationScopeKey],
  );
  const baseBarsCacheStale = isChartBarsPayloadCacheStale(
    barsQuery.data,
    baseBarsPage.historyPage,
  );
  const baseBarsReady = Boolean(
    barsQuery.isSuccess &&
      barsQuery.fetchStatus !== "fetching" &&
      !baseBarsCacheStale,
  );
  useEffect(() => {
    if (!baseBarsPage.bars.length) {
      return;
    }

    progressiveBars.hydrateFullWindow();
  }, [baseBarsPage.bars.length, progressiveBars.hydrateFullWindow]);
  const prewarmFavoriteTimeframe = useCallback(
    (nextTimeframe) => {
      const favoriteTimeframe = normalizeChartTimeframe(nextTimeframe);
      if (!ticker || favoriteTimeframe === tf) {
        return;
      }

      const favoriteBaseTimeframe = resolveLocalRollupBaseTimeframe(
        favoriteTimeframe,
        getChartBarLimit(favoriteTimeframe, "primary"),
        "primary",
      );
      const favoriteLimit = expandLocalRollupLimit(
        getInitialChartBarLimit(favoriteTimeframe, "primary"),
        favoriteTimeframe,
        favoriteBaseTimeframe,
      );
      const favoriteBrokerRecentWindowMinutes =
        getChartBrokerRecentWindowMinutes(
          favoriteBaseTimeframe,
          favoriteLimit,
        );

      queryClient.prefetchQuery({
        queryKey: [
          "trade-equity-bars",
          ticker,
          favoriteBaseTimeframe,
          favoriteLimit,
          favoriteBrokerRecentWindowMinutes,
        ],
        queryFn: () =>
          measureChartBarsRequest({
            scopeKey: buildChartBarScopeKey(
              "trade-equity-chart",
              ticker,
              favoriteTimeframe,
            ),
            metric: "favoritePrewarmRequestMs",
            request: () =>
              getBarsRequest(
                {
                  symbol: ticker,
                  timeframe: favoriteBaseTimeframe,
                  limit: favoriteLimit,
                  outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
                  source: "trades",
                  allowHistoricalSynthesis: false,
                  brokerRecentWindowMinutes:
                    favoriteBrokerRecentWindowMinutes,
                },
                buildBarsRequestOptions(BARS_REQUEST_PRIORITY.favoritePrewarm),
              ),
          }),
        ...BARS_QUERY_DEFAULTS,
      });
    },
    [queryClient, tf, ticker],
  );
  useEffect(() => {
    if (
      !historicalDataEnabled ||
      !barsQuery.data?.bars?.length ||
      !primaryFavoriteTimeframes.length
    ) {
      return;
    }

    const prewarmKey = [
      chartHydrationScopeKey,
      primaryFavoriteTimeframes.join(","),
    ].join("::");
    if (prewarmedFavoriteTimeframesRef.current === prewarmKey) {
      return;
    }

    prewarmedFavoriteTimeframesRef.current = prewarmKey;
    primaryFavoriteTimeframes.forEach(prewarmFavoriteTimeframe);
  }, [
    barsQuery.data?.bars?.length,
    chartHydrationScopeKey,
    historicalDataEnabled,
    prewarmFavoriteTimeframe,
    primaryFavoriteTimeframes,
  ]);
  const prependableBars = usePrependableHistoricalBars({
    scopeKey: baseBarsScopeKey,
    timeframe: rollupBaseTimeframe,
    pageSizeTimeframe: tf,
    bars: baseBarsPage.bars,
    baseBarsReady,
    enabled: Boolean(historicalDataEnabled && ticker),
    fetchOlderBars: useCallback(
      async ({ from, to, limit, historyCursor, preferCursor }) => {
        const fromIso = from.toISOString();
        const toIso = to.toISOString();
        const brokerRecentWindowMinutes = 0;
        const payload = await queryClient.fetchQuery({
          queryKey: buildBarsPageQueryKey({
            queryBase: ["trade-equity-bars-prepend", ticker],
            timeframe: rollupBaseTimeframe,
            limit,
            from: fromIso,
            to: toIso,
            historyCursor: historyCursor || null,
            preferCursor: Boolean(historyCursor && preferCursor),
            brokerRecentWindowMinutes,
          }),
          queryFn: () =>
            measureChartBarsRequest({
              scopeKey: chartHydrationScopeKey,
              metric: "prependRequestMs",
              request: () =>
                getBarsRequest({
                  symbol: ticker,
                  timeframe: rollupBaseTimeframe,
                  limit,
                  from: fromIso,
                  to: toIso,
                  outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
                  source: "trades",
                  allowHistoricalSynthesis: false,
                  historyCursor: historyCursor || undefined,
                  preferCursor: historyCursor && preferCursor ? true : undefined,
                  brokerRecentWindowMinutes,
                },
                buildBarsRequestOptions(BARS_REQUEST_PRIORITY.active),
              ),
            }),
            ...BARS_QUERY_DEFAULTS,
          });

        return normalizeChartBarsPagePayload(payload, {
          context: "trade-equity-prepend",
          scopeKey: chartHydrationScopeKey,
        });
      },
      [chartHydrationScopeKey, queryClient, rollupBaseTimeframe, ticker],
    ),
  });
  useUnderfilledChartBackfill({
    scopeKey: baseBarsScopeKey,
    enabled: Boolean(
      historicalDataEnabled && ticker && barsQuery.data?.bars?.length,
    ),
    loadedBarCount: prependableBars.loadedBarCount,
    requestedLimit: baseRequestedLimit,
    minPageSize: getInitialChartBarLimit(tf, "primary"),
    isPrependingOlder: prependableBars.isPrependingOlder,
    hasExhaustedOlderHistory: prependableBars.hasExhaustedOlderHistory,
    prependOlderBars: prependableBars.prependOlderBars,
  });
  const streamedSourceBars = useBrokerStreamedBars({
    symbol: ticker,
    timeframe: rollupBaseTimeframe,
    bars: prependableBars.bars,
    enabled: Boolean(stockAggregateStreamingEnabled && ticker),
    instrumentationScope: baseBarsScopeKey,
  });
  const liveBars = useMemo(
    () => buildTradeBarsFromApi(streamedSourceBars),
    [streamedSourceBars],
  );
  const hydratedBaseBars = useMemo(
    () =>
      rollupMarketBars(
        buildTradeBarsFromApi(prependableBars.bars),
        rollupBaseTimeframe,
        tf,
      ),
    [prependableBars.bars, rollupBaseTimeframe, tf],
  );
  const bars = useMemo(
    () => rollupMarketBars(liveBars, rollupBaseTimeframe, tf),
    [liveBars, rollupBaseTimeframe, tf],
  );
  const displayPriceFallbackQuery = useDisplayChartPriceFallbackBars({
    symbol: ticker,
    enabled: Boolean(
      historicalDataEnabled &&
        ticker &&
        !bars.length &&
        !Number.isFinite(tickerInfo?.price),
    ),
    scopeKey: chartHydrationScopeKey,
    priority: BARS_REQUEST_PRIORITY.active,
    metric: "displayPriceFallbackRequestMs",
  });
  useEffect(() => {
    recordChartBarScopeState(chartHydrationScopeKey, {
      timeframe: tf,
      role: "primary",
      requestedLimit: progressiveBars.requestedLimit,
      initialLimit: getInitialChartBarLimit(tf, "primary"),
      targetLimit: progressiveBars.targetLimit,
      maxLimit: progressiveBars.maxLimit,
      hydratedBaseCount: hydratedBaseBars.length,
      renderedBarCount: bars.length,
      livePatchedBarCount: Math.max(0, bars.length - hydratedBaseBars.length),
      oldestLoadedAt: prependableBars.oldestLoadedAtMs
        ? new Date(prependableBars.oldestLoadedAtMs).toISOString()
        : null,
      isPrependingOlder: prependableBars.isPrependingOlder,
      hasExhaustedOlderHistory: prependableBars.hasExhaustedOlderHistory,
      olderHistoryNextBeforeAt: prependableBars.olderHistoryNextBeforeMs
        ? new Date(prependableBars.olderHistoryNextBeforeMs).toISOString()
        : null,
      emptyOlderHistoryWindowCount:
        prependableBars.emptyOlderHistoryWindowCount,
      olderHistoryPageCount: prependableBars.olderHistoryPageCount,
      olderHistoryProvider: prependableBars.olderHistoryProvider,
      olderHistoryExhaustionReason:
        prependableBars.olderHistoryExhaustionReason,
      olderHistoryProviderCursor: prependableBars.olderHistoryProviderCursor,
      olderHistoryProviderNextUrl: prependableBars.olderHistoryProviderNextUrl,
      olderHistoryProviderPageCount:
        prependableBars.olderHistoryProviderPageCount,
      olderHistoryProviderPageLimitReached:
        prependableBars.olderHistoryProviderPageLimitReached,
      olderHistoryCursor: prependableBars.olderHistoryCursor,
    });
  }, [
    bars.length,
    chartHydrationScopeKey,
    hydratedBaseBars.length,
    prependableBars.hasExhaustedOlderHistory,
    prependableBars.emptyOlderHistoryWindowCount,
    prependableBars.olderHistoryExhaustionReason,
    prependableBars.olderHistoryNextBeforeMs,
    prependableBars.olderHistoryPageCount,
    prependableBars.olderHistoryProvider,
    prependableBars.olderHistoryProviderCursor,
    prependableBars.olderHistoryProviderNextUrl,
    prependableBars.olderHistoryProviderPageCount,
    prependableBars.olderHistoryProviderPageLimitReached,
    prependableBars.olderHistoryCursor,
    prependableBars.isPrependingOlder,
    prependableBars.loadedBarCount,
    prependableBars.oldestLoadedAtMs,
    progressiveBars.maxLimit,
    progressiveBars.requestedLimit,
    progressiveBars.targetLimit,
    tf,
  ]);
  const latestBar = bars[bars.length - 1];
  const latestBarSource = String(latestBar?.source || "");
  const hasBrokerLiveBar =
    latestBarSource === "ibkr-websocket-derived" ||
    latestBarSource.startsWith("ibkr-websocket-derived:");
  const barsStatus = !bars.length
    ? barsQuery.isPending || barsQuery.fetchStatus === "fetching"
      ? "loading"
      : "empty"
    : stockAggregateStreamingEnabled && hasBrokerLiveBar
      ? "live"
      : baseBarsCacheStale
      ? "stale"
      : "live";
  const chartEventConversion = useMemo(
    () => flowEventsToChartEventConversion(effectiveFlowEvents || [], ticker),
    [effectiveFlowEvents, ticker],
  );
  const chartEvents = chartEventConversion.events;
  const chartModel = useMeasuredChartModel({
    scopeKey: chartHydrationScopeKey,
    bars,
    buildInput: {
      bars,
      timeframe: tf,
      defaultVisibleBarCount: progressiveBars.targetLimit,
      selectedIndicators,
      indicatorSettings,
      indicatorRegistry,
      indicatorMarkers: [],
    },
    deps: [
      bars,
      chartHydrationScopeKey,
      indicatorRegistry,
      indicatorSettings,
      progressiveBars.targetLimit,
      selectedIndicators,
      tf,
    ],
  });
  const previousClose =
    Number.isFinite(tickerInfo?.prevClose)
      ? tickerInfo.prevClose
      : bars.length > 1
        ? (bars[bars.length - 2]?.c ?? null)
        : null;
  const displayPrice = resolveDisplayChartPrice({
    quotePrice: tickerInfo?.price,
    canonicalBars: displayPriceFallbackQuery.data?.bars,
    renderedBars: bars,
  });
  const displayChange =
    Number.isFinite(displayPrice) && Number.isFinite(previousClose)
      ? displayPrice - previousClose
      : null;
  const displayPct =
    Number.isFinite(displayChange) &&
    Number.isFinite(previousClose) &&
    previousClose !== 0
      ? (displayChange / previousClose) * 100
      : null;
  const equityChartName = ticker ? `${ticker} spot` : "Spot chart";
  const equityChartSourceState = resolveBrokerChartSourceState({
    latestBar,
    status: barsStatus,
    timeframe: tf,
    streamingEnabled: stockAggregateStreamingEnabled,
    market: "stocks",
  });
  const equityChartStatus =
    equityChartSourceState.label || describeBrokerChartStatus(barsStatus, tf);
  const equityChartSource =
    equityChartSourceState.sourceLabel || describeBrokerChartSource(latestBar?.source);
  const callFlows = chartEvents.filter((event) => {
    const right = String(event.metadata?.cp || event.metadata?.right || "").toUpperCase();
    return right === "C" || right === "CALL";
  }).length;
  const putFlows = chartEvents.filter((event) => {
    const right = String(event.metadata?.cp || event.metadata?.right || "").toUpperCase();
    return right === "P" || right === "PUT";
  }).length;
  const toggleIndicator = (indicatorId) => {
    setSelectedIndicators((current) =>
      current.includes(indicatorId)
        ? current.filter((value) => value !== indicatorId)
        : [...current, indicatorId],
    );
  };
  const handleChangeTimeframe = useCallback((timeframe) => {
    setTf(timeframe);
    onWorkspaceChartChange?.({ timeframe });
  }, [onWorkspaceChartChange]);

  useEffect(() => {
    persistState({
      tradeEquitySelectedIndicators: selectedIndicators,
      tradeEquityIndicatorPresetVersion: TRADE_EQUITY_INDICATOR_PRESET_VERSION,
    });
  }, [selectedIndicators]);

  useEffect(() => {
    persistState({ tradeEquityRayReplicaSettings: rayReplicaSettings });
  }, [rayReplicaSettings]);

  const expandVisibleLogicalRange = useCallback(
    (range) => {
      progressiveBars.expandForVisibleRange(range, bars.length, {
        oldestLoadedAtMs: prependableBars.oldestLoadedAtMs,
        prependOlderBars: prependableBars.prependOlderBars,
      });
    },
    [
      bars.length,
      prependableBars.oldestLoadedAtMs,
      prependableBars.prependOlderBars,
      progressiveBars.expandForVisibleRange,
    ],
  );
  const scheduleVisibleRangeExpansion = useDebouncedVisibleRangeExpansion(
    expandVisibleLogicalRange,
    { resetKey: chartHydrationScopeKey },
  );
  const handleVisibleLogicalRangeChange = useCallback(
    (range) => {
      scheduleVisibleRangeExpansion(range);
    },
    [scheduleVisibleRangeExpansion],
  );

  return (
    <ResearchChartFrame
      dataTestId={dataTestId}
      theme={T}
      themeKey={getCurrentTheme()}
      surfaceUiStateKey={surfaceUiStateKey}
      rangeIdentityKey={chartHydrationScopeKey}
      viewportLayoutKey={viewportLayoutKey}
      model={chartModel}
      compact={compact}
      frameSignalState={showSignalFrameBorder ? signalFrameState : null}
      chartEvents={chartEvents}
      chartFlowDiagnostics={chartEventConversion}
      showSurfaceToolbar={false}
      showLegend
      legend={{
        symbol: ticker,
        name: equityChartName,
        timeframe: tf,
        statusLabel: equityChartStatus,
        statusTone: equityChartSourceState.tone,
        priceLabel: "Spot",
        price: displayPrice,
        changePercent: displayPct,
        meta: {
          open: latestBar?.o,
          high: latestBar?.h,
          low: latestBar?.l,
          close: latestBar?.c,
          volume: latestBar?.v,
          vwap: latestBar?.vwap,
          sessionVwap: latestBar?.sessionVwap,
          accumulatedVolume: latestBar?.accumulatedVolume,
          averageTradeSize: latestBar?.averageTradeSize,
          timestamp: latestBar?.ts,
          sourceLabel: equityChartSource,
        },
        studies: availableStudies,
        selectedStudies: selectedIndicators,
      }}
      referenceLines={referenceLines}
      drawings={drawings}
      drawMode={drawMode}
      onAddDrawing={addDrawing}
      onVisibleLogicalRangeChange={handleVisibleLogicalRangeChange}
      emptyState={{
        eyebrow: "Spot feed",
        title: equityChartStatus,
        detail: `${ticker || "Selected symbol"} ${tf} spot bars are not hydrated for the broker feed yet.`,
      }}
      surfaceTopOverlay={(controls) => (
        <ResearchChartWidgetHeader
          theme={T}
          controls={controls}
          symbol={ticker}
          name={equityChartName}
          price={displayPrice}
          changePercent={displayPct}
          statusLabel={equityChartStatus}
          statusTone={equityChartSourceState.tone}
          timeframe={tf}
          showInlineLegend={false}
          timeframeOptions={TRADE_TIMEFRAMES.map((timeframe) => ({
            value: timeframe.v,
            label: timeframe.tag,
          }))}
          onChangeTimeframe={handleChangeTimeframe}
          favoriteTimeframes={primaryFavoriteTimeframes}
          onToggleFavoriteTimeframe={togglePrimaryFavoriteTimeframe}
          onPrewarmTimeframe={prewarmFavoriteTimeframe}
          onOpenSearch={hasAnchoredTickerSearch ? undefined : onOpenSearch}
          searchOpen={searchOpen}
          onSearchOpenChange={onSearchOpenChange}
          searchContent={searchContent}
          dense={compact}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          showUndoRedo
          studies={availableStudies}
          selectedStudies={selectedIndicators}
          studySpecs={chartModel.studySpecs}
          onToggleStudy={toggleIndicator}
          rightSlot={
            <RayReplicaSettingsMenu
              theme={T}
              settings={rayReplicaSettings}
              onChange={setRayReplicaSettings}
              disabled={!isRayReplicaIndicatorSelected(selectedIndicators)}
            />
          }
          meta={{
            open: latestBar?.o,
            high: latestBar?.h,
            low: latestBar?.l,
            close: latestBar?.c,
            volume: latestBar?.v,
            vwap: latestBar?.vwap,
            sessionVwap: latestBar?.sessionVwap,
            accumulatedVolume: latestBar?.accumulatedVolume,
            averageTradeSize: latestBar?.averageTradeSize,
            timestamp: latestBar?.ts,
            sourceLabel: equityChartSource,
          }}
        />
      )}
      surfaceTopOverlayHeight={spotChartFrameLayout.surfaceTopOverlayHeight}
      surfaceLeftOverlay={(controls) => (
        <ResearchChartWidgetSidebar
          theme={T}
          controls={controls}
          drawMode={drawMode}
          drawingCount={drawings.length}
          onToggleDrawMode={setDrawMode}
          onClearDrawings={() => {
            clearDrawings();
            setDrawMode(null);
          }}
          dense={compact}
        />
      )}
      surfaceLeftOverlayWidth={spotChartFrameLayout.surfaceLeftOverlayWidth}
      surfaceBottomOverlay={(controls) => (
        <ResearchChartWidgetFooter
          theme={T}
          controls={controls}
          studies={availableStudies}
          selectedStudies={selectedIndicators}
          studySpecs={chartModel.studySpecs}
          onToggleStudy={toggleIndicator}
          dense={compact}
          statusText={`${equityChartStatus}  C ${callFlows}  P ${putFlows}  Flow amber`}
        />
      )}
      surfaceBottomOverlayHeight={spotChartFrameLayout.surfaceBottomOverlayHeight}
    />
  );
};
