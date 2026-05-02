import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getBars as getBarsRequest,
  useGetQuoteSnapshots,
} from "@workspace/api-client-react";
import {
  useBrokerStockAggregateStream,
  useStockMinuteAggregateSymbolsVersion,
} from "../charting";
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
import { syncRuntimeMarketData } from "./runtimeMarketDataModel";

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

export const MarketDataSubscriptionProvider = ({
  watchlistSymbols,
  activeWatchlistItems,
  quoteSymbols,
  sparklineSymbols,
  streamedQuoteSymbols,
  streamedAggregateSymbols,
  marketStockAggregateStreamingEnabled,
  marketScreenActive = false,
  lowPriorityHistoryEnabled = true,
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
  const sparklineHistoryEnabled = Boolean(
    lowPriorityHistoryEnabled &&
      marketScreenActive &&
      sparklineSymbols.length > 0,
  );
  const marketStreamRuntimeEnabled = Boolean(
    pageVisible && marketStockAggregateStreamingEnabled && marketScreenActive,
  );

  useRuntimeWorkloadFlag(
    "market:subscription-streams",
    Boolean(
      pageVisible &&
        marketStreamRuntimeEnabled &&
        streamedQuoteSymbols.length > 0,
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
    detail: `${sparklineSymbols.length}s`,
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
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  const sparklineQuery = useQuery({
    queryKey: ["market-sparklines", sparklineSymbols],
    enabled: sparklineHistoryEnabled,
    queryFn: async () => {
      const results = await settleWithConcurrency(
        sparklineSymbols,
        4,
        (symbol) =>
          getBarsRequest(
            {
              symbol,
              timeframe: "15m",
              limit: 48,
              outsideRth: true,
              source: "trades",
            },
            buildBarsRequestOptions(BARS_REQUEST_PRIORITY.background),
          ),
      );

      return Object.fromEntries(
        results.map((result, index) => [
          sparklineSymbols[index],
          result.status === "fulfilled" ? result.value.bars || [] : [],
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
            buildBarsRequestOptions(BARS_REQUEST_PRIORITY.background),
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

  useIbkrQuoteSnapshotStream({
    symbols: streamedQuoteSymbols,
    enabled: Boolean(
      marketStreamRuntimeEnabled && streamedQuoteSymbols.length > 0,
    ),
  });
  useBrokerStockAggregateStream({
    symbols: streamedAggregateSymbols,
    enabled: Boolean(
      marketStreamRuntimeEnabled && streamedAggregateSymbols.length > 0,
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
