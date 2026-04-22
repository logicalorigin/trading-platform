#!/usr/bin/env node

import fs from "fs";
import path from "path";

import { STRATEGY_PRESETS } from "../src/research/config/strategyPresets.js";
import { computeMetrics } from "../src/research/engine/runtime.js";
import { normalizeRayAlgoScoringPreferences } from "../src/research/engine/rayalgoScoring.js";
import { runMassiveOptionReplayBacktest } from "../server/services/researchBacktest.js";
import { resolveResearchSpotHistory } from "../server/services/researchSpotHistory.js";

function parseArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  if (!hit) return fallback;
  return hit.slice(prefix.length).trim();
}

function parseListArg(name, fallback = []) {
  const raw = parseArg(name, "");
  if (!raw) return fallback;
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function parseNumberArg(name, fallback) {
  const raw = parseArg(name, "");
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function getExitPreset(strategy = "rayalgo") {
  const preset = STRATEGY_PRESETS[strategy] || {};
  const exitPresets = {
    scalp: { slPct: 0.15, tpPct: 0.20, trailStartPct: 0.05, trailPct: 0.10 },
    tight: { slPct: 0.20, tpPct: 0.28, trailStartPct: 0.06, trailPct: 0.15 },
    moderate: { slPct: 0.25, tpPct: 0.35, trailStartPct: 0.08, trailPct: 0.18 },
    wide: { slPct: 0.45, tpPct: 0.70, trailStartPct: 0.12, trailPct: 0.22 },
    runner: { slPct: 0.30, tpPct: 2.0, trailStartPct: 0.20, trailPct: 0.30 },
    lotto: { slPct: 0.60, tpPct: 5.0, trailStartPct: 0.50, trailPct: 0.50 },
  };
  return exitPresets[preset.exit] || exitPresets.moderate;
}

function buildReplayPayload({ symbol, bars, signalTimeframe, minConviction, targetDte, exitPreset }) {
  const preset = STRATEGY_PRESETS.rayalgo || {};
  return {
    marketSymbol: symbol,
    bars,
    capital: 25000,
    executionFidelity: "sub_candle",
    strategy: "rayalgo",
    signalTimeframe,
    dte: targetDte,
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
    riskStopPolicy: "disabled",
    optionSelectionSpec: {
      targetDte,
      strikeSlot: 0,
    },
  };
}

function tradeSignature(trade = {}) {
  return [
    trade.ts ?? "",
    trade.et ?? "",
    trade.dir ?? "",
    trade.optionTicker ?? "",
    Number(trade.pnl || 0).toFixed(2),
  ].join("|");
}

function simplifySignal(event = {}) {
  return {
    ts: event.ts ?? null,
    rawScore: event.rawScore ?? null,
    precursorBonus: event.precursorBonus ?? null,
    score: event.score ?? null,
    displayText: event.displayText ?? null,
  };
}

function buildMetricDelta(baseline = {}, variant = {}) {
  return {
    pnl: Number((Number(variant.pnl || 0) - Number(baseline.pnl || 0)).toFixed(2)),
    roi: Number((Number(variant.roi || 0) - Number(baseline.roi || 0)).toFixed(2)),
    wr: Number((Number(variant.wr || 0) - Number(baseline.wr || 0)).toFixed(2)),
    pf: Number((Number(variant.pf || 0) - Number(baseline.pf || 0)).toFixed(2)),
    sharpe: Number((Number(variant.sharpe || 0) - Number(baseline.sharpe || 0)).toFixed(2)),
    dd: Number((Number(variant.dd || 0) - Number(baseline.dd || 0)).toFixed(2)),
    n: Number(variant.n || 0) - Number(baseline.n || 0),
  };
}

async function fetchSpotBars(symbol, initialDays, apiKey) {
  const response = await resolveResearchSpotHistory({
    symbol,
    apiKey,
    mode: "initial",
    initialDays,
    preferredTf: "1m",
  });
  const bars = Array.isArray(response?.intradayBars) ? response.intradayBars : [];
  if (!bars.length) {
    throw new Error(response?.error || `No spot bars returned for ${symbol}`);
  }
  return bars;
}

async function findTradeProducingBaseline({
  symbol,
  bars,
  signalTimeframe,
  targetDte,
  minConvictions,
  apiKey,
  scoringConfig,
}) {
  const exitPreset = getExitPreset("rayalgo");
  const attempts = [];

  for (const minConviction of minConvictions) {
    const payload = {
      ...buildReplayPayload({ symbol, bars, signalTimeframe, minConviction, targetDte, exitPreset }),
      rayalgoScoringConfig: normalizeRayAlgoScoringPreferences({
        activeTimeframe: signalTimeframe,
        ...(scoringConfig || {}),
      }),
    };
    const run = await runMassiveOptionReplayBacktest(payload, { apiKey, timeoutMs: 30000 });
    const tradeCount = Array.isArray(run?.trades) ? run.trades.length : 0;
    attempts.push({ minConviction, tradeCount });
    if (tradeCount > 0) {
      return { payload, run, attempts };
    }
  }

  return { payload: null, run: null, attempts };
}

async function runScenario({
  symbol,
  signalTimeframe,
  initialDays,
  minConvictions,
  apiKey,
  targetDte,
  baselineScoringConfig,
  variantScoringConfig,
  expectation = "equal",
}) {
  const startedAt = new Date().toISOString();
  const bars = await fetchSpotBars(symbol, initialDays, apiKey);
  const baseline = await findTradeProducingBaseline({
    symbol,
    bars,
    signalTimeframe,
    targetDte,
    minConvictions,
    apiKey,
    scoringConfig: baselineScoringConfig,
  });

  if (!baseline.run || !baseline.payload) {
    return {
      symbol,
      signalTimeframe,
      initialDays,
      barCount: bars.length,
      status: "no_trade_producing_baseline",
      attempts: baseline.attempts,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  const autoPayload = {
    ...baseline.payload,
    rayalgoScoringConfig: normalizeRayAlgoScoringPreferences({
      activeTimeframe: signalTimeframe,
      ...(variantScoringConfig || {}),
    }),
  };
  const autoRun = await runMassiveOptionReplayBacktest(autoPayload, { apiKey, timeoutMs: 30000 });

  const baselineTrades = Array.isArray(baseline.run?.trades) ? baseline.run.trades : [];
  const autoTrades = Array.isArray(autoRun?.trades) ? autoRun.trades : [];
  const baselineMetrics = computeMetrics(baselineTrades, baseline.payload.capital);
  const autoMetrics = computeMetrics(autoTrades, baseline.payload.capital);

  const baselineSignals = (baseline.run?.indicatorOverlayTape?.events || []).filter((event) => event.eventType === "signal_fire" && event.strategy === "rayalgo");
  const autoSignals = (autoRun?.indicatorOverlayTape?.events || []).filter((event) => event.eventType === "signal_fire" && event.strategy === "rayalgo");

  const baselineSignature = baselineTrades.map(tradeSignature);
  const autoSignature = autoTrades.map(tradeSignature);
  const matchingTrades = JSON.stringify(baselineSignature) === JSON.stringify(autoSignature);
  const matchingMetrics = JSON.stringify(baselineMetrics) === JSON.stringify(autoMetrics);
  const changedSignal = autoSignals.find((event, index) => {
    const base = baselineSignals[index];
    return base && (event.displayText !== base.displayText || event.precursorBonus !== base.precursorBonus);
  });

  return {
    symbol,
    signalTimeframe,
    initialDays,
    barCount: bars.length,
    status: expectation === "equal"
      ? (matchingTrades && matchingMetrics ? "pass" : "drift")
      : "compared",
    chosenMinConviction: baseline.payload.minConviction,
    attempts: baseline.attempts,
    tradeCount: baselineTrades.length,
    matchingTrades,
    matchingMetrics,
    baselineMetrics,
    autoMetrics,
    metricDelta: buildMetricDelta(baselineMetrics, autoMetrics),
    baselineScoring: baseline.run?.rayalgoScoringContext || null,
    autoScoring: autoRun?.rayalgoScoringContext || null,
    signalCounts: {
      baseline: baselineSignals.length,
      auto: autoSignals.length,
    },
    firstBaselineSignal: baselineSignals[0] ? simplifySignal(baselineSignals[0]) : null,
    firstAutoSignal: autoSignals[0] ? simplifySignal(autoSignals[0]) : null,
    changedSignal: changedSignal ? simplifySignal(changedSignal) : null,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

async function main() {
  const apiKey = String(process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("MASSIVE_API_KEY or POLYGON_API_KEY is required");
  }

  const symbols = parseListArg("symbols", ["SPY", "QQQ"]);
  const timeframes = parseListArg("timeframes", ["5m", "15m"]);
  const outDir = parseArg("out", "output/rayalgo-tranche1-replay-matrix");
  const initialDays = parseNumberArg("days", 60);
  const targetDte = parseNumberArg("dte", STRATEGY_PRESETS.rayalgo?.dte ?? 5);
  const minConvictions = parseListArg("min-convictions", ["0.52", "0.48", "0.44", "0.40", "0.35", "0.30", "0.25"]).map(Number).filter(Number.isFinite);
  const expectation = String(parseArg("expect", "equal") || "equal").trim().toLowerCase() === "compare"
    ? "compare"
    : "equal";
  const baselineScoringConfig = normalizeRayAlgoScoringPreferences({
    precursorLadderId: parseArg("baseline-ladder", "none"),
    authority: parseArg("baseline-authority", "observe_only"),
  });
  const variantScoringConfig = normalizeRayAlgoScoringPreferences({
    precursorLadderId: parseArg("variant-ladder", "auto"),
    authority: parseArg("variant-authority", "observe_only"),
  });

  fs.mkdirSync(outDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const results = [];
  for (const symbol of symbols) {
    for (const signalTimeframe of timeframes) {
      console.error(`[matrix] running ${symbol} ${signalTimeframe}`);
      const result = await runScenario({
        symbol,
        signalTimeframe,
        initialDays,
        minConvictions,
        apiKey,
        targetDte,
        baselineScoringConfig,
        variantScoringConfig,
        expectation,
      });
      results.push(result);
      console.error(`[matrix] ${symbol} ${signalTimeframe} -> ${result.status}`);
    }
  }

  const summary = {
    startedAt,
    completedAt: new Date().toISOString(),
    symbols,
    timeframes,
    initialDays,
    targetDte,
    minConvictions,
    expectation,
    baselineScoringConfig,
    variantScoringConfig,
    totals: {
      scenarios: results.length,
      pass: results.filter((item) => item.status === "pass").length,
      drift: results.filter((item) => item.status === "drift").length,
      compared: results.filter((item) => item.status === "compared").length,
      noTradeProducingBaseline: results.filter((item) => item.status === "no_trade_producing_baseline").length,
    },
    results,
  };

  const fileName = `matrix-${startedAt.replace(/[:.]/g, "-")}.json`;
  const resultPath = path.join(outDir, fileName);
  fs.writeFileSync(resultPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ resultPath, ...summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
