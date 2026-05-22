import { useCallback, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getBars as getBarsRequest,
  useGetQuoteSnapshots,
} from "@workspace/api-client-react";
import {
  useBrokerStockAggregateStream,
  useStockMinuteAggregateSymbolsVersion,
} from "../charting/useMassiveStockAggregateStream";
import { MARKET_PERFORMANCE_SYMBOLS } from "../market/marketReferenceData";
import { useIbkrQuoteSnapshotStream } from "./live-streams";
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

export const MarketDataSubscriptionProvider = ({
  watchlistSymbols,
  activeWatchlistItems,
  quoteSymbols,
  sparklineSymbols,
  prioritySparklineSymbols = [],
  streamedQuoteSymbols,
  streamedAggregateSymbols,
  quoteStreamRuntimeEnabled = false,
  marketStockAggregateStreamingEnabled,
  marketScreenActive = false,
  lowPriorityHistoryEnabled = true,
  sparklineHistoryRuntimeEnabled = true,
  sparklineConcurrency = 4,
  children,
}) => {
  const pageVisible = usePageVisible();
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
  const sparklineHistoryEnabled = Boolean(
    sparklineHistoryRuntimeEnabled && requestedSparklineSymbols.length > 0,
  );
  const quoteStreamRuntimeActive = Boolean(
    pageVisible && quoteStreamRuntimeEnabled && streamedQuoteSymbols.length > 0,
  );
  const marketAggregateStreamRuntimeActive = Boolean(
    pageVisible && marketStockAggregateStreamingEnabled && marketScreenActive,
  );

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
  useRuntimeWorkloadFlag("market:sparklines", sparklineHistoryEnabled, {
    kind: "poll",
    label: "Market sparklines",
    detail: `${requestedSparklineSymbols.length}s`,
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
    { symbols: quoteSymbols.join(",") },
    {
      query: {
        enabled: Boolean(pageVisible && quoteSymbols.length > 0),
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
      requestedSparklineSymbols,
    ],
    enabled: sparklineHistoryEnabled,
    queryFn: async () => {
      const results = await settleWithConcurrency(
        requestedSparklineSymbols,
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
          requestedSparklineSymbols[index],
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
    marketPerformanceQuery.dataUpdatedAt || 0,
    marketAggregateStoreVersion,
  ].join("::");

  useEffect(() => {
    syncRuntimeMarketData(
      watchlistSymbols,
      activeWatchlistItems,
      quotesQuery.data?.quotes,
      {
        sparklineBarsBySymbol: sparklineQuery.data,
        performanceBaselineBySymbol: marketPerformanceQuery.data,
      },
    );
  }, [marketDataSyncKey]);

  return children;
};
