import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useIbkrQuoteSnapshotStream } from "./live-streams";
import { useRuntimeWorkloadFlag } from "./workloadStats";
import {
  BARS_QUERY_DEFAULTS,
  BARS_REQUEST_PRIORITY,
  HEAVY_PAYLOAD_GC_MS,
  buildBarsRequestOptions,
  parseRetryAfterMs,
  retryUnlessTimeout,
} from "./queryDefaults";
import { useHydrationGate } from "./hydrationCoordinator";
import {
  applyRuntimeQuoteSnapshots,
  applyRuntimeStockAggregateSnapshots,
  syncRuntimeMarketData,
} from "./runtimeMarketDataModel";
import { useCriticalApiMutationPause } from "./criticalApiMutationPause.js";
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
// The table renderer can draw a meaningful line with two points. Keep the
// provider gate aligned with the seed route's hydrated-symbol definition so
// thinly traded tickers do not get marked fulfilled by the server and then
// filtered blank before reaching runtime snapshots.
const SPARKLINE_MIN_VISUAL_POINT_COUNT = 2;
// Client-side fan-out cap for signal sparkline seed. Historical sparkline
// backfill is background work and each chunk can still be an expensive `bar_cache`
// read when the in-memory live edge is cold after a rebuild. Keep one seed POST
// in flight so this path cannot multiply server-side DB readers.
const SIGNAL_SPARKLINE_SEED_FETCH_CONCURRENCY = 1;
const SIGNAL_SPARKLINE_SEED_REQUEST_OPTIONS = buildBarsRequestOptions(
  BARS_REQUEST_PRIORITY.visible,
  "signal-sparkline-seed",
);
const QUOTE_STREAM_DIAGNOSTICS_GLOBAL =
  "__PYRUS_MARKET_DATA_SUBSCRIPTION_DIAGNOSTICS__";

const normalizeRuntimeSymbol = (symbol) =>
  String(symbol || "")
    .trim()
    .toUpperCase();

const quoteLooksLive = (quote) => {
  const transport = String(quote?.transport || "").toLowerCase();
  const freshness = String(quote?.freshness || "").toLowerCase();
  const marketDataMode = String(quote?.marketDataMode || "").toLowerCase();
  if (
    freshness === "frozen" ||
    freshness === "delayed" ||
    freshness === "delayed_frozen" ||
    freshness === "unavailable" ||
    marketDataMode === "frozen" ||
    marketDataMode === "delayed" ||
    marketDataMode === "unavailable"
  ) {
    return false;
  }
  return (
    freshness === "live" ||
    marketDataMode === "live" ||
    transport.includes("websocket") ||
    transport.includes("stream")
  );
};

const recordDeliveredRealtimeQuoteSymbols = (quotes = [], setSymbols) => {
  const incomingSymbols = (quotes || [])
    .filter(quoteLooksLive)
    .map((quote) => normalizeRuntimeSymbol(quote?.symbol))
    .filter(Boolean);
  if (!incomingSymbols.length) {
    return;
  }
  setSymbols((current) => {
    const next = new Set(current);
    incomingSymbols.forEach((symbol) => next.add(symbol));
    const nextSymbols = Array.from(next).sort();
    if (
      nextSymbols.length === current.length &&
      nextSymbols.every((symbol, index) => symbol === current[index])
    ) {
      return current;
    }
    return nextSymbols;
  });
};

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
            ? (bars.at(-1)?.timestamp ??
              bars.at(-1)?.time ??
              bars.at(-1)?.t ??
              null)
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
  ).length >= SPARKLINE_MIN_VISUAL_POINT_COUNT;

const aggregateToSparklineBar = (aggregate) => ({
  timestamp: Number.isFinite(aggregate?.startMs)
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

const barsRetryDelay = BARS_QUERY_DEFAULTS.retryDelay;

const signalSparklineSeedRetryDelay = (attempt, error) => {
  if (error?.status === 429 && Number.isFinite(error.retryAfterMs)) {
    return Math.max(0, error.retryAfterMs);
  }
  return barsRetryDelay(attempt, error);
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
    const error = new Error(`${label} failed with ${response.status}`);
    error.status = response.status;
    error.retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    throw error;
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

const fetchSignalSparklineSeedInChunks = async (
  symbols,
  {
    chunkSize = SPARKLINE_SEED_CHUNK_SIZE,
    concurrency = SIGNAL_SPARKLINE_SEED_FETCH_CONCURRENCY,
    onChunk = null,
  } = {},
) => {
  const size = Math.max(1, Math.floor(Number(chunkSize) || 1));
  const chunks = [];
  for (let index = 0; index < symbols.length; index += size) {
    chunks.push(symbols.slice(index, index + size));
  }
  if (!chunks.length) {
    return {};
  }
  // Fan the chunks out concurrently with a bounded cap so all signal symbols seed
  // in one non-serialized pass (no priority/background ordering). settleWithConcurrency
  // never rejects — it returns per-chunk fulfilled/rejected — so a single slow or
  // failed chunk blanks only its own symbols instead of a whole batch.
  const settled = await settleWithConcurrency(
    chunks,
    Math.max(1, Math.floor(Number(concurrency) || 1)),
    async (chunk, index) => {
      const chunkBarsBySymbol = await fetchSparklineSeed(chunk, {
        limit: SIGNAL_SPARKLINE_SEED_LIMIT,
        pointLimit: SIGNAL_SPARKLINE_SEED_POINT_LIMIT,
        requestOptions: SIGNAL_SPARKLINE_SEED_REQUEST_OPTIONS,
        label: "Signal sparkline seed",
      });
      if (typeof onChunk === "function") {
        onChunk(chunkBarsBySymbol, { index, symbols: chunk });
      }
      return chunkBarsBySymbol;
    },
  );
  const fulfilled = settled.filter((result) => result.status === "fulfilled");
  const rejected = settled.filter((result) => result.status === "rejected");
  // A partial seed is not a stable result: treating it as success pins the failed
  // chunk's symbols blank until the query key changes. Throw so React Query retries
  // the whole seed request and keep prior runtime bars visible meanwhile.
  if (rejected.length) {
    throw rejected[0]?.reason ?? new Error("Signal sparkline seed failed");
  }
  return Object.assign({}, ...fulfilled.map((result) => result.value));
};

const buildSignalSeedVisualBarsBySymbol = ({
  seedBarsBySymbol = {},
  aggregateBarsBySymbol = {},
  aggregateOnlySymbolSet = new Set(),
} = {}) => {
  const entries = Object.entries(seedBarsBySymbol)
    .map(([symbol, seedBars]) => {
      const normalized = normalizeRuntimeSymbol(symbol);
      if (!normalized || !hasUsableSparklineBars(seedBars)) {
        return null;
      }
      const bars = mergeSparklineBars(
        seedBars,
        aggregateBarsBySymbol[normalized],
      );
      if (!hasUsableSparklineBars(bars)) {
        return null;
      }
      return [
        normalized,
        thinBarsForSparkline(
          bars,
          aggregateOnlySymbolSet.has(normalized)
            ? SIGNAL_SPARKLINE_SEED_POINT_LIMIT
            : SPARKLINE_RENDER_POINT_LIMIT,
        ),
      ];
    })
    .filter(Boolean);

  return entries.length ? Object.fromEntries(entries) : {};
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
  massiveStockRealtimeConfigured = false,
  marketDataProviderConfigurationReady = false,
  quoteStreamDisabledReason: upstreamQuoteStreamDisabledReason = null,
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
  const criticalApiMutationPaused = useCriticalApiMutationPause();
  const [deliveredRealtimeQuoteSymbols, setDeliveredRealtimeQuoteSymbols] =
    useState([]);
  const marketAggregateStoreVersion = useStockMinuteAggregateSymbolsVersion(
    streamedAggregateSymbols,
  );
  const watchlistSymbolsKey = useMemo(
    () => (watchlistSymbols || []).join(","),
    [watchlistSymbols],
  );
  const streamedQuoteSymbolsKey = useMemo(
    () => (streamedQuoteSymbols || []).join(","),
    [streamedQuoteSymbols],
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
        [...requestedSparklineSymbols, ...aggregateOnlySparklineSymbols]
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
          getStoredBrokerMinuteAggregates(normalized).map(
            aggregateToSparklineBar,
          ),
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
  const aggregateRuntimePriceSymbols = useMemo(
    () =>
      new Set(
        [...watchlistSymbols, ...streamedQuoteSymbols]
          .map(normalizeRuntimeSymbol)
          .filter(Boolean),
      ),
    [streamedQuoteSymbols, watchlistSymbols],
  );
  const aggregateRuntimePriceSymbolsKey = useMemo(
    () => [...aggregateRuntimePriceSymbols].sort().join(","),
    [aggregateRuntimePriceSymbols],
  );
  const historySparklineSymbols = useMemo(
    () =>
      requestedSparklineSymbols.filter(
        (symbol) =>
          !aggregateOnlySparklineSymbolSet.has(
            normalizeRuntimeSymbol(symbol),
          ) &&
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
    !criticalApiMutationPaused &&
      sparklineHistoryRuntimeEnabled &&
      historySparklineSymbols.length > 0,
  );
  const signalSparklineSeedSymbols = useMemo(
    () => Array.from(aggregateOnlySparklineSymbolSet),
    [aggregateOnlySparklineSymbolSet],
  );
  const signalSparklineSeedSymbolsKey = useMemo(
    () => signalSparklineSeedSymbols.join(","),
    [signalSparklineSeedSymbols],
  );
  const signalSparklineSeedEnabled = Boolean(
    !criticalApiMutationPaused && signalSparklineSeedSymbols.length > 0,
  );
  const sparklineHydrationGate = useHydrationGate({
    enabled: sparklineHistoryEnabled,
    priority: BARS_REQUEST_PRIORITY.background,
    family: "sparkline",
  });
  const marketBaselineHydrationGate = useHydrationGate({
    enabled:
      !criticalApiMutationPaused &&
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
    upstreamDisabledReason: criticalApiMutationPaused
      ? "foreground-api-mutation"
      : upstreamQuoteStreamDisabledReason,
  });
  const quoteStreamRuntimeActive = Boolean(!quoteStreamDisabledReason);
  const marketAggregateStreamRuntimeActive = Boolean(
    !criticalApiMutationPaused &&
      marketStockAggregateStreamingEnabled &&
      streamedAggregateSymbols.length > 0,
  );
  const restQuoteSplit = useMemo(
    () =>
      splitRealtimeAwareRestQuoteSymbols({
        quoteSymbols,
        streamCoveredSymbols: deliveredRealtimeQuoteSymbols,
        activeVisibleSymbols: activeVisibleQuoteSymbols,
        realtimeRequired: realtimeQuoteCoverageRequired,
      }),
    [
      activeVisibleQuoteSymbols,
      deliveredRealtimeQuoteSymbols,
      quoteSymbols,
      realtimeQuoteCoverageRequired,
    ],
  );
  const quoteSnapshotFallbackBlocked = Boolean(
    criticalApiMutationPaused || !marketDataProviderConfigurationReady,
  );
  const restQuoteSymbols = quoteSnapshotFallbackBlocked
    ? []
    : restQuoteSplit.restQuoteSymbols;
  const quoteFallbackDisabledReason = criticalApiMutationPaused
    ? "foreground-api-mutation"
    : !marketDataProviderConfigurationReady
      ? "market-data-config-loading"
      : null;
  const visibleRealtimeCoverageDiagnostics = useMemo(
    () =>
      buildVisibleRealtimeCoverageDiagnostics({
        activeVisibleSymbols: activeVisibleQuoteSymbols,
        streamCoveredSymbols: deliveredRealtimeQuoteSymbols,
        realtimeRequired: realtimeQuoteCoverageRequired,
        disabledReason: quoteStreamDisabledReason,
      }),
    [
      activeVisibleQuoteSymbols,
      deliveredRealtimeQuoteSymbols,
      quoteStreamDisabledReason,
      realtimeQuoteCoverageRequired,
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
        missingRealtimeVisibleSymbols:
          restQuoteSplit.missingRealtimeVisibleSymbols,
        deliveredSymbols: deliveredRealtimeQuoteSymbols,
        deliveredSymbolCount: deliveredRealtimeQuoteSymbols.length,
        fallbackDisabledReason: quoteFallbackDisabledReason,
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
    quoteStreamCoverageDiagnostics,
    quoteStreamDisabledReason,
    quoteStreamRuntimeActive,
    deliveredRealtimeQuoteSymbols,
    quoteFallbackDisabledReason,
    restQuoteSplit.missingRealtimeVisibleSymbols,
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
    enabled: sparklineHydrationGate.enabled,
    queryFn: () =>
      fetchSparklineSeedInChunks(historySparklineSymbols, {
        chunkSize:
          Math.max(1, Math.floor(Number(sparklineConcurrency) || 1)) *
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
  const signalSparklineSeedChunkFlushRef = useRef({
    count: 0,
    symbolCount: 0,
    lastSymbolCount: 0,
    updatedAt: null,
  });
  useEffect(() => {
    signalSparklineSeedChunkFlushRef.current = {
      count: 0,
      symbolCount: 0,
      lastSymbolCount: 0,
      updatedAt: null,
    };
  }, [signalSparklineSeedSymbolsKey]);
  const publishSignalSparklineSeedChunk = useCallback(
    (seedBarsBySymbol) => {
      const visualBarsBySymbol = buildSignalSeedVisualBarsBySymbol({
        seedBarsBySymbol,
        aggregateBarsBySymbol: aggregateSparklineBarsBySymbol,
        aggregateOnlySymbolSet: aggregateOnlySparklineSymbolSet,
      });
      const symbolCount = Object.keys(visualBarsBySymbol).length;
      if (!symbolCount) {
        return;
      }
      syncRuntimeMarketData(
        watchlistSymbols,
        activeWatchlistItems,
        quotesQuery.data?.quotes,
        {
          sparklineBarsBySymbol: visualBarsBySymbol,
        },
      );
      signalSparklineSeedChunkFlushRef.current = {
        count: signalSparklineSeedChunkFlushRef.current.count + 1,
        symbolCount:
          signalSparklineSeedChunkFlushRef.current.symbolCount + symbolCount,
        lastSymbolCount: symbolCount,
        updatedAt: new Date().toISOString(),
      };
    },
    [
      activeWatchlistItems,
      aggregateOnlySparklineSymbolSet,
      aggregateSparklineBarsBySymbol,
      quotesQuery.data?.quotes,
      watchlistSymbols,
    ],
  );
  const signalSparklineSeedQuery = useQuery({
    queryKey: [
      "signal-sparkline-seed",
      SPARKLINE_HISTORY_TIMEFRAME,
      SIGNAL_SPARKLINE_SEED_LIMIT,
      SIGNAL_SPARKLINE_SEED_POINT_LIMIT,
      signalSparklineSeedSymbols,
    ],
    enabled: Boolean(
      signalSparklineSeedEnabled && signalSparklineSeedSymbols.length,
    ),
    queryFn: () =>
      fetchSignalSparklineSeedInChunks(signalSparklineSeedSymbols, {
        onChunk: publishSignalSparklineSeedChunk,
      }),
    ...BARS_QUERY_DEFAULTS,
    retry: retryUnlessTimeout(2),
    retryDelay: signalSparklineSeedRetryDelay,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  const signalSparklineSeedData = useMemo(
    () => signalSparklineSeedQuery.data || {},
    [signalSparklineSeedQuery.data],
  );
  const signalSparklineSeedStatus = signalSparklineSeedQuery.status;
  const signalSparklineSeedFetchStatus = signalSparklineSeedQuery.fetchStatus;
  const signalSparklineSeedDataUpdatedAt =
    signalSparklineSeedQuery.dataUpdatedAt || 0;
  const visualSparklineBarsCacheRef = useRef(new Map());
  const sparklineBarsBySymbol = useMemo(() => {
    const cache = visualSparklineBarsCacheRef.current;
    const requestedSymbols = new Set();
    const entries = [];

    aggregateSparklineSymbols.forEach((symbol) => {
      const normalized = normalizeRuntimeSymbol(symbol);
      if (!normalized) {
        return;
      }
      requestedSymbols.add(normalized);

      const aggregateBars = aggregateSparklineBarsBySymbol[normalized];
      const seedBars = signalSparklineSeedData?.[normalized];
      const cachedBars = cache.get(normalized)?.bars;
      const marketSeedBars =
        sparklineQuery.data?.[symbol] ||
        sparklineQuery.data?.[normalized] ||
        [];
      const hasSeedBars = hasUsableSparklineBars(seedBars);
      const hasCachedBars = hasUsableSparklineBars(cachedBars);
      const hasAggregateBars = hasUsableSparklineBars(aggregateBars);
      const hasMarketSeedBars = hasUsableSparklineBars(marketSeedBars);
      const isAggregateOnly = aggregateOnlySparklineSymbolSet.has(normalized);

      let bars = [];
      if (hasSeedBars) {
        bars = mergeSparklineBars(seedBars, aggregateBars);
      } else if (isAggregateOnly && hasCachedBars) {
        bars = mergeSparklineBars(cachedBars, aggregateBars);
      } else if (isAggregateOnly) {
        bars = [];
      } else {
        const fallbackBars = hasMarketSeedBars
          ? marketSeedBars
          : hasAggregateBars
            ? aggregateBars
            : [];
        bars = fallbackBars;
      }

      if (hasUsableSparklineBars(bars)) {
        const visualBars = thinBarsForSparkline(
          bars,
          isAggregateOnly
            ? SIGNAL_SPARKLINE_SEED_POINT_LIMIT
            : SPARKLINE_RENDER_POINT_LIMIT,
        );
        cache.set(normalized, { bars: visualBars });
        entries.push([normalized, visualBars]);
      }
    });

    cache.forEach((_value, symbol) => {
      if (!requestedSymbols.has(symbol)) {
        cache.delete(symbol);
      }
    });

    return Object.fromEntries(entries);
  }, [
    aggregateSparklineSymbols,
    aggregateOnlySparklineSymbolSet,
    aggregateSparklineBarsBySymbol,
    signalSparklineSeedData,
    sparklineQuery.data,
  ]);
  const signalSparklineSeedSettled = Boolean(
    !signalSparklineSeedSymbols.length || signalSparklineSeedQuery.isSuccess,
  );
  const clearAggregateOnlySparklineSymbols = useMemo(() => {
    if (!signalSparklineSeedSettled) {
      return [];
    }
    return aggregateSparklineSymbols
      .map(normalizeRuntimeSymbol)
      .filter(
        (symbol) =>
          symbol &&
          aggregateOnlySparklineSymbolSet.has(symbol) &&
          !hasUsableSparklineBars(sparklineBarsBySymbol[symbol]),
      );
  }, [
    aggregateOnlySparklineSymbolSet,
    aggregateSparklineSymbols,
    signalSparklineSeedSettled,
    sparklineBarsBySymbol,
  ]);
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
      recordDeliveredRealtimeQuoteSymbols(quotes, setDeliveredRealtimeQuoteSymbols);
      applyRuntimeQuoteSnapshots(quotes, activeWatchlistItems);
    },
    [activeWatchlistItems],
  );
  const handleStockAggregate = useCallback(
    (aggregate) => {
      const symbol = normalizeRuntimeSymbol(aggregate?.symbol);
      if (!symbol || !aggregateRuntimePriceSymbols.has(symbol)) {
        return;
      }
      applyRuntimeStockAggregateSnapshots([aggregate], activeWatchlistItems);
    },
    [activeWatchlistItems, aggregateRuntimePriceSymbols],
  );

  useEffect(() => {
    if (
      !marketAggregateStreamRuntimeActive ||
      !aggregateRuntimePriceSymbolsKey
    ) {
      return;
    }

    const aggregates = aggregateRuntimePriceSymbolsKey
      .split(",")
      .map((symbol) => getStoredBrokerMinuteAggregates(symbol).at(-1))
      .filter(Boolean);
    if (aggregates.length) {
      applyRuntimeStockAggregateSnapshots(aggregates, activeWatchlistItems);
    }
  }, [
    activeWatchlistItems,
    aggregateRuntimePriceSymbolsKey,
    marketAggregateStoreVersion,
    marketAggregateStreamRuntimeActive,
  ]);

  useEffect(() => {
    setDeliveredRealtimeQuoteSymbols([]);
  }, [
    quoteStreamRuntimeActive,
    streamedQuoteSymbolsKey,
  ]);

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
    onAggregate: handleStockAggregate,
  });

  const marketDataSyncKey = [
    watchlistSymbolsKey,
    activeWatchlistItemsKey,
    quotesQuery.dataUpdatedAt || 0,
    sparklineQuery.dataUpdatedAt || 0,
    signalSparklineSeedDataUpdatedAt,
    Object.keys(sparklineBarsBySymbol).join(","),
    clearAggregateOnlySparklineSymbols.join(","),
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
        clearSparklineSymbols: clearAggregateOnlySparklineSymbols,
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
          signalSeedEnabled: signalSparklineSeedEnabled,
          signalSeedStatus: signalSparklineSeedStatus,
          signalSeedFetchStatus: signalSparklineSeedFetchStatus,
          signalSeedUpdatedAt: signalSparklineSeedDataUpdatedAt || null,
          signalSeedSymbolCount: signalSparklineSeedSymbols.length,
          signalSeedSettled: signalSparklineSeedSettled,
          signalSeedChunkSize: SPARKLINE_SEED_CHUNK_SIZE,
          signalSeedFetchConcurrency: SIGNAL_SPARKLINE_SEED_FETCH_CONCURRENCY,
          signalSeedChunkFlushCount:
            signalSparklineSeedChunkFlushRef.current.count,
          signalSeedChunkFlushSymbolCount:
            signalSparklineSeedChunkFlushRef.current.symbolCount,
          signalSeedLastChunkFlushSymbolCount:
            signalSparklineSeedChunkFlushRef.current.lastSymbolCount,
          signalSeedLastChunkFlushAt:
            signalSparklineSeedChunkFlushRef.current.updatedAt,
          visualCacheSymbolCount: visualSparklineBarsCacheRef.current.size,
          visualCacheSymbols: Array.from(
            visualSparklineBarsCacheRef.current.keys(),
          ),
          clearSparklineSymbolCount: clearAggregateOnlySparklineSymbols.length,
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
