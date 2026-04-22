#!/usr/bin/env node

import fs from "fs";
import path from "path";

import { STRATEGY_PRESETS } from "../src/research/config/strategyPresets.js";
import { aggregateBarsToMinutes } from "../src/research/data/aggregateBars.js";
import {
  computeMetrics,
  detectRegimes,
  RISK_STOP_DISABLED,
  RISK_STOP_LEGACY_HALT,
  runBacktest,
} from "../src/research/engine/runtime.js";
import { formatMarketDateLabel } from "../src/research/market/time.js";
import { parseOptionTicker } from "../src/research/options/optionTicker.js";
import { buildResearchTradeId } from "../src/research/trades/selection.js";
import { runMassiveOptionReplayBacktest } from "../server/services/researchBacktest.js";
import { resolveResearchSpotHistory } from "../server/services/researchSpotHistory.js";

const DEFAULT_SYMBOL = "SPY";
const DEFAULT_CAPITAL = 10000;
const DEFAULT_RUNTIME_CAPITAL = 25000;
const DEFAULT_OUT_DIR = "output/pnl-integrity-audit";
const DEFAULT_INITIAL_DAYS = 45;
const MONEY_TOLERANCE = 0.01;

const EXIT_PRESETS = {
  scalp: { slPct: 0.15, tpPct: 0.20, trailStartPct: 0.05, trailPct: 0.10 },
  tight: { slPct: 0.20, tpPct: 0.28, trailStartPct: 0.06, trailPct: 0.15 },
  moderate: { slPct: 0.25, tpPct: 0.35, trailStartPct: 0.08, trailPct: 0.18 },
  wide: { slPct: 0.45, tpPct: 0.70, trailStartPct: 0.12, trailPct: 0.22 },
  runner: { slPct: 0.30, tpPct: 2.0, trailStartPct: 0.20, trailPct: 0.30 },
  lotto: { slPct: 0.60, tpPct: 5.0, trailStartPct: 0.50, trailPct: 0.50 },
};

function parseArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  if (!hit) {
    return fallback;
  }
  return hit.slice(prefix.length).trim();
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundTo(value, digits = 2) {
  return Number(toFiniteNumber(value, 0).toFixed(digits));
}

function sameNumber(left, right, tolerance = MONEY_TOLERANCE) {
  if (!Number.isFinite(Number(left)) && !Number.isFinite(Number(right))) {
    return true;
  }
  if (!Number.isFinite(Number(left)) || !Number.isFinite(Number(right))) {
    return false;
  }
  return Math.abs(Number(left) - Number(right)) <= tolerance;
}

function compareTs(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function getApiKey() {
  return String(process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || "").trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compactConfig(config = {}) {
  return {
    strategy: config.strategy || null,
    executionMode: config.executionMode || null,
    executionFidelity: config.executionFidelity || null,
    dte: toFiniteNumber(config.dte, null),
    iv: toFiniteNumber(config.iv, null),
    slPct: toFiniteNumber(config.slPct, null),
    tpPct: toFiniteNumber(config.tpPct, null),
    trailStartPct: toFiniteNumber(config.trailStartPct, null),
    trailPct: toFiniteNumber(config.trailPct, null),
    zombieBars: toFiniteNumber(config.zombieBars, null),
    minConviction: toFiniteNumber(config.minConviction, null),
    allowShorts: Boolean(config.allowShorts),
    regimeFilter: config.regimeFilter || null,
    maxPositions: toFiniteNumber(config.maxPositions, null),
    commPerContract: toFiniteNumber(config.commPerContract, null),
    slipBps: toFiniteNumber(config.slipBps, null),
    riskStopPolicy: config.riskStopPolicy || null,
    optionSelectionSpec: config.optionSelectionSpec || null,
  };
}

function summarizeTrades(trades = []) {
  const exitReasonCounts = {};
  for (const trade of Array.isArray(trades) ? trades : []) {
    const reason = String(trade?.er || "unknown");
    exitReasonCounts[reason] = (exitReasonCounts[reason] || 0) + 1;
  }
  const firstTrade = Array.isArray(trades) && trades.length
    ? {
      entryAt: trades[0]?.ts || null,
      exitAt: trades[0]?.et || null,
      exitReason: trades[0]?.er || null,
      tradeId: trades[0]?.tradeId || trades[0]?.tradeSelectionId || null,
      pnl: roundTo(trades[0]?.pnl, 2),
      commIn: roundTo(trades[0]?.commIn, 2),
      commOut: roundTo(trades[0]?.commOut, 2),
      qty: toFiniteNumber(trades[0]?.qty, null),
      optionTicker: trades[0]?.optionTicker || null,
    }
    : null;

  return {
    tradeCount: Array.isArray(trades) ? trades.length : 0,
    exitReasonCounts,
    firstTrade,
  };
}

function calculateExpectedTradePnl(trade = {}) {
  const entryFill = toFiniteNumber(trade?.oe, NaN);
  const exitFill = toFiniteNumber(trade?.exitFill, NaN);
  const qty = toFiniteNumber(trade?.qty, NaN);
  const commOut = toFiniteNumber(trade?.commOut, NaN);
  if (![entryFill, exitFill, qty, commOut].every((value) => Number.isFinite(value))) {
    return null;
  }
  return (exitFill - entryFill) * 100 * qty - commOut;
}

function calculateExpectedTradeCost(trade = {}) {
  const entryFill = toFiniteNumber(trade?.oe, NaN);
  const qty = toFiniteNumber(trade?.qty, NaN);
  if (![entryFill, qty].every((value) => Number.isFinite(value))) {
    return null;
  }
  return entryFill * 100 * qty;
}

function calculateExpectedExitCredit(trade = {}) {
  const exitFill = toFiniteNumber(trade?.exitFill, NaN);
  const qty = toFiniteNumber(trade?.qty, NaN);
  const commOut = toFiniteNumber(trade?.commOut, NaN);
  if (![exitFill, qty, commOut].every((value) => Number.isFinite(value))) {
    return null;
  }
  return exitFill * 100 * qty - commOut;
}

function buildManualMetrics(trades = [], capital = DEFAULT_CAPITAL) {
  if (!Array.isArray(trades) || !trades.length) {
    return {
      pnl: 0,
      roi: 0,
      wr: 0,
      w: 0,
      l: 0,
      pf: 0,
      avgW: 0,
      avgL: 0,
      exp: 0,
      dd: 0,
      sharpe: 0,
      n: 0,
      streak: 0,
      avgBars: 0,
      totalFees: 0,
    };
  }

  let peak = capital;
  let drawdown = 0;
  let balance = capital;
  let wins = 0;
  let losses = 0;
  let winnerPnl = 0;
  let loserPnl = 0;
  let streak = 0;
  let maxStreak = 0;
  let totalBars = 0;
  let totalFees = 0;
  const returns = [];

  for (const trade of trades) {
    const net = toFiniteNumber(trade?.pnl, 0) - toFiniteNumber(trade?.commIn, 0);
    balance += net;
    returns.push(net);
    totalBars += toFiniteNumber(trade?.bh, 0);
    totalFees += toFiniteNumber(trade?.fees, 0);
    if (net > 0) {
      wins += 1;
      winnerPnl += net;
      streak = 0;
    } else {
      losses += 1;
      loserPnl += net;
      streak += 1;
      maxStreak = Math.max(maxStreak, streak);
    }
    peak = Math.max(peak, balance);
    drawdown = Math.max(drawdown, peak > 0 ? ((peak - balance) / peak) * 100 : 0);
  }

  const totalPnl = balance - capital;
  const avgWinner = wins > 0 ? winnerPnl / wins : 0;
  const avgLoser = losses > 0 ? loserPnl / losses : 0;
  const winRate = (wins / trades.length) * 100;
  const expectancy = (winRate / 100) * avgWinner + (1 - winRate / 100) * avgLoser;
  const profitFactor = loserPnl !== 0 ? Math.abs(winnerPnl / loserPnl) : wins > 0 ? 99 : 0;
  const meanReturn = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const stdDev = Math.sqrt(
    returns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / returns.length,
  );
  const sharpe = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(returns.length) : 0;

  return {
    pnl: +totalPnl.toFixed(0),
    roi: +(totalPnl / capital * 100).toFixed(1),
    wr: +winRate.toFixed(1),
    w: wins,
    l: losses,
    pf: profitFactor > 50 ? "∞" : +profitFactor.toFixed(2),
    avgW: +avgWinner.toFixed(0),
    avgL: +avgLoser.toFixed(0),
    exp: +expectancy.toFixed(2),
    dd: +drawdown.toFixed(1),
    sharpe: +sharpe.toFixed(2),
    n: trades.length,
    streak: maxStreak,
    avgBars: trades.length ? +(totalBars / trades.length).toFixed(0) : 0,
    totalFees: +totalFees.toFixed(0),
  };
}

function auditTradeLedger(trades = []) {
  const failures = [];

  for (let index = 0; index < trades.length; index += 1) {
    const trade = trades[index];
    const tradeId = trade?.optionTicker || trade?.ts || `trade-${index + 1}`;
    const expectedPnl = calculateExpectedTradePnl(trade);
    if (expectedPnl == null) {
      failures.push({
        code: "trade_missing_fill_fields",
        tradeIndex: index,
        tradeId,
        message: "Trade is missing entry or exit fill fields required for PnL reconciliation.",
      });
      continue;
    }

    if (!sameNumber(trade?.pnl, expectedPnl)) {
      failures.push({
        code: "trade_pnl_mismatch",
        tradeIndex: index,
        tradeId,
        message: "Trade pnl does not reconcile from fills, quantity, and exit commission.",
        expected: roundTo(expectedPnl, 2),
        actual: roundTo(trade?.pnl, 2),
      });
    }

    const expectedCost = calculateExpectedTradeCost(trade);
    if (expectedCost != null && !sameNumber(trade?.cost, expectedCost)) {
      failures.push({
        code: "trade_cost_mismatch",
        tradeIndex: index,
        tradeId,
        message: "Trade cost does not reconcile from entry fill and quantity.",
        expected: roundTo(expectedCost, 2),
        actual: roundTo(trade?.cost, 2),
      });
    }

    const expectedFees = toFiniteNumber(trade?.commIn, 0) + toFiniteNumber(trade?.commOut, 0);
    if (!sameNumber(trade?.fees, expectedFees)) {
      failures.push({
        code: "trade_fees_mismatch",
        tradeIndex: index,
        tradeId,
        message: "Trade fees do not match entry plus exit commissions.",
        expected: roundTo(expectedFees, 2),
        actual: roundTo(trade?.fees, 2),
      });
    }

    const expectedExitCredit = calculateExpectedExitCredit(trade);
    const actualExitCredit = toFiniteNumber(trade?.cost, 0) + toFiniteNumber(trade?.pnl, 0);
    if (expectedExitCredit != null && !sameNumber(actualExitCredit, expectedExitCredit)) {
      failures.push({
        code: "trade_exit_credit_mismatch",
        tradeIndex: index,
        tradeId,
        message: "Trade exit cash credit does not reconcile from exit fill and exit commission.",
        expected: roundTo(expectedExitCredit, 2),
        actual: roundTo(actualExitCredit, 2),
      });
    }
  }

  return failures;
}

function auditMetricShape(actual = {}, expected = {}, metricSource = "metrics") {
  const failures = [];
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual?.[key];
    if (typeof expectedValue === "number") {
      if (!sameNumber(actualValue, expectedValue)) {
        failures.push({
          code: `${metricSource}_${key}_mismatch`,
          message: `Metric ${key} did not match expected value.`,
          expected: expectedValue,
          actual: actualValue,
        });
      }
      continue;
    }
    if (actualValue !== expectedValue) {
      failures.push({
        code: `${metricSource}_${key}_mismatch`,
        message: `Metric ${key} did not match expected value.`,
        expected: expectedValue,
        actual: actualValue,
      });
    }
  }
  return failures;
}

function auditTradeContractSemantics(trades = []) {
  const failures = [];

  for (let index = 0; index < trades.length; index += 1) {
    const trade = trades[index];
    const optionTicker = String(trade?.optionTicker || "").trim();
    if (!optionTicker || !/^O:/i.test(optionTicker)) {
      continue;
    }

    const parsed = parseOptionTicker(optionTicker);
    if (!parsed) {
      failures.push({
        code: "trade_option_ticker_unparseable",
        tradeIndex: index,
        tradeId: optionTicker,
        message: "Trade option ticker could not be parsed.",
      });
      continue;
    }

    const tradeExpiry = String(trade?.expiryDate || "").trim();
    if (tradeExpiry && parsed.expiry !== tradeExpiry) {
      failures.push({
        code: "trade_expiry_mismatch",
        tradeIndex: index,
        tradeId: optionTicker,
        message: "Trade expiryDate does not match parsed option ticker expiry.",
        expected: parsed.expiry,
        actual: tradeExpiry,
      });
    }

    const tradeStrike = Number(trade?.k);
    if (Number.isFinite(tradeStrike) && !sameNumber(tradeStrike, parsed.strike, 0.001)) {
      failures.push({
        code: "trade_strike_mismatch",
        tradeIndex: index,
        tradeId: optionTicker,
        message: "Trade strike does not match parsed option ticker strike.",
        expected: parsed.strike,
        actual: tradeStrike,
      });
    }

    const expectedRight = String(trade?.dir || "").trim().toLowerCase() === "short" ? "put" : "call";
    if (parsed.right !== expectedRight) {
      failures.push({
        code: "trade_right_mismatch",
        tradeIndex: index,
        tradeId: optionTicker,
        message: "Trade direction does not match parsed option ticker right.",
        expected: expectedRight,
        actual: parsed.right,
      });
    }
  }

  return failures;
}

function auditTradeIdentifiers(trades = []) {
  const failures = [];
  const seenTradeIds = new Set();

  for (let index = 0; index < trades.length; index += 1) {
    const trade = trades[index];
    const tradeId = String(trade?.tradeId || "").trim();
    if (!tradeId) {
      failures.push({
        code: "trade_id_missing",
        tradeIndex: index,
        message: "Trade is missing a stable tradeId.",
      });
      continue;
    }
    if (seenTradeIds.has(tradeId)) {
      failures.push({
        code: "trade_id_duplicate",
        tradeIndex: index,
        tradeId,
        message: "Trade run generated a duplicate tradeId.",
      });
      continue;
    }
    seenTradeIds.add(tradeId);

    const tradeSelectionId = String(trade?.tradeSelectionId || "").trim();
    if (tradeSelectionId && tradeSelectionId !== tradeId) {
      failures.push({
        code: "trade_selection_id_mismatch",
        tradeIndex: index,
        tradeId,
        message: "Trade selection id does not match tradeId.",
        expected: tradeId,
        actual: tradeSelectionId,
      });
    }
  }

  return failures;
}

function auditMarketDateFormatting() {
  const failures = [];
  const samples = [
    { raw: "2026-03-11", expected: "Mar 11" },
    { raw: "2026-01-02", expected: "Jan 2" },
    { raw: "2025-12-31", expected: "Dec 31" },
  ];

  for (const sample of samples) {
    const actual = formatMarketDateLabel(sample.raw);
    if (actual !== sample.expected) {
      failures.push({
        code: "market_date_label_mismatch",
        message: "Date-only market label shifted unexpectedly.",
        raw: sample.raw,
        expected: sample.expected,
        actual,
      });
    }
  }

  return buildScenarioResult({
    id: "utility_market_date_labels",
    type: "utility",
    input: { samples },
    metrics: null,
    metricExpectations: null,
    failures,
  });
}

function auditEquitySeries({ equity = [], trades = [], capital = DEFAULT_CAPITAL } = {}) {
  const failures = [];

  if (!Array.isArray(equity) || !equity.length) {
    failures.push({
      code: "equity_missing",
      message: "Equity series is empty.",
    });
    return { failures, zeroOpenSamplesChecked: 0 };
  }

  let zeroOpenSamplesChecked = 0;
  let previousTs = null;

  for (let index = 0; index < equity.length; index += 1) {
    const point = equity[index];
    const pointTs = point?.ts || null;
    const pointBalance = Number(point?.bal);
    if (!Number.isFinite(pointBalance)) {
      failures.push({
        code: "equity_non_finite",
        equityIndex: index,
        message: "Equity balance is not finite.",
        actual: point?.bal,
      });
    }
    if (previousTs && pointTs && compareTs(previousTs, pointTs) > 0) {
      failures.push({
        code: "equity_timestamp_order",
        equityIndex: index,
        message: "Equity timestamps are not monotonic.",
        previousTs,
        actual: pointTs,
      });
    }
    previousTs = pointTs || previousTs;

    if (!pointTs) {
      continue;
    }

    const openTrades = trades.filter(
      (trade) => compareTs(trade?.ts, pointTs) < 0 && compareTs(trade?.et, pointTs) > 0,
    );
    if (openTrades.length > 0) {
      continue;
    }

    const hasSameTimestampTradeActivity = trades.some(
      (trade) => compareTs(trade?.ts, pointTs) === 0 || compareTs(trade?.et, pointTs) === 0,
    );
    if (hasSameTimestampTradeActivity) {
      continue;
    }

    zeroOpenSamplesChecked += 1;
    const realizedBalance = capital + trades
      .filter((trade) => compareTs(trade?.et, pointTs) <= 0)
      .reduce((sum, trade) => sum + toFiniteNumber(trade?.pnl, 0) - toFiniteNumber(trade?.commIn, 0), 0);
    if (!sameNumber(pointBalance, realizedBalance)) {
      failures.push({
        code: "equity_realized_balance_mismatch",
        equityIndex: index,
        message: "Equity sample with no open trades does not match realized balance.",
        ts: pointTs,
        expected: roundTo(realizedBalance, 2),
        actual: roundTo(pointBalance, 2),
      });
    }
  }

  const terminalPoint = equity[equity.length - 1] || null;
  const expectedTerminalBalance = capital + trades
    .reduce((sum, trade) => sum + toFiniteNumber(trade?.pnl, 0) - toFiniteNumber(trade?.commIn, 0), 0);
  if (!sameNumber(terminalPoint?.bal, expectedTerminalBalance)) {
    failures.push({
      code: "equity_terminal_balance_mismatch",
      message: "Final equity point does not match starting capital plus net trade contributions.",
      expected: roundTo(expectedTerminalBalance, 2),
      actual: roundTo(terminalPoint?.bal, 2),
    });
  }

  return {
    failures,
    zeroOpenSamplesChecked,
  };
}

function buildFixtureTrade({
  sequence = 1,
  entryFill,
  exitFill,
  qty = 1,
  commIn = 0,
  commOut = 0,
  bh = 1,
  entryTs = "2025-01-02 09:35",
  exitTs = "2025-01-02 09:50",
  exitReason = "time_exit",
  optionTicker = "FIXTURE",
} = {}) {
  const expectedPnl = (entryFill == null || exitFill == null)
    ? 0
    : (Number(exitFill) - Number(entryFill)) * 100 * Number(qty) - Number(commOut || 0);
  const tradeSeed = {
    ts: entryTs,
    strat: "fixture",
    dir: "long",
    optionTicker,
    expiryDate: "2025-01-17",
    k: 100,
    ic: true,
  };
  const tradeId = buildResearchTradeId(tradeSeed, Math.max(1, Math.round(Number(sequence || 1) || 1)));
  return {
    tradeId,
    tradeSelectionId: tradeId,
    id: tradeId,
    ts: entryTs,
    et: exitTs,
    er: exitReason,
    optionTicker,
    oe: Number(entryFill),
    exitFill: Number(exitFill),
    qty: Number(qty),
    cost: Number(entryFill) * 100 * Number(qty),
    pnl: roundTo(expectedPnl, 2),
    commIn: Number(commIn),
    commOut: Number(commOut),
    fees: Number(commIn) + Number(commOut),
    bh: Number(bh),
  };
}

function buildFixtureScenarios() {
  return [
    {
      id: "fixture_no_trades",
      type: "fixture",
      capital: DEFAULT_CAPITAL,
      trades: [],
      expectedMetrics: {
        pnl: 0,
        roi: 0,
        wr: 0,
        w: 0,
        l: 0,
        pf: 0,
        avgW: 0,
        avgL: 0,
        exp: 0,
        dd: 0,
        sharpe: 0,
        n: 0,
        streak: 0,
        avgBars: 0,
        totalFees: 0,
      },
    },
    {
      id: "fixture_single_winner_commissioned",
      type: "fixture",
      capital: DEFAULT_CAPITAL,
      trades: [
        buildFixtureTrade({
          entryFill: 2.0,
          exitFill: 2.5,
          qty: 1,
          commIn: 1,
          commOut: 1,
          bh: 5,
          exitReason: "take_profit",
        }),
      ],
      expectedMetrics: {
        pnl: 48,
        roi: 0.5,
        wr: 100,
        w: 1,
        l: 0,
        pf: "∞",
        avgW: 48,
        avgL: 0,
        exp: 48,
        dd: 0,
        sharpe: 0,
        n: 1,
        streak: 0,
        avgBars: 5,
        totalFees: 2,
      },
    },
    {
      id: "fixture_single_loser_commissioned",
      type: "fixture",
      capital: DEFAULT_CAPITAL,
      trades: [
        buildFixtureTrade({
          entryFill: 2.0,
          exitFill: 1.4,
          qty: 1,
          commIn: 1,
          commOut: 1,
          bh: 4,
          exitReason: "stop_loss",
        }),
      ],
      expectedMetrics: {
        pnl: -62,
        roi: -0.6,
        wr: 0,
        w: 0,
        l: 1,
        pf: 0,
        avgW: 0,
        avgL: -62,
        exp: -62,
        dd: 0.6,
        sharpe: 0,
        n: 1,
        streak: 1,
        avgBars: 4,
        totalFees: 2,
      },
    },
    {
      id: "fixture_mixed_sequence",
      type: "fixture",
      capital: DEFAULT_CAPITAL,
      trades: [
        buildFixtureTrade({
          entryFill: 2.0,
          exitFill: 2.5,
          qty: 1,
          commIn: 1,
          commOut: 1,
          bh: 5,
          entryTs: "2025-01-02 09:35",
          exitTs: "2025-01-02 09:50",
          exitReason: "take_profit",
          optionTicker: "FIXTURE-A",
        }),
        buildFixtureTrade({
          entryFill: 2.0,
          exitFill: 1.4,
          qty: 1,
          commIn: 1,
          commOut: 1,
          bh: 4,
          entryTs: "2025-01-02 10:05",
          exitTs: "2025-01-02 10:20",
          exitReason: "stop_loss",
          optionTicker: "FIXTURE-B",
        }),
        buildFixtureTrade({
          entryFill: 2.0,
          exitFill: 1.8,
          qty: 1,
          commIn: 1,
          commOut: 1,
          bh: 2,
          entryTs: "2025-01-02 10:35",
          exitTs: "2025-01-02 10:40",
          exitReason: "trailing_stop",
          optionTicker: "FIXTURE-C",
        }),
      ],
      expectedMetrics: {
        pnl: -36,
        roi: -0.4,
        wr: 33.3,
        w: 1,
        l: 2,
        pf: 0.57,
        avgW: 48,
        avgL: -42,
        exp: -12,
        dd: 0.8,
        sharpe: -0.46,
        n: 3,
        streak: 2,
        avgBars: 4,
        totalFees: 6,
      },
    },
    {
      id: "fixture_finite_profit_factor",
      type: "fixture",
      capital: DEFAULT_CAPITAL,
      trades: [
        buildFixtureTrade({
          entryFill: 2.0,
          exitFill: 2.6,
          qty: 1,
          commIn: 1,
          commOut: 1,
          bh: 6,
          entryTs: "2025-01-03 09:35",
          exitTs: "2025-01-03 09:55",
          exitReason: "take_profit",
          optionTicker: "FIXTURE-D",
        }),
        buildFixtureTrade({
          entryFill: 1.5,
          exitFill: 1.9,
          qty: 1,
          commIn: 1,
          commOut: 1,
          bh: 3,
          entryTs: "2025-01-03 10:05",
          exitTs: "2025-01-03 10:20",
          exitReason: "time_exit",
          optionTicker: "FIXTURE-E",
        }),
        buildFixtureTrade({
          entryFill: 2.0,
          exitFill: 1.8,
          qty: 1,
          commIn: 1,
          commOut: 1,
          bh: 2,
          entryTs: "2025-01-03 10:35",
          exitTs: "2025-01-03 10:40",
          exitReason: "stop_loss",
          optionTicker: "FIXTURE-F",
        }),
      ],
      expectedMetrics: {
        pnl: 74,
        roi: 0.7,
        wr: 66.7,
        w: 2,
        l: 1,
        pf: 4.36,
        avgW: 48,
        avgL: -22,
        exp: 24.67,
        dd: 0.2,
        sharpe: 1.26,
        n: 3,
        streak: 1,
        avgBars: 4,
        totalFees: 6,
      },
    },
  ];
}

function buildScenarioResult({
  id,
  type,
  label = null,
  input = null,
  run = null,
  metrics = null,
  metricExpectations = null,
  failures = [],
  extra = {},
} = {}) {
  return {
    id,
    type,
    label,
    passed: failures.length === 0,
    failures,
    input,
    summary: {
      ...(run ? summarizeTrades(run?.trades || []) : summarizeTrades(extra?.trades || [])),
      metrics,
      metricExpectations,
      equityPoints: Array.isArray(run?.equity) ? run.equity.length : 0,
      riskStop: run?.riskStop || null,
      ...extra,
    },
  };
}

async function fetchSpotBars(symbol, initialDays) {
  const apiKey = getApiKey();
  const response = await resolveResearchSpotHistory({
    symbol,
    apiKey,
    mode: "initial",
    initialDays,
  });
  const bars = Array.isArray(response?.intradayBars) ? response.intradayBars : [];
  if (!bars.length) {
    throw new Error(response?.error || `No intraday bars returned for ${symbol}.`);
  }
  return bars;
}

function buildRuntimeConfig(strategy, minConviction, bars) {
  const preset = STRATEGY_PRESETS[strategy] || {};
  const exitPreset = EXIT_PRESETS[preset.exit] || EXIT_PRESETS.moderate;
  return {
    executionMode: "spot_model",
    executionFidelity: "sub_candle",
    executionBars: bars,
    strategy,
    dte: preset.dte ?? 5,
    iv: 0.2,
    slPct: exitPreset.slPct,
    tpPct: exitPreset.tpPct,
    trailStartPct: exitPreset.trailStartPct,
    trailPct: exitPreset.trailPct,
    zombieBars: preset.zb ?? 30,
    minConviction,
    allowShorts: true,
    kellyFrac: 0.25,
    regimeFilter: preset.rf ?? "none",
    maxPositions: 4,
    capital: DEFAULT_RUNTIME_CAPITAL,
    sessionBlocks: Array(13).fill(true),
    tfMin: 5,
    regimeAdapt: true,
    commPerContract: 0.65,
    slipBps: 150,
    tradeDays: Array(5).fill(true),
    riskStopPolicy: RISK_STOP_DISABLED,
    includeIndicatorOverlays: false,
  };
}

function buildReplayPayload(strategy, minConviction, bars, symbol) {
  const preset = STRATEGY_PRESETS[strategy] || {};
  const exitPreset = EXIT_PRESETS[preset.exit] || EXIT_PRESETS.moderate;
  return {
    marketSymbol: symbol,
    bars,
    capital: DEFAULT_RUNTIME_CAPITAL,
    executionFidelity: "sub_candle",
    strategy,
    dte: preset.dte ?? 5,
    iv: 0.2,
    slPct: exitPreset.slPct,
    tpPct: exitPreset.tpPct,
    trailStartPct: exitPreset.trailStartPct,
    trailPct: exitPreset.trailPct,
    zombieBars: preset.zb ?? 30,
    minConviction,
    allowShorts: true,
    kellyFrac: 0.25,
    regimeFilter: preset.rf ?? "none",
    maxPositions: 4,
    sessionBlocks: Array(13).fill(true),
    regimeAdapt: true,
    commPerContract: 0.65,
    slipBps: 150,
    tradeDays: Array(5).fill(true),
    riskStopPolicy: RISK_STOP_DISABLED,
    optionSelectionSpec: {
      targetDte: preset.dte ?? 5,
      strikeSlot: 0,
    },
  };
}

function findTradeProducingRuntimeScenario(bars) {
  const signalBars = aggregateBarsToMinutes(bars, 5);
  const regimes = detectRegimes(signalBars);
  const strategyOrder = [
    "rayalgo",
    "momentum_breakout",
    "sweep_reversal",
    "vwap_extreme",
    "ema_stack",
    "bb_squeeze",
  ];
  const minConvictions = [0.48, 0.4, 0.35, 0.3];
  const attempts = [];

  for (const strategy of strategyOrder) {
    for (const minConviction of minConvictions) {
      const config = buildRuntimeConfig(strategy, minConviction, bars);
      const run = runBacktest(signalBars, regimes, config);
      attempts.push({
        strategy,
        minConviction,
        tradeCount: Array.isArray(run?.trades) ? run.trades.length : 0,
      });
      if (Array.isArray(run?.trades) && run.trades.length) {
        return {
          signalBars,
          regimes,
          config,
          run,
          attempts,
        };
      }
    }
  }

  throw new Error(`No trade-producing spot_model scenario found. Attempts: ${JSON.stringify(attempts)}`);
}

async function findTradeProducingReplayScenario(bars, symbol) {
  const strategyOrder = [
    "rayalgo",
    "momentum_breakout",
    "sweep_reversal",
    "vwap_extreme",
    "ema_stack",
    "bb_squeeze",
  ];
  const minConvictions = [0.48, 0.4, 0.35, 0.3];
  const apiKey = getApiKey();
  const attempts = [];

  for (const strategy of strategyOrder) {
    for (const minConviction of minConvictions) {
      const payload = buildReplayPayload(strategy, minConviction, bars, symbol);
      const run = await runMassiveOptionReplayBacktest(payload, {
        apiKey,
        timeoutMs: 20000,
      });
      attempts.push({
        strategy,
        minConviction,
        tradeCount: Array.isArray(run?.trades) ? run.trades.length : 0,
      });
      if (Array.isArray(run?.trades) && run.trades.length) {
        return {
          payload,
          run,
          attempts,
        };
      }
    }
  }

  throw new Error(`No trade-producing replay scenario found. Attempts: ${JSON.stringify(attempts)}`);
}

function auditFixtureScenario(scenario) {
  const actualMetrics = computeMetrics(scenario.trades, scenario.capital);
  const failures = [
    ...auditTradeIdentifiers(scenario.trades),
    ...auditTradeLedger(scenario.trades),
    ...auditTradeContractSemantics(scenario.trades),
    ...auditMetricShape(actualMetrics, scenario.expectedMetrics, "fixture_metrics"),
  ];

  return buildScenarioResult({
    id: scenario.id,
    type: scenario.type,
    input: { capital: scenario.capital },
    metrics: actualMetrics,
    metricExpectations: scenario.expectedMetrics,
    failures,
    extra: {
      trades: scenario.trades,
    },
  });
}

function auditRunScenario({ id, type, label, input, run, capital, requireTrades = true }) {
  const tradeIdFailures = auditTradeIdentifiers(run?.trades || []);
  const tradeFailures = auditTradeLedger(run?.trades || []);
  const contractFailures = auditTradeContractSemantics(run?.trades || []);
  const actualMetrics = computeMetrics(run?.trades || [], capital);
  const manualMetrics = buildManualMetrics(run?.trades || [], capital);
  const metricFailures = auditMetricShape(actualMetrics, manualMetrics, "reconciled_metrics");
  const equityAudit = auditEquitySeries({
    equity: run?.equity || [],
    trades: run?.trades || [],
    capital,
  });

  const failures = [
    ...(requireTrades && !(Array.isArray(run?.trades) && run.trades.length)
      ? [{
        code: "missing_trades",
        message: "Scenario did not produce any trades, so it cannot validate non-trivial PnL flow.",
      }]
      : []),
    ...tradeIdFailures,
    ...tradeFailures,
    ...contractFailures,
    ...metricFailures,
    ...equityAudit.failures,
  ];

  return buildScenarioResult({
    id,
    type,
    label,
    input,
    run,
    metrics: actualMetrics,
    metricExpectations: manualMetrics,
    failures,
    extra: {
      zeroOpenSamplesChecked: equityAudit.zeroOpenSamplesChecked,
    },
  });
}

function printScenarioStatus(result) {
  const tradeCount = result?.summary?.tradeCount ?? 0;
  const equityPoints = result?.summary?.equityPoints ?? 0;
  const status = result?.passed ? "PASS" : "FAIL";
  const label = result?.label ? ` ${result.label}` : "";
  console.error(`[${status}] ${result.id}${label} trades=${tradeCount} equityPoints=${equityPoints} failures=${result.failures.length}`);
}

async function main() {
  const mode = String(parseArg("mode", "all")).trim().toLowerCase() || "all";
  const symbol = String(parseArg("symbol", DEFAULT_SYMBOL)).trim().toUpperCase() || DEFAULT_SYMBOL;
  const outDir = parseArg("out", DEFAULT_OUT_DIR);
  const initialDays = Math.max(10, Math.round(toFiniteNumber(parseArg("initial-days", DEFAULT_INITIAL_DAYS), DEFAULT_INITIAL_DAYS)));
  const shouldRunFixtures = mode === "all" || mode === "fixtures";
  const shouldRunRuntime = mode === "all" || mode === "runtime";
  const shouldRunReplay = mode === "all" || mode === "replay";
  const results = [];
  let bars = null;
  let runtimeScenario = null;
  let replayScenario = null;

  fs.mkdirSync(outDir, { recursive: true });

  if (shouldRunFixtures) {
    const utilityScenario = auditMarketDateFormatting();
    results.push(utilityScenario);
    printScenarioStatus(utilityScenario);
    for (const scenario of buildFixtureScenarios()) {
      const result = auditFixtureScenario(scenario);
      results.push(result);
      printScenarioStatus(result);
    }
  }

  if (shouldRunRuntime || shouldRunReplay) {
    bars = await fetchSpotBars(symbol, initialDays);
    console.error(`[setup] symbol=${symbol} bars=${bars.length}`);
  }

  if (shouldRunRuntime) {
    runtimeScenario = findTradeProducingRuntimeScenario(bars);
    console.error(`[runtime] baseline strategy=${runtimeScenario.config.strategy} mc=${runtimeScenario.config.minConviction} trades=${runtimeScenario.run.trades.length}`);
    const runtimeVariants = [
      {
        id: "runtime_spot_baseline",
        label: "Spot Baseline",
        config: runtimeScenario.config,
      },
      {
        id: "runtime_spot_high_slippage",
        label: "Spot High Slippage",
        config: {
          ...runtimeScenario.config,
          slipBps: 500,
        },
      },
      {
        id: "runtime_spot_tight_stop",
        label: "Spot Tight Stop",
        config: {
          ...runtimeScenario.config,
          slPct: 0.10,
        },
      },
      {
        id: "runtime_spot_legacy_halt",
        label: "Spot Legacy Halt",
        config: {
          ...runtimeScenario.config,
          riskStopPolicy: RISK_STOP_LEGACY_HALT,
        },
      },
    ];

    for (const variant of runtimeVariants) {
      const run = variant.id === "runtime_spot_baseline"
        ? runtimeScenario.run
        : runBacktest(runtimeScenario.signalBars, runtimeScenario.regimes, variant.config);
      const result = auditRunScenario({
        id: variant.id,
        type: "runtime",
        label: variant.label,
        input: compactConfig(variant.config),
        run,
        capital: variant.config.capital,
      });
      results.push(result);
      printScenarioStatus(result);
    }
  }

  if (shouldRunReplay) {
    replayScenario = await findTradeProducingReplayScenario(bars, symbol);
    console.error(`[replay] baseline strategy=${replayScenario.payload.strategy} mc=${replayScenario.payload.minConviction} trades=${replayScenario.run.trades.length}`);
    const apiKey = getApiKey();
    const replayVariants = [
      {
        id: "replay_baseline",
        label: "Replay Baseline",
        payload: replayScenario.payload,
      },
      {
        id: "replay_high_slippage",
        label: "Replay High Slippage",
        payload: {
          ...replayScenario.payload,
          slipBps: 500,
        },
      },
    ];

    for (const variant of replayVariants) {
      const run = variant.id === "replay_baseline"
        ? replayScenario.run
        : await runMassiveOptionReplayBacktest(variant.payload, {
          apiKey,
          timeoutMs: 20000,
        });
      const result = auditRunScenario({
        id: variant.id,
        type: "replay",
        label: variant.label,
        input: compactConfig(variant.payload),
        run,
        capital: variant.payload.capital,
      });
      results.push(result);
      printScenarioStatus(result);
    }
  }

  const summary = {
    scenarioCount: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
  };

  const artifact = {
    generatedAt: new Date().toISOString(),
    mode,
    symbol,
    initialDays,
    apiConfigured: Boolean(getApiKey()),
    summary,
    scenarios: clone(results),
    runtimeSearchAttempts: runtimeScenario?.attempts || [],
    replaySearchAttempts: replayScenario?.attempts || [],
  };

  const resultPath = path.join(outDir, "result.json");
  fs.writeFileSync(resultPath, JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify({ resultPath, ...summary }, null, 2));

  if (summary.failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
