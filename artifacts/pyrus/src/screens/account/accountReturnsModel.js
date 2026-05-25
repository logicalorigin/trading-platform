import {
  joinBenchmarkPercentSeries,
  normalizeEquityPointSeries,
} from "./equityCurveData.js";
import {
  calculateTransferAdjustedReturnSummary,
  transferAdjustedPnlDelta,
} from "@workspace/account-math";
import { getOpenPositionRows } from "../../features/account/accountPositionRows.js";

const DEFAULT_BENCHMARK_LABELS = {
  SPY: "SPY",
  QQQ: "QQQ",
  DJIA: "DJIA",
  DIA: "DJIA",
};

const finiteNumber = (value) => {
  if (value == null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const sumFinite = (values) =>
  values.reduce((sum, value) => {
    const numeric = finiteNumber(value);
    return numeric == null ? sum : sum + numeric;
  }, 0);

const lastFinite = (values) => {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const numeric = finiteNumber(values[index]);
    if (numeric != null) {
      return numeric;
    }
  }
  return null;
};

const percentChange = (current, previous) => {
  const currentValue = finiteNumber(current);
  const previousValue = finiteNumber(previous);
  if (currentValue == null || previousValue == null || previousValue === 0) {
    return null;
  }
  return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
};

const standardDeviation = (values) => {
  const normalized = values.map(finiteNumber).filter((value) => value != null);
  if (normalized.length < 2) {
    return null;
  }
  const mean =
    normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
  const variance =
    normalized.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (normalized.length - 1);
  return Math.sqrt(variance);
};

const average = (values) => {
  const normalized = values.map(finiteNumber).filter((value) => value != null);
  if (!normalized.length) {
    return null;
  }
  return normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
};

export const holdDurationBucket = (minutes) => {
  const value = finiteNumber(minutes);
  if (value == null) return "Unknown";
  if (value < 24 * 60) return "Intraday";
  if (value < 7 * 24 * 60) return "Swing";
  return "Position";
};

const buildDrawdown = (points) => {
  let highWaterMark = null;
  let maxDrawdownPercent = 0;
  let maxDrawdownAmount = 0;

  points.forEach((point) => {
    const nav = finiteNumber(point.netLiquidation);
    if (nav == null) return;
    if (highWaterMark == null || nav > highWaterMark) {
      highWaterMark = nav;
    }
    if (!highWaterMark) return;
    const drawdownAmount = nav - highWaterMark;
    const drawdownPercent = (drawdownAmount / highWaterMark) * 100;
    if (drawdownPercent < maxDrawdownPercent) {
      maxDrawdownPercent = drawdownPercent;
      maxDrawdownAmount = drawdownAmount;
    }
  });

  const lastPoint = points[points.length - 1] || null;
  const currentDrawdownPercent =
    lastPoint && highWaterMark
      ? ((lastPoint.netLiquidation - highWaterMark) / highWaterMark) * 100
      : null;
  const currentDrawdownAmount =
    lastPoint && highWaterMark ? lastPoint.netLiquidation - highWaterMark : null;

  return {
    highWaterMark,
    currentDrawdownAmount,
    currentDrawdownPercent,
    maxDrawdownAmount,
    maxDrawdownPercent,
  };
};

const buildBenchmarkDeltas = ({ points, benchmarkHistories, range, returnPercent }) =>
  Object.entries(benchmarkHistories || {})
    .map(([key, history]) => {
      const benchmarkRangeMatches = !history?.range || !range || history.range === range;
      const aligned = benchmarkRangeMatches
        ? joinBenchmarkPercentSeries(points, history?.points || [], range)
        : [];
      const benchmarkReturnPercent = lastFinite(aligned);
      if (benchmarkReturnPercent == null) {
        return null;
      }
      return {
        key,
        label: DEFAULT_BENCHMARK_LABELS[key] || key,
        returnPercent: benchmarkReturnPercent,
        deltaPercent:
          returnPercent == null ? null : returnPercent - benchmarkReturnPercent,
      };
    })
    .filter(Boolean);

const buildRiskStats = (points) => {
  const pointReturns = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = finiteNumber(points[index - 1]?.netLiquidation);
    const pnlDelta = transferAdjustedPnlDelta(points[index], points[index - 1]);
    const change =
      previous == null || previous === 0 || pnlDelta == null
        ? null
        : (pnlDelta / Math.abs(previous)) * 100;
    if (change != null) {
      pointReturns.push(change);
    }
  }

  const meanReturnPercent = average(pointReturns);
  const volatilityPercent = standardDeviation(pointReturns);
  const downsideReturns = pointReturns.filter((value) => value < 0);
  const downsideVolatilityPercent = downsideReturns.length
    ? Math.sqrt(
        downsideReturns.reduce((sum, value) => sum + value ** 2, 0) /
          downsideReturns.length,
      )
    : null;
  const sampleScale = pointReturns.length > 1 ? Math.sqrt(pointReturns.length) : 1;

  return {
    sampleSize: pointReturns.length,
    meanReturnPercent,
    volatilityPercent,
    downsideVolatilityPercent,
    sharpeLike:
      meanReturnPercent == null || !volatilityPercent
        ? null
        : (meanReturnPercent / volatilityPercent) * sampleScale,
    sortinoLike:
      meanReturnPercent == null || !downsideVolatilityPercent
        ? null
        : (meanReturnPercent / downsideVolatilityPercent) * sampleScale,
  };
};

const PNL_BAR_LIMIT = 28;
const RETURN_PERCENT_TOLERANCE = 0.01;

const buildPnlBars = (points, limit = PNL_BAR_LIMIT) => {
  if (!Array.isArray(points) || points.length < 2 || limit <= 0) {
    return [];
  }

  const changes = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = finiteNumber(points[index - 1]?.netLiquidation);
    const pnlDelta = transferAdjustedPnlDelta(points[index], points[index - 1]);
    if (previous == null || pnlDelta == null) {
      continue;
    }
    changes.push({
      timestamp: points[index]?.timestamp ?? null,
      timestampMs: points[index]?.timestampMs ?? null,
      value: pnlDelta,
      returnPercent: previous === 0 ? null : (pnlDelta / Math.abs(previous)) * 100,
    });
  }

  if (!changes.length) {
    return [];
  }

  const bucketSize = changes.length / Math.min(limit, changes.length);
  const sampled = [];
  for (let bucketIndex = 0; bucketIndex < Math.min(limit, changes.length); bucketIndex += 1) {
    const start = Math.floor(bucketIndex * bucketSize);
    const end = Math.max(start + 1, Math.floor((bucketIndex + 1) * bucketSize));
    const bucket = changes.slice(start, end);
    const last = bucket[bucket.length - 1];
    const value = sumFinite(bucket.map((item) => item.value));
    const firstPrevious = finiteNumber(points[start]?.netLiquidation);
    const returnPercent =
      firstPrevious == null || firstPrevious === 0
        ? null
        : (value / Math.abs(firstPrevious)) * 100;
    sampled.push({
      timestamp: last?.timestamp ?? null,
      timestampMs: last?.timestampMs ?? null,
      value,
      returnPercent,
    });
  }

  const maxAbs = sampled.reduce(
    (max, item) => Math.max(max, Math.abs(item.value)),
    0,
  );

  return sampled.map((item) => ({
    ...item,
    direction: item.value > 0 ? "up" : item.value < 0 ? "down" : "flat",
    magnitude: maxAbs > 0 ? Math.abs(item.value) / maxAbs : 0,
  }));
};

const buildGroupRows = (trades, keyFn) => {
  const groups = new Map();
  trades.forEach((trade) => {
    const label = keyFn(trade) || "Unknown";
    const current = groups.get(label) || {
      label,
      count: 0,
      winners: 0,
      losers: 0,
      realizedPnl: 0,
      commissions: 0,
    };
    const pnl = finiteNumber(trade.realizedPnl) ?? 0;
    current.count += 1;
    current.realizedPnl += pnl;
    current.commissions += finiteNumber(trade.commissions) ?? 0;
    if (pnl > 0) current.winners += 1;
    if (pnl < 0) current.losers += 1;
    groups.set(label, current);
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      winRate: group.count ? (group.winners / group.count) * 100 : null,
      averagePnl: group.count ? group.realizedPnl / group.count : null,
    }))
    .sort((left, right) => Math.abs(right.realizedPnl) - Math.abs(left.realizedPnl));
};

const buildTradeStats = (trades = []) => {
  const realizedValues = trades.map((trade) => finiteNumber(trade.realizedPnl) ?? 0);
  const winners = realizedValues.filter((value) => value > 0);
  const losers = realizedValues.filter((value) => value < 0);
  const grossProfit = sumFinite(winners);
  const grossLoss = sumFinite(losers);
  const realizedPnl = sumFinite(realizedValues);
  const count = trades.length;

  return {
    count,
    winners: winners.length,
    losers: losers.length,
    winRate: count ? (winners.length / count) * 100 : null,
    grossProfit,
    grossLoss,
    realizedPnl,
    commissions: sumFinite(trades.map((trade) => trade.commissions)),
    profitFactor: grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : null,
    expectancy: count ? realizedPnl / count : null,
    averageWin: winners.length ? grossProfit / winners.length : null,
    averageLoss: losers.length ? grossLoss / losers.length : null,
    groups: {
      symbols: buildGroupRows(trades, (trade) => trade.symbol),
      strategies: buildGroupRows(
        trades,
        (trade) => trade.strategyLabel || trade.sourceType || trade.source,
      ),
      assetClasses: buildGroupRows(trades, (trade) => trade.assetClass),
      holdBuckets: buildGroupRows(trades, (trade) =>
        holdDurationBucket(trade.holdDurationMinutes),
      ),
    },
  };
};

const metricNumber = (summary, key) =>
  finiteNumber(summary?.metrics?.[key]?.value);

export const buildAccountReturnsModel = ({
  summary,
  equityHistory,
  benchmarkHistories = {},
  positionsResponse,
  tradesResponse,
  cashResponse,
  range,
} = {}) => {
  const points = normalizeEquityPointSeries(equityHistory?.points || []);
  const firstPoint = points[0] || null;
  const lastPoint = points[points.length - 1] || null;
  const navDelta =
    firstPoint && lastPoint ? lastPoint.netLiquidation - firstPoint.netLiquidation : null;
  const navReturnPercent =
    firstPoint && lastPoint
      ? percentChange(lastPoint.netLiquidation, firstPoint.netLiquidation)
      : null;
  const providerReturnPercent = finiteNumber(lastPoint?.returnPercent);
  const adjustedSummary = firstPoint
    ? calculateTransferAdjustedReturnSummary(points)
    : null;
  const adjustedStartNav = adjustedSummary?.transferAdjustedStartNav ?? null;
  const adjustedCapitalBase = adjustedSummary?.capitalBase ?? null;
  const adjustedPnl = adjustedSummary?.cumulativePnl ?? null;
  const transferAdjustedReturnPercent = adjustedSummary?.returnPercent ?? null;
  const returnPercentDiscrepancy =
    providerReturnPercent != null &&
    transferAdjustedReturnPercent != null &&
    Math.abs(providerReturnPercent - transferAdjustedReturnPercent) >
      RETURN_PERCENT_TOLERANCE;
  const returnPercent = returnPercentDiscrepancy
    ? transferAdjustedReturnPercent
    : (providerReturnPercent ?? transferAdjustedReturnPercent);
  const returnPercentSource = returnPercentDiscrepancy
    ? "recomputed"
    : providerReturnPercent != null
      ? "provider"
      : "recomputed";
  const drawdown = buildDrawdown(points);
  const riskStats = buildRiskStats(points);
  const trades = tradesResponse?.trades || [];
  const tradeStats = buildTradeStats(trades);
  const positions = getOpenPositionRows(positionsResponse?.positions || []);
  const unrealizedPnl =
    Array.isArray(positionsResponse?.positions)
      ? sumFinite(positions.map((position) => position.unrealizedPnl))
      : (finiteNumber(positionsResponse?.totals?.unrealizedPnl) ??
        sumFinite(positions.map((position) => position.unrealizedPnl)));
  const netLiquidation =
    metricNumber(summary, "netLiquidation") ?? finiteNumber(lastPoint?.netLiquidation);
  const totalCash =
    metricNumber(summary, "totalCash") ?? finiteNumber(cashResponse?.totalCash);
  const totalPnl = metricNumber(summary, "totalPnl");
  const dayPnl = metricNumber(summary, "dayPnl");

  return {
    range: range || equityHistory?.range || null,
    equity: {
      pointCount: points.length,
      firstTimestamp: firstPoint?.timestamp ?? null,
      lastTimestamp: lastPoint?.timestamp ?? null,
      startNav: finiteNumber(firstPoint?.netLiquidation),
      transferAdjustedStartNav: adjustedStartNav,
      transferAdjustedCapitalBase: adjustedCapitalBase,
      endNav: finiteNumber(lastPoint?.netLiquidation),
      netLiquidation,
      navDelta,
      navReturnPercent,
      transferAdjustedPnl: adjustedPnl,
      transferAdjustedReturnPercent,
      providerReturnPercent,
      returnPercentDiscrepancy,
      returnPercentSource,
      returnPercent,
      ...drawdown,
      pnlBars: buildPnlBars(points),
      benchmarkDeltas: buildBenchmarkDeltas({
        points,
        benchmarkHistories,
        range,
        returnPercent,
      }),
    },
    trades: tradeStats,
    positions: {
      count: positions.length,
      unrealizedPnl,
      totalPnl,
      dayPnl,
    },
    cash: {
      totalCash,
      cashWeightPercent:
        totalCash == null || !netLiquidation
          ? null
          : (totalCash / netLiquidation) * 100,
      dividendsMonth: finiteNumber(cashResponse?.dividendsMonth),
      dividendsYtd: finiteNumber(cashResponse?.dividendsYtd),
      interestYtd: finiteNumber(cashResponse?.interestPaidEarnedYtd),
      feesYtd: finiteNumber(cashResponse?.feesYtd),
    },
    risk: riskStats,
    available: {
      hasEquity: points.length > 0,
      hasRiskAdjustedStats: riskStats.sampleSize >= 2,
      hasTrades: trades.length > 0,
      hasBenchmarks: Object.keys(benchmarkHistories || {}).length > 0,
    },
  };
};
