const finiteNumber = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const clampOddBucketCount = (tradeCount) => {
  const count =
    tradeCount < 12
      ? 7
      : tradeCount < 40
        ? 9
        : tradeCount < 120
          ? 11
          : 15;
  return count % 2 === 0 ? count + 1 : count;
};

const metricValueForTrade = (trade, metric = "pnl") =>
  metric === "percent"
    ? finiteNumber(trade?.realizedPnlPercent)
    : finiteNumber(trade?.realizedPnl);

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const average = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export const buildTradeOutcomeHistogramModel = ({
  trades = [],
  metric = "pnl",
  minBuckets = 7,
  maxBuckets = 15,
} = {}) => {
  const values = trades
    .map((trade) => ({
      trade,
      value: metricValueForTrade(trade, metric),
    }))
    .filter((entry) => entry.value != null);

  const winners = values.filter((entry) => entry.value > 0).map((entry) => entry.value);
  const losers = values.filter((entry) => entry.value < 0).map((entry) => entry.value);
  const breakeven = values.filter((entry) => entry.value === 0).map((entry) => entry.value);
  const grossWins = winners.reduce((sum, value) => sum + value, 0);
  const grossLosses = losers.reduce((sum, value) => sum + value, 0);
  const maxAbs = values.length
    ? Math.max(...values.map((entry) => Math.abs(entry.value)), 0)
    : 0;
  const requestedBucketCount = Math.min(
    maxBuckets,
    Math.max(minBuckets, clampOddBucketCount(values.length)),
  );
  const bucketCount = requestedBucketCount % 2 === 0
    ? requestedBucketCount + 1
    : requestedBucketCount;

  if (!values.length || maxAbs === 0) {
    return {
      metric,
      buckets: values.length
        ? [
            {
              id: `${metric}:flat`,
              index: 0,
              min: 0,
              max: 0,
              label: "Flat",
              side: "flat",
              count: values.length,
              total: 0,
              average: 0,
              trades: values.map((entry) => entry.trade),
            },
          ]
        : [],
      summary: {
        totalTrades: values.length,
        winners: winners.length,
        losers: losers.length,
        breakeven: breakeven.length,
        median: median(values.map((entry) => entry.value)),
        averageWin: average(winners),
        averageLoss: average(losers),
        profitFactor: grossLosses < 0 ? grossWins / Math.abs(grossLosses) : null,
      },
    };
  }

  const min = -maxAbs;
  const max = maxAbs;
  const width = (max - min) / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketMin = min + width * index;
    const bucketMax = index === bucketCount - 1 ? max : bucketMin + width;
    const crossesZero = bucketMin < 0 && bucketMax > 0;
    const side = crossesZero
      ? "flat"
      : bucketMax <= 0
        ? "loss"
        : bucketMin >= 0
          ? "win"
          : "flat";
    return {
      id: `${metric}:${index}:${bucketMin.toFixed(6)}:${bucketMax.toFixed(6)}`,
      index,
      bucketCount,
      min: bucketMin,
      max: bucketMax,
      label: bucketLabel(bucketMin, bucketMax, side),
      side,
      count: 0,
      total: 0,
      average: null,
      trades: [],
    };
  });

  values.forEach((entry) => {
    const rawIndex = Math.floor((entry.value - min) / width);
    const index = Math.min(bucketCount - 1, Math.max(0, rawIndex));
    const bucket = buckets[index];
    bucket.count += 1;
    bucket.total += entry.value;
    bucket.trades.push(entry.trade);
  });

  buckets.forEach((bucket) => {
    bucket.average = bucket.count ? bucket.total / bucket.count : null;
  });

  return {
    metric,
    buckets,
    summary: {
      totalTrades: values.length,
      winners: winners.length,
      losers: losers.length,
      breakeven: breakeven.length,
      median: median(values.map((entry) => entry.value)),
      averageWin: average(winners),
      averageLoss: average(losers),
      profitFactor: grossLosses < 0 ? grossWins / Math.abs(grossLosses) : null,
    },
  };
};

export const tradeMatchesOutcomeBucket = (trade, bucket, metric = "pnl") => {
  if (!bucket) return true;
  const value = metricValueForTrade(trade, metric);
  if (value == null) return false;
  if (bucket.min === bucket.max) return value === bucket.min;
  const isLastBucket = bucket.index === bucket.bucketCount - 1;
  return value >= bucket.min && (value < bucket.max || (isLastBucket && value <= bucket.max));
};

const bucketLabel = (min, max, side) => {
  if (side === "flat") return "Near 0";
  const format = (value) => {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${value < 0 ? "-" : ""}${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${value < 0 ? "-" : ""}${(abs / 1_000).toFixed(1)}K`;
    return `${Math.round(value)}`;
  };
  return `${format(min)} to ${format(max)}`;
};
