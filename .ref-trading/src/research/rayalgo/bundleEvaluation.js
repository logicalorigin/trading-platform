import { computeMetrics as computeBacktestMetrics } from "../engine/runtime.js";
import { parseMarketTimestamp } from "../market/time.js";

export const RAYALGO_VOLATILITY_BUCKETS = [
  { key: "v1", label: "0-10%", lower: 0, upper: 10 },
  { key: "v2", label: "10-25%", lower: 10, upper: 25 },
  { key: "v3", label: "25-75%", lower: 25, upper: 75 },
  { key: "v4", label: "75-90%", lower: 75, upper: 90 },
  { key: "v5", label: "90-100%", lower: 90, upper: 100 },
];

const SESSION_BUCKETS = [
  { key: "open", label: "Open", start: 570, end: 630 },
  { key: "morning", label: "Morning", start: 630, end: 720 },
  { key: "lunch", label: "Lunch", start: 720, end: 840 },
  { key: "afternoon", label: "Afternoon", start: 840, end: 900 },
  { key: "power", label: "Power Hour", start: 900, end: 960 },
];

function round(value, precision = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return +numeric.toFixed(precision);
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function quantile(sortedValues, percentile) {
  if (!Array.isArray(sortedValues) || !sortedValues.length) {
    return null;
  }
  const clamped = Math.max(0, Math.min(1, Number(percentile) || 0));
  const index = (sortedValues.length - 1) * clamped;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }
  const weight = index - lowerIndex;
  return sortedValues[lowerIndex] + (sortedValues[upperIndex] - sortedValues[lowerIndex]) * weight;
}

function deriveVolatilityThresholds(bars = []) {
  const values = (Array.isArray(bars) ? bars : [])
    .map((bar) => toFiniteNumber(bar?.vix))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!values.length) {
    return {
      p10: null,
      p25: null,
      p75: null,
      p90: null,
    };
  }
  return {
    p10: quantile(values, 0.10),
    p25: quantile(values, 0.25),
    p75: quantile(values, 0.75),
    p90: quantile(values, 0.90),
  };
}

function getSessionBucketKey(timestamp) {
  const text = String(timestamp || "").trim();
  const timeText = text.split(" ")[1] || "";
  const [hourText, minuteText] = timeText.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return "unknown";
  }
  const marketMinutes = hour * 60 + minute;
  const matched = SESSION_BUCKETS.find((bucket) => marketMinutes >= bucket.start && marketMinutes < bucket.end) || null;
  return matched?.key || "unknown";
}

function getSessionBucketLabel(key) {
  return SESSION_BUCKETS.find((bucket) => bucket.key === key)?.label || "Unknown";
}

function buildHoldoutSplit(trades = []) {
  const orderedTrades = [...(Array.isArray(trades) ? trades : [])]
    .sort((left, right) => {
      const leftTs = parseMarketTimestamp(left?.ts) || 0;
      const rightTs = parseMarketTimestamp(right?.ts) || 0;
      return leftTs - rightTs;
    });
  if (orderedTrades.length < 2) {
    return {
      inSampleTrades: orderedTrades,
      holdoutTrades: [],
    };
  }
  const splitIndex = Math.max(1, Math.min(orderedTrades.length - 1, Math.floor(orderedTrades.length * 0.7)));
  return {
    inSampleTrades: orderedTrades.slice(0, splitIndex),
    holdoutTrades: orderedTrades.slice(splitIndex),
  };
}

function computeTradeNetPnl(trade) {
  return round((Number(trade?.pnl) || 0) - (Number(trade?.commIn) || 0), 2) || 0;
}

function computeTradeRiskAmount(trade) {
  const entryPrice = Math.max(Number(trade?.oe) || 0, 0);
  const qty = Math.max(1, Number(trade?.qty) || 1);
  const stopPct = Math.max(0.01, Number(trade?.stopLossPctApplied) || 0.25);
  const fees = Math.max(0, Number(trade?.fees) || ((Number(trade?.commIn) || 0) + (Number(trade?.commOut) || 0)));
  const riskAmount = entryPrice * stopPct * 100 * qty + fees;
  return Math.max(riskAmount, 0.01);
}

function computeTradeRMultiple(trade) {
  const riskAmount = computeTradeRiskAmount(trade);
  if (!(riskAmount > 0)) {
    return null;
  }
  return round(computeTradeNetPnl(trade) / riskAmount, 3);
}

function buildSummaryFromTrades(trades = [], capital = 0) {
  const metrics = computeBacktestMetrics(trades, capital);
  const rMultiples = trades
    .map((trade) => computeTradeRMultiple(trade))
    .filter((value) => Number.isFinite(value));
  const expectancyR = rMultiples.length
    ? round(rMultiples.reduce((sum, value) => sum + value, 0) / rMultiples.length, 2)
    : null;
  const profitFactor = metrics.pf === "∞" ? 99 : Number(metrics.pf);

  return {
    trades: Number(metrics.n) || 0,
    expectancyR,
    maxDrawdownPct: round(metrics.dd, 1),
    winRatePct: round(metrics.wr, 1),
    profitFactor: Number.isFinite(profitFactor) ? round(profitFactor, 2) : null,
    netReturnPct: round(metrics.roi, 1),
    avgHoldBars: round(metrics.avgBars, 1),
    netPnl: round(metrics.pnl, 2),
  };
}

function groupTrades(trades = [], resolver = () => "unknown") {
  return (Array.isArray(trades) ? trades : []).reduce((summary, trade) => {
    const key = resolver(trade);
    if (!summary[key]) {
      summary[key] = [];
    }
    summary[key].push(trade);
    return summary;
  }, {});
}

function buildRowsFromGroupedTrades({
  groupedTrades = {},
  capital = 0,
  labelResolver = (key) => key,
  orderResolver = (left, right) => String(left).localeCompare(String(right)),
}) {
  return Object.entries(groupedTrades)
    .map(([key, bucketTrades]) => {
      const summary = buildSummaryFromTrades(bucketTrades, capital);
      return {
        key,
        label: labelResolver(key),
        ...summary,
      };
    })
    .sort((left, right) => orderResolver(left.key, right.key));
}

function getVolatilityBucketKey(vix, thresholds) {
  const numeric = toFiniteNumber(vix);
  if (!Number.isFinite(numeric)) {
    return "unknown";
  }
  if (thresholds.p10 != null && numeric <= thresholds.p10) return "v1";
  if (thresholds.p25 != null && numeric <= thresholds.p25) return "v2";
  if (thresholds.p75 != null && numeric <= thresholds.p75) return "v3";
  if (thresholds.p90 != null && numeric <= thresholds.p90) return "v4";
  return "v5";
}

function getVolatilityBucketLabel(key) {
  return RAYALGO_VOLATILITY_BUCKETS.find((bucket) => bucket.key === key)?.label || "Unknown";
}

function pickTopBadges(rows = []) {
  return rows
    .filter((row) => (row.trades || 0) >= 2 && Number(row.expectancyR) > 0)
    .sort((left, right) => {
      const leftScore = (Number(left.expectancyR) || 0) * Math.log((Number(left.trades) || 0) + 1);
      const rightScore = (Number(right.expectancyR) || 0) * Math.log((Number(right.trades) || 0) + 1);
      return rightScore - leftScore;
    })
    .slice(0, 2)
    .map((row) => row.label);
}

function buildValidation(fullSummary, holdoutSummary) {
  const tradeCount = Number(fullSummary?.trades) || 0;
  const holdoutExpectancy = Number(holdoutSummary?.expectancyR) || 0;
  const holdoutProfitFactor = Number(holdoutSummary?.profitFactor) || 0;
  const holdoutDrawdown = Number(holdoutSummary?.maxDrawdownPct) || 0;
  const fullDrawdown = Number(fullSummary?.maxDrawdownPct) || 0;
  const experimentalEligible = tradeCount >= 25
    && holdoutExpectancy > 0
    && holdoutProfitFactor > 1
    && holdoutDrawdown <= 25;
  const coreEligible = tradeCount >= 75
    && experimentalEligible
    && fullDrawdown <= 25;
  const tierSuggestion = coreEligible ? "core" : experimentalEligible ? "experimental" : "test";

  let statusText = "Awaiting validation";
  if (tradeCount === 0) {
    statusText = "No qualifying trades yet";
  } else if (coreEligible) {
    statusText = "Core thresholds met; manual approval required";
  } else if (experimentalEligible) {
    statusText = "Experimental thresholds met";
  } else if (tradeCount < 25) {
    statusText = `${tradeCount} trades; need 25 for experimental`;
  } else if (!(holdoutExpectancy > 0) || !(holdoutProfitFactor > 1)) {
    statusText = "Holdout expectancy still needs work";
  } else {
    statusText = "Drawdown too high for promotion";
  }

  return {
    experimentalEligible,
    coreEligible,
    tierSuggestion,
    statusText,
    checks: [
      {
        key: "experimental-trades",
        label: "25+ trades",
        passed: tradeCount >= 25,
        detail: `${tradeCount} trades`,
      },
      {
        key: "holdout-expectancy",
        label: "Holdout expectancy > 0R",
        passed: holdoutExpectancy > 0,
        detail: Number.isFinite(holdoutExpectancy) ? `${holdoutExpectancy.toFixed(2)}R` : "--",
      },
      {
        key: "holdout-pf",
        label: "Holdout PF > 1",
        passed: holdoutProfitFactor > 1,
        detail: Number.isFinite(holdoutProfitFactor) ? holdoutProfitFactor.toFixed(2) : "--",
      },
      {
        key: "drawdown",
        label: "Drawdown <= 25%",
        passed: holdoutDrawdown <= 25 && fullDrawdown <= 25,
        detail: `${Number.isFinite(fullDrawdown) ? fullDrawdown.toFixed(1) : "--"}% / ${Number.isFinite(holdoutDrawdown) ? holdoutDrawdown.toFixed(1) : "--"}%`,
      },
      {
        key: "core-trades",
        label: "75+ trades for core",
        passed: tradeCount >= 75,
        detail: `${tradeCount} trades`,
      },
    ],
  };
}

export function evaluateRayAlgoBundleRun({
  trades = [],
  bars = [],
  capital = 0,
  bundleId = null,
} = {}) {
  const safeTrades = Array.isArray(trades) ? trades : [];
  const fullSummary = buildSummaryFromTrades(safeTrades, capital);
  const { inSampleTrades, holdoutTrades } = buildHoldoutSplit(safeTrades);
  const inSampleSummary = buildSummaryFromTrades(inSampleTrades, capital);
  const holdoutSummary = buildSummaryFromTrades(holdoutTrades, capital);
  const volatilityThresholds = deriveVolatilityThresholds(bars);

  const sessionRows = buildRowsFromGroupedTrades({
    groupedTrades: groupTrades(safeTrades, (trade) => getSessionBucketKey(trade?.ts)),
    capital,
    labelResolver: getSessionBucketLabel,
    orderResolver: (left, right) => {
      const leftIndex = SESSION_BUCKETS.findIndex((bucket) => bucket.key === left);
      const rightIndex = SESSION_BUCKETS.findIndex((bucket) => bucket.key === right);
      return leftIndex - rightIndex;
    },
  });
  const regimeRows = buildRowsFromGroupedTrades({
    groupedTrades: groupTrades(safeTrades, (trade) => String(trade?.regime || "unknown")),
    capital,
    labelResolver: (key) => String(key || "unknown").replace(/^\w/, (char) => char.toUpperCase()),
    orderResolver: () => 0,
  }).sort((left, right) => (right.netPnl || 0) - (left.netPnl || 0));
  const volatilityRows = buildRowsFromGroupedTrades({
    groupedTrades: groupTrades(safeTrades, (trade) => getVolatilityBucketKey(trade?.vix, volatilityThresholds)),
    capital,
    labelResolver: getVolatilityBucketLabel,
    orderResolver: (left, right) => {
      const leftIndex = RAYALGO_VOLATILITY_BUCKETS.findIndex((bucket) => bucket.key === left);
      const rightIndex = RAYALGO_VOLATILITY_BUCKETS.findIndex((bucket) => bucket.key === right);
      return leftIndex - rightIndex;
    },
  });

  const validation = buildValidation(fullSummary, holdoutSummary);
  const summary = {
    tierSuggestion: validation.tierSuggestion,
    trades: fullSummary.trades,
    expectancyR: fullSummary.expectancyR,
    maxDrawdownPct: fullSummary.maxDrawdownPct,
    winRatePct: fullSummary.winRatePct,
    profitFactor: fullSummary.profitFactor,
    netReturnPct: fullSummary.netReturnPct,
    avgHoldBars: fullSummary.avgHoldBars,
    holdoutExpectancyR: holdoutSummary.expectancyR,
    holdoutProfitFactor: holdoutSummary.profitFactor,
    holdoutMaxDrawdownPct: holdoutSummary.maxDrawdownPct,
    sessionBadges: pickTopBadges(sessionRows),
    regimeBadges: pickTopBadges(regimeRows),
    statusText: validation.statusText,
    experimentalEligible: validation.experimentalEligible,
    coreEligible: validation.coreEligible,
  };

  return {
    bundleId: bundleId || null,
    summary,
    report: {
      fullSample: fullSummary,
      inSample: inSampleSummary,
      holdout: holdoutSummary,
      validation,
      sessions: sessionRows,
      regimes: regimeRows,
      volatility: volatilityRows,
      volatilityThresholds: {
        p10: round(volatilityThresholds.p10, 2),
        p25: round(volatilityThresholds.p25, 2),
        p75: round(volatilityThresholds.p75, 2),
        p90: round(volatilityThresholds.p90, 2),
      },
    },
  };
}
