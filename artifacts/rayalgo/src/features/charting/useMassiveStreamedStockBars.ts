import { useMemo } from "react";
import type { MarketBar } from "./types";
import {
  getStoredBrokerMinuteAggregates,
  useBrokerStockAggregateStream,
  useStockMinuteAggregateStoreVersion,
} from "./useMassiveStockAggregateStream";

type UseBrokerStreamedBarsInput = {
  symbol: string;
  timeframe: string;
  bars?: MarketBar[] | null;
  enabled?: boolean;
};

const STREAM_SUPPORTED_TIMEFRAMES = new Set(["1m", "5m", "15m", "1h", "1d"]);

const timeframeToStepMs = (timeframe: string): number => (
  ({
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "1d": 86_400_000,
  }[timeframe] || 0)
);

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

const normalizeBaseBars = (bars: MarketBar[]): MarketBar[] => (
  bars
    .reduce<Array<MarketBar & { _startMs: number }>>((result, bar) => {
      const startMs = resolveTimestampMs(bar.timestamp) ?? resolveTimestampMs(bar.time);
      if (startMs == null) {
        return result;
      }

      result.push({
        ...bar,
        timestamp: new Date(startMs),
        ts: typeof bar.ts === "string" ? bar.ts : new Date(startMs).toISOString(),
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

const mergeBarsWithMinuteAggregates = (
  symbol: string,
  timeframe: string,
  bars: MarketBar[],
): MarketBar[] => {
  const normalizedBars = normalizeBaseBars(bars);
  if (!STREAM_SUPPORTED_TIMEFRAMES.has(timeframe)) {
    return normalizedBars;
  }

  const stepMs = timeframeToStepMs(timeframe);
  if (!stepMs) {
    return normalizedBars;
  }

  const minuteAggregates = getStoredBrokerMinuteAggregates(symbol);
  if (!minuteAggregates.length) {
    return normalizedBars;
  }

  // Daily charts: patch the last historical bar with all live aggregates that fall
  // within its session window, rather than re-bucketing (which would mis-align with
  // IBKR's session-day boundary, typically 04:00 UTC).
  if (isDailyTimeframe(timeframe)) {
    if (!normalizedBars.length) {
      return normalizedBars;
    }
    const lastBar = normalizedBars[normalizedBars.length - 1];
    const lastStartMs =
      resolveTimestampMs(lastBar.timestamp) ?? resolveTimestampMs(lastBar.time);
    if (lastStartMs == null) {
      return normalizedBars;
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
      source: "ibkr-websocket-derived",
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

  const bucketedMinutes = new Map<number, ReturnType<typeof getStoredBrokerMinuteAggregates>>();
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
      source: "ibkr-websocket-derived",
    });
  });

  return Array.from(mergedByStart.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, bar]) => bar);
};

export const useBrokerStreamedBars = ({
  symbol,
  timeframe,
  bars,
  enabled = true,
}: UseBrokerStreamedBarsInput): MarketBar[] => {
  useBrokerStockAggregateStream({
    symbols: symbol ? [symbol] : [],
    enabled: Boolean(enabled && symbol && STREAM_SUPPORTED_TIMEFRAMES.has(timeframe)),
  });

  const storeVersion = useStockMinuteAggregateStoreVersion();

  return useMemo(
    () => mergeBarsWithMinuteAggregates(symbol, timeframe, bars || []),
    [bars, storeVersion, symbol, timeframe],
  );
};

export const useMassiveStreamedStockBars = useBrokerStreamedBars;
