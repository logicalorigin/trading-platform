import type { MarketBar } from "./types";

const TIMEFRAME_STEP_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1D": 24 * 60 * 60_000,
};

const LOCAL_ROLLUP_BASE_THRESHOLDS: Record<"mini" | "primary" | "option", number> = {
  mini: 4_800,
  primary: 12_000,
  option: 6_000,
};

const LOCAL_ROLLUP_BASE_CANDIDATES = ["1m", "5m", "15m"] as const;

const normalizeTimeframe = (timeframe: string): string =>
  timeframe === "1D" ? "1d" : timeframe;

const resolveTimeframeStepMs = (timeframe: string): number =>
  TIMEFRAME_STEP_MS[normalizeTimeframe(timeframe)] || 0;

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
  const normalizedTimeframe = normalizeTimeframe(timeframe);
  const targetStepMs = resolveTimeframeStepMs(normalizedTimeframe);
  if (!targetStepMs || normalizedTimeframe === "1d") {
    return normalizedTimeframe;
  }
  if (normalizedTimeframe === "1m") {
    return "1m";
  }

  const threshold = LOCAL_ROLLUP_BASE_THRESHOLDS[role];
  for (const candidate of LOCAL_ROLLUP_BASE_CANDIDATES) {
    const candidateStepMs = resolveTimeframeStepMs(candidate);
    if (!candidateStepMs || candidateStepMs >= targetStepMs) {
      continue;
    }
    if (targetStepMs % candidateStepMs !== 0) {
      continue;
    }

    const requiredBaseBars = Math.ceil((targetLimit * targetStepMs) / candidateStepMs);
    if (requiredBaseBars <= threshold) {
      return candidate;
    }
  }

  return normalizedTimeframe;
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

    rolledBars.push({
      time: currentBucketStartMs,
      timestamp: currentBucketStartMs,
      ts: new Date(currentBucketStartMs).toISOString(),
      o: resolveFiniteNumber(firstBar.o, firstBar.open) ?? 0,
      h: Number.isFinite(high) ? high : resolveFiniteNumber(lastBar.h, lastBar.high) ?? 0,
      l: Number.isFinite(low) ? low : resolveFiniteNumber(lastBar.l, lastBar.low) ?? 0,
      c: resolveFiniteNumber(lastBar.c, lastBar.close) ?? 0,
      v: volume,
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
