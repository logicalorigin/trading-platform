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
  buildBarsRequestOptions,
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
const SPARKLINE_HISTORY_SEED_LIMIT = 240;
const SPARKLINE_SEED_CHUNK_SIZE = 96;
const SIGNAL_SPARKLINE_SEED_LIMIT = 120;
const SIGNAL_SPARKLINE_SEED_POINT_LIMIT = 48;
const SIGNAL_SPARKLINE_PRIORITY_SEED_SYMBOL_LIMIT = SPARKLINE_SEED_CHUNK_SIZE;
const SIGNAL_SPARKLINE_BACKGROUND_SEED_CHUNK_SIZE = SPARKLINE_SEED_CHUNK_SIZE;
const SIGNAL_SPARKLINE_SEED_REQUEST_OPTIONS = buildBarsRequestOptions(
  BARS_REQUEST_PRIORITY.visible,
  "signal-sparkline-seed",
);
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

const sparklineBarTimestampMs = (bar) => {
  const raw = bar?.timestamp ?? bar?.time ?? bar?.t;
  if (raw instanceof Date) {
    const value = raw.getTime();
    return Number.isFinite(value) ? value : null;
  }
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const mergeSparklineBars = (...seriesList) => {
  const byTimestamp = new Map();
  const untimed = [];
  seriesList.forEach((series) => {
    (Array.isArray(series) ? series : []).forEach((bar) => {
      const timestampMs = sparklineBarTimestampMs(bar);
      if (timestampMs == null) {
        untimed.push(bar);
        return;
      }
      byTimestamp.set(timestampMs, bar);
    });
  });
  const timed = Array.from(byTimestamp.entries())
    .sort(([left], [right]) => left - right)
    .map(([, bar]) => bar);
  return [...untimed, ...timed];
};

const fetchSparklineSeed = async (
  symbols,
  {
    limit = SIGNAL_SPARKLINE_SEED_LIMIT,
    pointLimit = SIGNAL_SPARKLINE_SEED_POINT_LIMIT,
    requestOptions = SIGNAL_SPARKLINE_SEED_REQUEST_OPTIONS,
    label = "Sparkline seed",
  } = {},
) => {
  if (!symbols.length) {
    return {};
  }
  const headers = new Headers(requestOptions?.headers);
  headers.set("content-type", "application/json");
  const response = await fetch("/api/sparklines/seed", {
    ...requestOptions,
    method: "POST",
    headers,
    body: JSON.stringify({
      symbols,
      timeframe: SPARKLINE_HISTORY_TIMEFRAME,
      limit,
      pointLimit,
    }),
  });
  if (!response.ok) {
    throw new Error(`${label} failed with ${response.status}`);
  }
  const payload = await response.json();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return Object.fromEntries(
    items
      .map((item) => {
        const symbol = normalizeRuntimeSymbol(item?.symbol);
        const bars = Array.isArray(item?.bars) ? item.bars : [];
        return symbol && hasUsableSparklineBars(bars) ? [symbol, bars] : null;
      })
      .filter(Boolean),
  );
};

const fetchSignalSparklineSeed = async (symbols) =>
  fetchSparklineSeed(symbols, {
    limit: SIGNAL_SPARKLINE_SEED_LIMIT,
    pointLimit: SIGNAL_SPARKLINE_SEED_POINT_LIMIT,
    requestOptions: SIGNAL_SPARKLINE_SEED_REQUEST_OPTIONS,
    label: "Signal sparkline seed",
  });

const fetchSignalSparklineSeedInChunks = async (
  symbols,
  chunkSize = SIGNAL_SPARKLINE_BACKGROUND_SEED_CHUNK_SIZE,
) => {
  return fetchSparklineSeedInChunks(symbols, {
    chunkSize,
    limit: SIGNAL_SPARKLINE_SEED_LIMIT,
    pointLimit: SIGNAL_SPARKLINE_SEED_POINT_LIMIT,
    requestOptions: SIGNAL_SPARKLINE_SEED_REQUEST_OPTIONS,
    label: "Signal sparkline seed",
  });
};

const fetchSparklineSeedInChunks = async (
  symbols,
  {
    chunkSize = SPARKLINE_SEED_CHUNK_SIZE,
    limit = SPARKLINE_HISTORY_SEED_LIMIT,
    pointLimit = SPARKLINE_RENDER_POINT_LIMIT,
    requestOptions = SIGNAL_SPARKLINE_SEED_REQUEST_OPTIONS,
    label = "Sparkline seed",
  } = {},
) => {
  const size = Math.max(1, Math.floor(Number(chunkSize) || 1));
  const seedData = {};
  for (let index = 0; index < symbols.length; index += size) {
    Object.assign(
      seedData,
      await fetchSparklineSeed(symbols.slice(index, index + size), {
        limit,
        pointLimit,
        requestOptions,
        label,
      }),
    );
  }
  return seedData;
};

export const MarketDataSubscriptionProvider = ({
  watchlistSymbols,
  activeWatchlistItems,
  quoteSymbols,
  activeVisibleQuoteSymbols = [],
  sparklineSymbols,
  prioritySparklineSymbols = [],
  aggregateOnlySparklineSymbols = [],
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
  const aggregateOnlySparklineSymbolSet = useMemo(
    () =>
      new Set(
        (aggregateOnlySparklineSymbols || [])
          .map(normalizeRuntimeSymbol)
          .filter(Boolean),
      ),
    [aggregateOnlySparklineSymbols],
  );
  const aggregateSparklineSymbols = useMemo(
    () => [
      ...new Set(
        [
          ...requestedSparklineSymbols,
          ...aggregateOnlySparklineSymbols,
        ]
          .map(normalizeRuntimeSymbol)
          .filter(Boolean),
      ),
    ],
    [aggregateOnlySparklineSymbols, requestedSparklineSymbols],
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
    aggregateSparklineSymbols.forEach((symbol) => {
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
  }, [aggregateSparklineSymbols, marketAggregateStoreVersion]);
  const historySparklineSymbols = useMemo(
    () =>
      requestedSparklineSymbols.filter(
        (symbol) =>
          !aggregateOnlySparklineSymbolSet.has(normalizeRuntimeSymbol(symbol)) &&
          !hasUsableSparklineBars(
            aggregateSparklineBarsBySymbol[normalizeRuntimeSymbol(symbol)],
          ),
      ),
    [
      aggregateOnlySparklineSymbolSet,
      aggregateSparklineBarsBySymbol,
      requestedSparklineSymbols,
    ],
  );
  const sparklineHistoryEnabled = Boolean(
    sparklineHistoryRuntimeEnabled && historySparklineSymbols.length > 0,
  );
  const signalSparklineSeedSymbols = useMemo(
    () => Array.from(aggregateOnlySparklineSymbolSet),
    [aggregateOnlySparklineSymbolSet],
  );
  const signalSparklinePrioritySeedSymbols = useMemo(
    () =>
      signalSparklineSeedSymbols.slice(
        0,
        SIGNAL_SPARKLINE_PRIORITY_SEED_SYMBOL_LIMIT,
      ),
    [signalSparklineSeedSymbols],
  );
  const signalSparklineBackgroundSeedSymbols = useMemo(
    () =>
      signalSparklineSeedSymbols.slice(
        SIGNAL_SPARKLINE_PRIORITY_SEED_SYMBOL_LIMIT,
      ),
    [signalSparklineSeedSymbols],
  );
  const signalSparklineSeedEnabled = Boolean(
    marketStockAggregateStreamingEnabled && signalSparklineSeedSymbols.length > 0,
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
    marketStockAggregateStreamingEnabled && streamedAggregateSymbols.length > 0,
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
        aggregateOnlySymbolCount: aggregateOnlySparklineSymbolSet.size,
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
    aggregateOnlySparklineSymbolSet,
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
      SPARKLINE_HISTORY_SEED_LIMIT,
      SPARKLINE_RENDER_POINT_LIMIT,
      historySparklineSymbols,
    ],
    enabled: sparklineHistoryEnabled,
    queryFn: () =>
      fetchSparklineSeedInChunks(historySparklineSymbols, {
        chunkSize: Math.max(1, Math.floor(Number(sparklineConcurrency) || 1)) *
          SPARKLINE_SEED_CHUNK_SIZE,
        limit: SPARKLINE_HISTORY_SEED_LIMIT,
        pointLimit: SPARKLINE_RENDER_POINT_LIMIT,
        requestOptions: sparklineHydrationGate.requestOptions,
        label: "Market sparkline seed",
      }),
    ...BARS_QUERY_DEFAULTS,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  const signalSparklinePrioritySeedQuery = useQuery({
    queryKey: [
      "signal-sparkline-seed",
      "priority",
      SPARKLINE_HISTORY_TIMEFRAME,
      SIGNAL_SPARKLINE_SEED_LIMIT,
      SIGNAL_SPARKLINE_SEED_POINT_LIMIT,
      signalSparklinePrioritySeedSymbols,
    ],
    enabled: Boolean(
      signalSparklineSeedEnabled && signalSparklinePrioritySeedSymbols.length,
    ),
    queryFn: () => fetchSignalSparklineSeed(signalSparklinePrioritySeedSymbols),
    ...BARS_QUERY_DEFAULTS,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  const signalSparklineBackgroundSeedQuery = useQuery({
    queryKey: [
      "signal-sparkline-seed",
      "background",
      SPARKLINE_HISTORY_TIMEFRAME,
      SIGNAL_SPARKLINE_SEED_LIMIT,
      SIGNAL_SPARKLINE_SEED_POINT_LIMIT,
      signalSparklineBackgroundSeedSymbols,
    ],
    enabled: Boolean(
      signalSparklineSeedEnabled &&
        signalSparklineBackgroundSeedSymbols.length &&
        signalSparklinePrioritySeedQuery.status === "success",
    ),
    queryFn: () =>
      fetchSignalSparklineSeedInChunks(signalSparklineBackgroundSeedSymbols),
    ...BARS_QUERY_DEFAULTS,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  const signalSparklineSeedData = useMemo(
    () => ({
      ...(signalSparklineBackgroundSeedQuery.data || {}),
      ...(signalSparklinePrioritySeedQuery.data || {}),
    }),
    [
      signalSparklineBackgroundSeedQuery.data,
      signalSparklinePrioritySeedQuery.data,
    ],
  );
  const signalSparklineSeedStatus =
    signalSparklinePrioritySeedQuery.status === "error" ||
    signalSparklineBackgroundSeedQuery.status === "error"
      ? "error"
      : signalSparklineBackgroundSeedSymbols.length
        ? signalSparklineBackgroundSeedQuery.status
        : signalSparklinePrioritySeedQuery.status;
  const signalSparklineSeedFetchStatus =
    signalSparklinePrioritySeedQuery.fetchStatus === "fetching" ||
    signalSparklineBackgroundSeedQuery.fetchStatus === "fetching"
      ? "fetching"
      : signalSparklinePrioritySeedQuery.fetchStatus === "paused" ||
          signalSparklineBackgroundSeedQuery.fetchStatus === "paused"
        ? "paused"
        : "idle";
  const signalSparklineSeedDataUpdatedAt = Math.max(
    signalSparklinePrioritySeedQuery.dataUpdatedAt || 0,
    signalSparklineBackgroundSeedQuery.dataUpdatedAt || 0,
  );
  const sparklineBarsBySymbol = useMemo(
    () =>
      Object.fromEntries(
        aggregateSparklineSymbols
          .map((symbol) => {
            const normalized = normalizeRuntimeSymbol(symbol);
            const seedBars = signalSparklineSeedData?.[normalized];
            const hasSeedBars = hasUsableSparklineBars(seedBars);
            const signalSparklineBars = hasSeedBars
              ? mergeSparklineBars(
                  seedBars,
                  aggregateSparklineBarsBySymbol[normalized],
                )
              : [];
            if (aggregateOnlySparklineSymbolSet.has(normalized)) {
              return hasUsableSparklineBars(signalSparklineBars)
                ? [normalized, signalSparklineBars]
                : null;
            }
            const fallbackBars =
              aggregateSparklineBarsBySymbol[normalized] ||
              sparklineQuery.data?.[symbol] ||
              sparklineQuery.data?.[normalized] ||
              [];
            const bars = hasUsableSparklineBars(signalSparklineBars)
              ? signalSparklineBars
              : fallbackBars;
            return hasUsableSparklineBars(bars) ? [normalized, bars] : null;
          })
          .filter(Boolean),
      ),
    [
      aggregateSparklineSymbols,
      aggregateOnlySparklineSymbolSet,
      aggregateSparklineBarsBySymbol,
      signalSparklineSeedData,
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
    signalSparklineSeedDataUpdatedAt,
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
        clearSparklineSymbols: Array.from(aggregateOnlySparklineSymbolSet),
      },
    );
    if (typeof window !== "undefined") {
      window[QUOTE_STREAM_DIAGNOSTICS_GLOBAL] = {
        ...(window[QUOTE_STREAM_DIAGNOSTICS_GLOBAL] || {}),
        sparkline: {
          enabled: sparklineHistoryEnabled,
          requestedSymbols: requestedSparklineSymbols,
          requestedSymbolCount: requestedSparklineSymbols.length,
          aggregateOnlySymbolCount: aggregateOnlySparklineSymbolSet.size,
          historySymbols: historySparklineSymbols,
          historySymbolCount: historySparklineSymbols.length,
          queryStatus: sparklineQuery.status,
          fetchStatus: sparklineQuery.fetchStatus,
          dataUpdatedAt: sparklineQuery.dataUpdatedAt || null,
          signalSeedStatus: signalSparklineSeedStatus,
          signalSeedFetchStatus: signalSparklineSeedFetchStatus,
          signalSeedUpdatedAt: signalSparklineSeedDataUpdatedAt || null,
          signalSeedPrioritySymbolCount: signalSparklinePrioritySeedSymbols.length,
          signalSeedPriorityStatus: signalSparklinePrioritySeedQuery.status,
          signalSeedPriorityFetchStatus:
            signalSparklinePrioritySeedQuery.fetchStatus,
          signalSeedPriorityUpdatedAt:
            signalSparklinePrioritySeedQuery.dataUpdatedAt || null,
          signalSeedBackgroundSymbolCount:
            signalSparklineBackgroundSeedSymbols.length,
          signalSeedBackgroundChunkSize:
            SIGNAL_SPARKLINE_BACKGROUND_SEED_CHUNK_SIZE,
          signalSeedBackgroundStatus: signalSparklineBackgroundSeedQuery.status,
          signalSeedBackgroundFetchStatus:
            signalSparklineBackgroundSeedQuery.fetchStatus,
          signalSeedBackgroundUpdatedAt:
            signalSparklineBackgroundSeedQuery.dataUpdatedAt || null,
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
