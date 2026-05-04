import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MarketBar } from "./types";
import {
  getStoredBrokerMinuteAggregates,
  useBrokerStockAggregateStream,
  useStockMinuteAggregateSymbolVersion,
} from "./useMassiveStockAggregateStream";
import type { BrokerStockAggregateMessage } from "./useMassiveStockAggregateStream";
import { useStoredOptionQuoteSnapshot } from "../platform/live-streams";
import { usePageVisible } from "../platform/usePageVisible";
import {
  markChartLivePatchPending,
  recordChartHydrationCounter,
} from "./chartHydrationStats";
import type {
  ChartBarsHistoryPage,
  ChartBarsPagePayload,
} from "./chartBarsPayloads";
import {
  updateActiveChartBarState,
  useActiveChartBarState,
} from "./activeChartBarStore";
import {
  getChartBarLimit,
  getChartTimeframeStepMs,
  normalizeChartTimeframe,
} from "./timeframes";
import {
  expandLocalRollupLimit,
  normalizeTimeframeBucketStartMs,
} from "./timeframeRollups";

type UseBrokerStreamedBarsInput = {
  symbol: string;
  timeframe: string;
  bars?: MarketBar[] | null;
  enabled?: boolean;
};

type UseOptionQuotePatchedBarsInput = {
  providerContractId?: string | null;
  timeframe: string;
  bars?: MarketBar[] | null;
  enabled?: boolean;
  instrumentationScope?: string | null;
};

type UseHistoricalBarStreamInput = {
  symbol: string;
  timeframe: string;
  bars?: MarketBar[] | null;
  enabled?: boolean;
  assetClass?: "equity" | "option";
  providerContractId?: string | null;
  outsideRth?: boolean;
  source?: "trades" | "midpoint" | "bid_ask";
  instrumentationScope?: string | null;
  fetchLatestBars?: () => Promise<MarketBar[] | null | undefined>;
  streamPriority?: number;
};

type UsePrependableHistoricalBarsInput = {
  scopeKey: string;
  timeframe: string;
  pageSizeTimeframe?: string;
  bars?: MarketBar[] | null;
  enabled?: boolean;
  fetchOlderBars?: (input: {
    from: Date;
    to: Date;
    limit: number;
    historyCursor?: string | null;
    preferCursor?: boolean;
  }) => Promise<ChartBarsPagePayload | null | undefined>;
};

type LiveOptionQuoteLike = {
  price?: number | null;
  bid?: number | null;
  ask?: number | null;
  updatedAt?: string | Date | null;
  freshness?: string | null;
  marketDataMode?: string | null;
  dataUpdatedAt?: string | Date | null;
};

type HistoricalBarStreamSnapshot = {
  timestamp: string | Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source?: string;
  providerContractId?: string | null;
  freshness?: string;
  marketDataMode?: string | null;
  dataUpdatedAt?: string | Date | null;
};

type HistoricalBarStreamPayload = {
  symbol?: string;
  timeframe?: string;
  bar?: HistoricalBarStreamSnapshot | null;
};

export type LiveBarStreamStatus =
  | "connecting"
  | "live"
  | "stale"
  | "reconnecting"
  | "fallback"
  | "deferred"
  | "unsupported"
  | "error";

type LiveBarStreamListener = {
  priority: number;
  onBar: (bar: HistoricalBarStreamSnapshot) => void;
  onStatus: (status: LiveBarStreamStatus) => void;
};

type LiveBarStreamEntry = {
  url: string;
  source: EventSource | null;
  listeners: Map<number, LiveBarStreamListener>;
  status: LiveBarStreamStatus;
  lastSignalAt: number;
  staleTimer: number | null;
  reconnectTimer: number | null;
};

type LiveFrameSchedulerStats = {
  queued: number;
  applied: number;
  coalesced: number;
  duplicates: number;
};

type LiveFrameScheduler<T> = {
  enqueue: (item: T) => void;
  flush: () => void;
  cancel: () => void;
  pendingSize: () => number;
};

const HISTORICAL_BAR_STREAM_TIMEFRAMES = new Set(["5s", "1m", "5m", "15m", "1h", "1d"]);
const MINUTE_AGGREGATE_PATCH_TIMEFRAMES = new Set(["1m", "5m", "15m", "1h", "1d"]);
const LIVE_BAR_STREAM_STALE_MS = 45_000;
const LIVE_BAR_STREAM_RECONNECT_MS = 5_000;
const LIVE_BAR_FALLBACK_DELAYS_MS = [0, 15_000, 30_000, 60_000] as const;
const LIVE_BAR_FALLBACK_SUCCESS_COOLDOWN_MS = 15_000;
const LIVE_BAR_STREAM_MAX_CONNECTIONS = 64;
const INTRADAY_PREPEND_MIN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1_000;
const EMPTY_OLDER_HISTORY_WINDOW_EXHAUSTION_LIMIT = 120;

const liveBarStreamEntries = new Map<string, LiveBarStreamEntry>();
let nextLiveBarStreamListenerId = 1;

const requestLiveFrame = (callback: () => void): ReturnType<typeof setTimeout> | number => {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback);
  }

  return setTimeout(callback, 0);
};

const cancelLiveFrame = (handle: ReturnType<typeof setTimeout> | number): void => {
  if (
    typeof window !== "undefined" &&
    typeof window.cancelAnimationFrame === "function" &&
    typeof handle === "number"
  ) {
    window.cancelAnimationFrame(handle);
    return;
  }

  clearTimeout(handle);
};

const createLiveBarFrameScheduler = <T,>({
  getBucketKey,
  getSignature,
  apply,
  requestFrame = requestLiveFrame,
  cancelFrame = cancelLiveFrame,
}: {
  getBucketKey: (item: T) => string | null;
  getSignature?: (item: T) => string;
  apply: (items: T[], stats: LiveFrameSchedulerStats) => void;
  requestFrame?: (callback: () => void) => ReturnType<typeof setTimeout> | number;
  cancelFrame?: (handle: ReturnType<typeof setTimeout> | number) => void;
}): LiveFrameScheduler<T> => {
  const pendingByBucket = new Map<string, T>();
  let queued = 0;
  let duplicates = 0;
  let frameHandle: ReturnType<typeof setTimeout> | number | null = null;

  const flush = () => {
    frameHandle = null;
    if (!pendingByBucket.size) {
      queued = 0;
      duplicates = 0;
      return;
    }

    const items = Array.from(pendingByBucket.values());
    const stats = {
      queued,
      applied: items.length,
      coalesced: Math.max(0, queued - items.length),
      duplicates,
    };
    pendingByBucket.clear();
    queued = 0;
    duplicates = 0;
    apply(items, stats);
  };

  const schedule = () => {
    if (frameHandle !== null) {
      return;
    }
    frameHandle = requestFrame(flush);
  };

  return {
    enqueue: (item) => {
      const bucketKey = getBucketKey(item);
      if (!bucketKey) {
        return;
      }

      const previous = pendingByBucket.get(bucketKey);
      if (
        previous &&
        getSignature &&
        getSignature(previous) === getSignature(item)
      ) {
        duplicates += 1;
      }
      pendingByBucket.set(bucketKey, item);
      queued += 1;
      schedule();
    },
    flush,
    cancel: () => {
      if (frameHandle !== null) {
        cancelFrame(frameHandle);
        frameHandle = null;
      }
      pendingByBucket.clear();
      queued = 0;
      duplicates = 0;
    },
    pendingSize: () => pendingByBucket.size,
  };
};

const timeframeToStepMs = (timeframe: string): number => (
  getChartTimeframeStepMs(normalizeChartTimeframe(timeframe)) || 0
);

const FALLBACK_PATCHED_BAR_LIMIT = 500;
const LIVE_PATCH_EXTRA_BAR_LIMIT = 500;

const resolvePatchedBarLimit = (
  timeframe: string,
  baseBars: MarketBar[],
): number => {
  const targetLimit =
    getChartBarLimit(normalizeChartTimeframe(timeframe)) ||
    FALLBACK_PATCHED_BAR_LIMIT;
  const hydratedLimit = baseBars.length
    ? baseBars.length + Math.min(LIVE_PATCH_EXTRA_BAR_LIMIT, targetLimit)
    : 0;

  return Math.max(targetLimit, hydratedLimit, 1);
};

const capBarsToRecentLimit = (
  bars: MarketBar[],
  limit: number,
): MarketBar[] => {
  if (bars.length <= limit) {
    return bars;
  }
  return bars.slice(bars.length - limit);
};

// For 1d, IBKR timestamps daily bars at the trading-day boundary (typically 04:00 UTC = ET midnight).
// We don't re-bucket — instead we patch the last historical daily bar's OHLCV using all live
// minute-aggregates whose timestamp is >= the bar's start. This keeps daily aligned with IBKR's
// own session boundaries while still reflecting the live last-trade price.
const isDailyTimeframe = (timeframe: string): boolean => timeframe === "1d";

const resolveTimestampMs = (value: MarketBar["timestamp"] | MarketBar["time"]): number | null => {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
};

const resolveHistoryPageTimeMs = (
  value: ChartBarsHistoryPage[keyof ChartBarsHistoryPage] | undefined,
): number | null => {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const normalizeHistoricalBarsPayload = (
  payload: ChartBarsPagePayload | null | undefined,
): ChartBarsPagePayload => {
  return {
    bars: Array.isArray(payload?.bars) ? payload.bars : [],
    historyPage: payload?.historyPage ?? null,
  };
};

const resolvePrependLookbackMs = (
  timeframe: string,
  pageSize: number,
): number => {
  const stepMs = timeframeToStepMs(timeframe);
  const pageWindowMs = Math.max(stepMs, stepMs * Math.max(1, pageSize));
  if (!stepMs) {
    return 0;
  }
  if (normalizeChartTimeframe(timeframe) === "1d") {
    return pageWindowMs;
  }
  return Math.max(pageWindowMs * 3, INTRADAY_PREPEND_MIN_LOOKBACK_MS);
};

const resolvePrependRequestPageSize = ({
  pageSize,
  pageSizeTimeframe,
  timeframe,
}: {
  pageSize: number;
  pageSizeTimeframe?: string | null;
  timeframe: string;
}): number => {
  const normalizedPageSize = Math.max(1, Math.ceil(pageSize));
  const normalizedPageSizeTimeframe = normalizeChartTimeframe(
    pageSizeTimeframe || timeframe,
  );

  return expandLocalRollupLimit(
    normalizedPageSize,
    normalizedPageSizeTimeframe,
    timeframe,
  );
};

const resolveQuoteUpdatedAtMs = (
  value: LiveOptionQuoteLike["updatedAt"],
): number | null => {
  if (typeof value === "object" && value !== null) {
    return value.getTime();
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
};

const resolveLiveQuotePrice = (quote: LiveOptionQuoteLike | null): number | null => {
  if (!quote) {
    return null;
  }

  if (typeof quote.price === "number" && Number.isFinite(quote.price)) {
    return quote.price;
  }

  if (
    typeof quote.bid === "number" &&
    Number.isFinite(quote.bid) &&
    typeof quote.ask === "number" &&
    Number.isFinite(quote.ask)
  ) {
    return (quote.bid + quote.ask) / 2;
  }

  if (typeof quote.bid === "number" && Number.isFinite(quote.bid)) {
    return quote.bid;
  }

  if (typeof quote.ask === "number" && Number.isFinite(quote.ask)) {
    return quote.ask;
  }

  return null;
};

const normalizeBaseBars = (
  bars: MarketBar[] | null | undefined,
  timeframe?: string,
): MarketBar[] => (
  (Array.isArray(bars) ? bars : [])
    .reduce<Array<MarketBar & { _startMs: number }>>((result, bar) => {
      const rawStartMs = resolveTimestampMs(bar.timestamp) ?? resolveTimestampMs(bar.time);
      if (rawStartMs == null) {
        return result;
      }
      const startMs = timeframe
        ? normalizeTimeframeBucketStartMs(rawStartMs, timeframe)
        : rawStartMs;

      result.push({
        ...bar,
        timestamp: new Date(startMs),
        time: startMs,
        ts: new Date(startMs).toISOString(),
        open: bar.open ?? bar.o,
        high: bar.high ?? bar.h,
        low: bar.low ?? bar.l,
        close: bar.close ?? bar.c,
        volume: bar.volume ?? bar.v ?? 0,
        _startMs: startMs,
      });
      return result;
    }, [])
    .sort((left, right) => left._startMs - right._startMs)
    .map(({ _startMs: _discard, ...bar }) => bar)
);

const buildHistoricalBarStreamUrl = (input: {
  symbol: string;
  timeframe: string;
  assetClass?: "equity" | "option";
  providerContractId?: string | null;
  outsideRth?: boolean;
  source?: "trades" | "midpoint" | "bid_ask";
}): string | null => {
  const normalizedTimeframe = normalizeChartTimeframe(input.timeframe);
  if (
    !input.symbol ||
    !normalizedTimeframe ||
    !HISTORICAL_BAR_STREAM_TIMEFRAMES.has(normalizedTimeframe)
  ) {
    return null;
  }

  const params = new URLSearchParams({
    symbol: input.symbol.trim().toUpperCase(),
    timeframe: normalizedTimeframe,
  });

  if (input.assetClass) {
    params.set("assetClass", input.assetClass);
  }
  if (input.providerContractId?.trim()) {
    params.set("providerContractId", input.providerContractId.trim());
  }
  if (typeof input.outsideRth === "boolean") {
    params.set("outsideRth", String(input.outsideRth));
  }
  if (input.source) {
    params.set("source", input.source);
  }

  return `/api/streams/bars?${params.toString()}`;
};

const parseHistoricalBarStreamPayload = (
  value: string,
): HistoricalBarStreamPayload | null => {
  try {
    return JSON.parse(value) as HistoricalBarStreamPayload;
  } catch {
    return null;
  }
};

const isHistoricalBarStreamPayloadForUrl = (
  url: string,
  payload: HistoricalBarStreamPayload | null | undefined,
): boolean => {
  if (!payload) {
    return false;
  }

  let params: URLSearchParams;
  try {
    params = new URL(url, "http://rayalgo.local").searchParams;
  } catch {
    return true;
  }

  const requestedSymbol = params.get("symbol")?.trim().toUpperCase() || "";
  const payloadSymbol = payload.symbol?.trim?.().toUpperCase?.() || "";
  if (requestedSymbol && payloadSymbol && requestedSymbol !== payloadSymbol) {
    return false;
  }

  const requestedTimeframe = normalizeChartTimeframe(params.get("timeframe") || "");
  const payloadTimeframe = payload.timeframe
    ? normalizeChartTimeframe(payload.timeframe)
    : "";
  if (
    requestedTimeframe &&
    payloadTimeframe &&
    requestedTimeframe !== payloadTimeframe
  ) {
    return false;
  }

  return true;
};

const notifyLiveBarStreamStatus = (
  entry: LiveBarStreamEntry,
  status: LiveBarStreamStatus,
): void => {
  if (entry.status === status) {
    return;
  }

  entry.status = status;
  entry.listeners.forEach((listener) => listener.onStatus(status));
};

const touchLiveBarStream = (entry: LiveBarStreamEntry): void => {
  entry.lastSignalAt = Date.now();
  notifyLiveBarStreamStatus(entry, "live");
};

const stopLiveBarStreamEntry = (entry: LiveBarStreamEntry): void => {
  if (entry.source) {
    entry.source.close();
    entry.source = null;
  }
  if (entry.staleTimer != null) {
    window.clearInterval(entry.staleTimer);
    entry.staleTimer = null;
  }
  if (entry.reconnectTimer != null) {
    window.clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
  }
};

const startLiveBarStreamEntry = (entry: LiveBarStreamEntry): void => {
  if (entry.source || typeof window === "undefined" || typeof window.EventSource === "undefined") {
    return;
  }

  const activeConnectionCount = Array.from(liveBarStreamEntries.values()).filter(
    (candidate) => candidate.source && candidate !== entry,
  ).length;
  if (activeConnectionCount >= LIVE_BAR_STREAM_MAX_CONNECTIONS) {
    notifyLiveBarStreamStatus(entry, "deferred");
    return;
  }

  notifyLiveBarStreamStatus(entry, "connecting");
  entry.lastSignalAt = Date.now();

  const stream = new EventSource(entry.url);
  entry.source = stream;

  stream.onopen = () => {
    touchLiveBarStream(entry);
  };

  const handleReady = () => {
    touchLiveBarStream(entry);
  };
  const handleHeartbeat = () => {
    touchLiveBarStream(entry);
  };
  const handleStreamError = () => {
    notifyLiveBarStreamStatus(entry, "error");
  };
  const handleBar = (event: MessageEvent<string>) => {
    const payload = parseHistoricalBarStreamPayload(event.data);
    if (!payload?.bar || !isHistoricalBarStreamPayloadForUrl(entry.url, payload)) {
      return;
    }

    touchLiveBarStream(entry);
    entry.listeners.forEach((listener) => listener.onBar(payload.bar!));
  };

  stream.addEventListener("ready", handleReady as EventListener);
  stream.addEventListener("heartbeat", handleHeartbeat as EventListener);
  stream.addEventListener("stream-error", handleStreamError as EventListener);
  stream.addEventListener("bar", handleBar as EventListener);
  stream.onerror = () => {
    notifyLiveBarStreamStatus(
      entry,
      stream.readyState === EventSource.CLOSED ? "error" : "reconnecting",
    );

    if (stream.readyState !== EventSource.CLOSED || entry.reconnectTimer != null) {
      return;
    }

    entry.source = null;
    entry.reconnectTimer = window.setTimeout(() => {
      entry.reconnectTimer = null;
      if (entry.listeners.size) {
        startLiveBarStreamEntry(entry);
      }
    }, LIVE_BAR_STREAM_RECONNECT_MS);
  };

  entry.staleTimer = window.setInterval(() => {
    if (!entry.listeners.size) {
      return;
    }
    if (Date.now() - entry.lastSignalAt > LIVE_BAR_STREAM_STALE_MS) {
      notifyLiveBarStreamStatus(entry, "stale");
      if (entry.reconnectTimer != null) {
        return;
      }
      if (entry.source) {
        entry.source.close();
        entry.source = null;
      }
      notifyLiveBarStreamStatus(entry, "reconnecting");
      entry.reconnectTimer = window.setTimeout(() => {
        entry.reconnectTimer = null;
        if (entry.listeners.size) {
          startLiveBarStreamEntry(entry);
        }
      }, LIVE_BAR_STREAM_RECONNECT_MS);
    }
  }, 5_000);
};

const subscribeLiveBarStream = (
  url: string,
  listener: LiveBarStreamListener,
): (() => void) => {
  if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
    listener.onStatus("unsupported");
    return () => {};
  }

  let entry = liveBarStreamEntries.get(url);
  if (!entry) {
    entry = {
      url,
      source: null,
      listeners: new Map(),
      status: "connecting",
      lastSignalAt: Date.now(),
      staleTimer: null,
      reconnectTimer: null,
    };
    liveBarStreamEntries.set(url, entry);
  }

  const listenerId = nextLiveBarStreamListenerId;
  nextLiveBarStreamListenerId += 1;
  entry.listeners.set(listenerId, listener);
  listener.onStatus(entry.status);
  startLiveBarStreamEntry(entry);

  return () => {
    const activeEntry = liveBarStreamEntries.get(url);
    if (!activeEntry) {
      return;
    }

    activeEntry.listeners.delete(listenerId);
    if (activeEntry.listeners.size > 0) {
      return;
    }

    stopLiveBarStreamEntry(activeEntry);
    liveBarStreamEntries.delete(url);
    Array.from(liveBarStreamEntries.values())
      .filter((entry) => entry.status === "deferred" && entry.listeners.size > 0)
      .sort((left, right) => {
        const leftPriority = Math.max(
          ...Array.from(left.listeners.values()).map((item) => item.priority),
        );
        const rightPriority = Math.max(
          ...Array.from(right.listeners.values()).map((item) => item.priority),
        );
        return rightPriority - leftPriority;
      })
      .slice(0, 1)
      .forEach(startLiveBarStreamEntry);
  };
};

const weightedAverage = (
  values: Array<{ value: number | null; weight: number }>,
): number | undefined => {
  const weighted = values.filter((entry) => Number.isFinite(entry.value) && entry.weight > 0);
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight) {
    return undefined;
  }

  const total = weighted.reduce((sum, entry) => sum + ((entry.value as number) * entry.weight), 0);
  return Number((total / totalWeight).toFixed(6));
};

const resolveUtcDateKey = (timeMs: number): string =>
  new Date(timeMs).toISOString().slice(0, 10);

const buildBarFromMinuteAggregateBucket = (
  ordered: BrokerStockAggregateMessage[],
  timestampMs: number,
): MarketBar | null => {
  if (!ordered.length) {
    return null;
  }

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const volume = ordered.reduce((sum, minute) => sum + minute.volume, 0);
  const vwap = weightedAverage(
    ordered.map((minute) => ({
      value: minute.vwap,
      weight: minute.volume,
    })),
  );
  const averageTradeSize = weightedAverage(
    ordered.map((minute) => ({
      value: minute.averageTradeSize,
      weight: minute.volume,
    })),
  );

  return {
    timestamp: new Date(timestampMs),
    time: timestampMs,
    ts: new Date(timestampMs).toISOString(),
    open: first.open,
    high: ordered.reduce((max, minute) => Math.max(max, minute.high), first.high),
    low: ordered.reduce((min, minute) => Math.min(min, minute.low), first.low),
    close: last.close,
    volume,
    vwap,
    sessionVwap: last.sessionVwap ?? undefined,
    accumulatedVolume: last.accumulatedVolume ?? undefined,
    averageTradeSize,
    source: last.source,
  };
};

const mergeBarsWithMinuteAggregates = (
  symbol: string,
  timeframe: string,
  bars: MarketBar[],
): MarketBar[] => {
  return mergeBarsWithMinuteAggregateList(
    timeframe,
    bars,
    getStoredBrokerMinuteAggregates(symbol),
  );
};

const mergeBarsWithMinuteAggregateList = (
  timeframe: string,
  bars: MarketBar[],
  minuteAggregates: BrokerStockAggregateMessage[],
): MarketBar[] => {
  const normalizedBars = normalizeBaseBars(bars, timeframe);
  if (!MINUTE_AGGREGATE_PATCH_TIMEFRAMES.has(timeframe)) {
    return normalizedBars;
  }

  const stepMs = timeframeToStepMs(timeframe);
  if (!stepMs) {
    return normalizedBars;
  }

  if (!minuteAggregates.length) {
    return normalizedBars;
  }

  // Daily charts: patch the last historical bar with all live aggregates that fall
  // within its session window, rather than re-bucketing (which would mis-align with
  // IBKR's session-day boundary, typically 04:00 UTC).
  if (isDailyTimeframe(timeframe)) {
    const lastBar = normalizedBars[normalizedBars.length - 1] ?? null;
    const lastStartMs =
      lastBar
        ? resolveTimestampMs(lastBar.timestamp) ?? resolveTimestampMs(lastBar.time)
        : null;
    const latestAggregate = minuteAggregates[minuteAggregates.length - 1];
    if (!latestAggregate) {
      return normalizedBars;
    }

    if (
      lastStartMs == null ||
      resolveUtcDateKey(latestAggregate.startMs) !== resolveUtcDateKey(lastStartMs)
    ) {
      const liveDateKey = resolveUtcDateKey(latestAggregate.startMs);
      const liveSessionAggregates = minuteAggregates
        .filter((aggregate) => resolveUtcDateKey(aggregate.startMs) === liveDateKey)
        .slice()
        .sort((left, right) => left.startMs - right.startMs);
      const liveSessionStartMs = Date.parse(`${liveDateKey}T00:00:00.000Z`);
      const liveSessionBar = buildBarFromMinuteAggregateBucket(
        liveSessionAggregates,
        Number.isFinite(liveSessionStartMs)
          ? liveSessionStartMs
          : liveSessionAggregates[0]?.startMs,
      );
      return liveSessionBar
        ? mergePatchedBars(normalizedBars, [liveSessionBar], timeframe)
        : normalizedBars;
    }

    const liveSinceLast = minuteAggregates.filter(
      (aggregate) => aggregate.startMs >= lastStartMs,
    );
    if (!liveSinceLast.length) {
      return normalizedBars;
    }
    const ordered = liveSinceLast
      .slice()
      .sort((left, right) => left.startMs - right.startMs);
    const last = ordered[ordered.length - 1];
    const liveHigh = ordered.reduce((max, m) => Math.max(max, m.high), -Infinity);
    const liveLow = ordered.reduce((min, m) => Math.min(min, m.low), Infinity);
    const liveVolume = ordered.reduce((sum, m) => sum + m.volume, 0);
    const patchedLast: MarketBar = {
      ...lastBar,
      high: Math.max(lastBar.high ?? lastBar.h ?? -Infinity, liveHigh),
      low: Math.min(lastBar.low ?? lastBar.l ?? Infinity, liveLow),
      close: last.close,
      // Prefer accumulatedVolume from the most recent live aggregate when present,
      // since IBKR streams report session-cumulative volume; otherwise add live deltas.
      volume:
        last.accumulatedVolume != null
          ? last.accumulatedVolume
          : (lastBar.volume ?? lastBar.v ?? 0) + liveVolume,
      sessionVwap: last.sessionVwap ?? lastBar.sessionVwap,
      accumulatedVolume: last.accumulatedVolume ?? lastBar.accumulatedVolume,
      source: last.source,
    };
    return [...normalizedBars.slice(0, -1), patchedLast];
  }

  const mergedByStart = new Map<number, MarketBar>();
  normalizedBars.forEach((bar) => {
    const startMs = resolveTimestampMs(bar.timestamp) ?? resolveTimestampMs(bar.time);
    if (startMs == null) {
      return;
    }

    mergedByStart.set(startMs, bar);
  });

  const bucketedMinutes = new Map<number, BrokerStockAggregateMessage[]>();
  minuteAggregates.forEach((aggregate) => {
    const bucketStartMs = Math.floor(aggregate.startMs / stepMs) * stepMs;
    const bucket = bucketedMinutes.get(bucketStartMs) || [];
    bucket.push(aggregate);
    bucketedMinutes.set(bucketStartMs, bucket);
  });

  bucketedMinutes.forEach((bucket, bucketStartMs) => {
    const ordered = bucket.slice().sort((left, right) => left.startMs - right.startMs);
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const volume = ordered.reduce((sum, minute) => sum + minute.volume, 0);
    const open = first.open;
    const high = ordered.reduce((max, minute) => Math.max(max, minute.high), first.high);
    const low = ordered.reduce((min, minute) => Math.min(min, minute.low), first.low);
    const close = last.close;
    const vwap = weightedAverage(
      ordered.map((minute) => ({
        value: minute.vwap,
        weight: minute.volume,
      })),
    );
    const averageTradeSize = weightedAverage(
      ordered.map((minute) => ({
        value: minute.averageTradeSize,
        weight: minute.volume,
      })),
    );

    mergedByStart.set(bucketStartMs, {
      timestamp: new Date(bucketStartMs),
      ts: new Date(bucketStartMs).toISOString(),
      open,
      high,
      low,
      close,
      volume,
      vwap,
      sessionVwap: last.sessionVwap ?? undefined,
      accumulatedVolume: last.accumulatedVolume ?? undefined,
      averageTradeSize,
      source: last.source,
    });
  });

  return Array.from(mergedByStart.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, bar]) => bar);
};

const mergePatchedBars = (
  baseBars: MarketBar[],
  patchedBars: MarketBar[],
  timeframe?: string,
): MarketBar[] => {
  const mergedByTime = new Map<number, MarketBar>();

  normalizeBaseBars(baseBars, timeframe).forEach((bar) => {
    const timeMs = resolveTimestampMs(bar.timestamp) ?? resolveTimestampMs(bar.time);
    if (timeMs != null) {
      mergedByTime.set(timeMs, bar);
    }
  });

  normalizeBaseBars(patchedBars, timeframe).forEach((bar) => {
    const timeMs = resolveTimestampMs(bar.timestamp) ?? resolveTimestampMs(bar.time);
    if (timeMs != null) {
      mergedByTime.set(timeMs, bar);
    }
  });

  return Array.from(mergedByTime.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, bar]) => bar);
};

const mergeAndCapPatchedBars = (
  baseBars: MarketBar[],
  patchedBars: MarketBar[],
  limit: number,
  timeframe?: string,
): MarketBar[] => capBarsToRecentLimit(
  mergePatchedBars(baseBars, patchedBars, timeframe),
  limit,
);

const areBarsEquivalent = (
  left: MarketBar[],
  right: MarketBar[],
): boolean => {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const current = left[index];
    const next = right[index];
    const currentTimeMs =
      resolveTimestampMs(current.timestamp) ?? resolveTimestampMs(current.time);
    const nextTimeMs =
      resolveTimestampMs(next.timestamp) ?? resolveTimestampMs(next.time);
    if (
      currentTimeMs !== nextTimeMs ||
      (current.open ?? current.o ?? null) !== (next.open ?? next.o ?? null) ||
      (current.high ?? current.h ?? null) !== (next.high ?? next.h ?? null) ||
      (current.low ?? current.l ?? null) !== (next.low ?? next.l ?? null) ||
      (current.close ?? current.c ?? null) !== (next.close ?? next.c ?? null) ||
      (current.volume ?? current.v ?? null) !== (next.volume ?? next.v ?? null) ||
      (current.source ?? null) !== (next.source ?? null) ||
      (current.freshness ?? null) !== (next.freshness ?? null) ||
      (current.marketDataMode ?? null) !== (next.marketDataMode ?? null) ||
      (current.dataUpdatedAt ?? null) !== (next.dataUpdatedAt ?? null)
    ) {
      return false;
    }
  }

  return true;
};

const patchBarsWithHistoricalBarStream = (
  bars: MarketBar[],
  nextBar: HistoricalBarStreamSnapshot | null | undefined,
  timeframe: string,
): MarketBar[] => {
  const normalizedBars = normalizeBaseBars(bars, timeframe);
  if (!nextBar) {
    return normalizedBars;
  }

  const rawTimeMs = resolveTimestampMs(nextBar.timestamp);
  if (rawTimeMs == null) {
    return normalizedBars;
  }
  const timeMs = normalizeTimeframeBucketStartMs(rawTimeMs, timeframe);

  const patchedBar: MarketBar = {
    timestamp: new Date(timeMs),
    time: timeMs,
    ts: new Date(timeMs).toISOString(),
    open: nextBar.open,
    high: nextBar.high,
    low: nextBar.low,
    close: nextBar.close,
    volume: nextBar.volume,
    source: nextBar.source ?? "ibkr-history",
    freshness: nextBar.freshness,
    marketDataMode: nextBar.marketDataMode,
    dataUpdatedAt: nextBar.dataUpdatedAt,
  };

  const existingIndex = normalizedBars.findIndex((bar) => {
    const startMs = resolveTimestampMs(bar.timestamp) ?? resolveTimestampMs(bar.time);
    return startMs === timeMs;
  });

  if (existingIndex >= 0) {
    const nextBars = normalizedBars.slice();
    nextBars[existingIndex] = {
      ...nextBars[existingIndex],
      ...patchedBar,
      o: patchedBar.open,
      h: patchedBar.high,
      l: patchedBar.low,
      c: patchedBar.close,
      v: patchedBar.volume,
    };
    return nextBars;
  }

  return mergePatchedBars(normalizedBars, [patchedBar], timeframe);
};

const buildPatchedBarFromHistoricalBarStream = (
  nextBar: HistoricalBarStreamSnapshot | null | undefined,
  timeframe: string,
): MarketBar | null => {
  if (!nextBar) {
    return null;
  }

  const rawTimeMs = resolveTimestampMs(nextBar.timestamp);
  if (rawTimeMs == null) {
    return null;
  }

  const timeMs = normalizeTimeframeBucketStartMs(rawTimeMs, timeframe);
  return {
    timestamp: new Date(timeMs),
    time: timeMs,
    ts: new Date(timeMs).toISOString(),
    open: nextBar.open,
    high: nextBar.high,
    low: nextBar.low,
    close: nextBar.close,
    volume: nextBar.volume,
    source: nextBar.source ?? "ibkr-history",
    freshness: nextBar.freshness,
    marketDataMode: nextBar.marketDataMode,
    dataUpdatedAt: nextBar.dataUpdatedAt,
  };
};

const buildHistoricalBarStreamSignature = (
  bar: HistoricalBarStreamSnapshot,
): string => JSON.stringify({
  timestamp: bar.timestamp instanceof Date ? bar.timestamp.toISOString() : String(bar.timestamp),
  open: bar.open,
  high: bar.high,
  low: bar.low,
  close: bar.close,
  volume: bar.volume,
  source: bar.source ?? "",
  freshness: bar.freshness ?? "",
  marketDataMode: bar.marketDataMode ?? "",
  dataUpdatedAt:
    bar.dataUpdatedAt instanceof Date
      ? bar.dataUpdatedAt.toISOString()
      : String(bar.dataUpdatedAt ?? ""),
});

const resolveHistoricalBarStreamBucketKey = (
  bar: HistoricalBarStreamSnapshot,
  timeframe: string,
): string | null => {
  const rawTimeMs = resolveTimestampMs(bar.timestamp);
  if (rawTimeMs == null) {
    return null;
  }

  return String(normalizeTimeframeBucketStartMs(rawTimeMs, timeframe));
};

const patchBarsWithLiveQuote = (
  bars: MarketBar[],
  timeframe: string,
  quote: LiveOptionQuoteLike | null,
): MarketBar[] => {
  const normalizedBars = normalizeBaseBars(bars, timeframe);
  const quotePrice = resolveLiveQuotePrice(quote);
  const quoteUpdatedAtMs = resolveQuoteUpdatedAtMs(quote?.updatedAt);
  const stepMs = timeframeToStepMs(timeframe);

  if (!normalizedBars.length || quotePrice == null || quoteUpdatedAtMs == null || !stepMs) {
    return normalizedBars;
  }

  const nextBars = normalizedBars.slice();
  const lastBar = nextBars[nextBars.length - 1];
  const lastBarStartMs =
    resolveTimestampMs(lastBar.timestamp) ?? resolveTimestampMs(lastBar.time);
  if (lastBarStartMs == null) {
    return normalizedBars;
  }

  const nextBarStartMs =
    isDailyTimeframe(timeframe)
      ? quoteUpdatedAtMs < lastBarStartMs + stepMs
        ? lastBarStartMs
        : lastBarStartMs + stepMs
      : Math.floor(quoteUpdatedAtMs / stepMs) * stepMs;

  if (nextBarStartMs <= lastBarStartMs) {
    nextBars[nextBars.length - 1] = {
      ...lastBar,
      high: Math.max(lastBar.high ?? lastBar.h ?? quotePrice, quotePrice),
      low: Math.min(lastBar.low ?? lastBar.l ?? quotePrice, quotePrice),
      close: quotePrice,
      c: quotePrice,
      source: "ibkr-option-quote-derived",
      freshness: quote?.freshness ?? lastBar.freshness,
      marketDataMode: quote?.marketDataMode ?? lastBar.marketDataMode,
      dataUpdatedAt: quote?.dataUpdatedAt ?? quote?.updatedAt ?? lastBar.dataUpdatedAt,
      ts: new Date(lastBarStartMs).toISOString(),
    };
    return nextBars;
  }

  const previousClose =
    lastBar.close ?? lastBar.c ?? quotePrice;
  nextBars.push({
    timestamp: new Date(nextBarStartMs),
    time: nextBarStartMs,
    ts: new Date(nextBarStartMs).toISOString(),
    open: previousClose,
    high: Math.max(previousClose, quotePrice),
    low: Math.min(previousClose, quotePrice),
    close: quotePrice,
    volume: lastBar.volume ?? lastBar.v ?? 0,
    source: "ibkr-option-quote-derived",
    freshness: quote?.freshness ?? lastBar.freshness,
    marketDataMode: quote?.marketDataMode ?? lastBar.marketDataMode,
    dataUpdatedAt: quote?.dataUpdatedAt ?? quote?.updatedAt ?? lastBar.dataUpdatedAt,
  });
  return nextBars;
};

export const usePrependableHistoricalBars = ({
  scopeKey,
  timeframe,
  pageSizeTimeframe,
  bars,
  enabled = true,
  fetchOlderBars,
}: UsePrependableHistoricalBarsInput): {
  bars: MarketBar[];
  prependOlderBars: (input?: { pageSize?: number }) => Promise<number>;
  oldestLoadedAtMs: number | null;
  loadedBarCount: number;
  isPrependingOlder: boolean;
  hasExhaustedOlderHistory: boolean;
  olderHistoryNextBeforeMs: number | null;
  emptyOlderHistoryWindowCount: number;
  olderHistoryPageCount: number;
  olderHistoryProvider: string | null;
  olderHistoryExhaustionReason: string | null;
  olderHistoryProviderCursor: string | null;
  olderHistoryProviderNextUrl: string | null;
  olderHistoryProviderPageCount: number | null;
  olderHistoryProviderPageLimitReached: boolean;
  olderHistoryCursor: string | null;
} => {
  const normalizedBaseBars = useMemo(
    () => normalizeBaseBars(bars || [], timeframe),
    [bars, timeframe],
  );
  const sharedState = useActiveChartBarState(scopeKey);
  const [isPrependingOlder, setIsPrependingOlder] = useState(false);
  const activeScopeKeyRef = useRef(scopeKey);
  const inFlightOlderKeyRef = useRef<string | null>(null);

  useEffect(() => {
    activeScopeKeyRef.current = scopeKey;
    inFlightOlderKeyRef.current = null;
    setIsPrependingOlder(false);
  }, [scopeKey]);

  useEffect(() => {
    if (!enabled || !scopeKey?.trim()) {
      return;
    }

    updateActiveChartBarState(scopeKey, (current) => {
      const mergedHistoricalBars = current.historicalBars.length
        ? mergePatchedBars(current.historicalBars, normalizedBaseBars, timeframe)
        : normalizedBaseBars;

      if (areBarsEquivalent(current.historicalBars, mergedHistoricalBars)) {
        return current;
      }

      return {
        ...current,
        historicalBars: mergedHistoricalBars,
      };
    });
  }, [enabled, normalizedBaseBars, scopeKey, timeframe]);

  const mergedBars = useMemo(() => {
    if (!sharedState.historicalBars.length) {
      return normalizedBaseBars;
    }
    if (!normalizedBaseBars.length) {
      return sharedState.historicalBars;
    }
    return mergePatchedBars(normalizedBaseBars, sharedState.historicalBars, timeframe);
  }, [normalizedBaseBars, sharedState.historicalBars, timeframe]);
  const oldestLoadedAtMs = useMemo(
    () =>
      mergedBars.length
        ? (resolveTimestampMs(mergedBars[0]?.timestamp) ??
          resolveTimestampMs(mergedBars[0]?.time))
        : null,
    [mergedBars],
  );

  const prependOlderBars = useCallback(
    async (input?: { pageSize?: number }): Promise<number> => {
      if (
        !enabled ||
        !fetchOlderBars ||
        !mergedBars.length ||
        isPrependingOlder ||
        sharedState.hasExhaustedOlderHistory
      ) {
        return 0;
      }

      const oldestMs = oldestLoadedAtMs;
      const stepMs = timeframeToStepMs(timeframe);
      if (oldestMs == null || !stepMs) {
        return 0;
      }

      const requestedPageSize = resolvePrependRequestPageSize({
        pageSize: input?.pageSize ?? 0,
        pageSizeTimeframe,
        timeframe,
      });
      const requestToMs = Math.max(
        0,
        sharedState.olderHistoryNextBeforeMs ?? oldestMs - 1,
      );
      const historyCursor =
        sharedState.olderHistoryProviderPageLimitReached
          ? sharedState.olderHistoryCursor
          : null;
      if (requestToMs <= 0 && !historyCursor) {
        updateActiveChartBarState(scopeKey, (current) => ({
          ...current,
          hasExhaustedOlderHistory: true,
          olderHistoryExhaustionReason: "reached-history-start",
        }));
        return 0;
      }

      const prependKey = `${scopeKey}::${requestToMs}::${requestedPageSize}::${historyCursor ?? ""}`;
      if (inFlightOlderKeyRef.current === prependKey) {
        return 0;
      }

      const toMs = requestToMs;
      const lookbackMs = resolvePrependLookbackMs(timeframe, requestedPageSize);
      const fromMs = Math.max(0, toMs - lookbackMs);
      inFlightOlderKeyRef.current = prependKey;
      setIsPrependingOlder(true);
      recordChartHydrationCounter("olderPageFetch", scopeKey);
      if (historyCursor) {
        recordChartHydrationCounter("historyCursorPage", scopeKey);
      }

      try {
        const olderPayload = normalizeHistoricalBarsPayload(
          await fetchOlderBars({
            from: new Date(fromMs),
            to: new Date(toMs),
            limit: requestedPageSize,
            historyCursor,
            preferCursor: Boolean(historyCursor),
          }),
        );
        const olderBars = normalizeBaseBars(olderPayload.bars, timeframe);
        const historyPage = olderPayload.historyPage;

        if (activeScopeKeyRef.current !== scopeKey) {
          return 0;
        }

        const nextState = updateActiveChartBarState(scopeKey, (current) => {
          const existingTimes = new Set(
            current.historicalBars
              .map((bar) => resolveTimestampMs(bar.timestamp) ?? resolveTimestampMs(bar.time))
              .filter((value): value is number => value != null),
          );
          let addedCount = 0;
          olderBars.forEach((bar) => {
            const timeMs =
              resolveTimestampMs(bar.timestamp) ?? resolveTimestampMs(bar.time);
            if (timeMs != null && !existingTimes.has(timeMs)) {
              addedCount += 1;
            }
          });
          const oldestOlderMs = olderBars.length
            ? resolveTimestampMs(olderBars[0]?.timestamp) ??
              resolveTimestampMs(olderBars[0]?.time)
            : null;
          const historyNextBeforeMs = resolveHistoryPageTimeMs(
            historyPage?.nextBefore,
          );
          const nextEmptyWindowCount = olderBars.length
            ? 0
            : current.emptyOlderHistoryWindowCount + 1;
          const providerExhausted = Boolean(historyPage?.exhaustedBefore);
          const providerCursor =
            historyPage?.providerCursor ?? historyPage?.providerNextUrl ?? null;
          const providerNextUrl = historyPage?.providerNextUrl ?? null;
          const providerPageCount =
            typeof historyPage?.providerPageCount === "number"
              ? historyPage.providerPageCount
              : current.olderHistoryProviderPageCount;
          const providerPageLimitReached = Boolean(
            historyPage?.providerPageLimitReached,
          );
          const nextHistoryCursor =
            typeof historyPage?.historyCursor === "string" &&
            historyPage.historyCursor.trim()
              ? historyPage.historyCursor.trim()
              : null;
          const exhaustedByEmptyWindows =
            !olderBars.length &&
            nextEmptyWindowCount >= EMPTY_OLDER_HISTORY_WINDOW_EXHAUSTION_LIMIT;

          const mergedHistoricalBars = addedCount
            ? mergePatchedBars(current.historicalBars, olderBars, timeframe)
            : current.historicalBars;
          const oldestMergedMs = mergedHistoricalBars.length
            ? resolveTimestampMs(mergedHistoricalBars[0]?.timestamp) ??
              resolveTimestampMs(mergedHistoricalBars[0]?.time)
            : oldestOlderMs;
          const fallbackNextBeforeMs =
            oldestMergedMs != null
              ? Math.max(0, oldestMergedMs - 1)
              : fromMs > 0
                ? Math.max(0, fromMs - stepMs)
                : null;
          const candidateNextBeforeMs = [
            historyNextBeforeMs,
            fallbackNextBeforeMs,
          ].filter(
            (value): value is number => value != null && value < toMs,
          );
          const windowNextBeforeMs = candidateNextBeforeMs.length
            ? Math.min(...candidateNextBeforeMs)
            : null;
          const canContinueProviderCursor = Boolean(nextHistoryCursor);
          const nextBeforeMs = canContinueProviderCursor
            ? current.olderHistoryNextBeforeMs ?? toMs
            : windowNextBeforeMs;
          const cursorAdvanced =
            canContinueProviderCursor ||
            (nextBeforeMs != null && nextBeforeMs < toMs);
          const exhaustedByDuplicateWindow =
            olderBars.length > 0 && addedCount === 0 && !cursorAdvanced;
          const exhaustedAtStart =
            fromMs <= 0 && !olderBars.length && !canContinueProviderCursor;
          const hasExhaustedOlderHistory =
            current.hasExhaustedOlderHistory ||
            providerExhausted ||
            exhaustedByEmptyWindows ||
            exhaustedByDuplicateWindow ||
            exhaustedAtStart;
          const olderHistoryExhaustionReason = hasExhaustedOlderHistory
            ? providerExhausted
              ? "provider-exhausted"
              : exhaustedByEmptyWindows
                ? "empty-window-budget"
                : exhaustedByDuplicateWindow
                  ? "duplicate-window"
                  : exhaustedAtStart
                    ? "reached-history-start"
                    : current.olderHistoryExhaustionReason
            : null;
          const olderHistoryProvider =
            historyPage?.provider ?? current.olderHistoryProvider ?? null;
          if (providerCursor) {
            recordChartHydrationCounter("providerCursorPage", scopeKey);
          }
          if (exhaustedByDuplicateWindow) {
            recordChartHydrationCounter("olderPageDuplicate", scopeKey);
          }

          if (
            mergedHistoricalBars === current.historicalBars &&
            hasExhaustedOlderHistory === current.hasExhaustedOlderHistory &&
            nextBeforeMs === current.olderHistoryNextBeforeMs &&
            nextEmptyWindowCount === current.emptyOlderHistoryWindowCount &&
            olderHistoryProvider === current.olderHistoryProvider &&
            olderHistoryExhaustionReason === current.olderHistoryExhaustionReason &&
            providerCursor === current.olderHistoryProviderCursor &&
            providerNextUrl === current.olderHistoryProviderNextUrl &&
            providerPageCount === current.olderHistoryProviderPageCount &&
            providerPageLimitReached ===
              current.olderHistoryProviderPageLimitReached &&
            nextHistoryCursor === current.olderHistoryCursor
          ) {
            return current;
          }

          return {
            ...current,
            historicalBars: mergedHistoricalBars,
            hasExhaustedOlderHistory,
            olderHistoryNextBeforeMs: hasExhaustedOlderHistory
              ? current.olderHistoryNextBeforeMs
              : nextBeforeMs,
            emptyOlderHistoryWindowCount: nextEmptyWindowCount,
            olderHistoryPageCount: current.olderHistoryPageCount + 1,
            olderHistoryProvider,
            olderHistoryExhaustionReason,
            olderHistoryProviderCursor: providerCursor,
            olderHistoryProviderNextUrl: providerNextUrl,
            olderHistoryProviderPageCount: providerPageCount,
            olderHistoryProviderPageLimitReached: providerPageLimitReached,
            olderHistoryCursor: nextHistoryCursor,
          };
        });

        return Math.max(0, nextState.historicalBars.length - mergedBars.length);
      } finally {
        if (activeScopeKeyRef.current === scopeKey) {
          setIsPrependingOlder(false);
          if (inFlightOlderKeyRef.current === prependKey) {
            inFlightOlderKeyRef.current = null;
          }
        }
      }
    },
    [
      enabled,
      fetchOlderBars,
      isPrependingOlder,
      mergedBars.length,
      oldestLoadedAtMs,
      sharedState.hasExhaustedOlderHistory,
      sharedState.olderHistoryNextBeforeMs,
      sharedState.olderHistoryCursor,
      sharedState.olderHistoryProviderPageLimitReached,
      scopeKey,
      pageSizeTimeframe,
      timeframe,
    ],
  );

  return {
    bars: mergedBars,
    prependOlderBars,
    oldestLoadedAtMs,
    loadedBarCount: mergedBars.length,
    isPrependingOlder,
    hasExhaustedOlderHistory: sharedState.hasExhaustedOlderHistory,
    olderHistoryNextBeforeMs: sharedState.olderHistoryNextBeforeMs,
    emptyOlderHistoryWindowCount: sharedState.emptyOlderHistoryWindowCount,
    olderHistoryPageCount: sharedState.olderHistoryPageCount,
    olderHistoryProvider: sharedState.olderHistoryProvider,
    olderHistoryExhaustionReason: sharedState.olderHistoryExhaustionReason,
    olderHistoryProviderCursor: sharedState.olderHistoryProviderCursor,
    olderHistoryProviderNextUrl: sharedState.olderHistoryProviderNextUrl,
    olderHistoryProviderPageCount: sharedState.olderHistoryProviderPageCount,
    olderHistoryProviderPageLimitReached:
      sharedState.olderHistoryProviderPageLimitReached,
    olderHistoryCursor: sharedState.olderHistoryCursor,
  };
};

export const useBrokerStreamedBars = ({
  symbol,
  timeframe,
  bars,
  enabled = true,
}: UseBrokerStreamedBarsInput): MarketBar[] => {
  useBrokerStockAggregateStream({
    symbols: symbol ? [symbol] : [],
    enabled: Boolean(enabled && symbol && MINUTE_AGGREGATE_PATCH_TIMEFRAMES.has(timeframe)),
  });

  const symbolAggregateVersion = useStockMinuteAggregateSymbolVersion(symbol);

  return useMemo(
    () => mergeBarsWithMinuteAggregates(symbol, timeframe, bars || []),
    [bars, symbolAggregateVersion, symbol, timeframe],
  );
};

export const useOptionQuotePatchedBars = ({
  providerContractId,
  timeframe,
  bars,
  enabled = true,
  instrumentationScope,
}: UseOptionQuotePatchedBarsInput): MarketBar[] => {
  const liveQuote = useStoredOptionQuoteSnapshot(providerContractId);
  const normalizedBaseBars = useMemo(
    () => normalizeBaseBars(bars || [], timeframe),
    [bars, timeframe],
  );
  const scopeKey = `${providerContractId?.trim?.() || ""}:${timeframe}`;
  const [patchedBars, setPatchedBars] = useState<MarketBar[]>(normalizedBaseBars);
  const baseBarsRef = useRef(normalizedBaseBars);
  const lastAppliedQuoteSignatureRef = useRef<string | null>(null);
  const patchedBarLimit = useMemo(
    () => resolvePatchedBarLimit(timeframe, normalizedBaseBars),
    [normalizedBaseBars, timeframe],
  );
  const quoteSignature = [
    resolveQuoteUpdatedAtMs(liveQuote?.updatedAt) ?? "",
    liveQuote?.price ?? "",
    liveQuote?.bid ?? "",
    liveQuote?.ask ?? "",
  ].join("|");

  useEffect(() => {
    baseBarsRef.current = normalizedBaseBars;
  }, [normalizedBaseBars]);

  useEffect(() => {
    setPatchedBars((current) => {
      const next = capBarsToRecentLimit(normalizedBaseBars, patchedBarLimit);
      return areBarsEquivalent(current, next) ? current : next;
    });
    lastAppliedQuoteSignatureRef.current = quoteSignature;
  }, [scopeKey]);

  useEffect(() => {
    setPatchedBars((current) => {
      const next = mergeAndCapPatchedBars(
        normalizedBaseBars,
        current,
        patchedBarLimit,
        timeframe,
      );
      return areBarsEquivalent(current, next) ? current : next;
    });
  }, [normalizedBaseBars, patchedBarLimit, timeframe]);

  useEffect(() => {
    if (!enabled || !providerContractId || !liveQuote) {
      return;
    }

    if (lastAppliedQuoteSignatureRef.current === quoteSignature) {
      return;
    }

    lastAppliedQuoteSignatureRef.current = quoteSignature;
    markChartLivePatchPending(instrumentationScope);
    setPatchedBars((current) => {
      const next = capBarsToRecentLimit(
        patchBarsWithLiveQuote(
          current.length ? current : baseBarsRef.current,
          timeframe,
          liveQuote,
        ),
        patchedBarLimit,
      );
      return areBarsEquivalent(current, next) ? current : next;
    });
  }, [
    enabled,
    liveQuote,
    patchedBarLimit,
    providerContractId,
    quoteSignature,
    timeframe,
    instrumentationScope,
  ]);

  return patchedBars;
};

export const useHistoricalBarStream = ({
  symbol,
  timeframe,
  bars,
  enabled = true,
  assetClass,
  providerContractId,
  outsideRth,
  source,
  instrumentationScope,
  fetchLatestBars,
  streamPriority = 0,
}: UseHistoricalBarStreamInput): MarketBar[] => {
  const normalizedBaseBars = useMemo(
    () => normalizeBaseBars(bars || [], timeframe),
    [bars, timeframe],
  );
  const scopeKey = [
    symbol?.trim?.().toUpperCase?.() || "",
    timeframe,
    assetClass || "equity",
    providerContractId?.trim?.() || "",
    typeof outsideRth === "boolean" ? String(outsideRth) : "",
    source || "",
  ].join("::");
  const [streamedBars, setStreamedBars] = useState<MarketBar[]>(normalizedBaseBars);
  const baseBarsRef = useRef(normalizedBaseBars);
  const fetchLatestBarsRef = useRef(fetchLatestBars);
  const lastStreamSignatureRef = useRef<string | null>(null);
  const pageVisible = usePageVisible();
  const streamedBarLimit = useMemo(
    () => resolvePatchedBarLimit(timeframe, normalizedBaseBars),
    [normalizedBaseBars, timeframe],
  );
  const streamUrl = useMemo(
    () =>
      buildHistoricalBarStreamUrl({
        symbol,
        timeframe,
        assetClass,
        providerContractId,
        outsideRth,
        source,
      }),
    [assetClass, outsideRth, providerContractId, source, symbol, timeframe],
  );

  useEffect(() => {
    baseBarsRef.current = normalizedBaseBars;
  }, [normalizedBaseBars]);

  useEffect(() => {
    fetchLatestBarsRef.current = fetchLatestBars;
  }, [fetchLatestBars]);

  useEffect(() => {
    setStreamedBars((current) => {
      const next = capBarsToRecentLimit(normalizedBaseBars, streamedBarLimit);
      return areBarsEquivalent(current, next) ? current : next;
    });
    lastStreamSignatureRef.current = null;
  }, [scopeKey, normalizedBaseBars, streamedBarLimit]);

  useEffect(() => {
    setStreamedBars((current) => {
      const next = mergeAndCapPatchedBars(
        normalizedBaseBars,
        current,
        streamedBarLimit,
        timeframe,
      );
      return areBarsEquivalent(current, next) ? current : next;
    });
  }, [normalizedBaseBars, streamedBarLimit, timeframe]);

  useEffect(() => {
    if (!enabled || !pageVisible || !streamUrl || typeof window === "undefined") {
      return;
    }

    let active = true;
    let fallbackTimer: number | null = null;
    let fallbackInFlight = false;
    let fallbackAttempt = 0;
    let lastFallbackCompletedAt = 0;
    let streamIsLive = false;

    const clearFallbackTimer = () => {
      if (fallbackTimer == null) {
        return;
      }
      window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    };

    const applyStreamBars = (
      bars: HistoricalBarStreamSnapshot[],
      stats: LiveFrameSchedulerStats,
    ) => {
      if (!active || !bars.length) {
        return;
      }
      if (stats.coalesced > 0) {
        recordChartHydrationCounter(
          "livePatchCoalesced",
          instrumentationScope,
          stats.coalesced,
        );
      }
      if (stats.duplicates > 0) {
        recordChartHydrationCounter(
          "livePatchDuplicate",
          instrumentationScope,
          stats.duplicates,
        );
      }
      markChartLivePatchPending(instrumentationScope);
      setStreamedBars((current) => {
        const patchedBars = bars
          .map((bar) => buildPatchedBarFromHistoricalBarStream(bar, timeframe))
          .filter((bar): bar is MarketBar => Boolean(bar));
        if (!patchedBars.length) {
          return current;
        }
        const next = capBarsToRecentLimit(
          mergePatchedBars(
            current.length ? current : baseBarsRef.current,
            patchedBars,
            timeframe,
          ),
          streamedBarLimit,
        );
        return areBarsEquivalent(current, next) ? current : next;
      });
    };

    const streamBarScheduler = createLiveBarFrameScheduler<HistoricalBarStreamSnapshot>({
      getBucketKey: (bar) => resolveHistoricalBarStreamBucketKey(bar, timeframe),
      getSignature: buildHistoricalBarStreamSignature,
      apply: applyStreamBars,
    });

    const enqueueStreamBar = (bar: HistoricalBarStreamSnapshot) => {
      const nextSignature = buildHistoricalBarStreamSignature(bar);
      if (nextSignature === lastStreamSignatureRef.current) {
        recordChartHydrationCounter("livePatchDuplicate", instrumentationScope);
        return;
      }
      lastStreamSignatureRef.current = nextSignature;
      streamBarScheduler.enqueue(bar);
    };

    const scheduleFallback = (delayMs?: number) => {
      if (!active || fallbackTimer != null || fallbackInFlight || !fetchLatestBarsRef.current) {
        return;
      }

      const delay =
        typeof delayMs === "number"
          ? delayMs
          : LIVE_BAR_FALLBACK_DELAYS_MS[
              Math.min(fallbackAttempt, LIVE_BAR_FALLBACK_DELAYS_MS.length - 1)
            ];
      const cooldownRemaining = Math.max(
        0,
        lastFallbackCompletedAt + LIVE_BAR_FALLBACK_SUCCESS_COOLDOWN_MS - Date.now(),
      );
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = null;
        void runFallback();
      }, Math.max(delay, cooldownRemaining));
    };

    const runFallback = async () => {
      if (!active || fallbackInFlight || !fetchLatestBarsRef.current) {
        return;
      }

      fallbackInFlight = true;
      try {
        recordChartHydrationCounter("liveFallbackFetch", instrumentationScope);
        const bars = normalizeBaseBars(
          await fetchLatestBarsRef.current(),
          timeframe,
        );
        if (!active || !bars.length) {
          return;
        }

        markChartLivePatchPending(instrumentationScope);
        setStreamedBars((current) => {
          const next = mergeAndCapPatchedBars(
            current.length ? current : baseBarsRef.current,
            bars,
            streamedBarLimit,
            timeframe,
          );
          return areBarsEquivalent(current, next) ? current : next;
        });
        lastFallbackCompletedAt = Date.now();
      } finally {
        fallbackInFlight = false;
        fallbackAttempt += 1;
        if (active && !streamIsLive) {
          scheduleFallback();
        }
      }
    };

    const unsubscribe = subscribeLiveBarStream(streamUrl, {
      priority: streamPriority,
      onBar: (bar) => {
        fallbackAttempt = 0;
        clearFallbackTimer();
        enqueueStreamBar(bar);
      },
      onStatus: (status) => {
        streamIsLive = status === "live";
        if (status === "live" || status === "connecting") {
          if (status === "live") {
            fallbackAttempt = 0;
          }
          clearFallbackTimer();
          return;
        }

        scheduleFallback(0);
      },
    });

    return () => {
      active = false;
      clearFallbackTimer();
      streamBarScheduler.cancel();
      unsubscribe();
    };
  }, [
    enabled,
    instrumentationScope,
    pageVisible,
    scopeKey,
    streamUrl,
    streamPriority,
    streamedBarLimit,
    timeframe,
  ]);

  return streamedBars;
};

export const useMassiveStreamedStockBars = useBrokerStreamedBars;

export const __chartStreamingTestInternals = {
  capBarsToRecentLimit,
  buildBarFromMinuteAggregateBucket,
  mergeBarsWithMinuteAggregateList,
  mergeBarsWithMinuteAggregates,
  mergeAndCapPatchedBars,
  normalizeHistoricalBarsPayload,
  normalizeBaseBars,
  patchBarsWithHistoricalBarStream,
  buildPatchedBarFromHistoricalBarStream,
  buildHistoricalBarStreamSignature,
  resolveHistoricalBarStreamBucketKey,
  createLiveBarFrameScheduler,
  isHistoricalBarStreamPayloadForUrl,
  resolvePrependLookbackMs,
  resolvePrependRequestPageSize,
  resolvePatchedBarLimit,
};
