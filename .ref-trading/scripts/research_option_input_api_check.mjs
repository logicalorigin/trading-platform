#!/usr/bin/env node

import fs from "fs";
import path from "path";

import { STRATEGY_PRESETS } from "../src/research/config/strategyPresets.js";
import {
  buildDefaultInputImpactVariants,
  compactReplayRunSummary,
  createInputImpactPayload,
  createReplayRunSummary,
  summarizeInputImpactComparison,
  summarizeInputImpactDiagnostics,
} from "../src/research/analysis/inputImpact.js";
import { runMassiveOptionReplayBacktest as runMassiveOptionReplayBacktestService } from "../server/services/researchBacktest.js";
import { resolveResearchSpotHistory } from "../server/services/researchSpotHistory.js";

function parseArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  if (!hit) return fallback;
  return hit.slice(prefix.length).trim();
}

async function fetchSpotBars(_baseUrl, symbol) {
  const apiKey = process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || "";
  const initial = await resolveResearchSpotHistory({
    symbol,
    apiKey,
    mode: "initial",
  });
  let bars = Array.isArray(initial?.intradayBars) ? initial.intradayBars : [];
  if (!bars.length) {
    throw new Error(`No initial intraday bars returned for ${symbol}.`);
  }
  return bars;
}

async function runReplay(_baseUrl, payload) {
  const apiKey = process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || "";
  return runMassiveOptionReplayBacktestService(payload, {
    apiKey,
    timeoutMs: 20000,
  });
}

async function findScenario(baseUrl, bars, symbol) {
  const strategyOrder = [
    "rayalgo",
    "momentum_breakout",
    "sweep_reversal",
    "vwap_extreme",
    "ema_stack",
    "bb_squeeze",
  ];
  const minConvictions = [null, 0.4, 0.35, 0.3];
  const attempts = [];

  for (const strategy of strategyOrder) {
    const preset = STRATEGY_PRESETS[strategy];
    for (const overrideMinConviction of minConvictions) {
      const payload = {
        marketSymbol: symbol,
        bars,
        capital: 25000,
        executionFidelity: "sub_candle",
        strategy,
        dte: preset?.dte ?? 5,
        iv: 0.2,
        slPct: preset?.exit ? null : 0.25,
        tpPct: preset?.exit ? null : 0.35,
        trailStartPct: preset?.exit ? null : 0.08,
        trailPct: preset?.exit ? null : 0.18,
        zombieBars: preset?.zb ?? 30,
        minConviction: overrideMinConviction ?? preset?.mc ?? 0.48,
        allowShorts: true,
        kellyFrac: 0.25,
        regimeFilter: preset?.rf ?? "none",
        maxPositions: 4,
        sessionBlocks: Array(13).fill(true),
        regimeAdapt: true,
        commPerContract: 0.65,
        slipBps: 150,
        tradeDays: Array(5).fill(true),
        riskStopPolicy: "disabled",
        optionSelectionSpec: {
          targetDte: preset?.dte ?? 5,
          strikeSlot: 0,
        },
      };

      if (preset?.exit) {
        const exitPreset = STRATEGY_PRESETS[strategy]?.exit;
        const exitPresets = {
          scalp: { slPct: 0.15, tpPct: 0.20, trailStartPct: 0.05, trailPct: 0.10 },
          tight: { slPct: 0.20, tpPct: 0.28, trailStartPct: 0.06, trailPct: 0.15 },
          moderate: { slPct: 0.25, tpPct: 0.35, trailStartPct: 0.08, trailPct: 0.18 },
          wide: { slPct: 0.45, tpPct: 0.70, trailStartPct: 0.12, trailPct: 0.22 },
          runner: { slPct: 0.30, tpPct: 2.0, trailStartPct: 0.20, trailPct: 0.30 },
          lotto: { slPct: 0.60, tpPct: 5.0, trailStartPct: 0.50, trailPct: 0.50 },
        };
        Object.assign(payload, exitPresets[exitPreset] || exitPresets.moderate);
      }

      console.error(`[scenario] strategy=${strategy} mc=${payload.minConviction}`);
      const run = await runReplay(baseUrl, payload);
      const summary = createReplayRunSummary(run, payload.capital);
      console.error(`[scenario] trades=${summary.tradeCount} first=${summary.firstTrade?.entryAt || "--"}`);
      attempts.push({
        strategy,
        minConviction: payload.minConviction,
        tradeCount: summary.tradeCount,
        firstTradeEntry: summary.firstTrade?.entryAt || null,
      });
      if (summary.tradeCount > 0 && summary.firstTrade) {
        return {
          payload,
          run,
          summary,
          attempts,
        };
      }
    }
  }

  throw new Error(`No trade-producing scenario found. Attempts: ${JSON.stringify(attempts)}`);
}

async function main() {
  const baseUrl = parseArg("url", "http://127.0.0.1:4174");
  const symbol = parseArg("symbol", "SPY");
  const outDir = parseArg("out", "output/research-option-input-api-check");
  fs.mkdirSync(outDir, { recursive: true });

  const bars = await fetchSpotBars(baseUrl, symbol);
  console.error(`[setup] symbol=${symbol} bars=${bars.length}`);
  const scenario = await findScenario(baseUrl, bars, symbol);
  console.error(`[baseline] strategy=${scenario.payload.strategy} trades=${scenario.summary.tradeCount}`);
  const baselinePayload = createInputImpactPayload(scenario.payload);
  const baselineSummary = createReplayRunSummary(scenario.run, baselinePayload.capital);
  const variants = buildDefaultInputImpactVariants(baselinePayload);
  const comparisons = [];

  for (const variant of variants) {
    const variantRun = await runReplay(baseUrl, variant.variantInput);
    console.error(`[variant] ${variant.key} complete`);
    comparisons.push(summarizeInputImpactComparison({
      variant,
      baselineInput: baselinePayload,
      variantInput: variant.variantInput,
      baselineRun: scenario.run,
      variantRun,
      capital: baselinePayload.capital,
    }));
  }

  const summary = summarizeInputImpactDiagnostics(comparisons);

  const result = {
    symbol,
    barCount: bars.length,
    scenario: {
      strategy: scenario.payload.strategy,
      minConviction: scenario.payload.minConviction,
      targetDte: scenario.payload.optionSelectionSpec?.targetDte ?? null,
      strikeSlot: scenario.payload.optionSelectionSpec?.strikeSlot ?? null,
      allowShorts: scenario.payload.allowShorts,
      regimeFilter: scenario.payload.regimeFilter,
      riskStopPolicy: scenario.payload.riskStopPolicy,
      attempts: scenario.attempts,
    },
    baseline: compactReplayRunSummary(baselineSummary),
    inputImpact: summary,
  };

  const resultPath = path.join(outDir, "result.json");
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ resultPath, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
