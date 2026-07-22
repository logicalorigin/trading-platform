import type { MarketBar } from "./types";
import {
  getChartBaseTimeframe,
  getChartTimeframeStepMs,
  normalizeChartTimeframe,
} from "./timeframes";
import { resolveBarTimestampMs as resolveBarTimestampMsFromValue } from "./chartBarTime";

const DAY_MS = getChartTimeframeStepMs("1d");

export const normalizeTimeframeBucketStartMs = (
  timeMs: number,
  timeframe: string,
): number => {
  const stepMs = getChartTimeframeStepMs(timeframe);
  if (!Number.isFinite(timeMs) || !stepMs || stepMs >= DAY_MS) {
    return timeMs;
  }

  return Math.floor(timeMs / stepMs) * stepMs;
};

const resolveBarTimestampMs = (bar: MarketBar): number | null =>
  resolveBarTimestampMsFromValue(bar.timestamp ?? bar.time ?? bar.ts);

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
  _targetLimit: number,
  _role: "primary" | "option" = "primary",
): string => {
  const normalizedTimeframe = normalizeChartTimeframe(timeframe);
  const targetStepMs = getChartTimeframeStepMs(normalizedTimeframe);
  if (!targetStepMs || normalizedTimeframe === "1d") {
    return normalizedTimeframe;
  }
  const preferredBaseTimeframe = getChartBaseTimeframe(normalizedTimeframe);
  if (preferredBaseTimeframe === normalizedTimeframe) {
    return normalizedTimeframe;
  }

  const baseStepMs = getChartTimeframeStepMs(preferredBaseTimeframe);
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
  const targetStepMs = getChartTimeframeStepMs(targetTimeframe);
  const baseStepMs = getChartTimeframeStepMs(baseTimeframe);
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
  const sourceStepMs = getChartTimeframeStepMs(sourceTimeframe);
  const targetStepMs = getChartTimeframeStepMs(targetTimeframe);

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
      ageMs: lastBar.ageMs,
      delayed: lastBar.delayed,
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
