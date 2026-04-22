import { aggregateBarsToMinutes } from "../../src/research/data/aggregateBars.js";
import { normalizeResearchStrategy } from "../../src/research/config/strategyPresets.js";
import { normalizeRayAlgoSettings } from "../../src/research/config/rayalgoSettings.js";
import {
  compileBacktestV2RuntimeBridge,
  filterBarsForBacktestV2Window,
} from "../../src/research/config/backtestV2RuntimeBridge.js";
import { resolveLegacyTopRailCompatFields } from "../../src/research/config/backtestLegacyInputMapping.js";
import { timeframeToMinutes } from "../../src/research/chart/timeframeModel.js";
import { normalizeRayAlgoScoringConfig } from "../../src/research/engine/rayalgoScoring.js";
import {
  collectReplayEntryCandidates,
  detectRegimes,
  normalizeRiskStopPolicy,
  runBacktest,
  runBacktestAsync,
} from "../../src/research/engine/runtime.js";
import { resolveMassiveOptionReplayDataset } from "./massiveClient.js";
import { resolveResearchSpotHistory } from "./researchSpotHistory.js";

function normalizeBars(bars = []) {
  return Array.isArray(bars) ? bars.filter(Boolean) : [];
}

function normalizeBooleanArray(values, expectedLength, fallback = true) {
  if (!Array.isArray(values) || values.length !== expectedLength) {
    return Array(expectedLength).fill(Boolean(fallback));
  }
  return values.map(Boolean);
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function normalizeSignalTimeframe(value, fallback = "5m") {
  const normalized = String(value || "").trim();
  return Number.isFinite(timeframeToMinutes(normalized)) ? normalized : fallback;
}

function hasFiniteNumber(value) {
  return value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number(value));
}

function normalizeOptionSelectionSpec(optionSelectionSpec = {}) {
  const hasMinDte = hasFiniteNumber(optionSelectionSpec?.minDte);
  const hasMaxDte = hasFiniteNumber(optionSelectionSpec?.maxDte);
  const hasTargetDte = hasFiniteNumber(optionSelectionSpec?.targetDte);
  const hasStrikeSlot = hasFiniteNumber(optionSelectionSpec?.strikeSlot);
  const rawMoneyness = String(optionSelectionSpec?.moneyness || "").trim().toLowerCase();
  const hasLegacyMoneyness = ["itm", "atm", "otm"].includes(rawMoneyness);
  const hasLegacyStrikeSteps = hasFiniteNumber(optionSelectionSpec?.strikeSteps);

  let minDte = hasMinDte ? clampNumber(optionSelectionSpec?.minDte, 0, 60, 0) : null;
  let maxDte = hasMaxDte ? clampNumber(optionSelectionSpec?.maxDte, 0, 60, 10) : null;

  if (minDte == null && maxDte == null && hasTargetDte) {
    const targetDte = clampNumber(optionSelectionSpec?.targetDte, 0, 60, 5);
    minDte = targetDte;
    maxDte = targetDte;
  } else {
    if (minDte == null) {
      minDte = maxDte ?? 0;
    }
    if (maxDte == null) {
      maxDte = minDte ?? 10;
    }
  }

  return {
    targetDte: hasTargetDte ? clampNumber(optionSelectionSpec?.targetDte, 0, 60, 5) : null,
    minDte,
    maxDte: Math.max(minDte, maxDte),
    strikeSlot: hasStrikeSlot ? clampNumber(optionSelectionSpec?.strikeSlot, 0, 5, 3) : null,
    moneyness: hasLegacyMoneyness ? rawMoneyness : null,
    strikeSteps: hasLegacyStrikeSteps ? clampNumber(optionSelectionSpec?.strikeSteps, 0, 25, 1) : null,
  };
}

function normalizeReplayRunRequest(payload = {}) {
  const sourceBars = normalizeBars(payload.bars);
  if (!sourceBars.length) {
    throw new Error("bars are required");
  }
  const marketSymbol = String(payload.marketSymbol || "SPY").trim().toUpperCase() || "SPY";
  const signalTimeframe = normalizeSignalTimeframe(payload.signalTimeframe);
  const rawOptionSelectionSpec = normalizeOptionSelectionSpec(payload.optionSelectionSpec);
  const backtestV2RuntimeBridge = compileBacktestV2RuntimeBridge({
    stageConfig: payload.backtestV2StageConfig || payload?.backtestV2RuntimeBridge?.stageConfig || null,
    signalTimeframe,
    fallbackCapital: payload.capital,
    fallbackDte: payload.dte,
    fallbackKellyFrac: payload.kellyFrac,
    fallbackMaxPositions: payload.maxPositions,
    fallbackRiskStopPolicy: payload.riskStopPolicy,
    fallbackOptionSelectionSpec: rawOptionSelectionSpec,
  });
  const bars = normalizeBars(filterBarsForBacktestV2Window(sourceBars, backtestV2RuntimeBridge.stageConfig));
  if (!bars.length) {
    throw new Error("bars are required after applying the staged backtest date window");
  }
  const compatFields = resolveLegacyTopRailCompatFields({
    stageConfig: backtestV2RuntimeBridge.stageConfig,
    runtimeBridge: backtestV2RuntimeBridge,
    fallbackFields: {
      ...payload,
      optionSelectionSpec: rawOptionSelectionSpec,
    },
  });

  return {
    marketSymbol,
    bars,
    capital: clampNumber(compatFields.capital, 100, 100000000, 25000),
    executionFidelity: String(payload.executionFidelity || "bar_close").trim().toLowerCase() === "sub_candle"
      ? "sub_candle"
      : "bar_close",
    strategy: normalizeResearchStrategy(payload.strategy),
    dte: clampNumber(compatFields.dte, 0, 60, 5),
    iv: clampNumber(payload.iv, 0.01, 5, 0.20),
    slPct: clampNumber(compatFields.slPct, 0.001, 5, 0.25),
    tpPct: clampNumber(compatFields.tpPct, 0.001, 10, 0.35),
    trailStartPct: clampNumber(compatFields.trailStartPct, 0.001, 5, 0.08),
    trailPct: clampNumber(compatFields.trailPct, 0.001, 5, 0.18),
    zombieBars: clampNumber(compatFields.zombieBars, 1, 500, 30),
    minConviction: clampNumber(compatFields.minConviction, 0, 1, 0.48),
    allowShorts: Boolean(compatFields.allowShorts),
    kellyFrac: clampNumber(compatFields.kellyFrac, 0, 5, 0.25),
    regimeFilter: String(compatFields.regimeFilter || "none").trim() || "none",
    maxPositions: clampNumber(compatFields.maxPositions, 1, 50, 4),
    sessionBlocks: normalizeBooleanArray(compatFields.sessionBlocks, 13, true),
    regimeAdapt: Boolean(compatFields.regimeAdapt),
    commPerContract: clampNumber(compatFields.commPerContract, 0, 1000, 0.65),
    slipBps: clampNumber(compatFields.slipBps, 0, 5000, 150),
    tradeDays: normalizeBooleanArray(compatFields.tradeDays, 5, true),
    signalTimeframe,
    rayalgoSettings: normalizeRayAlgoSettings(payload.rayalgoSettings || {}),
    rayalgoScoringConfig: normalizeRayAlgoScoringConfig({
      activeTimeframe: signalTimeframe,
      marketSymbol,
      ...(payload.rayalgoScoringConfig || {}),
    }),
    riskStopPolicy: normalizeRiskStopPolicy(compatFields.riskStopPolicy),
    optionSelectionSpec: normalizeOptionSelectionSpec(compatFields.optionSelectionSpec),
    positionSizingConfig: backtestV2RuntimeBridge.positionSizingConfig,
    riskStopConfig: backtestV2RuntimeBridge.riskStopConfig,
    backtestV2RuntimeBridge,
  };
}

async function hydrateReplayBarsIfNeeded(payload = {}, options = {}) {
  const sourceBars = normalizeBars(payload.bars);
  if (sourceBars.length) {
    return {
      ...payload,
      bars: sourceBars,
    };
  }

  const marketSymbol = String(payload.marketSymbol || "SPY").trim().toUpperCase() || "SPY";
  const signalTimeframe = normalizeSignalTimeframe(payload.signalTimeframe);
  const history = await resolveResearchSpotHistory({
    symbol: marketSymbol,
    apiKey: options.apiKey || payload.apiKey || "",
    mode: "full",
    preferredTf: signalTimeframe === "1m" || signalTimeframe === "2m" ? "1m" : "5m",
  });
  const hydratedBars = normalizeBars(history?.intradayBars);
  if (!hydratedBars.length) {
    throw new Error(`Unable to hydrate replay bars for ${marketSymbol}`);
  }

  return {
    ...payload,
    marketSymbol,
    bars: hydratedBars,
  };
}

function buildEmptyReplayRunResult() {
  return {
    trades: [],
    equity: [],
    skippedTrades: [],
    skippedByReason: {},
    replayDatasetSummary: {
      candidates: 0,
      resolved: 0,
      skipped: 0,
      uniqueContracts: 0,
    },
    firstResolvedContract: null,
  };
}

function buildReplayRuntimeConfig(normalized, signalTfMin) {
  return {
    executionMode: "option_history",
    executionBars: normalized.bars,
    executionFidelity: normalized.executionFidelity,
    strategy: normalized.strategy,
    dte: normalized.dte,
    iv: normalized.iv,
    slPct: normalized.slPct,
    tpPct: normalized.tpPct,
    trailStartPct: normalized.trailStartPct,
    trailPct: normalized.trailPct,
    zombieBars: normalized.zombieBars,
    minConviction: normalized.minConviction,
    allowShorts: normalized.allowShorts,
    kellyFrac: normalized.kellyFrac,
    regimeFilter: normalized.regimeFilter,
    maxPositions: normalized.maxPositions,
    capital: normalized.capital,
    sessionBlocks: normalized.sessionBlocks,
    tfMin: signalTfMin,
    regimeAdapt: normalized.regimeAdapt,
    commPerContract: normalized.commPerContract,
    slipBps: normalized.slipBps,
    tradeDays: normalized.tradeDays,
    signalTimeframe: normalized.signalTimeframe,
    rayalgoSettings: normalized.rayalgoSettings,
    rayalgoScoringConfig: normalized.rayalgoScoringConfig,
    positionSizingConfig: normalized.positionSizingConfig,
    riskStopConfig: normalized.riskStopConfig,
    backtestV2RuntimeBridge: normalized.backtestV2RuntimeBridge,
    riskStopPolicy: normalized.riskStopPolicy,
    optionSelectionSpec: normalized.optionSelectionSpec,
    includeIndicatorOverlays: true,
  };
}

function buildResolvedReplayRunResult({ result, replayCandidates, replayDataset, normalized }) {
  return {
    trades: result?.trades || [],
    equity: result?.equity || [],
    skippedTrades: result?.skippedTrades || [],
    skippedByReason: result?.skippedByReason || {},
    riskStop: result?.riskStop || null,
    rayalgoScoringContext: result?.rayalgoScoringContext || normalized.rayalgoScoringConfig,
    indicatorOverlayTape: result?.indicatorOverlayTape || { events: [], zones: [], windows: [] },
    replayDatasetSummary: replayDataset.counts || {
      candidates: replayCandidates.length,
      resolved: 0,
      skipped: replayCandidates.length,
      uniqueContracts: 0,
    },
    firstResolvedContract: replayDataset.firstResolvedContract || null,
  };
}

export async function runMassiveOptionReplayBacktest(payload = {}, options = {}) {
  const hydratedPayload = await hydrateReplayBarsIfNeeded(payload, options);
  const normalized = normalizeReplayRunRequest(hydratedPayload);
  const signalTfMin = Math.max(1, timeframeToMinutes(normalized.signalTimeframe) || 5);
  const signalBars = aggregateBarsToMinutes(normalized.bars, signalTfMin);
  if (!signalBars.length) {
    return buildEmptyReplayRunResult();
  }

  const regimes = detectRegimes(signalBars);
  const runtimeConfig = buildReplayRuntimeConfig(normalized, signalTfMin);

  const replayCandidates = collectReplayEntryCandidates(signalBars, regimes, runtimeConfig);
  const replayDataset = await resolveMassiveOptionReplayDataset(
    {
      underlyingTicker: normalized.marketSymbol,
      replayEndDate: signalBars[signalBars.length - 1]?.date || null,
      targetDte: normalized.optionSelectionSpec.targetDte,
      minDte: normalized.optionSelectionSpec.minDte,
      maxDte: normalized.optionSelectionSpec.maxDte,
      strikeSlot: normalized.optionSelectionSpec.strikeSlot,
      moneyness: normalized.optionSelectionSpec.moneyness,
      strikeSteps: normalized.optionSelectionSpec.strikeSteps,
      candidates: replayCandidates,
    },
    {
      apiKey: options.apiKey,
      timeoutMs: options.timeoutMs,
    },
  );

  const result = runBacktest(signalBars, regimes, {
    ...runtimeConfig,
    optionReplayDataset: replayDataset,
  });

  return buildResolvedReplayRunResult({
    result,
    replayCandidates,
    replayDataset,
    normalized,
  });
}

export async function streamMassiveOptionReplayBacktest(payload = {}, options = {}) {
  const emit = (event) => {
    if (typeof options.onEvent === "function") {
      options.onEvent(event);
    }
  };
  const isCancelled = typeof options.isCancelled === "function"
    ? options.isCancelled
    : (() => false);
  const payloadMarketSymbol = String(payload.marketSymbol || "SPY").trim().toUpperCase() || "SPY";
  const hasInlineBars = normalizeBars(payload.bars).length > 0;

  if (!hasInlineBars) {
    emit({
      type: "status",
      stage: "hydrating-bars",
      detail: `Loading ${payloadMarketSymbol} replay bars.`,
    });
  }

  const hydratedPayload = await hydrateReplayBarsIfNeeded(payload, options);
  if (isCancelled()) {
    return null;
  }

  const normalized = normalizeReplayRunRequest(hydratedPayload);
  const signalTfMin = Math.max(1, timeframeToMinutes(normalized.signalTimeframe) || 5);
  const signalBars = aggregateBarsToMinutes(normalized.bars, signalTfMin);
  if (!signalBars.length) {
    const emptyResult = buildEmptyReplayRunResult();
    emit({ type: "result", result: emptyResult });
    return emptyResult;
  }

  const regimes = detectRegimes(signalBars);
  const runtimeConfig = buildReplayRuntimeConfig(normalized, signalTfMin);
  const replayCandidates = collectReplayEntryCandidates(signalBars, regimes, runtimeConfig);

  emit({
    type: "status",
    stage: "resolving-contracts",
    detail: replayCandidates.length
      ? `0/${replayCandidates.length} replay candidates processed.`
      : "No replay candidates were generated.",
    counts: {
      processed: 0,
      candidates: replayCandidates.length,
      resolved: 0,
      skipped: 0,
      uniqueContracts: 0,
    },
  });

  const replayDataset = await resolveMassiveOptionReplayDataset(
    {
      underlyingTicker: normalized.marketSymbol,
      replayEndDate: signalBars[signalBars.length - 1]?.date || null,
      targetDte: normalized.optionSelectionSpec.targetDte,
      minDte: normalized.optionSelectionSpec.minDte,
      maxDte: normalized.optionSelectionSpec.maxDte,
      strikeSlot: normalized.optionSelectionSpec.strikeSlot,
      moneyness: normalized.optionSelectionSpec.moneyness,
      strikeSteps: normalized.optionSelectionSpec.strikeSteps,
      candidates: replayCandidates,
    },
    {
      apiKey: options.apiKey,
      timeoutMs: options.timeoutMs,
      onProgress(progress) {
        emit({
          type: "status",
          stage: "resolving-contracts",
          detail: `${progress.processed}/${progress.candidates} replay candidates processed.`,
          counts: progress,
        });
      },
    },
  );

  if (isCancelled()) {
    return null;
  }

  emit({
    type: "status",
    stage: "running-runtime",
    detail: `Resolved ${replayDataset.counts?.resolved || 0} contracts across ${replayDataset.counts?.uniqueContracts || 0} tickers.`,
    counts: replayDataset.counts || null,
  });

  const result = await runBacktestAsync(
    signalBars,
    regimes,
    {
      ...runtimeConfig,
      optionReplayDataset: replayDataset,
    },
    (progress) => {
      emit({
        type: "progress",
        progress,
        replayDatasetSummary: replayDataset.counts || null,
        firstResolvedContract: replayDataset.firstResolvedContract || null,
      });
    },
    isCancelled,
  );

  if (!result || isCancelled()) {
    return null;
  }

  const finalResult = buildResolvedReplayRunResult({
    result,
    replayCandidates,
    replayDataset,
    normalized,
  });
  emit({
    type: "status",
    stage: "finalizing",
    detail: `Finalized ${finalResult.trades.length} trades.`,
    counts: replayDataset.counts || null,
  });
  emit({ type: "result", result: finalResult });
  return finalResult;
}
