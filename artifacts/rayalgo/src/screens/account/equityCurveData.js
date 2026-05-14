import {
  buildTransferAdjustedPnlSeries as buildSharedTransferAdjustedPnlSeries,
} from "@workspace/account-math";

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

export const equityRangeResponseMatches = (response, range) =>
  Boolean(response) && (!response.range || !range || response.range === range);

export const resolveStableEquityRangeResponse = ({
  response,
  fallback = null,
  range,
  acceptResponse = true,
} = {}) =>
  equityRangeResponseMatches(response, range)
    ? acceptResponse
      ? response
      : fallback ?? response
    : fallback;

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

export const buildTransferAdjustedPnlSeries = (points = []) =>
  buildSharedTransferAdjustedPnlSeries(points);

export const buildEquityCurvePointSummary = (points = []) => {
  const firstPoint = points[0] || null;
  const lastPoint = points[points.length - 1] || null;
  if (!points.length) {
    return {
      firstPoint,
      lastPoint,
      minNav: null,
      maxNav: null,
      minPnl: null,
      maxPnl: null,
      transferAdjustedPnl: null,
    };
  }

  let minNav = null;
  let maxNav = null;
  let minPnl = null;
  let maxPnl = null;

  points.forEach((point) => {
    const nav = finiteNumber(point?.netLiquidation);
    if (nav !== null) {
      minNav = minNav === null ? nav : Math.min(minNav, nav);
      maxNav = maxNav === null ? nav : Math.max(maxNav, nav);
    }

    const pnl = finiteNumber(point?.cumulativePnl ?? 0);
    if (pnl !== null) {
      minPnl = minPnl === null ? pnl : Math.min(minPnl, pnl);
      maxPnl = maxPnl === null ? pnl : Math.max(maxPnl, pnl);
    }
  });

  return {
    firstPoint,
    lastPoint,
    minNav,
    maxNav,
    minPnl,
    maxPnl,
    transferAdjustedPnl: finiteNumber(lastPoint?.cumulativePnl),
  };
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
  const matchedSeries = equityPoints.map((point) => {
    const match = findNearestEquityPoint(
      benchmarkSeries,
      point.timestampMs,
      toleranceMs,
    );
    return match?.benchmarkPercent ?? null;
  });
  const baseline = matchedSeries.find((value) => value != null);
  if (baseline == null) {
    return matchedSeries;
  }
  return matchedSeries.map((value) => {
    if (value == null) {
      return null;
    }
    const rebased = value - baseline;
    if (Math.abs(rebased) < 1e-9) {
      return 0;
    }
    return Number(rebased.toFixed(10));
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

export const buildAnchoredValueDomain = (
  values = [],
  {
    anchorValue = 0,
    anchorRatio = 0.5,
    paddingRatio = 0.08,
    minPadding = 1,
    floor = null,
    ceiling = null,
  } = {},
) => {
  const [baseMin, baseMax] = buildPaddedValueDomain(values, {
    paddingRatio,
    minPadding,
    floor,
    ceiling,
  });
  if (!Number.isFinite(baseMin) || !Number.isFinite(baseMax)) {
    return [baseMin, baseMax];
  }

  const clampedRatio = Math.min(0.999, Math.max(0.001, Number(anchorRatio) || 0.5));
  const neededAbove = Math.max(0, baseMax - anchorValue);
  const neededBelow = Math.max(0, anchorValue - baseMin);
  const scale = Math.max(
    neededAbove / clampedRatio,
    neededBelow / (1 - clampedRatio),
  );

  if (!Number.isFinite(scale) || scale <= 0) {
    return [baseMin, baseMax];
  }

  const upper = anchorValue + scale * clampedRatio;
  const lower = anchorValue - scale * (1 - clampedRatio);
  return [
    floor === null ? lower : Math.max(floor, lower),
    ceiling === null ? upper : Math.min(ceiling, upper),
  ];
};
