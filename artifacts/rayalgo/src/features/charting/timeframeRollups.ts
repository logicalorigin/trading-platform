import type { MarketBar } from "./types";
import {
  getChartBaseTimeframe,
  getChartTimeframeStepMs,
  normalizeChartTimeframe,
} from "./timeframes";

const TIMEFRAME_STEP_MS: Record<string, number> = {
  "1s": 1_000,
  "5s": 5_000,
  "15s": 15_000,
  "30s": 30_000,
  "1m": 60_000,
  "2m": 2 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1D": 24 * 60 * 60_000,
};

const resolveTimeframeStepMs = (timeframe: string): number =>
  getChartTimeframeStepMs(timeframe) || TIMEFRAME_STEP_MS[normalizeChartTimeframe(timeframe)] || 0;

export const normalizeTimeframeBucketStartMs = (
  timeMs: number,
  timeframe: string,
): number => {
  const stepMs = resolveTimeframeStepMs(timeframe);
  if (!Number.isFinite(timeMs) || !stepMs || stepMs >= TIMEFRAME_STEP_MS["1d"]) {
    return timeMs;
  }

  return Math.floor(timeMs / stepMs) * stepMs;
};

const resolveBarTimestampMs = (bar: MarketBar): number | null => {
  const value = bar.timestamp ?? bar.time ?? bar.ts;
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

const resolveFiniteNumber = (...values: Array<number | null | undefined>): number | null => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
};

const weightedAverage = (
  values: Array<{ value: number | null; weight: number }>,
): number | null => {
  let totalWeight = 0;
  let totalValue = 0;

  values.forEach(({ value, weight }) => {
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) {
      return;
    }
    totalWeight += weight;
    totalValue += (value as number) * weight;
  });

  if (totalWeight <= 0) {
    return null;
  }

  return Number((totalValue / totalWeight).toFixed(6));
};

export const resolveLocalRollupBaseTimeframe = (
  timeframe: string,
  targetLimit: number,
  role: "mini" | "primary" | "option" = "primary",
): string => {
  const normalizedTimeframe = normalizeChartTimeframe(timeframe);
  const targetStepMs = resolveTimeframeStepMs(normalizedTimeframe);
  if (!targetStepMs || normalizedTimeframe === "1d") {
    return normalizedTimeframe;
  }
  const preferredBaseTimeframe = getChartBaseTimeframe(normalizedTimeframe);
  if (preferredBaseTimeframe === normalizedTimeframe) {
    return normalizedTimeframe;
  }

  const baseStepMs = resolveTimeframeStepMs(preferredBaseTimeframe);
  if (!baseStepMs || baseStepMs >= targetStepMs || targetStepMs % baseStepMs !== 0) {
    return normalizedTimeframe;
  }

  return preferredBaseTimeframe;
};

export const expandLocalRollupLimit = (
  limit: number,
  targetTimeframe: string,
  baseTimeframe: string,
): number => {
  const targetStepMs = resolveTimeframeStepMs(targetTimeframe);
  const baseStepMs = resolveTimeframeStepMs(baseTimeframe);
  if (!targetStepMs || !baseStepMs || baseStepMs >= targetStepMs) {
    return Math.max(1, Math.ceil(limit));
  }

  return Math.max(1, Math.ceil((limit * targetStepMs) / baseStepMs));
};

export const rollupMarketBars = (
  bars: MarketBar[] | null | undefined,
  sourceTimeframe: string,
  targetTimeframe: string,
): MarketBar[] => {
  const normalizedBars = Array.isArray(bars) ? bars : [];
  const sourceStepMs = resolveTimeframeStepMs(sourceTimeframe);
  const targetStepMs = resolveTimeframeStepMs(targetTimeframe);

  if (
    !normalizedBars.length ||
    !sourceStepMs ||
    !targetStepMs ||
    targetStepMs <= sourceStepMs ||
    targetStepMs % sourceStepMs !== 0
  ) {
    return normalizedBars;
  }

  const rolledBars: MarketBar[] = [];
  let currentBucketStartMs: number | null = null;
  let currentBucket: MarketBar[] = [];

  const flushBucket = () => {
    if (!currentBucket.length || currentBucketStartMs == null) {
      return;
    }

    const firstBar = currentBucket[0];
    const lastBar = currentBucket[currentBucket.length - 1];
    const high = Math.max(
      ...currentBucket.map((bar) => resolveFiniteNumber(bar.h, bar.high) ?? Number.NEGATIVE_INFINITY),
    );
    const low = Math.min(
      ...currentBucket.map((bar) => resolveFiniteNumber(bar.l, bar.low) ?? Number.POSITIVE_INFINITY),
    );
    const volume = currentBucket.reduce(
      (total, bar) => total + (resolveFiniteNumber(bar.v, bar.volume) ?? 0),
      0,
    );
    const open = resolveFiniteNumber(firstBar.o, firstBar.open) ?? 0;
    const resolvedHigh = Number.isFinite(high)
      ? high
      : resolveFiniteNumber(lastBar.h, lastBar.high) ?? 0;
    const resolvedLow = Number.isFinite(low)
      ? low
      : resolveFiniteNumber(lastBar.l, lastBar.low) ?? 0;
    const close = resolveFiniteNumber(lastBar.c, lastBar.close) ?? 0;

    rolledBars.push({
      time: currentBucketStartMs,
      timestamp: currentBucketStartMs,
      ts: new Date(currentBucketStartMs).toISOString(),
      o: open,
      h: resolvedHigh,
      l: resolvedLow,
      c: close,
      open,
      high: resolvedHigh,
      low: resolvedLow,
      close,
      v: volume,
      volume,
      vwap: weightedAverage(
        currentBucket.map((bar) => ({
          value: resolveFiniteNumber(bar.vwap),
          weight: resolveFiniteNumber(bar.v, bar.volume) ?? 0,
        })),
      ) ?? undefined,
      sessionVwap: resolveFiniteNumber(lastBar.sessionVwap) ?? undefined,
      accumulatedVolume:
        resolveFiniteNumber(lastBar.accumulatedVolume) ?? undefined,
      averageTradeSize: weightedAverage(
        currentBucket.map((bar) => ({
          value: resolveFiniteNumber(bar.averageTradeSize),
          weight: resolveFiniteNumber(bar.v, bar.volume) ?? 0,
        })),
      ) ?? undefined,
      source:
        typeof lastBar.source === "string" && lastBar.source
          ? `${lastBar.source}:rollup`
          : "rollup",
      freshness: lastBar.freshness,
      marketDataMode: lastBar.marketDataMode,
      dataUpdatedAt: lastBar.dataUpdatedAt,
      studyFallback: lastBar.studyFallback,
    });
  };

  normalizedBars.forEach((bar) => {
    const timeMs = resolveBarTimestampMs(bar);
    if (timeMs == null) {
      return;
    }

    const bucketStartMs = Math.floor(timeMs / targetStepMs) * targetStepMs;
    if (currentBucketStartMs == null || bucketStartMs !== currentBucketStartMs) {
      flushBucket();
      currentBucketStartMs = bucketStartMs;
      currentBucket = [bar];
      return;
    }

    currentBucket.push(bar);
  });

  flushBucket();
  return rolledBars;
};
