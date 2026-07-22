import { normalizeEquityPointSeries } from "./equityCurveData.js";
import {
  calculateTransferAdjustedReturnSummary,
  transferAdjustedPnlDelta,
} from "@workspace/account-math";
import { getOpenPositionRows } from "../../features/account/accountPositionRows.js";

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

const sumComplete = (values) => {
  if (!values.length) return null;
  const finiteValues = values.map(finiteNumber);
  return finiteValues.every((value) => value != null)
    ? finiteValues.reduce((sum, value) => sum + value, 0)
    : null;
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

const buildDrawdown = (points) => {
  const navs = points
    .map((point) => finiteNumber(point?.netLiquidation))
    .filter((value) => value != null);
  if (!navs.length) {
    return {
      currentDrawdownAmount: null,
      currentDrawdownPercent: null,
      maxDrawdownAmount: null,
      maxDrawdownPercent: null,
    };
  }
  let highWaterMark = null;
  let maxDrawdownPercent = 0;
  let maxDrawdownAmount = 0;

  navs.forEach((nav) => {
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

  const lastNav = navs[navs.length - 1];
  const currentDrawdownPercent =
    highWaterMark
      ? ((lastNav - highWaterMark) / highWaterMark) * 100
      : null;
  const currentDrawdownAmount =
    highWaterMark ? lastNav - highWaterMark : null;

  return {
    currentDrawdownAmount,
    currentDrawdownPercent,
    maxDrawdownAmount,
    maxDrawdownPercent,
  };
};

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
    volatilityPercent,
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

const RETURN_PERCENT_TOLERANCE = 0.01;

const buildTradeStats = (trades) => {
  if (!Array.isArray(trades)) {
    return {
      count: null,
      outcomeCount: null,
      winners: null,
      losers: null,
      winRate: null,
      realizedPnl: null,
      profitFactor: null,
      expectancy: null,
    };
  }
  const realizedValues = trades
    .map((trade) => finiteNumber(trade.realizedPnl))
    .filter((value) => value != null);
  const winners = realizedValues.filter((value) => value > 0);
  const losers = realizedValues.filter((value) => value < 0);
  const grossProfit = sumFinite(winners);
  const grossLoss = sumFinite(losers);
  const realizedPnl = sumFinite(realizedValues);
  const count = trades.length;
  const outcomeCount = realizedValues.length;
  const outcomesComplete = count > 0 && outcomeCount === count;
  const completeGrossProfit = outcomesComplete ? grossProfit : null;
  const completeGrossLoss = outcomesComplete ? grossLoss : null;
  const completeRealizedPnl = outcomesComplete ? realizedPnl : null;

  return {
    count,
    outcomeCount,
    winners: winners.length,
    losers: losers.length,
    winRate: outcomesComplete ? (winners.length / outcomeCount) * 100 : null,
    realizedPnl: completeRealizedPnl,
    profitFactor:
      completeGrossLoss != null && completeGrossLoss < 0
        ? completeGrossProfit / Math.abs(completeGrossLoss)
        : null,
    expectancy: outcomesComplete ? completeRealizedPnl / outcomeCount : null,
  };
};

export const buildAccountReturnsModel = ({
  equityHistory,
  positionsResponse,
  tradesResponse,
  cashResponse,
  range,
} = {}) => {
  const points = normalizeEquityPointSeries(equityHistory?.points || []);
  const firstPoint = points[0] || null;
  const lastPoint = points[points.length - 1] || null;
  const providerReturnPercent = finiteNumber(lastPoint?.returnPercent);
  const adjustedSummary = firstPoint
    ? calculateTransferAdjustedReturnSummary(points)
    : null;
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
  const drawdown = buildDrawdown(points);
  const { sampleSize: riskSampleSize, ...riskStats } = buildRiskStats(points);
  const tradeStats = buildTradeStats(tradesResponse?.trades);
  const positionsKnown = Array.isArray(positionsResponse?.positions);
  const positions = positionsKnown
    ? getOpenPositionRows(positionsResponse.positions)
    : [];
  // Prefer the per-row sum when open rows carry finite unrealized P&L; otherwise
  // fall back to the response totals. When there is no positions response at all
  // (loading/errored/degraded), stay null so the KPI renders "—" instead of a
  // false "+$0". A present response with no open rows and no totals is genuinely
  // unknown, not zero.
  const unrealizedPnl = positionsResponse
    ? (sumComplete(positions.map((position) => position.unrealizedPnl)) ??
      finiteNumber(positionsResponse?.totals?.unrealizedPnl))
    : null;
  return {
    range: range || equityHistory?.range || null,
    equity: {
      transferAdjustedPnl: adjustedPnl,
      providerReturnPercent,
      returnPercentDiscrepancy,
      returnPercent,
      ...drawdown,
    },
    trades: tradeStats,
    positions: {
      count: positionsKnown ? positions.length : null,
      unrealizedPnl,
    },
    cash: {
      dividendsYtd: finiteNumber(cashResponse?.dividendsYtd),
      interestYtd: finiteNumber(cashResponse?.interestPaidEarnedYtd),
      feesYtd: finiteNumber(cashResponse?.feesYtd),
    },
    risk: riskStats,
    available: {
      hasRiskAdjustedStats: riskSampleSize >= 2,
    },
  };
};
