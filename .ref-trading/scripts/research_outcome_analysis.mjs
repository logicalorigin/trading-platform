#!/usr/bin/env node

import fs from "fs";
import path from "path";

import { cloneBacktestV2StageDefaults } from "../src/research/config/backtestV2StagingConfig.js";
import { DEFAULT_RAYALGO_SETTINGS } from "../src/research/config/rayalgoSettings.js";
import { normalizeRayAlgoScoringPreferences } from "../src/research/engine/rayalgoScoring.js";
import { computeMetrics } from "../src/research/engine/runtime.js";
import { resolveResearchSpotHistory } from "../server/services/researchSpotHistory.js";
import { runMassiveOptionReplayBacktest } from "../server/services/researchBacktest.js";

function parseArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  if (!hit) return fallback;
  return hit.slice(prefix.length).trim();
}

function parseNumberArg(name, fallback) {
  const raw = parseArg(name, "");
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function roundMetric(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Number(numeric.toFixed(digits));
}

function updateNestedValue(target, pathText, value) {
  const pathParts = String(pathText || "").split(".").filter(Boolean);
  if (!pathParts.length) {
    return target;
  }
  const next = Array.isArray(target) ? [...target] : { ...(target || {}) };
  let cursor = next;
  let sourceCursor = target || {};
  for (let index = 0; index < pathParts.length - 1; index += 1) {
    const key = pathParts[index];
    const currentValue = sourceCursor?.[key];
    const branch = Array.isArray(currentValue) ? [...currentValue] : { ...(currentValue || {}) };
    cursor[key] = branch;
    cursor = branch;
    sourceCursor = currentValue || {};
  }
  cursor[pathParts[pathParts.length - 1]] = value;
  return next;
}

function applyStagePatch(stageConfig, patchEntries = []) {
  return patchEntries.reduce(
    (current, entry) => updateNestedValue(current, entry.path, entry.value),
    stageConfig,
  );
}

function summarizeTrades(trades = []) {
  const byExit = {};
  const byLayer = {};
  const byDte = {};
  const byHourBucket = {};
  const byScoreBucket = {};

  const scoreBucketLabels = [
    { key: "lt_0.60", test: (value) => value < 0.60 },
    { key: "0.60_0.69", test: (value) => value >= 0.60 && value < 0.70 },
    { key: "0.70_0.79", test: (value) => value >= 0.70 && value < 0.80 },
    { key: "0.80_0.89", test: (value) => value >= 0.80 && value < 0.90 },
    { key: "ge_0.90", test: (value) => value >= 0.90 },
  ];

  for (const trade of Array.isArray(trades) ? trades : []) {
    const pnl = Number(trade?.pnl || 0);
    const exit = String(trade?.er || "unknown");
    const layer = String(Number.isFinite(Number(trade?.layerNumber)) ? Math.round(Number(trade.layerNumber)) : 1);
    const actualDte = String(Number.isFinite(Number(trade?.actualDteAtEntry)) ? Math.round(Number(trade.actualDteAtEntry)) : "unknown");
    const minuteOfDay = Number(trade?.entryMinuteOfDay);
    const scoreAtEntry = Number(trade?.scoreAtEntry);

    const hourBucket = Number.isFinite(minuteOfDay)
      ? (
        minuteOfDay < 10 * 60 + 30
          ? "open"
          : minuteOfDay < 12 * 60
            ? "mid_morning"
            : minuteOfDay < 14 * 60
              ? "midday"
              : "power_hour"
      )
      : "unknown";
    const scoreBucket = Number.isFinite(scoreAtEntry)
      ? (scoreBucketLabels.find((bucket) => bucket.test(scoreAtEntry))?.key || "unknown")
      : "unknown";

    for (const [bucket, key] of [
      [byExit, exit],
      [byLayer, layer],
      [byDte, actualDte],
      [byHourBucket, hourBucket],
      [byScoreBucket, scoreBucket],
    ]) {
      bucket[key] = bucket[key] || { n: 0, pnl: 0 };
      bucket[key].n += 1;
      bucket[key].pnl = roundMetric(bucket[key].pnl + pnl, 4);
    }
  }

  return {
    byExit,
    byLayer,
    byDte,
    byHourBucket,
    byScoreBucket,
  };
}

function sortSummaryBuckets(summary = {}) {
  return Object.fromEntries(
    Object.entries(summary)
      .sort((left, right) => Number(right[1]?.n || 0) - Number(left[1]?.n || 0)),
  );
}

function summarizeVariant(name, patchEntries, run, capital) {
  const metrics = computeMetrics(run?.trades || [], capital);
  return {
    name,
    patchEntries,
    tradeCount: Number(metrics?.n || 0),
    pnl: roundMetric(metrics?.pnl, 2),
    roi: roundMetric(metrics?.roi, 2),
    wr: roundMetric(metrics?.wr, 2),
    pf: roundMetric(metrics?.pf, 2),
    dd: roundMetric(metrics?.dd, 2),
    avgBars: roundMetric(metrics?.avgBars, 2),
    wins: Number(metrics?.w || 0),
    losses: Number(metrics?.l || 0),
  };
}

async function runScenario({ symbol, bars, apiKey, stageConfig, timeoutMs }) {
  const run = await runMassiveOptionReplayBacktest({
    marketSymbol: symbol,
    bars,
    executionFidelity: "sub_candle",
    strategy: "rayalgo",
    signalTimeframe: "5m",
    rayalgoSettings: DEFAULT_RAYALGO_SETTINGS,
    rayalgoScoringConfig: normalizeRayAlgoScoringPreferences({ activeTimeframe: "5m" }),
    backtestV2StageConfig: stageConfig,
  }, { apiKey, timeoutMs });
  return run;
}

async function main() {
  const apiKey = String(process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("MASSIVE_API_KEY or POLYGON_API_KEY is required");
  }

  const symbol = String(parseArg("symbol", "SPY") || "SPY").toUpperCase();
  const preferredTf = String(parseArg("preferredTf", "5m") || "5m").toLowerCase() === "1m" ? "1m" : "5m";
  const outDir = parseArg("out", "output/research-outcome-analysis");
  const timeoutMs = parseNumberArg("timeoutMs", 45000);

  fs.mkdirSync(outDir, { recursive: true });

  const stageDefaults = cloneBacktestV2StageDefaults();
  const spot = await resolveResearchSpotHistory({
    symbol,
    apiKey,
    mode: "initial",
    preferredTf,
  });
  const bars = Array.isArray(spot?.intradayBars) ? spot.intradayBars : [];
  if (!bars.length) {
    throw new Error(spot?.error || `No spot bars returned for ${symbol}`);
  }

  const baselineStage = cloneBacktestV2StageDefaults();
  baselineStage.runSettings.startDate = bars[0]?.date || "";
  baselineStage.runSettings.endDate = bars[bars.length - 1]?.date || "";

  const baselineRun = await runScenario({
    symbol,
    bars,
    apiKey,
    stageConfig: baselineStage,
    timeoutMs,
  });

  const baselineMetrics = computeMetrics(baselineRun.trades || [], baselineStage.runSettings.initialCapital);
  const baselineTradeSummary = summarizeTrades(baselineRun.trades || []);

  const variantDefinitions = [
    {
      name: "allow_shorts_all_regimes",
      patchEntries: [
        { path: "entryGate.allow_shorts", value: true },
        { path: "entryGate.regime_filter", value: "none" },
      ],
    },
    {
      name: "conviction_0_60",
      patchEntries: [{ path: "entryGate.min_conviction", value: 0.60 }],
    },
    {
      name: "conviction_0_70",
      patchEntries: [{ path: "entryGate.min_conviction", value: 0.70 }],
    },
    {
      name: "strike_atm_below",
      patchEntries: [{ path: "dteSelection.strike_slot", value: "2" }],
    },
    {
      name: "strike_atm_above",
      patchEntries: [{ path: "dteSelection.strike_slot", value: "3" }],
    },
    {
      name: "floor_1dte",
      patchEntries: [
        { path: "dteSelection.base_dte_2m", value: 1 },
        { path: "dteSelection.base_dte_5m_morning", value: 1 },
        { path: "dteSelection.base_dte_5m_midday", value: 1 },
        { path: "dteSelection.base_dte_5m_power_hour", value: 1 },
        { path: "dteSelection.dte_floor", value: 1 },
      ],
    },
    {
      name: "no_layers",
      patchEntries: [{ path: "layers.max_layers_per_position", value: 1 }],
    },
    {
      name: "quality_combo",
      patchEntries: [
        { path: "entryGate.min_conviction", value: 0.60 },
        { path: "dteSelection.strike_slot", value: "2" },
        { path: "dteSelection.base_dte_2m", value: 1 },
        { path: "dteSelection.base_dte_5m_morning", value: 1 },
        { path: "dteSelection.base_dte_5m_midday", value: 1 },
        { path: "dteSelection.base_dte_5m_power_hour", value: 1 },
        { path: "dteSelection.dte_floor", value: 1 },
        { path: "layers.max_layers_per_position", value: 1 },
      ],
    },
  ];

  const variantResults = [];
  for (const variant of variantDefinitions) {
    const nextStage = applyStagePatch(structuredClone(baselineStage), variant.patchEntries);
    const run = await runScenario({
      symbol,
      bars,
      apiKey,
      stageConfig: nextStage,
      timeoutMs,
    });
    variantResults.push(summarizeVariant(
      variant.name,
      variant.patchEntries,
      run,
      baselineStage.runSettings.initialCapital,
    ));
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    symbol,
    preferredTf,
    baselineStageConfig: baselineStage,
    barCount: bars.length,
    spotDataMeta: spot?.meta || null,
    replayDatasetSummary: baselineRun.replayDatasetSummary || null,
    baselineMetrics,
    baselineTradeSummary: {
      byExit: sortSummaryBuckets(baselineTradeSummary.byExit),
      byLayer: sortSummaryBuckets(baselineTradeSummary.byLayer),
      byDte: sortSummaryBuckets(baselineTradeSummary.byDte),
      byHourBucket: sortSummaryBuckets(baselineTradeSummary.byHourBucket),
      byScoreBucket: sortSummaryBuckets(baselineTradeSummary.byScoreBucket),
    },
    bestVariantsByPnl: [...variantResults].sort((left, right) => Number(right.pnl || -Infinity) - Number(left.pnl || -Infinity)),
    bestVariantsByProfitFactor: [...variantResults].sort((left, right) => Number(right.pf || -Infinity) - Number(left.pf || -Infinity)),
    variantResults,
  };

  const filePath = path.join(outDir, `research-outcome-analysis-${symbol}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));

  console.log(JSON.stringify({
    filePath,
    symbol,
    barCount: bars.length,
    baselineMetrics,
    replayDatasetSummary: baselineRun.replayDatasetSummary || null,
    baselineTradeSummary: payload.baselineTradeSummary,
    topVariants: payload.bestVariantsByPnl.slice(0, 5),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
