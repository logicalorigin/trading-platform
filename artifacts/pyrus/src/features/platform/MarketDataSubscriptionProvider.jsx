import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetQuoteSnapshotsQueryKey,
  getBars as getBarsRequest,
  useGetQuoteSnapshots,
} from "@workspace/api-client-react";
import {
  getStockMinuteAggregateSymbolVersion,
  getStoredBrokerMinuteAggregates,
  useBrokerStockAggregateStream,
  useStockMinuteAggregateSymbolsVersion,
} from "../charting/useMassiveStockAggregateStream";
import { MARKET_PERFORMANCE_SYMBOLS } from "../market/marketReferenceData";
import {
  useIbkrQuoteSnapshotStream,
  usePositionQuoteSnapshotStream,
} from "./live-streams";
import {
  applyPositionQuoteSnapshots,
  usePositionMarketDataSymbols,
} from "./positionMarketDataStore";
import { useRuntimeWorkloadFlag } from "./workloadStats";
import {
  BARS_QUERY_DEFAULTS,
  BARS_REQUEST_PRIORITY,
  HEAVY_PAYLOAD_GC_MS,
} from "./queryDefaults";
import { useHydrationGate } from "./hydrationCoordinator";
import {
  applyRuntimeQuoteSnapshots,
  syncRuntimeMarketData,
} from "./runtimeMarketDataModel";
import { SPARKLINE_RENDER_POINT_LIMIT } from "./sparklineConfig";
import {
  usePlatformFreshnessQueryHydration,
  usePlatformFreshnessQueryPublisher,
} from "./platformFreshnessBus";
import {
  buildVisibleRealtimeCoverageDiagnostics,
  splitRealtimeAwareRestQuoteSymbols,
} from "./watchlistQuoteRotation";

const settleWithConcurrency = async (items, concurrency, mapper) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          results[index] = {
            status: "fulfilled",
            value: await mapper(items[index], index),
          };
        } catch (reason) {
          results[index] = {
            status: "rejected",
            reason,
          };
        }
      }
    }),
  );

  return results;
};

const SPARKLINE_HISTORY_TIMEFRAME = "1m";
const SPARKLINE_HISTORY_LIMIT = 720;
const QUOTE_STREAM_DIAGNOSTICS_GLOBAL =
  "__PYRUS_MARKET_DATA_SUBSCRIPTION_DIAGNOSTICS__";

const normalizeRuntimeSymbol = (symbol) =>
  String(symbol || "").trim().toUpperCase();

const summarizeSparklineBars = (barsBySymbol = {}) =>
  Object.fromEntries(
    Object.entries(barsBySymbol || {}).map(([symbol, bars]) => [
      symbol,
      {
        count: Array.isArray(bars) ? bars.length : 0,
        first:
          Array.isArray(bars) && bars.length
            ? (bars[0]?.timestamp ?? bars[0]?.time ?? bars[0]?.t ?? null)
            : null,
        last:
          Array.isArray(bars) && bars.length
            ? (bars.at(-1)?.timestamp ?? bars.at(-1)?.time ?? bars.at(-1)?.t ?? null)
            : null,
      },
    ]),
  );

export const resolveQuoteStreamDisabledReason = ({
  quoteStreamRuntimeEnabled,
  symbolCount,
  eventSourceAvailable,
  upstreamDisabledReason = null,
} = {}) => {
  if (upstreamDisabledReason) return upstreamDisabledReason;
  if (!quoteStreamRuntimeEnabled) return "runtime-disabled";
  if (!symbolCount) return "empty-symbol-batch";
  if (!eventSourceAvailable) return "eventsource-unavailable";
  return null;
};

const thinBarsForSparkline = (bars, limit = SPARKLINE_RENDER_POINT_LIMIT) => {
  if (!Array.isArray(bars) || bars.length <= limit) {
    return Array.isArray(bars) ? bars : [];
  }

  if (limit <= 1) {
    return bars.slice(-1);
  }

  const lastIndex = bars.length - 1;
  return Array.from({ length: limit }, (_, index) => {
    const sourceIndex = Math.round((index * lastIndex) / (limit - 1));
    return bars[sourceIndex];
  });
};

const sparklineBarCloseValue = (bar) => {
  const close = Number(bar?.close ?? bar?.c ?? bar?.v);
  return Number.isFinite(close) ? close : null;
};

const hasUsableSparklineBars = (bars) =>
  (Array.isArray(bars) ? bars : []).filter(
    (bar) => sparklineBarCloseValue(bar) != null,
  ).length >= 2;

const aggregateToSparklineBar = (aggregate) => ({
  timestamp:
    Number.isFinite(aggregate?.startMs)
      ? new Date(aggregate.startMs).toISOString()
      : null,
  time: aggregate?.startMs ?? null,
  open: aggregate?.open ?? null,
  high: aggregate?.high ?? null,
  low: aggregate?.low ?? null,
  close: aggregate?.close ?? null,
  volume: aggregate?.volume ?? null,
});

export const MarketDataSubscriptionProvider = ({
  watchlistSymbols,
  activeWatchlistItems,
  quoteSymbols,
  activeVisibleQuoteSymbols = [],
  sparklineSymbols,
  prioritySparklineSymbols = [],
  streamedQuoteSymbols,
  streamedAggregateSymbols,
  quoteStreamRuntimeEnabled = false,
  positionQuoteStreamRuntimeEnabled = quoteStreamRuntimeEnabled,
  quoteStreamDisabledReason: upstreamQuoteStreamDisabledReason = null,
  positionQuoteStreamDisabledReason:
    upstreamPositionQuoteStreamDisabledReason = null,
  quoteStreamCoverageDiagnostics = null,
  marketStockAggregateStreamingEnabled,
  marketScreenActive = false,
  realtimeQuoteCoverageRequired = false,
  lowPriorityHistoryEnabled = true,
  sparklineHistoryRuntimeEnabled = true,
  sparklineConcurrency = 4,
  platformFreshnessBus = null,
  children,
}) => {
  const queryClient = useQueryClient();
  const positionQuoteSymbols = usePositionMarketDataSymbols();
  const marketAggregateStoreVersion = useStockMinuteAggregateSymbolsVersion(
    streamedAggregateSymbols,
  );
  const watchlistSymbolsKey = useMemo(
    () => (watchlistSymbols || []).join(","),
    [watchlistSymbols],
  );
  const activeWatchlistItemsKey = useMemo(
    () =>
      (activeWatchlistItems || [])
        .map((item) =>
          [
            item?.id,
            item?.symbol,
            item?.name,
            item?.assetClass,
            item?.provider,
            item?.providerContractId,
          ]
            .filter(Boolean)
            .join(":"),
        )
        .join("|"),
    [activeWatchlistItems],
  );
  const requestedSparklineSymbols = useMemo(
    () => [
      ...new Set([
        ...(lowPriorityHistoryEnabled ? sparklineSymbols : []),
        ...prioritySparklineSymbols,
      ]),
    ],
    [lowPriorityHistoryEnabled, prioritySparklineSymbols, sparklineSymbols],
  );
  // Per-symbol thinned-bar cache keyed on each symbol's individual store version.
  // marketAggregateStoreVersion bumps when ANY subscribed symbol ticks, so without
  // this cache every tick recomputed sparkline bars for the entire (now uncapped)
  // universe. Reusing unchanged symbols makes a flush O(changed) instead of O(all).
  const sparklineBarsCacheRef = useRef(new Map());
  const aggregateSparklineBarsBySymbol = useMemo(() => {
    const cache = sparklineBarsCacheRef.current;
    const requested = new Set();
    const entries = [];
    requestedSparklineSymbols.forEach((symbol) => {
      const normalized = normalizeRuntimeSymbol(symbol);
      if (!normalized) {
        return;
      }
      requested.add(normalized);
      const version = getStockMinuteAggregateSymbolVersion(normalized);
      const cached = cache.get(normalized);
      let bars;
      if (cached && cached.version === version) {
        bars = cached.bars;
      } else {
        bars = thinBarsForSparkline(
          getStoredBrokerMinuteAggregates(normalized).map(aggregateToSparklineBar),
        );
        cache.set(normalized, { version, bars });
      }
      if (hasUsableSparklineBars(bars)) {
        entries.push([normalized, bars]);
      }
    });
    // Drop cache entries for symbols that are no longer requested.
    cache.forEach((_value, key) => {
      if (!requested.has(key)) {
        cache.delete(key);
      }
    });
    return Object.fromEntries(entries);
  }, [marketAggregateStoreVersion, requestedSparklineSymbols]);
  const historySparklineSymbols = useMemo(
    () =>
      requestedSparklineSymbols.filter(
        (symbol) =>
          !hasUsableSparklineBars(
            aggregateSparklineBarsBySymbol[normalizeRuntimeSymbol(symbol)],
          ),
      ),
    [aggregateSparklineBarsBySymbol, requestedSparklineSymbols],
  );
  const sparklineHistoryEnabled = Boolean(
    sparklineHistoryRuntimeEnabled && historySparklineSymbols.length > 0,
  );
  const sparklineHydrationGate = useHydrationGate({
    enabled: sparklineHistoryEnabled,
    priority: BARS_REQUEST_PRIORITY.background,
    family: "sparkline",
  });
  const marketBaselineHydrationGate = useHydrationGate({
    enabled:
      lowPriorityHistoryEnabled &&
      marketScreenActive &&
      MARKET_PERFORMANCE_SYMBOLS.length > 0,
    priority: BARS_REQUEST_PRIORITY.background,
    family: "market-baseline",
  });
  const eventSourceAvailable =
    typeof window === "undefined" || typeof window.EventSource !== "undefined";
  const quoteStreamDisabledReason = resolveQuoteStreamDisabledReason({
    quoteStreamRuntimeEnabled,
    symbolCount: streamedQuoteSymbols.length,
    eventSourceAvailable,
    upstreamDisabledReason: upstreamQuoteStreamDisabledReason,
  });
  const positionQuoteStreamDisabledReason = resolveQuoteStreamDisabledReason({
    quoteStreamRuntimeEnabled: positionQuoteStreamRuntimeEnabled,
    symbolCount: positionQuoteSymbols.length,
    eventSourceAvailable,
    upstreamDisabledReason: upstreamPositionQuoteStreamDisabledReason,
  });
  const quoteStreamRuntimeActive = Boolean(
    !quoteStreamDisabledReason,
  );
  const positionQuoteStreamRuntimeActive = Boolean(
    !positionQuoteStreamDisabledReason,
  );
  const marketAggregateStreamRuntimeActive = Boolean(
    marketStockAggregateStreamingEnabled && marketScreenActive,
  );
  const streamCoveredQuoteSymbols = useMemo(() => {
    const symbols = [
      ...(quoteStreamRuntimeActive ? streamedQuoteSymbols : []),
      ...(positionQuoteStreamRuntimeActive ? positionQuoteSymbols : []),
    ];
    return new Set(symbols.map(normalizeRuntimeSymbol).filter(Boolean));
  }, [
    positionQuoteStreamRuntimeActive,
    positionQuoteSymbols,
    quoteStreamRuntimeActive,
    streamedQuoteSymbols,
  ]);
  const restQuoteSplit = useMemo(
    () =>
      splitRealtimeAwareRestQuoteSymbols({
        quoteSymbols,
        streamCoveredSymbols: Array.from(streamCoveredQuoteSymbols),
        activeVisibleSymbols: activeVisibleQuoteSymbols,
        realtimeRequired: realtimeQuoteCoverageRequired,
      }),
    [
      activeVisibleQuoteSymbols,
      quoteSymbols,
      realtimeQuoteCoverageRequired,
      streamCoveredQuoteSymbols,
    ],
  );
  const restQuoteSymbols = restQuoteSplit.restQuoteSymbols;
  const visibleRealtimeCoverageDiagnostics = useMemo(
    () =>
      buildVisibleRealtimeCoverageDiagnostics({
        activeVisibleSymbols: activeVisibleQuoteSymbols,
        streamCoveredSymbols: Array.from(streamCoveredQuoteSymbols),
        realtimeRequired: realtimeQuoteCoverageRequired,
        disabledReason: quoteStreamDisabledReason,
      }),
    [
      activeVisibleQuoteSymbols,
      quoteStreamDisabledReason,
      realtimeQuoteCoverageRequired,
      streamCoveredQuoteSymbols,
    ],
  );
  const restQuoteSymbolsKey = useMemo(
    () => restQuoteSymbols.join(","),
    [restQuoteSymbols],
  );
  const restQuoteSnapshotQueryKey = useMemo(
    () => getGetQuoteSnapshotsQueryKey({ symbols: restQuoteSymbolsKey }),
    [restQuoteSymbolsKey],
  );
  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const snapshot = {
      quoteStream: {
        active: quoteStreamRuntimeActive,
        disabledReason: quoteStreamDisabledReason,
        requestedSymbols: streamedQuoteSymbols,
        requestedSymbolCount: streamedQuoteSymbols.length,
        eventSourceAvailable,
        coverage: quoteStreamCoverageDiagnostics,
        activeVisibleCoverage: visibleRealtimeCoverageDiagnostics,
        restBlockedVisibleSymbols: restQuoteSplit.blockedVisibleSymbols,
      },
      positionQuoteStream: {
        active: positionQuoteStreamRuntimeActive,
        disabledReason: positionQuoteStreamDisabledReason,
        requestedSymbols: positionQuoteSymbols,
        requestedSymbolCount: positionQuoteSymbols.length,
        eventSourceAvailable,
      },
      aggregateStream: {
        active: marketAggregateStreamRuntimeActive,
        requestedSymbolCount: streamedAggregateSymbols.length,
      },
      updatedAt: new Date().toISOString(),
    };
    window[QUOTE_STREAM_DIAGNOSTICS_GLOBAL] = snapshot;
    return () => {
      if (window[QUOTE_STREAM_DIAGNOSTICS_GLOBAL] === snapshot) {
        delete window[QUOTE_STREAM_DIAGNOSTICS_GLOBAL];
      }
    };
  }, [
    eventSourceAvailable,
    marketAggregateStreamRuntimeActive,
    positionQuoteStreamDisabledReason,
    positionQuoteStreamRuntimeActive,
    positionQuoteSymbols,
    quoteStreamCoverageDiagnostics,
    quoteStreamDisabledReason,
    quoteStreamRuntimeActive,
    restQuoteSplit.blockedVisibleSymbols,
    streamedAggregateSymbols.length,
    streamedQuoteSymbols,
    visibleRealtimeCoverageDiagnostics,
  ]);

  useRuntimeWorkloadFlag(
    "market:subscription-streams",
    Boolean(
      quoteStreamRuntimeActive ||
        (marketAggregateStreamRuntimeActive &&
          streamedAggregateSymbols.length > 0),
    ),
    {
      kind: "stream",
      label: "Market runtime streams",
      detail: `${streamedQuoteSymbols.length}q/${streamedAggregateSymbols.length}a`,
      priority: 3,
    },
  );
  useRuntimeWorkloadFlag(
    "market:position-quote-stream",
    Boolean(positionQuoteStreamRuntimeActive),
    {
      kind: "stream",
      label: "Position spot stream",
      detail: `${positionQuoteSymbols.length}q`,
      priority: 2,
    },
  );
  useRuntimeWorkloadFlag("market:sparklines", sparklineHistoryEnabled, {
    kind: "poll",
    label: "Market sparklines",
    detail: `${historySparklineSymbols.length}s`,
    priority: 6,
  });
  useRuntimeWorkloadFlag(
    "market:performance-baselines",
    Boolean(
      lowPriorityHistoryEnabled &&
        marketScreenActive &&
        MARKET_PERFORMANCE_SYMBOLS.length > 0,
    ),
    {
      kind: "poll",
      label: "Market performance baselines",
      detail: `${MARKET_PERFORMANCE_SYMBOLS.length}s`,
      priority: 7,
    },
  );

  const quotesQuery = useGetQuoteSnapshots(
    { symbols: restQuoteSymbolsKey },
    {
      query: {
        enabled: Boolean(restQuoteSymbolsKey),
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  usePlatformFreshnessQueryHydration({
    bus: platformFreshnessBus,
    family: "market-quotes",
    freshnessKey: restQuoteSnapshotQueryKey,
    queryKey: restQuoteSnapshotQueryKey,
    queryClient,
    enabled: Boolean(restQuoteSymbolsKey),
  });
  usePlatformFreshnessQueryPublisher({
    bus: platformFreshnessBus,
    family: "market-quotes",
    freshnessKey: restQuoteSnapshotQueryKey,
    data: quotesQuery.data,
    enabled: Boolean(restQuoteSymbolsKey && quotesQuery.data),
    ttlMs: 60_000,
    payloadSizeClass: "medium",
  });
  const sparklineQuery = useQuery({
    queryKey: [
      "market-sparklines",
      SPARKLINE_HISTORY_TIMEFRAME,
      SPARKLINE_HISTORY_LIMIT,
      SPARKLINE_RENDER_POINT_LIMIT,
      historySparklineSymbols,
    ],
    enabled: sparklineHydrationGate.enabled,
    queryFn: async () => {
      const results = await settleWithConcurrency(
        historySparklineSymbols,
        Math.max(1, Math.floor(Number(sparklineConcurrency) || 1)),
        (symbol) =>
          getBarsRequest(
            {
              symbol,
              timeframe: SPARKLINE_HISTORY_TIMEFRAME,
              limit: SPARKLINE_HISTORY_LIMIT,
              outsideRth: true,
              source: "trades",
            },
            sparklineHydrationGate.requestOptions,
          ),
      );

      return Object.fromEntries(
        results.map((result, index) => [
          historySparklineSymbols[index],
          result.status === "fulfilled"
            ? thinBarsForSparkline(result.value.bars || [])
            : [],
        ]),
      );
    },
    ...BARS_QUERY_DEFAULTS,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  const sparklineBarsBySymbol = useMemo(
    () =>
      Object.fromEntries(
        requestedSparklineSymbols
          .map((symbol) => {
            const normalized = normalizeRuntimeSymbol(symbol);
            const bars =
              aggregateSparklineBarsBySymbol[normalized] ||
              sparklineQuery.data?.[symbol] ||
              sparklineQuery.data?.[normalized] ||
              [];
            return hasUsableSparklineBars(bars) ? [normalized, bars] : null;
          })
          .filter(Boolean),
      ),
    [
      aggregateSparklineBarsBySymbol,
      requestedSparklineSymbols,
      sparklineQuery.data,
    ],
  );
  const marketPerformanceQuery = useQuery({
    queryKey: ["market-performance-baselines", MARKET_PERFORMANCE_SYMBOLS],
    enabled: marketBaselineHydrationGate.enabled,
    queryFn: async () => {
      const results = await settleWithConcurrency(
        MARKET_PERFORMANCE_SYMBOLS,
        4,
        (symbol) =>
          getBarsRequest(
            {
              symbol,
              timeframe: "1d",
              limit: 6,
              outsideRth: false,
              source: "trades",
            },
            marketBaselineHydrationGate.requestOptions,
          ),
      );

      return Object.fromEntries(
        results.map((result, index) => {
          const bars =
            result.status === "fulfilled" ? result.value.bars || [] : [];
          const baselineBar = bars.length > 5 ? bars[bars.length - 6] : bars[0];
          return [
            MARKET_PERFORMANCE_SYMBOLS[index],
            baselineBar?.close ?? null,
          ];
        }),
      );
    },
    staleTime: 300_000,
    refetchInterval: false,
    refetchOnMount: false,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });

  const handleStreamQuotes = useCallback(
    (quotes) => {
      applyRuntimeQuoteSnapshots(quotes, activeWatchlistItems);
    },
    [activeWatchlistItems],
  );
  const handlePositionStreamQuotes = useCallback(
    (quotes) => {
      applyPositionQuoteSnapshots(quotes);
      applyRuntimeQuoteSnapshots(quotes, activeWatchlistItems);
    },
    [activeWatchlistItems],
  );

  useIbkrQuoteSnapshotStream({
    symbols: streamedQuoteSymbols,
    enabled: quoteStreamRuntimeActive,
    onQuotes: handleStreamQuotes,
  });
  usePositionQuoteSnapshotStream({
    symbols: positionQuoteSymbols,
    enabled: positionQuoteStreamRuntimeActive,
    onQuotes: handlePositionStreamQuotes,
  });
  useBrokerStockAggregateStream({
    symbols: streamedAggregateSymbols,
    enabled: Boolean(
      marketAggregateStreamRuntimeActive && streamedAggregateSymbols.length > 0,
    ),
  });

  const marketDataSyncKey = [
    watchlistSymbolsKey,
    activeWatchlistItemsKey,
    quotesQuery.dataUpdatedAt || 0,
    sparklineQuery.dataUpdatedAt || 0,
    Object.keys(sparklineBarsBySymbol).join(","),
    marketPerformanceQuery.dataUpdatedAt || 0,
    marketAggregateStoreVersion,
  ].join("::");

  useEffect(() => {
    const changedSymbolCount = syncRuntimeMarketData(
      watchlistSymbols,
      activeWatchlistItems,
      quotesQuery.data?.quotes,
      {
        sparklineBarsBySymbol,
        performanceBaselineBySymbol: marketPerformanceQuery.data,
      },
    );
    if (typeof window !== "undefined") {
      window[QUOTE_STREAM_DIAGNOSTICS_GLOBAL] = {
        ...(window[QUOTE_STREAM_DIAGNOSTICS_GLOBAL] || {}),
        sparkline: {
          enabled: sparklineHistoryEnabled,
          requestedSymbols: requestedSparklineSymbols,
          requestedSymbolCount: requestedSparklineSymbols.length,
          historySymbols: historySparklineSymbols,
          historySymbolCount: historySparklineSymbols.length,
          queryStatus: sparklineQuery.status,
          fetchStatus: sparklineQuery.fetchStatus,
          dataUpdatedAt: sparklineQuery.dataUpdatedAt || null,
          dataSymbols: Object.keys(sparklineBarsBySymbol || {}),
          dataSummary: summarizeSparklineBars(sparklineBarsBySymbol),
          changedSymbolCount,
          syncedAt: new Date().toISOString(),
        },
      };
    }
  }, [marketDataSyncKey]);

  return children;
};
