#!/usr/bin/env node

import fs from "fs";
import path from "path";

import { cloneBacktestV2StageDefaults } from "../src/research/config/backtestV2StagingConfig.js";
import { DEFAULT_RAYALGO_SETTINGS } from "../src/research/config/rayalgoSettings.js";
import { normalizeRayAlgoScoringPreferences } from "../src/research/engine/rayalgoScoring.js";
import { computeMetrics } from "../src/research/engine/runtime.js";
import { resolveResearchSpotHistory } from "../server/services/researchSpotHistory.js";
import { runMassiveOptionReplayBacktest } from "../server/services/researchBacktest.js";

const POCKET_DEFINITIONS = Object.freeze([
  {
    key: "trend_change_long",
    label: "Trend Change Long",
    path: "entryGate.rayalgo_trend_change_long_min_quality_score",
    signalClass: "trend_change",
    direction: "long",
  },
  {
    key: "trend_change_short",
    label: "Trend Change Short",
    path: "entryGate.rayalgo_trend_change_short_min_quality_score",
    signalClass: "trend_change",
    direction: "short",
  },
]);

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

function summarizePocketTrades(trades = []) {
  const summary = {};
  for (const trade of Array.isArray(trades) ? trades : []) {
    const signalClass = String(trade?.signalClass || "unknown").trim().toLowerCase() || "unknown";
    const direction = String(trade?.dir || "unknown").trim().toLowerCase() || "unknown";
    const key = `${signalClass}_${direction}`;
    const bucket = summary[key] || {
      signalClass,
      direction,
      tradeCount: 0,
      pnl: 0,
      totalScoreAtEntry: 0,
      totalRequiredQualityScoreAtEntry: 0,
      requiredQualityScoreSamples: 0,
    };
    bucket.tradeCount += 1;
    bucket.pnl += Number(trade?.pnl || 0);
    bucket.totalScoreAtEntry += Number(trade?.scoreAtEntry || 0);
    const requiredFloor = Number(trade?.requiredQualityScoreAtEntry);
    if (Number.isFinite(requiredFloor)) {
      bucket.totalRequiredQualityScoreAtEntry += requiredFloor;
      bucket.requiredQualityScoreSamples += 1;
    }
    summary[key] = bucket;
  }

  return Object.fromEntries(
    Object.entries(summary)
      .sort((left, right) => Number(right[1]?.tradeCount || 0) - Number(left[1]?.tradeCount || 0))
      .map(([key, value]) => [key, {
        signalClass: value.signalClass,
        direction: value.direction,
        tradeCount: value.tradeCount,
        pnl: roundMetric(value.pnl, 2),
        avgScoreAtEntry: value.tradeCount ? roundMetric(value.totalScoreAtEntry / value.tradeCount, 3) : null,
        avgRequiredQualityScoreAtEntry: value.requiredQualityScoreSamples
          ? roundMetric(value.totalRequiredQualityScoreAtEntry / value.requiredQualityScoreSamples, 3)
          : null,
      }]),
  );
}

function summarizeVariant({ name, pocket = null, floor = null, patchEntries = [], run, capital }) {
  const metrics = computeMetrics(run?.trades || [], capital);
  const pocketTrades = summarizePocketTrades(run?.trades || []);
  const affectedPocket = pocket ? pocketTrades[pocket.key] || {
    signalClass: pocket.signalClass,
    direction: pocket.direction,
    tradeCount: 0,
    pnl: 0,
    avgScoreAtEntry: null,
    avgRequiredQualityScoreAtEntry: null,
  } : null;
  return {
    name,
    pocketKey: pocket?.key || null,
    pocketLabel: pocket?.label || null,
    floor,
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
    pocketTrades,
    affectedPocket,
    skippedByReason: run?.skippedByReason || {},
    replayDatasetSummary: run?.replayDatasetSummary || null,
  };
}

function buildDelta(baseline, variant) {
  return {
    tradeCount: Number(variant?.tradeCount || 0) - Number(baseline?.tradeCount || 0),
    pnl: roundMetric(Number(variant?.pnl || 0) - Number(baseline?.pnl || 0), 2),
    roi: roundMetric(Number(variant?.roi || 0) - Number(baseline?.roi || 0), 2),
    wr: roundMetric(Number(variant?.wr || 0) - Number(baseline?.wr || 0), 2),
    pf: roundMetric(Number(variant?.pf || 0) - Number(baseline?.pf || 0), 2),
    dd: roundMetric(Number(variant?.dd || 0) - Number(baseline?.dd || 0), 2),
    avgBars: roundMetric(Number(variant?.avgBars || 0) - Number(baseline?.avgBars || 0), 2),
    affectedPocketTradeCount: Number(variant?.affectedPocket?.tradeCount || 0) - Number(baseline?.affectedPocket?.tradeCount || 0),
    affectedPocketPnl: roundMetric(Number(variant?.affectedPocket?.pnl || 0) - Number(baseline?.affectedPocket?.pnl || 0), 2),
  };
}

async function runScenario({ symbol, bars, apiKey, stageConfig, signalTimeframe, timeoutMs }) {
  return runMassiveOptionReplayBacktest({
    marketSymbol: symbol,
    bars,
    executionFidelity: "sub_candle",
    strategy: "rayalgo",
    signalTimeframe,
    rayalgoSettings: DEFAULT_RAYALGO_SETTINGS,
    rayalgoScoringConfig: normalizeRayAlgoScoringPreferences({ activeTimeframe: signalTimeframe }),
    backtestV2StageConfig: stageConfig,
  }, { apiKey, timeoutMs });
}

async function resolveBars({ symbol, apiKey, mode, initialDays, preferredTf }) {
  const spot = await resolveResearchSpotHistory({
    symbol,
    apiKey,
    mode,
    initialDays,
    preferredTf,
  });
  const bars = Array.isArray(spot?.intradayBars) ? spot.intradayBars : [];
  if (!bars.length) {
    throw new Error(spot?.error || `No spot bars returned for ${symbol}`);
  }
  return { bars, meta: spot?.meta || null };
}

function resolveRunWindowDates(bars = [], runWindowDays = null) {
  const uniqueDates = [...new Set((Array.isArray(bars) ? bars : []).map((bar) => String(bar?.date || "").trim()).filter(Boolean))];
  if (!uniqueDates.length) {
    return { startDate: "", endDate: "" };
  }
  const normalizedRunWindowDays = Math.max(1, Math.round(Number(runWindowDays) || uniqueDates.length));
  const startIndex = Math.max(0, uniqueDates.length - normalizedRunWindowDays);
  return {
    startDate: uniqueDates[startIndex] || uniqueDates[0],
    endDate: uniqueDates[uniqueDates.length - 1] || uniqueDates[0],
  };
}

function buildBaselineStageConfig(bars, { allowShorts = true, regimeFilter = "none", runWindowDays = null } = {}) {
  const stage = cloneBacktestV2StageDefaults();
  const { startDate, endDate } = resolveRunWindowDates(bars, runWindowDays);
  stage.runSettings.startDate = startDate;
  stage.runSettings.endDate = endDate;
  stage.entryGate.allow_shorts = allowShorts;
  stage.entryGate.regime_filter = regimeFilter;
  return stage;
}

async function main() {
  const apiKey = String(process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("MASSIVE_API_KEY or POLYGON_API_KEY is required");
  }

  const symbols = parseListArg("symbols", ["SPY", "QQQ"]).map((value) => value.toUpperCase());
  const selectedPocketKeys = new Set(parseListArg("pockets", POCKET_DEFINITIONS.map((pocket) => pocket.key)));
  const pockets = POCKET_DEFINITIONS.filter((pocket) => selectedPocketKeys.has(pocket.key));
  if (!pockets.length) {
    throw new Error("No valid pockets selected");
  }
  const values = parseListArg("values", ["0.45", "0.50", "0.55", "0.60"]).map(Number).filter(Number.isFinite);
  if (!values.length) {
    throw new Error("At least one numeric floor value is required");
  }

  const mode = String(parseArg("mode", "full") || "full").trim().toLowerCase() === "initial" ? "initial" : "full";
  const initialDays = parseNumberArg("days", 60);
  const signalTimeframe = String(parseArg("signalTimeframe", "5m") || "5m").trim();
  const preferredTf = String(parseArg("preferredTf", signalTimeframe === "1m" || signalTimeframe === "2m" ? "1m" : "5m") || "5m").trim().toLowerCase() === "1m" ? "1m" : "5m";
  const timeoutMs = parseNumberArg("timeoutMs", 120000);
  const runWindowDays = parseNumberArg("runWindowDays", 10);
  const outDir = parseArg("out", "output/rayalgo-entry-floor-sweep");
  const regimeFilter = String(parseArg("regimeFilter", "none") || "none").trim().toLowerCase() === "none" ? "none" : "not_bear";
  const allowShorts = String(parseArg("allowShorts", "true") || "true").trim().toLowerCase() !== "false";

  fs.mkdirSync(outDir, { recursive: true });

  const payload = {
    generatedAt: new Date().toISOString(),
    mode,
    initialDays,
    signalTimeframe,
    preferredTf,
    values,
    regimeFilter,
    allowShorts,
    runWindowDays,
    symbols: {},
  };

  for (const symbol of symbols) {
    const { bars, meta } = await resolveBars({ symbol, apiKey, mode, initialDays, preferredTf });
    const capital = Number(cloneBacktestV2StageDefaults().runSettings?.initialCapital || 25000);
    const pocketSweeps = {};

    for (const pocket of pockets) {
      const baselineStage = buildBaselineStageConfig(bars, { allowShorts, regimeFilter, runWindowDays });
      const baselineRun = await runScenario({
        symbol,
        bars,
        apiKey,
        stageConfig: baselineStage,
        signalTimeframe,
        timeoutMs,
      });
      const baselineSummary = summarizeVariant({
        name: `${pocket.key}_baseline`,
        pocket,
        patchEntries: [],
        run: baselineRun,
        capital,
      });

      const variants = [];
      for (const floor of values) {
        const patchEntries = [{ path: pocket.path, value: floor }];
        const stageConfig = applyStagePatch(structuredClone(baselineStage), patchEntries);
        const run = await runScenario({
          symbol,
          bars,
          apiKey,
          stageConfig,
          signalTimeframe,
          timeoutMs,
        });
        const summary = summarizeVariant({
          name: `${pocket.key}_${floor.toFixed(2)}`,
          pocket,
          floor,
          patchEntries,
          run,
          capital,
        });
        summary.deltaFromBaseline = buildDelta(baselineSummary, summary);
        variants.push(summary);
      }

      pocketSweeps[pocket.key] = {
        pocket,
        baselineStageConfig: baselineStage,
        baseline: baselineSummary,
        variantsByPnl: [...variants].sort((left, right) => Number(right.pnl || -Infinity) - Number(left.pnl || -Infinity)),
        variantsByProfitFactor: [...variants].sort((left, right) => Number(right.pf || -Infinity) - Number(left.pf || -Infinity)),
        variantsByDrawdown: [...variants].sort((left, right) => Number(left.dd || Infinity) - Number(right.dd || Infinity)),
        variants,
      };
    }

    payload.symbols[symbol] = {
      barCount: bars.length,
      spotDataMeta: meta,
      pocketSweeps,
    };
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(outDir, `rayalgo-entry-floor-sweep-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));

  const compact = {
    filePath,
    generatedAt: payload.generatedAt,
    mode,
    signalTimeframe,
    preferredTf,
    values,
    runWindowDays,
    symbols: Object.fromEntries(Object.entries(payload.symbols).map(([symbol, data]) => [symbol, {
      bestByPocket: Object.fromEntries(Object.entries(data.pocketSweeps).map(([pocketKey, sweep]) => [pocketKey, {
        baseline: {
          tradeCount: sweep.baseline.tradeCount,
          pnl: sweep.baseline.pnl,
          roi: sweep.baseline.roi,
          wr: sweep.baseline.wr,
          pf: sweep.baseline.pf,
          dd: sweep.baseline.dd,
          affectedPocket: sweep.baseline.affectedPocket,
        },
        bestPnl: sweep.variantsByPnl[0] || null,
        bestProfitFactor: sweep.variantsByProfitFactor[0] || null,
        lowestDrawdown: sweep.variantsByDrawdown[0] || null,
      }])),
    }])),
  };

  console.log(JSON.stringify(compact, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
