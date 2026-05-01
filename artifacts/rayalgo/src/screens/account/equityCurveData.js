const EQUITY_JOIN_TOLERANCE_BY_RANGE_MS = {
  "1D": 5 * 60_000,
  "1W": 10 * 60_000,
  "1M": 30 * 60_000,
  "3M": 3 * 60 * 60_000,
  "6M": 6 * 60 * 60_000,
  YTD: 12 * 60 * 60_000,
  "1Y": 12 * 60 * 60_000,
  ALL: 36 * 60 * 60_000,
};

const DEFAULT_JOIN_TOLERANCE_MS = EQUITY_JOIN_TOLERANCE_BY_RANGE_MS["1M"];

const finiteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const parseEquityTimestampMs = (value) => {
  const timestampMs = new Date(value).getTime();
  return Number.isFinite(timestampMs) ? timestampMs : null;
};

export const equityJoinToleranceMs = (range) =>
  EQUITY_JOIN_TOLERANCE_BY_RANGE_MS[range] ?? DEFAULT_JOIN_TOLERANCE_MS;

export const normalizeEquityPointSeries = (points = []) =>
  points
    .map((point) => {
      const timestampMs = parseEquityTimestampMs(point?.timestamp);
      const netLiquidation = finiteNumber(point?.netLiquidation);
      if (timestampMs === null || netLiquidation === null) {
        return null;
      }
      return {
        ...point,
        timestampMs,
        netLiquidation,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.timestampMs - right.timestampMs);

const externalTransferAmount = (point) =>
  (finiteNumber(point?.deposits) ?? 0) - (finiteNumber(point?.withdrawals) ?? 0);

export const buildTransferAdjustedPnlSeries = (points = []) => {
  if (!points.length) {
    return [];
  }

  const firstPoint = points[0] || null;
  const firstNav = finiteNumber(firstPoint?.netLiquidation);
  if (firstNav === null) {
    return points.map(() => null);
  }

  const firstTransfer = externalTransferAmount(firstPoint);
  let previousNav =
    firstTransfer > 0 ? Math.max(0, firstNav - firstTransfer) : firstNav - firstTransfer;
  let cumulativePnl = 0;

  return points.map((point) => {
    const currentNav = finiteNumber(point?.netLiquidation);
    if (currentNav === null) {
      return null;
    }
    cumulativePnl += currentNav - previousNav - externalTransferAmount(point);
    previousNav = currentNav;
    return cumulativePnl;
  });
};

const normalizeBenchmarkSeries = (points = []) =>
  points
    .map((point) => {
      const timestampMs = parseEquityTimestampMs(point?.timestamp);
      const benchmarkPercent = finiteNumber(point?.benchmarkPercent);
      if (timestampMs === null || benchmarkPercent === null) {
        return null;
      }
      return {
        timestampMs,
        benchmarkPercent,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.timestampMs - right.timestampMs);

export const findNearestEquityPoint = (
  sortedPoints,
  targetTimestampMs,
  toleranceMs,
) => {
  if (!sortedPoints?.length || !Number.isFinite(targetTimestampMs)) {
    return null;
  }

  let low = 0;
  let high = sortedPoints.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const timestampMs = sortedPoints[middle].timestampMs;
    if (timestampMs === targetTimestampMs) {
      return sortedPoints[middle];
    }
    if (timestampMs < targetTimestampMs) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const candidates = [sortedPoints[high], sortedPoints[low]].filter(Boolean);
  const nearest = candidates.reduce((best, point) => {
    if (!best) return point;
    return Math.abs(point.timestampMs - targetTimestampMs) <
      Math.abs(best.timestampMs - targetTimestampMs)
      ? point
      : best;
  }, null);

  return nearest &&
    Math.abs(nearest.timestampMs - targetTimestampMs) <= toleranceMs
    ? nearest
    : null;
};

export const joinBenchmarkPercentSeries = (
  equityPoints,
  benchmarkPoints,
  range,
) => {
  const toleranceMs = equityJoinToleranceMs(range);
  const benchmarkSeries = normalizeBenchmarkSeries(benchmarkPoints);
  return equityPoints.map((point) => {
    const match = findNearestEquityPoint(
      benchmarkSeries,
      point.timestampMs,
      toleranceMs,
    );
    return match?.benchmarkPercent ?? null;
  });
};

export const mapEquityEventsToPoints = (events = [], equityPoints = [], range) => {
  const toleranceMs = equityJoinToleranceMs(range);
  return events
    .map((event) => {
      const timestampMs = parseEquityTimestampMs(event?.timestamp);
      if (timestampMs === null) {
        return null;
      }
      const point = findNearestEquityPoint(equityPoints, timestampMs, toleranceMs);
      return point
        ? {
            ...event,
            timestampMs: point.timestampMs,
            netLiquidation: point.netLiquidation,
            cumulativePnl: point.cumulativePnl,
          }
        : null;
    })
    .filter(Boolean);
};

export const buildPaddedValueDomain = (
  values = [],
  { paddingRatio = 0.08, minPadding = 1, floor = null, ceiling = null } = {},
) => {
  const finiteValues = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!finiteValues.length) {
    return ["auto", "auto"];
  }

  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  const span = max - min;
  const padding =
    span > 0
      ? Math.max(span * paddingRatio, minPadding)
      : Math.max(Math.abs(max) * 0.002, minPadding);

  const lower = min - padding;
  const upper = max + padding;
  return [
    floor === null ? lower : Math.max(floor, lower),
    ceiling === null ? upper : Math.min(ceiling, upper),
  ];
};
