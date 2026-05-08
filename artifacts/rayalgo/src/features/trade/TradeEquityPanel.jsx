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
  rollupMarketBars,
} from "../charting/timeframeRollups";
import {
  filterFlowEventsForChartLookbackWindow,
  mergeFlowEventFeeds,
} from "../charting/chartEvents";
import {
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
  mergeChartBarsByTime,
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
  normalizeChartHydrationRole,
  resolveChartHydrationPolicy,
  resolveChartHydrationRequestPolicy,
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
import {
  buildChartBarsCacheKey,
  hydrateQueryFromRuntimeCache,
  readCachedChartBars,
  writeCachedChartBars,
} from "../platform/runtimeCache";
import { useSignalMonitorStateForSymbol } from "../platform/signalMonitorStore";
import { resolveSignalFrameState } from "../platform/signalFrameState";
import { useTradeFlowSnapshot } from "../platform/tradeFlowStore";
import {
  filterFlowEventsForChartDisplay,
  useFlowTapeFilterState,
} from "../platform/flowFilterStore";
import { useFlowChartEventConversion } from "../workers/analyticsClient";
import {
  DEFAULT_TRADE_EQUITY_STUDIES,
  TRADE_EQUITY_INDICATOR_PRESET_VERSION,
  TRADE_TIMEFRAMES,
  buildTradeBarsPageQueryKey as buildBarsPageQueryKey,
} from "./tradeChartState";
import { _initialState, persistState } from "../../lib/workspaceState";
import { T, getCurrentTheme } from "../../lib/uiTokens";
import { PlatformErrorBoundary } from "../../components/platform/PlatformErrorBoundary";

const COMPACT_FULL_WINDOW_HYDRATION_DELAY_MS = 30_000;
const MINI_FULL_WINDOW_HYDRATION_DELAY_MS = 2_500;

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
  prewarmFavoriteTimeframesEnabled = true,
  flowEventsSourceMode = "merge-store",
  chartHydrationRole = "primary",
}) => {
  const queryClient = useQueryClient();
  const effectiveChartHydrationRole =
    normalizeChartHydrationRole(chartHydrationRole);
  const shouldMergeTradeFlowStore = flowEventsSourceMode !== "provided";
  const tradeFlowSnapshot = useTradeFlowSnapshot(ticker, {
    subscribe: shouldMergeTradeFlowStore,
  });
  const flowTapeFilters = useFlowTapeFilterState({
    subscribe: shouldMergeTradeFlowStore,
  });
  const effectiveFlowEvents = useMemo(
    () => {
      const providedFlowEvents = Array.isArray(flowEvents) ? flowEvents : [];
      if (!shouldMergeTradeFlowStore) {
        return providedFlowEvents;
      }
      return mergeFlowEventFeeds(
        tradeFlowSnapshot.events || [],
        providedFlowEvents,
      );
    },
    [flowEvents, shouldMergeTradeFlowStore, tradeFlowSnapshot.events],
  );
  const chartDisplayFlowEvents = useMemo(
    () =>
      shouldMergeTradeFlowStore
        ? filterFlowEventsForChartDisplay(effectiveFlowEvents, flowTapeFilters)
        : effectiveFlowEvents,
    [effectiveFlowEvents, flowTapeFilters, shouldMergeTradeFlowStore],
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
  const [intervalChangeRevision, setIntervalChangeRevision] = useState(0);
  const {
    favoriteTimeframes: chartFavoriteTimeframes,
    toggleFavoriteTimeframe: toggleChartFavoriteTimeframe,
  } = useChartTimeframeFavorites(effectiveChartHydrationRole);
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
    const nextWorkspaceTimeframe = normalizeChartTimeframe(
      workspaceChart?.timeframe,
    );
    if (!nextWorkspaceTimeframe) {
      return;
    }
    setTf((currentTimeframe) => {
      if (nextWorkspaceTimeframe === currentTimeframe) {
        return currentTimeframe;
      }
      setIntervalChangeRevision((revision) => revision + 1);
      return nextWorkspaceTimeframe;
    });
  }, [ticker, workspaceChart?.timeframe]);
  const spotChartFrameLayout = resolveSpotChartFrameLayout(compact);
  const indicatorSettings = useMemo(
    () => buildRayReplicaIndicatorSettings(rayReplicaSettings),
    [rayReplicaSettings],
  );
  const prewarmedFavoriteTimeframesRef = useRef(null);
  const { drawings, addDrawing, clearDrawings, undo, redo, canUndo, canRedo } =
    useDrawingHistory();
  const chartHydrationBasePolicy = useMemo(
    () =>
      resolveChartHydrationPolicy({
        timeframe: tf,
        role: effectiveChartHydrationRole,
      }),
    [effectiveChartHydrationRole, tf],
  );
  const rollupBaseTimeframe = chartHydrationBasePolicy.baseTimeframe;
  const chartHydrationWarmPriority =
    effectiveChartHydrationRole === "mini"
      ? BARS_REQUEST_PRIORITY.favoritePrewarm
      : BARS_REQUEST_PRIORITY.visible;
  const baseBarsScopeKey = buildChartBarScopeKey(
    "trade-equity-base-bars",
    effectiveChartHydrationRole,
    ticker,
    rollupBaseTimeframe,
    tf,
  );
  const chartHydrationScopeKey = buildChartBarScopeKey(
    "trade-equity-chart",
    effectiveChartHydrationRole,
    ticker,
    tf,
  );
  const progressiveBars = useProgressiveChartBarLimit({
    scopeKey: buildChartBarScopeKey(
      "trade-equity-bars",
      effectiveChartHydrationRole,
      ticker,
    ),
    timeframe: tf,
    role: effectiveChartHydrationRole,
    hydrationPriority: chartHydrationWarmPriority,
    enabled: Boolean(historicalDataEnabled && ticker),
    warmTargetLimit: useCallback(
      (limit) => {
        const requestPolicy = resolveChartHydrationRequestPolicy({
          timeframe: tf,
          role: effectiveChartHydrationRole,
          requestedLimit: limit,
        });

        return queryClient.prefetchQuery({
          queryKey: [
            "trade-equity-bars",
            effectiveChartHydrationRole,
            ticker,
            requestPolicy.baseTimeframe,
            requestPolicy.baseLimit,
            requestPolicy.brokerRecentWindowMinutes,
          ],
          queryFn: () =>
            measureChartBarsRequest({
              scopeKey: chartHydrationScopeKey,
              metric: "barsRequestMs",
              request: () =>
                getBarsRequest({
                  symbol: ticker,
                  timeframe: requestPolicy.baseTimeframe,
                  limit: requestPolicy.baseLimit,
                  outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
                  source: "trades",
                  allowHistoricalSynthesis: true,
                  brokerRecentWindowMinutes:
                    requestPolicy.brokerRecentWindowMinutes,
                },
                buildBarsRequestOptions(chartHydrationWarmPriority),
              ),
            }),
          ...BARS_QUERY_DEFAULTS,
        });
      },
      [
        chartHydrationScopeKey,
        chartHydrationWarmPriority,
        effectiveChartHydrationRole,
        queryClient,
        tf,
        ticker,
      ],
    ),
  });
  const chartHydrationRequestPolicy = useMemo(
    () =>
      resolveChartHydrationRequestPolicy({
        timeframe: tf,
        role: effectiveChartHydrationRole,
        requestedLimit: progressiveBars.requestedLimit,
      }),
    [effectiveChartHydrationRole, progressiveBars.requestedLimit, tf],
  );
  const baseRequestedLimit = chartHydrationRequestPolicy.baseLimit;
  const baseBrokerRecentWindowMinutes =
    chartHydrationRequestPolicy.brokerRecentWindowMinutes;
  const barsQueryKey = useMemo(
    () => [
      "trade-equity-bars",
      effectiveChartHydrationRole,
      ticker,
      rollupBaseTimeframe,
      baseRequestedLimit,
      baseBrokerRecentWindowMinutes,
    ],
    [
      baseBrokerRecentWindowMinutes,
      baseRequestedLimit,
      effectiveChartHydrationRole,
      rollupBaseTimeframe,
      ticker,
    ],
  );
  const barsRuntimeCacheKey = useMemo(
    () =>
      buildChartBarsCacheKey({
        symbol: ticker,
        timeframe: rollupBaseTimeframe,
        session: DISPLAY_CHART_OUTSIDE_RTH ? "extended" : "regular",
        source: "trade-equity",
        identity: [
          effectiveChartHydrationRole,
          baseRequestedLimit,
          baseBrokerRecentWindowMinutes ?? "recent",
        ].join("-"),
      }),
    [
      baseBrokerRecentWindowMinutes,
      baseRequestedLimit,
      effectiveChartHydrationRole,
      rollupBaseTimeframe,
      ticker,
    ],
  );
  useEffect(() => {
    if (!historicalDataEnabled || !ticker) {
      return;
    }
    void hydrateQueryFromRuntimeCache({
      queryClient,
      queryKey: barsQueryKey,
      read: () => readCachedChartBars(barsRuntimeCacheKey),
    });
  }, [
    barsQueryKey,
    barsRuntimeCacheKey,
    historicalDataEnabled,
    queryClient,
    ticker,
  ]);
  const barsQuery = useQuery({
    queryKey: barsQueryKey,
    queryFn: async () => {
      const payload = await measureChartBarsRequest({
        scopeKey: chartHydrationScopeKey,
        metric: "barsRequestMs",
        request: () =>
          getBarsRequest({
            symbol: ticker,
            timeframe: rollupBaseTimeframe,
            limit: baseRequestedLimit,
            outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
            source: "trades",
            allowHistoricalSynthesis: true,
            brokerRecentWindowMinutes: baseBrokerRecentWindowMinutes,
          },
          buildBarsRequestOptions(BARS_REQUEST_PRIORITY.active),
        ),
      });
      void writeCachedChartBars(barsRuntimeCacheKey, payload, {
        ticker,
        interval: rollupBaseTimeframe,
        session: DISPLAY_CHART_OUTSIDE_RTH ? "extended" : "regular",
        source: "trade-equity",
      });
      return payload;
    },
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
      return undefined;
    }

    if (!compact || intervalChangeRevision > 0) {
      progressiveBars.hydrateFullWindow();
      return undefined;
    }

    const hydrationDelayMs =
      effectiveChartHydrationRole === "mini"
        ? MINI_FULL_WINDOW_HYDRATION_DELAY_MS
        : COMPACT_FULL_WINDOW_HYDRATION_DELAY_MS;
    const timer = setTimeout(() => {
      progressiveBars.hydrateFullWindow();
    }, hydrationDelayMs);
    return () => clearTimeout(timer);
  }, [
    baseBarsPage.bars.length,
    compact,
    effectiveChartHydrationRole,
    intervalChangeRevision,
    progressiveBars.hydrateFullWindow,
  ]);
  const prewarmFavoriteTimeframe = useCallback(
    (nextTimeframe) => {
      const favoriteTimeframe = normalizeChartTimeframe(nextTimeframe);
      if (!ticker || favoriteTimeframe === tf) {
        return;
      }

      const favoriteHydrationPolicy = resolveChartHydrationPolicy({
        timeframe: favoriteTimeframe,
        role: effectiveChartHydrationRole,
      });
      const favoriteRequestPolicy = resolveChartHydrationRequestPolicy({
        timeframe: favoriteTimeframe,
        role: effectiveChartHydrationRole,
        requestedLimit: favoriteHydrationPolicy.initialLimit,
      });

      queryClient.prefetchQuery({
        queryKey: [
          "trade-equity-bars",
          effectiveChartHydrationRole,
          ticker,
          favoriteRequestPolicy.baseTimeframe,
          favoriteRequestPolicy.baseLimit,
          favoriteRequestPolicy.brokerRecentWindowMinutes,
        ],
        queryFn: () =>
          measureChartBarsRequest({
            scopeKey: buildChartBarScopeKey(
              "trade-equity-chart",
              effectiveChartHydrationRole,
              ticker,
              favoriteTimeframe,
            ),
            metric: "favoritePrewarmRequestMs",
            request: () =>
              getBarsRequest(
                {
                  symbol: ticker,
                  timeframe: favoriteRequestPolicy.baseTimeframe,
                  limit: favoriteRequestPolicy.baseLimit,
                  outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
                  source: "trades",
                  allowHistoricalSynthesis: true,
                  brokerRecentWindowMinutes:
                    favoriteRequestPolicy.brokerRecentWindowMinutes,
                },
                buildBarsRequestOptions(BARS_REQUEST_PRIORITY.favoritePrewarm),
              ),
          }),
        ...BARS_QUERY_DEFAULTS,
      });
    },
    [effectiveChartHydrationRole, queryClient, tf, ticker],
  );
  useEffect(() => {
    if (
      !prewarmFavoriteTimeframesEnabled ||
      !historicalDataEnabled ||
      !barsQuery.data?.bars?.length ||
      !chartFavoriteTimeframes.length
    ) {
      return;
    }

    const prewarmKey = [
      chartHydrationScopeKey,
      chartFavoriteTimeframes.join(","),
    ].join("::");
    if (prewarmedFavoriteTimeframesRef.current === prewarmKey) {
      return;
    }

    prewarmedFavoriteTimeframesRef.current = prewarmKey;
    chartFavoriteTimeframes.forEach(prewarmFavoriteTimeframe);
  }, [
    barsQuery.data?.bars?.length,
    chartHydrationScopeKey,
    chartFavoriteTimeframes,
    historicalDataEnabled,
    prewarmFavoriteTimeframesEnabled,
    prewarmFavoriteTimeframe,
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
            queryBase: [
              "trade-equity-bars-prepend",
              effectiveChartHydrationRole,
              ticker,
            ],
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
                  allowHistoricalSynthesis: true,
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
      [
        chartHydrationScopeKey,
        effectiveChartHydrationRole,
        queryClient,
        rollupBaseTimeframe,
        ticker,
      ],
    ),
  });
  const hydratedBaseBars = useMemo(
    () =>
      rollupMarketBars(
        buildTradeBarsFromApi(prependableBars.bars),
        rollupBaseTimeframe,
        tf,
      ),
    [prependableBars.bars, rollupBaseTimeframe, tf],
  );
  useUnderfilledChartBackfill({
    scopeKey: baseBarsScopeKey,
    enabled: Boolean(
      historicalDataEnabled && ticker && barsQuery.data?.bars?.length,
    ),
    loadedBarCount: hydratedBaseBars.length,
    requestedLimit: progressiveBars.requestedLimit,
    minPageSize: chartHydrationBasePolicy.initialLimit,
    hydrationPriority: chartHydrationWarmPriority,
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
  const streamedChartBars = useMemo(
    () => rollupMarketBars(liveBars, rollupBaseTimeframe, tf),
    [liveBars, rollupBaseTimeframe, tf],
  );
  const bars = useMemo(
    () => mergeChartBarsByTime(hydratedBaseBars, streamedChartBars),
    [hydratedBaseBars, streamedChartBars],
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
      role: effectiveChartHydrationRole,
      requestedLimit: progressiveBars.requestedLimit,
      initialLimit: chartHydrationBasePolicy.initialLimit,
      baseRequestedLimit,
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
    baseRequestedLimit,
    chartHydrationBasePolicy.initialLimit,
    chartHydrationScopeKey,
    effectiveChartHydrationRole,
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
    latestBarSource === "ibkr-stock-quote-derived" ||
    latestBarSource.startsWith("ibkr-websocket-derived:") ||
    latestBarSource.startsWith("ibkr-stock-quote-derived:");
  const barsStatus = !bars.length
    ? barsQuery.isPending || barsQuery.fetchStatus === "fetching"
      ? "loading"
      : "empty"
    : stockAggregateStreamingEnabled && hasBrokerLiveBar
      ? "live"
      : baseBarsCacheStale
      ? "stale"
      : "live";
  const chartWindowFlowEvents = useMemo(
    () =>
      filterFlowEventsForChartLookbackWindow(
        chartDisplayFlowEvents || [],
        tf,
      ),
    [chartDisplayFlowEvents, tf],
  );
  const chartEventConversion = useFlowChartEventConversion(
    chartWindowFlowEvents,
    ticker,
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
    const nextTimeframe = normalizeChartTimeframe(timeframe);
    if (!nextTimeframe || nextTimeframe === tf) {
      return;
    }
    setTf(nextTimeframe);
    setIntervalChangeRevision((revision) => revision + 1);
    onWorkspaceChartChange?.({ timeframe: nextTimeframe });
  }, [onWorkspaceChartChange, tf]);

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
        hasExhaustedOlderHistory: prependableBars.hasExhaustedOlderHistory,
        isHydratingRequestedWindow:
          barsQuery.fetchStatus === "fetching" &&
          baseRequestedLimit > prependableBars.loadedBarCount,
        isPrependingOlder: prependableBars.isPrependingOlder,
        oldestLoadedAtMs: prependableBars.oldestLoadedAtMs,
        prependOlderBars: prependableBars.prependOlderBars,
      });
    },
    [
      barsQuery.fetchStatus,
      bars.length,
      baseRequestedLimit,
      prependableBars.hasExhaustedOlderHistory,
      prependableBars.isPrependingOlder,
      prependableBars.loadedBarCount,
      prependableBars.oldestLoadedAtMs,
      prependableBars.prependOlderBars,
      progressiveBars.expandForVisibleRange,
    ],
  );
  const scheduleVisibleRangeExpansion = useDebouncedVisibleRangeExpansion(
    expandVisibleLogicalRange,
    {
      resetKey: chartHydrationScopeKey,
      recheckKey: [
        chartHydrationScopeKey,
        bars.length,
        barsQuery.fetchStatus === "fetching" ? "fetching" : "settled",
        prependableBars.isPrependingOlder ? "prepending" : "ready",
        prependableBars.hasExhaustedOlderHistory ? "exhausted" : "open",
      ].join(":"),
    },
  );
  const handleVisibleLogicalRangeChange = useCallback(
    (range) => {
      scheduleVisibleRangeExpansion(range);
    },
    [scheduleVisibleRangeExpansion],
  );
  const chartViewportLayoutKey = intervalChangeRevision
    ? buildChartBarScopeKey(
        viewportLayoutKey || "trade-equity-viewport",
        "interval",
        tf,
        intervalChangeRevision,
      )
    : viewportLayoutKey;

  return (
    <PlatformErrorBoundary
      label={`${ticker || "Spot"} chart`}
      resetKeys={[ticker, tf, chartHydrationScopeKey]}
      minHeight="100%"
    >
      <ResearchChartFrame
      dataTestId={dataTestId}
      theme={T}
      themeKey={getCurrentTheme()}
      surfaceUiStateKey={surfaceUiStateKey}
      rangeIdentityKey={chartHydrationScopeKey}
      viewportLayoutKey={chartViewportLayoutKey}
      model={chartModel}
      compact={compact}
      frameSignalState={showSignalFrameBorder ? signalFrameState : null}
      chartEvents={chartEvents}
      chartFlowDiagnostics={chartEventConversion}
      latestQuotePrice={tickerInfo?.price}
      latestQuoteUpdatedAt={tickerInfo?.updatedAt}
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
          favoriteTimeframes={chartFavoriteTimeframes}
          onToggleFavoriteTimeframe={toggleChartFavoriteTimeframe}
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
    </PlatformErrorBoundary>
  );
};
