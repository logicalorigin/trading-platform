import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getBars as getBarsRequest,
  useGetQuoteSnapshots,
} from "@workspace/api-client-react";
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
import {
  getChartBarLimit,
  getChartTimeframeValues,
  getInitialChartBarLimit,
  getMaxChartBarLimit,
  normalizeChartTimeframe,
} from "../charting/timeframes";
import { recordChartBarScopeState } from "../charting/chartHydrationStats";
import { resolveSpotChartFrameLayout } from "../charting/spotChartFrameLayout";
import {
  useBrokerStreamedBars,
  useHistoricalBarStream,
  usePrependableHistoricalBars,
} from "../charting/useMassiveStreamedStockBars";
import { useDrawingHistory } from "../charting/useDrawingHistory";
import { useIndicatorLibrary } from "../charting/pineScripts";
import {
  buildMiniChartBarsFromApi,
  describeBrokerChartSource,
  describeBrokerChartStatus,
  resolveBrokerChartSourceState,
  useDisplayChartPriceFallbackBars,
} from "../charting/chartApiBars";
import {
  buildChartBarScopeKey,
  measureChartBarsRequest,
  useDebouncedVisibleRangeExpansion,
  useMeasuredChartModel,
  useProgressiveChartBarLimit,
} from "../charting/chartHydrationRuntime";
import { useChartTimeframeFavorites } from "../charting/useChartTimeframeFavorites";
import {
  buildRayReplicaIndicatorSettings,
  isRayReplicaIndicatorSelected,
  resolvePersistedRayReplicaSettings,
} from "../charting/chartIndicatorPersistence";
import {
  DEFAULT_WATCHLIST_BY_SYMBOL,
  WATCHLIST,
} from "./marketReferenceData";
import {
  ensureTradeTickerInfo,
  useRuntimeTickerSnapshot,
} from "../platform/runtimeTickerStore";
import { useSignalMonitorStateForSymbol } from "../platform/signalMonitorStore";
import { useHydrationIntent } from "../platform/hydrationCoordinator";
import { useLiveMarketFlow } from "../platform/useLiveMarketFlow";
import { useIbkrQuoteSnapshotStream } from "../platform/live-streams";
import { USER_PREFERENCES_UPDATED_EVENT } from "../preferences/userPreferenceModel";
import { MarketIdentityMark } from "../platform/marketIdentity";
import { MiniChartTickerSearch } from "../platform/tickerSearch/TickerSearch.jsx";
import {
  getTickerSearchRowStorageKey,
  normalizePersistedTickerSearchRows,
  normalizeTickerSearchResultForStorage,
} from "../platform/tickerSearch/TickerSearch.jsx";
import {
  buildMarketBarsPageQueryKey as buildBarsPageQueryKey,
  normalizeMiniChartStudies,
  resolveMarketGridChartProviderContractId,
} from "./marketGridChartState";
import {
  normalizeChartBarsPagePayload,
  normalizeLatestChartBarsPayload,
} from "../charting/chartBarsPayloads";
import { BARS_QUERY_DEFAULTS, BARS_REQUEST_PRIORITY, buildBarsRequestOptions } from "../platform/queryDefaults";
import { normalizeTickerSymbol } from "../platform/tickerIdentity";
import { isFiniteNumber } from "../../lib/formatters";
import { T, dim, fs, getCurrentTheme, sp } from "../../lib/uiTokens";

const MINI_CHART_TIMEFRAMES = getChartTimeframeValues("mini");

const MARKET_CHART_INTERACTIVE_TARGET_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[role='button']",
  "[role='checkbox']",
  "[role='menu']",
  "[role='menuitem']",
  "[role='option']",
  "[role='radio']",
  "[role='switch']",
  "[data-chart-control-root]",
  "[data-grid-resize-handle]",
  "[data-radix-popper-content-wrapper]",
  "[data-testid='ticker-search-popover']",
].join(",");

const isMarketChartInteractiveTarget = (target) =>
  typeof Element !== "undefined" &&
  target instanceof Element &&
  Boolean(target.closest(MARKET_CHART_INTERACTIVE_TARGET_SELECTOR));

const isMarketChartPlotTarget = (target) =>
  typeof Element !== "undefined" &&
  target instanceof Element &&
  Boolean(target.closest("[data-chart-plot-root]"));
const MARKET_CHART_PLOT_FOCUS_MOVE_TOLERANCE = 6;

const getChartSourceToneColor = (tone) => {
  if (tone === "good") return T.green;
  if (tone === "warn") return T.amber;
  if (tone === "info") return T.accent;
  if (tone === "neutral") return T.textSec;
  return T.textDim;
};

const MiniChartSourceBadge = ({ state, dense = false, dataTestId }) => {
  const toneColor = getChartSourceToneColor(state?.tone);
  const label = dense ? state?.shortLabel : state?.label;
  return (
    <AppTooltip content={state?.detail || "Chart source"}>
      <span
        data-chart-control-root
        data-testid={dataTestId ? `${dataTestId}-source-badge` : undefined}
        data-chart-source-state={state?.state || ""}
        data-chart-source-label={state?.label || ""}
        data-chart-source-freshness={state?.freshness || ""}
        data-chart-source-mode={state?.marketDataMode || ""}
        data-chart-source-live={state?.isRealtime ? "true" : "false"}
        data-chart-source-degraded={state?.isDegraded ? "true" : "false"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(3),
          height: dense ? dim(17) : dim(20),
          maxWidth: dense ? dim(58) : dim(92),
          border: `1px solid ${toneColor}66`,
          background: `${toneColor}14`,
          color: toneColor,
          fontFamily: T.mono,
          fontSize: fs(dense ? 7 : 8),
          fontWeight: 900,
          lineHeight: 1,
          padding: sp(dense ? "2px 4px" : "3px 5px"),
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          flexShrink: 0,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: dense ? 5 : 6,
            height: dense ? 5 : 6,
            borderRadius: "50%",
            background: toneColor,
            boxShadow: state?.isRealtime ? `0 0 6px ${toneColor}` : "none",
            flexShrink: 0,
          }}
        />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {label || "SRC"}
        </span>
      </span>
    </AppTooltip>
  );
};


import { MiniChartPremiumFlowIndicator } from "./MiniChartPremiumFlowIndicator.jsx";
import { AppTooltip } from "@/components/ui/tooltip";


export const MiniChartCell = ({
  slot,
  quote,
  premiumFlowSummary,
  chartEvents = [],
  premiumFlowStatus,
  premiumFlowProviderSummary,
  onFocus,
  onEnterSoloMode,
  onChangeTicker,
  onChangeTimeframe,
  favoriteTimeframes = [],
  onToggleFavoriteTimeframe,
  onChangeStudies,
  onChangeRayReplicaSettings,
  recentTickers = [],
  recentTickerRows = [],
  watchlistSymbols = [],
  popularTickers = [],
  smartSuggestionSymbols = [],
  signalSuggestionSymbols = [],
  onRememberTicker,
  tickerSearchOpen = false,
  onTickerSearchOpenChange,
  isActive,
  dense = false,
  compactFlow = false,
  stockAggregateStreamingEnabled = false,
  chartViewportIdentityKey = null,
  viewportSnapshot = null,
  onViewportSnapshotChange,
  dataTestId,
}) => {
  const queryClient = useQueryClient();
  const { studies: availableStudies, indicatorRegistry } =
    useIndicatorLibrary();
  const ticker = slot?.ticker || WATCHLIST[0]?.sym || "SPY";
  const signalState = useSignalMonitorStateForSymbol(ticker);
  const slotMarket = String(slot?.market || "stocks").trim() || "stocks";
  const chartProviderContractId = resolveMarketGridChartProviderContractId(slot);
  const hydratedTimeframe = normalizeChartTimeframe(slot?.tf);
  const tf = MINI_CHART_TIMEFRAMES.includes(hydratedTimeframe)
    ? hydratedTimeframe
    : "15m";
  const chartLimitRole = isActive ? "primary" : "mini";
  const currentBarsPriority = isActive
    ? BARS_REQUEST_PRIORITY.active
    : BARS_REQUEST_PRIORITY.visible;
  const selectedIndicators = normalizeMiniChartStudies(slot?.studies);
  const spotChartFrameLayout = resolveSpotChartFrameLayout(dense);
  const rayReplicaSettings = useMemo(
    () => resolvePersistedRayReplicaSettings(slot?.rayReplicaSettings),
    [slot?.rayReplicaSettings],
  );
  const indicatorSettings = useMemo(
    () => buildRayReplicaIndicatorSettings(rayReplicaSettings),
    [rayReplicaSettings],
  );
  const searchOpen = Boolean(tickerSearchOpen);
  const setSearchOpen = useCallback(
    (open) => onTickerSearchOpenChange?.(Boolean(open)),
    [onTickerSearchOpenChange],
  );
  const [pendingTickerSelection, setPendingTickerSelection] = useState(null);
  const [drawMode, setDrawMode] = useState(null);
  const suppressNextFrameClickRef = useRef(false);
  const pendingPlotFocusRef = useRef(null);
  const pendingPlotMouseFocusRef = useRef(null);
  const prewarmedFavoriteTimeframesRef = useRef(null);
  const { drawings, addDrawing, clearDrawings } = useDrawingHistory();
  const fallbackInfo =
    DEFAULT_WATCHLIST_BY_SYMBOL[ticker] ||
    WATCHLIST.find((item) => item.sym === ticker) ||
    WATCHLIST[0];
  const chartIdentityItem = {
    ...(slot?.searchResult || {}),
    ticker,
    name: slot?.searchResult?.name || fallbackInfo?.name || ticker,
    market: slotMarket,
    exchangeDisplay:
      slot?.exchange || slot?.searchResult?.exchangeDisplay || slot?.searchResult?.primaryExchange,
    normalizedExchangeMic:
      slot?.searchResult?.normalizedExchangeMic || slot?.exchange || null,
    logoUrl: slot?.searchResult?.logoUrl || null,
    countryCode: slot?.searchResult?.countryCode || null,
    exchangeCountryCode: slot?.searchResult?.exchangeCountryCode || null,
    sector: slot?.searchResult?.sector || null,
    industry: slot?.searchResult?.industry || null,
  };
  const normalizedTimeframe = normalizeChartTimeframe(tf);
  const rollupBaseTimeframe = useMemo(
    () =>
      resolveLocalRollupBaseTimeframe(
        normalizedTimeframe,
        getChartBarLimit(tf, chartLimitRole),
        chartLimitRole,
      ),
    [chartLimitRole, normalizedTimeframe, tf],
  );
  const barsScopeKey = buildChartBarScopeKey(
    "market-mini-bars",
    ticker,
    slotMarket,
    chartProviderContractId,
  );
  const baseBarsScopeKey = buildChartBarScopeKey(
    "market-mini-base-bars",
    ticker,
    slotMarket,
    chartProviderContractId,
    rollupBaseTimeframe,
  );
  const chartHydrationScopeKey = buildChartBarScopeKey(
    "market-mini-chart",
    ticker,
    normalizedTimeframe,
    slotMarket,
    chartProviderContractId,
  );
  useHydrationIntent({
    key: chartHydrationScopeKey,
    family: "chart-bars",
    label: `${ticker} ${normalizedTimeframe}`,
    priority: isActive ? "active" : "visible",
    active: Boolean(ticker),
    meta: {
      role: chartLimitRole,
      market: slotMarket,
      timeframe: normalizedTimeframe,
    },
  });
  const progressiveBars = useProgressiveChartBarLimit({
    scopeKey: barsScopeKey,
    timeframe: tf,
    role: chartLimitRole,
    enabled: Boolean(ticker),
    warmTargetLimit: useCallback(
      (limit) =>
        queryClient.prefetchQuery({
          queryKey: [
            "market-mini-bars",
            ticker,
            rollupBaseTimeframe,
            expandLocalRollupLimit(
              limit,
              normalizedTimeframe,
              rollupBaseTimeframe,
            ),
            slotMarket,
            chartProviderContractId,
          ],
          queryFn: () =>
            measureChartBarsRequest({
              scopeKey: chartHydrationScopeKey,
              metric: "barsRequestMs",
              request: () =>
                getBarsRequest({
                  symbol: ticker,
                  timeframe: rollupBaseTimeframe,
                  limit: expandLocalRollupLimit(
                    limit,
                    normalizedTimeframe,
                    rollupBaseTimeframe,
                  ),
                  market: slotMarket,
                  outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
                  source: "trades",
                  allowHistoricalSynthesis: true,
                  providerContractId: chartProviderContractId || undefined,
                },
                buildBarsRequestOptions(currentBarsPriority),
              ),
            }),
          ...BARS_QUERY_DEFAULTS,
        }),
      [
        chartHydrationScopeKey,
        chartProviderContractId,
        normalizedTimeframe,
        queryClient,
        rollupBaseTimeframe,
        slotMarket,
        tf,
        ticker,
        currentBarsPriority,
      ],
    ),
  });
  const baseRequestedLimit = useMemo(
    () =>
      expandLocalRollupLimit(
        progressiveBars.requestedLimit,
        normalizedTimeframe,
        rollupBaseTimeframe,
      ),
    [normalizedTimeframe, progressiveBars.requestedLimit, rollupBaseTimeframe],
  );
  const barsQuery = useQuery({
    queryKey: [
      "market-mini-bars",
      ticker,
      rollupBaseTimeframe,
      baseRequestedLimit,
      slotMarket,
      chartProviderContractId,
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
            market: slotMarket,
            outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
            source: "trades",
            allowHistoricalSynthesis: true,
            providerContractId: chartProviderContractId || undefined,
          },
          buildBarsRequestOptions(currentBarsPriority),
        ),
      }),
    ...BARS_QUERY_DEFAULTS,
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
      if (
        !ticker ||
        favoriteTimeframe === normalizedTimeframe ||
        !MINI_CHART_TIMEFRAMES.includes(favoriteTimeframe)
      ) {
        return;
      }

      const favoriteBaseTimeframe = resolveLocalRollupBaseTimeframe(
        favoriteTimeframe,
        getChartBarLimit(favoriteTimeframe, chartLimitRole),
        chartLimitRole,
      );
      const favoriteLimit = expandLocalRollupLimit(
        getInitialChartBarLimit(favoriteTimeframe, chartLimitRole),
        favoriteTimeframe,
        favoriteBaseTimeframe,
      );

      queryClient.prefetchQuery({
        queryKey: [
          "market-mini-bars",
          ticker,
            favoriteBaseTimeframe,
            favoriteLimit,
            slotMarket,
            chartProviderContractId,
          ],
        queryFn: () =>
          measureChartBarsRequest({
            scopeKey: buildChartBarScopeKey(
              "market-mini-chart",
              ticker,
              favoriteTimeframe,
              slotMarket,
              chartProviderContractId,
            ),
            metric: "favoritePrewarmRequestMs",
            request: () =>
              getBarsRequest(
                {
                  symbol: ticker,
                  timeframe: favoriteBaseTimeframe,
                  limit: favoriteLimit,
                  market: slotMarket,
                  outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
                  source: "trades",
                  allowHistoricalSynthesis: true,
                  providerContractId: chartProviderContractId || undefined,
                },
                buildBarsRequestOptions(BARS_REQUEST_PRIORITY.favoritePrewarm),
              ),
          }),
        ...BARS_QUERY_DEFAULTS,
      });
    },
    [
      chartLimitRole,
      chartProviderContractId,
      normalizedTimeframe,
      queryClient,
      slotMarket,
      ticker,
    ],
  );
  useEffect(() => {
    if (!isActive || !barsQuery.data?.bars?.length || !favoriteTimeframes.length) {
      return;
    }

    const prewarmKey = [
      chartHydrationScopeKey,
      favoriteTimeframes.join(","),
      slotMarket,
      chartProviderContractId || "",
    ].join("::");
    if (prewarmedFavoriteTimeframesRef.current === prewarmKey) {
      return;
    }

    prewarmedFavoriteTimeframesRef.current = prewarmKey;
    favoriteTimeframes.forEach(prewarmFavoriteTimeframe);
  }, [
    barsQuery.data?.bars?.length,
    chartHydrationScopeKey,
    chartProviderContractId,
    favoriteTimeframes,
    isActive,
    prewarmFavoriteTimeframe,
    slotMarket,
  ]);
  const prependableBars = usePrependableHistoricalBars({
    scopeKey: baseBarsScopeKey,
    timeframe: rollupBaseTimeframe,
    pageSizeTimeframe: normalizedTimeframe,
    bars: barsQuery.data?.bars,
    enabled: Boolean(ticker),
    fetchOlderBars: useCallback(
      async ({ from, to, limit, historyCursor, preferCursor }) => {
        const fromIso = from.toISOString();
        const toIso = to.toISOString();
        const payload = await queryClient.fetchQuery({
          queryKey: buildBarsPageQueryKey({
            queryBase: ["market-mini-bars-prepend", ticker],
            timeframe: rollupBaseTimeframe,
            limit,
            from: fromIso,
            to: toIso,
            market: slotMarket,
            providerContractId: chartProviderContractId,
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
                  market: slotMarket,
                  outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
                  source: "trades",
                  allowHistoricalSynthesis: true,
                  providerContractId: chartProviderContractId || undefined,
                  historyCursor: historyCursor || undefined,
                  preferCursor: historyCursor && preferCursor ? true : undefined,
                },
                buildBarsRequestOptions(currentBarsPriority),
              ),
            }),
          ...BARS_QUERY_DEFAULTS,
        });

        return normalizeChartBarsPagePayload(payload, {
          context: "market-mini-prepend",
          scopeKey: chartHydrationScopeKey,
        });
      },
      [
        chartHydrationScopeKey,
        chartProviderContractId,
        currentBarsPriority,
        queryClient,
        rollupBaseTimeframe,
        slotMarket,
        ticker,
      ],
    ),
  });
  const streamedSourceBars = useBrokerStreamedBars({
    symbol: ticker,
    timeframe: rollupBaseTimeframe,
    bars: prependableBars.bars,
    enabled: Boolean(
      stockAggregateStreamingEnabled &&
        ticker &&
        ["stocks", "etf", "otc"].includes(slotMarket),
    ),
  });
  const liveBars = useMemo(
    () => buildMiniChartBarsFromApi(streamedSourceBars),
    [streamedSourceBars],
  );
  const hydratedBaseBars = useMemo(
    () =>
      rollupMarketBars(
        buildMiniChartBarsFromApi(prependableBars.bars),
        rollupBaseTimeframe,
        normalizedTimeframe,
      ),
    [normalizedTimeframe, prependableBars.bars, rollupBaseTimeframe],
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
            market: slotMarket,
            outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
            source: "trades",
            allowHistoricalSynthesis: true,
            providerContractId: chartProviderContractId || undefined,
          },
          buildBarsRequestOptions(currentBarsPriority),
        ),
    });

    return normalizeLatestChartBarsPayload(payload, {
      context: "market-mini-live-fallback",
      scopeKey: chartHydrationScopeKey,
    });
  }, [
    baseRequestedLimit,
    chartHydrationScopeKey,
    chartProviderContractId,
    currentBarsPriority,
    normalizedTimeframe,
    rollupBaseTimeframe,
    slotMarket,
    ticker,
  ]);
  const streamedLiveBars = useHistoricalBarStream({
    symbol: ticker,
    timeframe: rollupBaseTimeframe,
    bars: liveBars,
    enabled: Boolean(
      stockAggregateStreamingEnabled &&
        ticker &&
        normalizedTimeframe !== "1d" &&
        ["stocks", "etf", "otc"].includes(slotMarket),
    ),
    providerContractId: chartProviderContractId,
    outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
    source: "trades",
    instrumentationScope: chartHydrationScopeKey,
    fetchLatestBars: fetchLatestLiveBars,
    streamPriority: isActive ? 100 : 10,
  });
  const bars = useMemo(
    () =>
      rollupMarketBars(
        streamedLiveBars,
        rollupBaseTimeframe,
        normalizedTimeframe,
      ),
    [normalizedTimeframe, rollupBaseTimeframe, streamedLiveBars],
  );
  const displayPriceFallbackQuery = useDisplayChartPriceFallbackBars({
    symbol: ticker,
    market: slotMarket,
    providerContractId: chartProviderContractId,
    enabled: Boolean(ticker && !Number.isFinite(quote?.price)),
    scopeKey: chartHydrationScopeKey,
    priority: currentBarsPriority,
  });
  useEffect(() => {
    recordChartBarScopeState(chartHydrationScopeKey, {
      timeframe: normalizedTimeframe,
      role: chartLimitRole,
      requestedLimit: progressiveBars.requestedLimit,
      initialLimit: getInitialChartBarLimit(tf, chartLimitRole),
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
    chartLimitRole,
    hydratedBaseBars.length,
    normalizedTimeframe,
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
  const chartModel = useMeasuredChartModel({
    scopeKey: chartHydrationScopeKey,
    bars,
    buildInput: {
      bars,
      timeframe: normalizedTimeframe,
      defaultVisibleBarCount: progressiveBars.targetLimit,
      selectedIndicators,
      indicatorSettings,
      indicatorRegistry,
    },
    deps: [
      bars,
      chartHydrationScopeKey,
      indicatorRegistry,
      indicatorSettings,
      normalizedTimeframe,
      progressiveBars.targetLimit,
      selectedIndicators,
    ],
  });
  const barsStatus = bars.length
    ? "live"
    : barsQuery.isPending
      ? "loading"
      : "empty";
  const latestBar = bars[bars.length - 1];
  const displayPrice = resolveDisplayChartPrice({
    quotePrice: quote?.price,
    canonicalBars: displayPriceFallbackQuery.data?.bars,
    renderedBars: bars,
  });
  const quotePrevClose = Number.isFinite(quote?.prevClose)
    ? quote.prevClose
    : null;
  const displayChange =
    Number.isFinite(displayPrice) && Number.isFinite(quotePrevClose)
      ? displayPrice - quotePrevClose
      : Number.isFinite(quote?.change)
        ? quote.change
        : null;
  const displayPct =
    Number.isFinite(displayPrice) &&
    Number.isFinite(quotePrevClose) &&
    quotePrevClose !== 0
      ? (displayChange / quotePrevClose) * 100
      : Number.isFinite(quote?.changePercent)
        ? quote.changePercent
        : null;
  const chartSourceLabel =
    describeBrokerChartSource(latestBar?.source) || barsStatus.toUpperCase();
  const chartSourceState = useMemo(
    () =>
      resolveBrokerChartSourceState({
        latestBar,
        status: barsStatus,
        timeframe: tf,
        streamingEnabled: Boolean(
          stockAggregateStreamingEnabled &&
            ticker &&
            ["stocks", "etf", "otc"].includes(slotMarket),
        ),
        market: slotMarket,
      }),
    [barsStatus, latestBar, slotMarket, stockAggregateStreamingEnabled, tf, ticker],
  );
  const handleFramePointerDownCapture = useCallback(
    (event) => {
      if (event.button != null && event.button !== 0) {
        return;
      }
      if (isMarketChartInteractiveTarget(event.target)) {
        return;
      }
      if (isMarketChartPlotTarget(event.target)) {
        pendingPlotFocusRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
        suppressNextFrameClickRef.current = true;
        return;
      }
      if (isActive || typeof onFocus !== "function") {
        return;
      }
      suppressNextFrameClickRef.current = true;
      onFocus(ticker);
    },
    [isActive, onFocus, ticker],
  );
  const handleFramePointerMoveCapture = useCallback((event) => {
    const pending = pendingPlotFocusRef.current;
    if (!pending || pending.pointerId !== event.pointerId) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - pending.x,
      event.clientY - pending.y,
    );
    if (distance > MARKET_CHART_PLOT_FOCUS_MOVE_TOLERANCE) {
      pendingPlotFocusRef.current = {
        ...pending,
        moved: true,
      };
      suppressNextFrameClickRef.current = true;
    }
  }, []);
  const handleFramePointerUpCapture = useCallback(
    (event) => {
      const pending = pendingPlotFocusRef.current;
      if (!pending || pending.pointerId !== event.pointerId) {
        return;
      }

      pendingPlotFocusRef.current = null;
      const distance = Math.hypot(
        event.clientX - pending.x,
        event.clientY - pending.y,
      );
      const moved =
        pending.moved ||
        distance > MARKET_CHART_PLOT_FOCUS_MOVE_TOLERANCE;

      if (moved) {
        suppressNextFrameClickRef.current = true;
        return;
      }

      if (!isActive && typeof onFocus === "function") {
        suppressNextFrameClickRef.current = true;
        onFocus(ticker);
      }
    },
    [isActive, onFocus, ticker],
  );
  const handleFramePointerCancelCapture = useCallback(() => {
    pendingPlotFocusRef.current = null;
  }, []);
  const handleFrameMouseDownCapture = useCallback(
    (event) => {
      if (event.button != null && event.button !== 0) {
        return;
      }
      if (isMarketChartInteractiveTarget(event.target)) {
        return;
      }
      if (isMarketChartPlotTarget(event.target)) {
        pendingPlotMouseFocusRef.current = {
          x: event.clientX,
          y: event.clientY,
        };
        suppressNextFrameClickRef.current = true;
      }
    },
    [],
  );
  const handleFrameMouseMoveCapture = useCallback((event) => {
    const pending = pendingPlotMouseFocusRef.current;
    if (!pending) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - pending.x,
      event.clientY - pending.y,
    );
    if (distance > MARKET_CHART_PLOT_FOCUS_MOVE_TOLERANCE) {
      pendingPlotMouseFocusRef.current = {
        ...pending,
        moved: true,
      };
      suppressNextFrameClickRef.current = true;
    }
  }, []);
  const handleFrameMouseUpCapture = useCallback((event) => {
    const pending = pendingPlotMouseFocusRef.current;
    if (!pending) {
      return;
    }

    pendingPlotMouseFocusRef.current = null;
    const distance = Math.hypot(
      event.clientX - pending.x,
      event.clientY - pending.y,
    );
    if (
      pending.moved ||
      distance > MARKET_CHART_PLOT_FOCUS_MOVE_TOLERANCE
    ) {
      suppressNextFrameClickRef.current = true;
      return;
    }

    if (!isActive && typeof onFocus === "function") {
      suppressNextFrameClickRef.current = true;
      onFocus(ticker);
    }
  }, [isActive, onFocus, ticker]);
  const handleFrameClick = useCallback(
    (event) => {
      if (suppressNextFrameClickRef.current) {
        suppressNextFrameClickRef.current = false;
        return;
      }
      if (isActive || typeof onFocus !== "function") {
        return;
      }
      if (isMarketChartInteractiveTarget(event.target)) {
        return;
      }
      onFocus(ticker);
    },
    [isActive, onFocus, ticker],
  );
  const handleDoubleClick = useCallback(
    (event) => {
      if (isMarketChartInteractiveTarget(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onEnterSoloMode?.(ticker);
    },
    [onEnterSoloMode, ticker],
  );
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
  const rememberTicker = useCallback(
    (nextTickerOrRow) => {
      const normalized =
        typeof nextTickerOrRow === "string"
          ? normalizeTickerSymbol(nextTickerOrRow)
          : normalizeTickerSymbol(nextTickerOrRow?.ticker);
      if (!normalized) {
        return;
      }
      onRememberTicker?.(nextTickerOrRow);
    },
    [onRememberTicker],
  );
  useEffect(() => {
    if (!pendingTickerSelection) {
      return;
    }
    setSearchOpen(false);
    rememberTicker(pendingTickerSelection.result);
    onChangeTicker?.(pendingTickerSelection.ticker, pendingTickerSelection.result);
    setPendingTickerSelection(null);
  }, [onChangeTicker, pendingTickerSelection, rememberTicker, setSearchOpen]);
  const signalDirection = signalState?.currentSignalDirection;
  const hasSignalBorder =
    signalState?.fresh &&
    signalState?.status === "ok" &&
    (signalDirection === "buy" || signalDirection === "sell");
  const signalBorderColor =
    signalDirection === "buy" ? T.green : signalDirection === "sell" ? T.red : T.border;

  return (
    <div
      onPointerDownCapture={handleFramePointerDownCapture}
      onPointerMoveCapture={handleFramePointerMoveCapture}
      onPointerUpCapture={handleFramePointerUpCapture}
      onPointerCancelCapture={handleFramePointerCancelCapture}
      onMouseDownCapture={handleFrameMouseDownCapture}
      onMouseMoveCapture={handleFrameMouseMoveCapture}
      onMouseUpCapture={handleFrameMouseUpCapture}
      onClick={handleFrameClick}
      onDoubleClick={handleDoubleClick}
      style={{
        position: "relative",
        height: "100%",
        boxSizing: "border-box",
        border: `1px solid ${hasSignalBorder ? signalBorderColor : "transparent"}`,
        cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: hasSignalBorder
          ? `0 0 0 1px ${signalBorderColor}55, 0 0 18px ${signalBorderColor}30`
          : "none",
      }}
    >
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <ResearchChartFrame
          dataTestId={dataTestId}
          theme={T}
          themeKey={getCurrentTheme()}
          surfaceUiStateKey="market-mini-chart"
          rangeIdentityKey={chartViewportIdentityKey || chartHydrationScopeKey}
          model={chartModel}
          compact={dense}
          drawings={drawings}
          drawMode={drawMode}
          onAddDrawing={addDrawing}
          showSurfaceToolbar={false}
          showLegend
          legend={{
            symbol: ticker,
            name: fallbackInfo?.name || ticker,
            timeframe: tf,
            statusLabel: describeBrokerChartStatus(barsStatus, tf),
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
              sourceLabel: chartSourceLabel,
            },
            studies: availableStudies,
            selectedStudies: selectedIndicators,
          }}
          hideTimeScale={false}
          referenceLines={
            typeof bars[0]?.o === "number"
              ? [
                  {
                    price: bars[0].o,
                    color: T.textMuted,
                    lineWidth: 1,
                    axisLabelVisible: false,
                    title: "",
                  },
                ]
              : []
          }
          chartEvents={chartEvents}
          emptyState={{
            title: describeBrokerChartStatus(barsStatus, tf),
            detail:
              barsStatus === "loading"
                ? `${ticker} ${tf} bars are loading from the broker feed.`
                : `${ticker} ${tf} has no hydrated bars for the current provider/timeframe.`,
          }}
          style={{
            borderColor: isActive ? T.accent : T.border,
            boxShadow: isActive ? `0 0 0 1px ${T.accent}33` : "none",
          }}
          onVisibleLogicalRangeChange={handleVisibleLogicalRangeChange}
          viewportSnapshot={viewportSnapshot}
          onViewportSnapshotChange={onViewportSnapshotChange}
          persistScalePrefs={false}
          surfaceTopOverlay={(controls) => (
            <ResearchChartWidgetHeader
              theme={T}
              controls={controls}
              symbol={ticker}
              name={fallbackInfo?.name || ticker}
              price={displayPrice}
              priceLabel="Spot"
              changePercent={displayPct}
              statusLabel={describeBrokerChartStatus(barsStatus, tf)}
              timeframe={tf}
              showInlineLegend={false}
              timeframeOptions={MINI_CHART_TIMEFRAMES.map((timeframe) => ({
                value: timeframe,
                label: timeframe,
              }))}
              onChangeTimeframe={(timeframe) => onChangeTimeframe?.(timeframe)}
              favoriteTimeframes={favoriteTimeframes}
              onToggleFavoriteTimeframe={onToggleFavoriteTimeframe}
              onPrewarmTimeframe={
                isActive ? prewarmFavoriteTimeframe : undefined
              }
              searchOpen={searchOpen}
              onSearchOpenChange={setSearchOpen}
              searchContent={
                <MiniChartTickerSearch
                  open={searchOpen}
                  ticker={ticker}
                  recentTickerRows={recentTickerRows}
                  watchlistSymbols={watchlistSymbols}
                  popularTickers={popularTickers}
                  contextSymbols={recentTickers}
                  flowSuggestionSymbols={smartSuggestionSymbols}
                  signalSuggestionSymbols={signalSuggestionSymbols}
                  embedded
                  onClose={() => setSearchOpen(false)}
                  onSelectTicker={(result) => {
                    const nextTicker = normalizeTickerSymbol(result?.ticker);
                    if (!nextTicker) {
                      return;
                    }
                    ensureTradeTickerInfo(nextTicker, result?.name || nextTicker);
                    setPendingTickerSelection({ ticker: nextTicker, result });
                  }}
                />
              }
              dense={dense}
              studies={availableStudies}
              selectedStudies={selectedIndicators}
              studySpecs={chartModel.studySpecs}
              showSnapshotButton={false}
              showUndoRedo={false}
              onFocusChart={() => onFocus?.(ticker)}
              focusChartActive={isActive}
              focusChartTitle={`Focus ${ticker} chart`}
              onEnterSoloMode={() => onEnterSoloMode?.(ticker)}
              soloChartTitle={`Show ${ticker} in solo layout`}
              identitySlot={
                <MarketIdentityMark
                  item={chartIdentityItem}
                  size={dense ? 16 : 20}
                  showMarketIcon
                  style={{ borderColor: isActive ? T.accent : T.border }}
                />
              }
              rightSlot={
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: sp(dense ? 2 : 4),
                  }}
                >
                  <MiniChartSourceBadge
                    state={chartSourceState}
                    dense={dense}
                    dataTestId={dataTestId}
                  />
                  <AppTooltip content="Reset chart view"><button
                    type="button"
                    aria-label={`Reset ${ticker} chart view`}
                    data-testid="market-chart-reset-view"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      controls.reset();
                    }}
                    style={{
                      border: "none",
                      background: T.bg3,
                      color: T.textDim,
                      cursor: "pointer",
                      fontFamily: T.mono,
                      fontSize: fs(dense ? 7 : 8),
                      fontWeight: 800,
                      padding: sp(dense ? "2px 4px" : "3px 5px"),
                      lineHeight: 1,
                    }}
                  >
                    RESET
                  </button></AppTooltip>
                  <RayReplicaSettingsMenu
                    theme={T}
                    settings={rayReplicaSettings}
                    onChange={(next) => onChangeRayReplicaSettings?.(next)}
                    dense={dense}
                    disabled={!isRayReplicaIndicatorSelected(selectedIndicators)}
                  />
                </span>
              }
              onToggleStudy={(studyId) => {
                const active = selectedIndicators.includes(studyId);
                const next = active
                  ? selectedIndicators.filter((value) => value !== studyId)
                  : [...selectedIndicators, studyId];
                onChangeStudies?.(next);
              }}
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
                sourceLabel: chartSourceLabel,
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
              dense={dense}
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
              onToggleStudy={(studyId) => {
                const active = selectedIndicators.includes(studyId);
                const next = active
                  ? selectedIndicators.filter((value) => value !== studyId)
                  : [...selectedIndicators, studyId];
                onChangeStudies?.(next);
              }}
              dense={dense}
              statusText={`${describeBrokerChartStatus(barsStatus, tf)}  ${chartSourceLabel}`}
            />
          )}
          surfaceBottomOverlayHeight={spotChartFrameLayout.surfaceBottomOverlayHeight}
        />
      </div>
      <MiniChartPremiumFlowIndicator
        symbol={ticker}
        summary={premiumFlowSummary}
        flowStatus={premiumFlowStatus}
        providerSummary={premiumFlowProviderSummary}
        dense={dense}
        compact={compactFlow}
      />
    </div>
  );
};

// ─── MULTI CHART GRID ───
// Configurable grid of mini chart cells. Layout selector + independent ticker ownership per slot.
