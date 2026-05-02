import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getBars as getBarsRequest,
  useCancelOrder,
  useListOrders,
  useListPositions,
  usePlaceOrder,
  usePreviewOrder,
  useReplaceOrder,
  useSubmitOrders,
} from "@workspace/api-client-react";
import {
  DISPLAY_CHART_OUTSIDE_RTH,
  RAY_REPLICA_PINE_SCRIPT_KEY,
  RayReplicaSettingsMenu,
  ResearchChartFrame,
  ResearchChartWidgetFooter,
  ResearchChartWidgetHeader,
  ResearchChartWidgetSidebar,
  expandLocalRollupLimit,
  flowEventsToChartEvents,
  getChartBarLimit,
  getChartTimeframeOptions,
  getInitialChartBarLimit,
  normalizeChartTimeframe,
  recordChartBarScopeState,
  resolveDisplayChartPrice,
  resolveLocalRollupBaseTimeframe,
  resolveSpotChartFrameLayout,
  rollupMarketBars,
  useBrokerStreamedBars,
  useDrawingHistory,
  useHistoricalBarStream,
  useIndicatorLibrary,
  usePrependableHistoricalBars,
} from "../charting";
import {
  buildTradeBarsFromApi,
  describeBrokerChartSource,
  describeBrokerChartStatus,
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
} from "../charting/chartHydrationRuntime";
import {
  normalizeChartBarsPagePayload,
  normalizeLatestChartBarsPayload,
} from "../charting/chartBarsPayloads";
import { useChartTimeframeFavorites } from "../charting/useChartTimeframeFavorites";
import {
  BARS_QUERY_DEFAULTS,
  BARS_REQUEST_PRIORITY,
  HEAVY_PAYLOAD_GC_MS,
  QUERY_DEFAULTS,
  buildBarsRequestOptions,
} from "../platform/queryDefaults";
import {
  ensureTradeTickerInfo,
  useRuntimeTickerSnapshot,
} from "../platform/runtimeTickerStore";
import {
  resolveTradeOptionChainSnapshot,
  useTradeOptionChainSnapshot,
} from "../platform/tradeOptionChainStore";
import { useTradeFlowSnapshot } from "../platform/tradeFlowStore";
import { usePageVisible } from "../platform/usePageVisible";
import { usePositions, useToast } from "../platform/platformContexts.jsx";
import { useUserPreferences } from "../preferences/useUserPreferences";
import {
  TICKET_ASSET_MODES,
  TICKET_ORDER_TYPES,
  TRADING_EXECUTION_MODES,
  buildTwsBracketOrders,
  formatTicketOrderType,
  getDefaultTicketRiskPrices,
  isTwsStructuredOrderPayload,
  normalizeTicketAssetMode,
  normalizeTicketOrderType,
  normalizeTradingExecutionMode,
  resolveTicketOrderPrices,
  validateTicketBracket,
} from "./ibkrOrderTicketModel";
import {
  BrokerActionConfirmDialog,
  formatLiveBrokerActionError,
} from "./BrokerActionConfirmDialog.jsx";
import {
  FINAL_ORDER_STATUSES,
  formatExecutionContractLabel,
  getBrokerMarketDepthRequest,
  listBrokerExecutionsRequest,
  orderStatusColor,
  sameOptionContract,
} from "./tradeBrokerRequests";
import { buildMarketOrderFlowFromEvents } from "../flow/flowAnalytics";
import {
  OrderFlowDonut,
  SizeBucketRow,
} from "../flow/OrderFlowVisuals.jsx";
import { isOpenPositionRow } from "../account/accountPositionRows.js";
import { _initialState, persistState } from "../../lib/workspaceState";
import {
  daysToExpiration,
  fmtCompactNumber,
  formatEnumLabel,
  formatExpirationLabel,
  formatQuotePrice,
  formatRelativeTimeShort,
  formatSignedPercent,
  isFiniteNumber,
  parseExpirationValue,
} from "../../lib/formatters";
import {
  MISSING_VALUE,
  T,
  dim,
  fs,
  getCurrentTheme,
  sp,
} from "../../lib/uiTokens";
import { DataUnavailableState } from "../../components/platform/primitives.jsx";

const buildBarsPageQueryKey = ({
  queryBase,
  timeframe,
  limit,
  from,
  to,
  historyCursor,
  preferCursor,
}) => [
  ...queryBase,
  timeframe,
  limit,
  from || null,
  to || null,
  historyCursor || null,
  preferCursor ? "cursor" : "window",
];

const TRADE_EQUITY_INDICATOR_PRESET_VERSION = 1;
const DEFAULT_TRADE_EQUITY_STUDIES = [
  "ema-21",
  "ema-55",
  "vwap",
  RAY_REPLICA_PINE_SCRIPT_KEY,
];

const buildTradeFlowMarkersFromEvents = (events, barsLength) => {
  const list = (events || []).slice(0, 24);
  if (!list.length || !barsLength) return [];
  return list.map((evt, index) => {
    const ratio = list.length === 1 ? 0.5 : index / (list.length - 1);
    return {
      barIdx: Math.max(
        0,
        Math.min(barsLength - 1, Math.round(ratio * (barsLength - 1))),
      ),
      cp: evt.cp,
      size:
        evt.premium >= 500000 ? "lg" : evt.premium >= 150000 ? "md" : "sm",
      golden: evt.golden,
    };
  });
};

const TRADE_TIMEFRAMES = getChartTimeframeOptions("primary").map((option) => ({
  v: option.value,
  bars: getChartBarLimit(option.value, "primary"),
  tag: option.label,
}));
export const TradeEquityPanel = ({
  ticker,
  flowEvents,
  historicalDataEnabled = true,
  stockAggregateStreamingEnabled = false,
  onOpenSearch,
  searchOpen,
  onSearchOpenChange,
  searchContent,
  workspaceChart = null,
  onWorkspaceChartChange,
  referenceLines = [],
}) => {
  const queryClient = useQueryClient();
  const tradeFlowSnapshot = useTradeFlowSnapshot(ticker);
  const effectiveFlowEvents = flowEvents?.length ? flowEvents : tradeFlowSnapshot.events;
  const tickerFallback = useMemo(
    () => ensureTradeTickerInfo(ticker, ticker),
    [ticker],
  );
  const tickerInfo = useRuntimeTickerSnapshot(ticker, tickerFallback);
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
  const spotChartFrameLayout = resolveSpotChartFrameLayout(false);
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
      (limit) =>
        queryClient.prefetchQuery({
          queryKey: [
            "trade-equity-bars",
            ticker,
            rollupBaseTimeframe,
            expandLocalRollupLimit(limit, tf, rollupBaseTimeframe),
          ],
          queryFn: () =>
            measureChartBarsRequest({
              scopeKey: chartHydrationScopeKey,
              metric: "barsRequestMs",
              request: () =>
                getBarsRequest({
                  symbol: ticker,
                  timeframe: rollupBaseTimeframe,
                  limit: expandLocalRollupLimit(limit, tf, rollupBaseTimeframe),
                  outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
                  source: "trades",
                  allowHistoricalSynthesis: true,
                },
                buildBarsRequestOptions(BARS_REQUEST_PRIORITY.active),
              ),
            }),
          ...BARS_QUERY_DEFAULTS,
        }),
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
  const barsQuery = useQuery({
    queryKey: [
      "trade-equity-bars",
      ticker,
      rollupBaseTimeframe,
      baseRequestedLimit,
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
            allowHistoricalSynthesis: true,
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
  useEffect(() => {
    if (!barsQuery.data?.bars?.length) {
      return;
    }

    progressiveBars.hydrateFullWindow();
  }, [barsQuery.data?.bars?.length, progressiveBars.hydrateFullWindow]);
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

      queryClient.prefetchQuery({
        queryKey: [
          "trade-equity-bars",
          ticker,
          favoriteBaseTimeframe,
          favoriteLimit,
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
                  allowHistoricalSynthesis: true,
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
    bars: barsQuery.data?.bars,
    enabled: Boolean(historicalDataEnabled && ticker),
    fetchOlderBars: useCallback(
      async ({ from, to, limit, historyCursor, preferCursor }) => {
        const fromIso = from.toISOString();
        const toIso = to.toISOString();
        const payload = await queryClient.fetchQuery({
          queryKey: buildBarsPageQueryKey({
            queryBase: ["trade-equity-bars-prepend", ticker],
            timeframe: rollupBaseTimeframe,
            limit,
            from: fromIso,
            to: toIso,
            historyCursor: historyCursor || null,
            preferCursor: Boolean(historyCursor && preferCursor),
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
  const streamedSourceBars = useBrokerStreamedBars({
    symbol: ticker,
    timeframe: rollupBaseTimeframe,
    bars: prependableBars.bars,
    enabled: Boolean(stockAggregateStreamingEnabled && ticker),
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
  const fetchLatestLiveBars = useCallback(async () => {
    const fallbackLimit = Math.max(2, Math.min(baseRequestedLimit, 500));
    const payload = await measureChartBarsRequest({
      scopeKey: chartHydrationScopeKey,
      metric: "liveFallbackRequestMs",
      request: () =>
        getBarsRequest(
          {
            symbol: ticker,
            timeframe: rollupBaseTimeframe,
            limit: fallbackLimit,
            outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
            source: "trades",
            allowHistoricalSynthesis: true,
          },
          buildBarsRequestOptions(BARS_REQUEST_PRIORITY.active),
        ),
    });

    return normalizeLatestChartBarsPayload(payload, {
      context: "trade-equity-live-fallback",
      scopeKey: chartHydrationScopeKey,
    });
  }, [baseRequestedLimit, chartHydrationScopeKey, rollupBaseTimeframe, ticker]);
  const streamedLiveBars = useHistoricalBarStream({
    symbol: ticker,
    timeframe: rollupBaseTimeframe,
    bars: liveBars,
    enabled: Boolean(
      stockAggregateStreamingEnabled && ticker && rollupBaseTimeframe !== "1d"
    ),
    outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
    source: "trades",
    instrumentationScope: chartHydrationScopeKey,
    fetchLatestBars: fetchLatestLiveBars,
    streamPriority: 90,
  });
  const bars = useMemo(
    () => rollupMarketBars(streamedLiveBars, rollupBaseTimeframe, tf),
    [rollupBaseTimeframe, streamedLiveBars, tf],
  );
  const displayPriceFallbackQuery = useDisplayChartPriceFallbackBars({
    symbol: ticker,
    enabled: Boolean(
      historicalDataEnabled && ticker && !Number.isFinite(tickerInfo?.price),
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
  const barsStatus = bars.length
    ? "live"
    : barsQuery.isPending
      ? "loading"
      : "empty";
  const markers = useMemo(
    () =>
      effectiveFlowEvents.length
        ? buildTradeFlowMarkersFromEvents(effectiveFlowEvents, bars.length)
        : [],
    [bars.length, effectiveFlowEvents],
  );
  const chartMarkers = useMemo(
    () =>
      markers.flatMap((marker, index) => {
        const targetBar = bars[marker?.barIdx];
        const rawTime = targetBar?.time;
        const time =
          typeof rawTime === "number"
            ? rawTime > 1e12
              ? Math.floor(rawTime / 1000)
              : Math.floor(rawTime)
            : null;
        if (!time) return [];

        const isCall = marker.cp === "C";
        return [
          {
            id: `trade-flow-${ticker}-${index}-${time}`,
            time,
            barIndex: marker.barIdx,
            position: isCall ? "belowBar" : "aboveBar",
            shape: isCall ? "arrowUp" : "arrowDown",
            color: marker.golden ? T.amber : isCall ? T.green : T.red,
            size: marker.golden
              ? 1.6
              : marker.size === "lg"
                ? 1.25
                : marker.size === "md"
                  ? 1
                  : 0.8,
            text: marker.golden ? "G" : "",
          },
        ];
      }),
    [bars, markers, ticker],
  );
  const chartEvents = useMemo(
    () => flowEventsToChartEvents(effectiveFlowEvents || [], ticker),
    [effectiveFlowEvents, ticker],
  );
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
      indicatorMarkers: chartMarkers,
    },
    deps: [
      bars,
      chartHydrationScopeKey,
      chartMarkers,
      indicatorRegistry,
      indicatorSettings,
      progressiveBars.targetLimit,
      selectedIndicators,
      tf,
    ],
  });
  const latestBar = bars[bars.length - 1];
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
  const equityChartStatus = describeBrokerChartStatus(barsStatus, tf);
  const equityChartSource = describeBrokerChartSource(latestBar?.source);
  const callFlows = markers.filter((m) => m.cp === "C").length;
  const putFlows = markers.filter((m) => m.cp === "P").length;
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
      key={chartHydrationScopeKey}
      dataTestId="trade-equity-chart"
      theme={T}
      themeKey={getCurrentTheme()}
      surfaceUiStateKey="trade-equity-chart"
      rangeIdentityKey={chartHydrationScopeKey}
      model={chartModel}
      chartEvents={chartEvents}
      showSurfaceToolbar={false}
      showLegend
      legend={{
        symbol: ticker,
        name: equityChartName,
        timeframe: tf,
        statusLabel: equityChartStatus,
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
          onOpenSearch={onOpenSearch}
          searchOpen={searchOpen}
          onSearchOpenChange={onSearchOpenChange}
          searchContent={searchContent}
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
          statusText={`${equityChartStatus}  C ${callFlows}  P ${putFlows}  UOA amber`}
        />
      )}
      surfaceBottomOverlayHeight={spotChartFrameLayout.surfaceBottomOverlayHeight}
    />
  );
};
