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
import { usePositionMarketDataSymbols } from "./positionMarketDataStore";
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
  WATCHLIST_QUOTE_STREAM_CYCLE_WINDOW_MS,
  buildVisibleRealtimeCoverageDiagnostics,
  reconcileRealtimeQuoteCoverage,
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
const SPARKLINE_SEED_REQUEST_TIMEOUT_MS = 20_000;
const SIGNAL_SPARKLINE_SEED_PENDING_RETRY_DELAYS_MS = [
  1_000,
  2_000,
  3_000,
  5_000,
  5_000,
  5_000,
];
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
  if (
    (error?.status === 425 || error?.status === 429) &&
    Number.isFinite(error.retryAfterMs)
  ) {
    return Math.max(0, error.retryAfterMs);
  }
  return barsRetryDelay(attempt, error);
};

const waitForSignalSparklineSeedRetry = (delayMs, signal) =>
  new Promise((resolve, reject) => {
    const canceled = () => {
      const error = new Error("Signal sparkline seed canceled.");
      error.name = "AbortError";
      error.code = "request_canceled";
      return error;
    };
    if (signal?.aborted) {
      reject(canceled());
      return;
    }
    const timeoutId = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, Math.max(0, delayMs));
    const handleAbort = () => {
      globalThis.clearTimeout(timeoutId);
      reject(canceled());
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
  });

const fetchSparklineSeed = async (
  symbols,
  {
    limit = SIGNAL_SPARKLINE_SEED_LIMIT,
    pointLimit = SIGNAL_SPARKLINE_SEED_POINT_LIMIT,
    requestOptions = SIGNAL_SPARKLINE_SEED_REQUEST_OPTIONS,
    label = "Sparkline seed",
    signal = null,
  } = {},
) => {
  if (!symbols.length) {
    return { barsBySymbol: {}, pendingSymbols: [], retryAfterMs: null };
  }
  const headers = new Headers(requestOptions?.headers);
  headers.set("content-type", "application/json");
  const timeoutSignal =
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(SPARKLINE_SEED_REQUEST_TIMEOUT_MS)
      : null;
  const requestSignals = [signal, requestOptions?.signal, timeoutSignal].filter(
    Boolean,
  );
  const requestSignal =
    requestSignals.length > 1 &&
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.any === "function"
      ? AbortSignal.any(requestSignals)
      : requestSignals[0];
  let response;
  try {
    response = await fetch("/api/sparklines/seed", {
      ...requestOptions,
      method: "POST",
      headers,
      signal: requestSignal,
      body: JSON.stringify({
        symbols,
        timeframe: SPARKLINE_HISTORY_TIMEFRAME,
        limit,
        pointLimit,
      }),
    });
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw error;
    }
    const networkError = new Error(`${label} network request failed`);
    networkError.name = "NetworkError";
    networkError.code = "request_network";
    networkError.cause = error;
    throw networkError;
  }
  if (!response.ok) {
    const error = new Error(`${label} failed with ${response.status}`);
    error.status = response.status;
    error.retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    throw error;
  }
  const payload = await response.json();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const barsBySymbol = Object.fromEntries(
    items
      .map((item) => {
        const symbol = normalizeRuntimeSymbol(item?.symbol);
        const bars = Array.isArray(item?.bars) ? item.bars : [];
        return symbol && hasUsableSparklineBars(bars) ? [symbol, bars] : null;
      })
      .filter(Boolean),
  );
  const pendingSymbols = items
    .filter((item) => item?.status === "pending")
    .map((item) => normalizeRuntimeSymbol(item?.symbol))
    .filter(Boolean);
  return {
    barsBySymbol,
    pendingSymbols,
    retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
  };
};

const fetchSignalSparklineSeedInChunks = async (
  symbols,
  {
    chunkSize = SPARKLINE_SEED_CHUNK_SIZE,
    concurrency = SIGNAL_SPARKLINE_SEED_FETCH_CONCURRENCY,
    onChunk = null,
    signal = null,
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
  const seedData = {};
  let pendingChunks = chunks.map((chunk, index) => ({ chunk, index }));
  let pendingRetryAfterMs = 1_000;

  for (
    let round = 0;
    pendingChunks.length;
    round += 1
  ) {
    if (round > 0) {
      await waitForSignalSparklineSeedRetry(
        SIGNAL_SPARKLINE_SEED_PENDING_RETRY_DELAYS_MS[round - 1],
        signal,
      );
    }
    const settled = await settleWithConcurrency(
      pendingChunks,
      Math.max(1, Math.floor(Number(concurrency) || 1)),
      async ({ chunk, index }) => {
        const seed = await fetchSparklineSeed(chunk, {
          limit: SIGNAL_SPARKLINE_SEED_LIMIT,
          pointLimit: SIGNAL_SPARKLINE_SEED_POINT_LIMIT,
          requestOptions: SIGNAL_SPARKLINE_SEED_REQUEST_OPTIONS,
          label: "Signal sparkline seed",
          signal,
        });
        const chunkBarsBySymbol = seed.barsBySymbol;
        Object.assign(seedData, chunkBarsBySymbol);
        if (typeof onChunk === "function") {
          onChunk(chunkBarsBySymbol, { index, symbols: chunk });
        }
        return { ...seed, chunk, index };
      },
    );
    const rejected = settled.filter((result) => result.status === "rejected");
    if (rejected.length) {
      throw rejected[0]?.reason ?? new Error("Signal sparkline seed failed");
    }
    const nextPendingChunks = settled
      .map((result) => result.value)
      .filter((result) => result.pendingSymbols.length)
      .map(({ pendingSymbols, index, retryAfterMs }) => {
        if (Number.isFinite(retryAfterMs)) {
          pendingRetryAfterMs = Math.max(
            pendingRetryAfterMs,
            retryAfterMs,
          );
        }
        return { chunk: pendingSymbols, index };
      });
    if (!nextPendingChunks.length) {
      return seedData;
    }
    if (
      round >=
      SIGNAL_SPARKLINE_SEED_PENDING_RETRY_DELAYS_MS.length
    ) {
      const error = new Error("Signal sparkline history is still warming.");
      error.status = 425;
      error.code = "sparkline_seed_pending";
      error.retryAfterMs = pendingRetryAfterMs;
      throw error;
    }
    pendingChunks = nextPendingChunks;
  }

  return seedData;
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
      (
        await fetchSparklineSeed(symbols.slice(index, index + size), {
        limit,
        pointLimit,
        requestOptions,
        label,
        })
      ).barsBySymbol,
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
  const positionMarketDataSymbols = usePositionMarketDataSymbols();
  const positionAwareStreamedQuoteSymbols = useMemo(
    () => [
      ...new Set(
        [...(streamedQuoteSymbols || []), ...positionMarketDataSymbols]
          .map(normalizeRuntimeSymbol)
          .filter(Boolean),
      ),
    ],
    [positionMarketDataSymbols, streamedQuoteSymbols],
  );
  const positionAwareQuoteSymbols = useMemo(
    () => [
      ...new Set(
        [...(quoteSymbols || []), ...positionMarketDataSymbols]
          .map(normalizeRuntimeSymbol)
          .filter(Boolean),
      ),
    ],
    [positionMarketDataSymbols, quoteSymbols],
  );
  const positionAwareVisibleQuoteSymbols = useMemo(
    () => [
      ...new Set(
        [...(activeVisibleQuoteSymbols || []), ...positionMarketDataSymbols]
          .map(normalizeRuntimeSymbol)
          .filter(Boolean),
      ),
    ],
    [activeVisibleQuoteSymbols, positionMarketDataSymbols],
  );
  const [deliveredRealtimeQuoteSymbols, setDeliveredRealtimeQuoteSymbols] =
    useState([]);
  const deliveredRealtimeQuoteAtRef = useRef(new Map());
  const marketDataDiagnosticsRef = useRef({});
  const marketAggregateStoreVersion = useStockMinuteAggregateSymbolsVersion(
    streamedAggregateSymbols,
  );
  const watchlistSymbolsKey = useMemo(
    () => (watchlistSymbols || []).join(","),
    [watchlistSymbols],
  );
  const streamedQuoteSymbolsKey = useMemo(
    () => positionAwareStreamedQuoteSymbols.join(","),
    [positionAwareStreamedQuoteSymbols],
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
        [...watchlistSymbols, ...positionAwareStreamedQuoteSymbols]
          .map(normalizeRuntimeSymbol)
          .filter(Boolean),
      ),
    [positionAwareStreamedQuoteSymbols, watchlistSymbols],
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
    symbolCount: positionAwareStreamedQuoteSymbols.length,
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
        quoteSymbols: positionAwareQuoteSymbols,
        streamCoveredSymbols: deliveredRealtimeQuoteSymbols,
        activeVisibleSymbols: positionAwareVisibleQuoteSymbols,
        realtimeRequired: realtimeQuoteCoverageRequired,
      }),
    [
      deliveredRealtimeQuoteSymbols,
      positionAwareQuoteSymbols,
      positionAwareVisibleQuoteSymbols,
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
        activeVisibleSymbols: positionAwareVisibleQuoteSymbols,
        streamCoveredSymbols: deliveredRealtimeQuoteSymbols,
        realtimeRequired: realtimeQuoteCoverageRequired,
        disabledReason: quoteStreamDisabledReason,
      }),
    [
      deliveredRealtimeQuoteSymbols,
      positionAwareVisibleQuoteSymbols,
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
    const diagnostics = marketDataDiagnosticsRef.current;
    diagnostics.quoteStream = {
      active: quoteStreamRuntimeActive,
      disabledReason: quoteStreamDisabledReason,
      requestedSymbols: positionAwareStreamedQuoteSymbols,
      requestedSymbolCount: positionAwareStreamedQuoteSymbols.length,
      eventSourceAvailable,
      coverage: quoteStreamCoverageDiagnostics,
      activeVisibleCoverage: visibleRealtimeCoverageDiagnostics,
      missingRealtimeVisibleSymbols: restQuoteSplit.missingRealtimeVisibleSymbols,
      deliveredSymbols: deliveredRealtimeQuoteSymbols,
      deliveredSymbolCount: deliveredRealtimeQuoteSymbols.length,
      fallbackDisabledReason: quoteFallbackDisabledReason,
    };
    diagnostics.aggregateStream = {
      active: marketAggregateStreamRuntimeActive,
      requestedSymbolCount: streamedAggregateSymbols.length,
      aggregateOnlySymbolCount: aggregateOnlySparklineSymbolSet.size,
    };
    diagnostics.updatedAt = new Date().toISOString();
    window[QUOTE_STREAM_DIAGNOSTICS_GLOBAL] = diagnostics;
    return () => {
      if (window[QUOTE_STREAM_DIAGNOSTICS_GLOBAL] === diagnostics) {
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
    positionAwareStreamedQuoteSymbols,
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
      detail: `${positionAwareStreamedQuoteSymbols.length}q/${streamedAggregateSymbols.length}a`,
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
    queryFn: ({ signal }) =>
      fetchSignalSparklineSeedInChunks(signalSparklineSeedSymbols, {
        onChunk: publishSignalSparklineSeedChunk,
        signal,
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
      const nextCoverage = reconcileRealtimeQuoteCoverage({
        deliveredAtBySymbol: deliveredRealtimeQuoteAtRef.current,
        quotes,
      });
      deliveredRealtimeQuoteAtRef.current = nextCoverage;
      const nextSymbols = Array.from(nextCoverage.keys()).sort();
      setDeliveredRealtimeQuoteSymbols((current) =>
        nextSymbols.length === current.length &&
        nextSymbols.every((symbol, index) => symbol === current[index])
          ? current
          : nextSymbols,
      );
      applyRuntimeQuoteSnapshots(quotes, activeWatchlistItems);
    },
    [activeWatchlistItems],
  );
  const clearDeliveredRealtimeQuoteCoverage = useCallback(() => {
    deliveredRealtimeQuoteAtRef.current = new Map();
    setDeliveredRealtimeQuoteSymbols((current) =>
      current.length ? [] : current,
    );
  }, []);
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
    clearDeliveredRealtimeQuoteCoverage();
  }, [
    clearDeliveredRealtimeQuoteCoverage,
    quoteStreamRuntimeActive,
    streamedQuoteSymbolsKey,
  ]);

  useEffect(() => {
    if (!quoteStreamRuntimeActive) return undefined;
    const interval = setInterval(
      () => handleStreamQuotes([]),
      WATCHLIST_QUOTE_STREAM_CYCLE_WINDOW_MS / 4,
    );
    return () => clearInterval(interval);
  }, [handleStreamQuotes, quoteStreamRuntimeActive]);

  useIbkrQuoteSnapshotStream({
    symbols: positionAwareStreamedQuoteSymbols,
    enabled: quoteStreamRuntimeActive,
    onQuotes: handleStreamQuotes,
    onUnavailable: clearDeliveredRealtimeQuoteCoverage,
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
      const diagnostics = marketDataDiagnosticsRef.current;
      diagnostics.sparkline = {
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
        signalSeedChunkFlushCount: signalSparklineSeedChunkFlushRef.current.count,
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
      };
      diagnostics.updatedAt = new Date().toISOString();
      window[QUOTE_STREAM_DIAGNOSTICS_GLOBAL] = diagnostics;
    }
  }, [marketDataSyncKey]);

  return children;
};
