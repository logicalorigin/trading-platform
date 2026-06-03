import { useCallback, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getBars as getBarsRequest,
  useGetQuoteSnapshots,
} from "@workspace/api-client-react";
import {
  getStoredBrokerMinuteAggregates,
  useBrokerStockAggregateStream,
  useStockMinuteAggregateSymbolsVersion,
} from "../charting/useMassiveStockAggregateStream";
import { MARKET_PERFORMANCE_SYMBOLS } from "../market/marketReferenceData";
import {
  useIbkrQuoteSnapshotStream,
  usePositionQuoteSnapshotStream,
} from "./live-streams";
import { usePositionMarketDataSymbols } from "./positionMarketDataStore";
import { usePageVisible } from "./usePageVisible";
import { useRuntimeWorkloadFlag } from "./workloadStats";
import {
  BARS_QUERY_DEFAULTS,
  BARS_REQUEST_PRIORITY,
  HEAVY_PAYLOAD_GC_MS,
  buildBarsRequestOptions,
} from "./queryDefaults";
import {
  applyRuntimeQuoteSnapshots,
  syncRuntimeMarketData,
} from "./runtimeMarketDataModel";
import { SPARKLINE_RENDER_POINT_LIMIT } from "./sparklineConfig";

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
  pageVisible,
  quoteStreamRuntimeEnabled,
  symbolCount,
  eventSourceAvailable,
  upstreamDisabledReason = null,
} = {}) => {
  if (!pageVisible) return "page-hidden";
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

const hasUsableSparklineBars = (bars) => Array.isArray(bars) && bars.length >= 2;

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
  sparklineSymbols,
  prioritySparklineSymbols = [],
  streamedQuoteSymbols,
  streamedAggregateSymbols,
  quoteStreamRuntimeEnabled = false,
  quoteStreamDisabledReason: upstreamQuoteStreamDisabledReason = null,
  quoteStreamCoverageDiagnostics = null,
  marketStockAggregateStreamingEnabled,
  marketScreenActive = false,
  lowPriorityHistoryEnabled = true,
  sparklineHistoryRuntimeEnabled = true,
  sparklineConcurrency = 4,
  children,
}) => {
  const pageVisible = usePageVisible();
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
  const aggregateSparklineBarsBySymbol = useMemo(() => {
    return Object.fromEntries(
      requestedSparklineSymbols
        .map((symbol) => {
          const normalized = normalizeRuntimeSymbol(symbol);
          if (!normalized) {
            return null;
          }
          const bars = thinBarsForSparkline(
            getStoredBrokerMinuteAggregates(normalized).map(aggregateToSparklineBar),
          );
          return hasUsableSparklineBars(bars) ? [normalized, bars] : null;
        })
        .filter(Boolean),
    );
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
  const eventSourceAvailable =
    typeof window === "undefined" || typeof window.EventSource !== "undefined";
  const quoteStreamDisabledReason = resolveQuoteStreamDisabledReason({
    pageVisible,
    quoteStreamRuntimeEnabled,
    symbolCount: streamedQuoteSymbols.length,
    eventSourceAvailable,
    upstreamDisabledReason: upstreamQuoteStreamDisabledReason,
  });
  const positionQuoteStreamDisabledReason = resolveQuoteStreamDisabledReason({
    pageVisible,
    quoteStreamRuntimeEnabled,
    symbolCount: positionQuoteSymbols.length,
    eventSourceAvailable,
  });
  const quoteStreamRuntimeActive = Boolean(
    !quoteStreamDisabledReason,
  );
  const positionQuoteStreamRuntimeActive = Boolean(
    !positionQuoteStreamDisabledReason,
  );
  const marketAggregateStreamRuntimeActive = Boolean(
    pageVisible && marketStockAggregateStreamingEnabled && marketScreenActive,
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
  const restQuoteSymbols = useMemo(
    () =>
      quoteSymbols.filter(
        (symbol) => !streamCoveredQuoteSymbols.has(normalizeRuntimeSymbol(symbol)),
      ),
    [quoteSymbols, streamCoveredQuoteSymbols],
  );
  const restQuoteSymbolsKey = useMemo(
    () => restQuoteSymbols.join(","),
    [restQuoteSymbols],
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
    streamedAggregateSymbols.length,
    streamedQuoteSymbols,
  ]);

  useRuntimeWorkloadFlag(
    "market:subscription-streams",
    Boolean(
      pageVisible &&
        (quoteStreamRuntimeActive ||
          (marketAggregateStreamRuntimeActive &&
            streamedAggregateSymbols.length > 0)),
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
    Boolean(pageVisible && positionQuoteStreamRuntimeActive),
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
        enabled: Boolean(pageVisible && restQuoteSymbolsKey),
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  const sparklineQuery = useQuery({
    queryKey: [
      "market-sparklines",
      SPARKLINE_HISTORY_TIMEFRAME,
      SPARKLINE_HISTORY_LIMIT,
      SPARKLINE_RENDER_POINT_LIMIT,
      historySparklineSymbols,
    ],
    enabled: sparklineHistoryEnabled,
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
            buildBarsRequestOptions(
              BARS_REQUEST_PRIORITY.background,
              "sparkline",
            ),
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
    enabled:
      lowPriorityHistoryEnabled &&
      marketScreenActive &&
      MARKET_PERFORMANCE_SYMBOLS.length > 0,
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
            buildBarsRequestOptions(
              BARS_REQUEST_PRIORITY.background,
              "market-baseline",
            ),
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

  useIbkrQuoteSnapshotStream({
    symbols: streamedQuoteSymbols,
    enabled: quoteStreamRuntimeActive,
    onQuotes: handleStreamQuotes,
  });
  usePositionQuoteSnapshotStream({
    symbols: positionQuoteSymbols,
    enabled: positionQuoteStreamRuntimeActive,
    onQuotes: handleStreamQuotes,
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
