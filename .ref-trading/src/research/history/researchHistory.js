import { normalizeRayAlgoScoringPreferences } from "../engine/rayalgoScoring.js";
import { normalizeBacktestV2StageConfig } from "../config/backtestV2RuntimeBridge.js";
import {
  DEFAULT_RAYALGO_CANDLE_COLOR_MODE,
  normalizeRayalgoCandleColorMode,
} from "../chart/rayalgoCandleColorMode.js";
import { DEFAULT_CHART_TYPE, normalizeChartType } from "../chart/volumeChartType.js";

const MAX_RUN_HISTORY = 24;
const MAX_OPTIMIZER_HISTORY = 12;
const MAX_STORED_TRADES = 120;
const MAX_STORED_SKIPPED_TRADES = 120;
const MAX_STORED_EQUITY_POINTS = 400;
const MAX_STORED_OPTIMIZER_CANDIDATES = 20;

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function round(value, precision = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return +numeric.toFixed(precision);
}

function normalizeTrade(trade = {}) {
  return {
    ts: normalizeText(trade.ts),
    et: normalizeText(trade.et),
    optionTicker: normalizeText(trade.optionTicker),
    expiryDate: normalizeText(trade.expiryDate),
    strat: normalizeText(trade.strat),
    dir: normalizeText(trade.dir),
    entryIV: round(trade.entryIV, 2),
    oe: round(trade.oe, 2),
    qty: Number.isFinite(Number(trade.qty)) ? Number(trade.qty) : null,
    ep: round(trade.ep, 2),
    pnl: round(trade.pnl, 2),
    fees: round(trade.fees, 2),
    bh: Number.isFinite(Number(trade.bh)) ? Number(trade.bh) : null,
    er: normalizeText(trade.er),
    regime: normalizeText(trade.regime),
    rawScoreAtEntry: round(trade.rawScoreAtEntry, 3),
    precursorBonusAtEntry: round(trade.precursorBonusAtEntry, 3),
    scoreAtEntry: round(trade.scoreAtEntry ?? trade.conv, 3),
    precursorLadderId: normalizeText(trade.precursorLadderId) || null,
    signalRole: normalizeText(trade.signalRole) || null,
    scoringVersion: normalizeText(trade.scoringVersion) || null,
    executionProfile: normalizeText(trade.executionProfile) || null,
    scoringAuthorityApplied: normalizeText(trade.scoringAuthorityApplied) || null,
    sizeUpgradeApplied: Boolean(trade.sizeUpgradeApplied),
    sizeUpgradeMultiplier: round(trade.sizeUpgradeMultiplier, 3),
    sizingConvictionApplied: round(trade.sizingConvictionApplied, 3),
  };
}

function normalizeRayAlgoScoringContext(context = null) {
  if (!context || typeof context !== "object") {
    return null;
  }
  return {
    executionProfile: normalizeText(context.executionProfile) || null,
    scoringVersion: normalizeText(context.scoringVersion) || null,
    activeTimeframe: normalizeText(context.activeTimeframe) || null,
    precursorLadderId: normalizeText(context.precursorLadderId) || null,
    precursorFrames: Array.isArray(context.precursorFrames) ? [...context.precursorFrames] : [],
    conflictPolicy: normalizeText(context.conflictPolicy) || null,
    authority: normalizeText(context.authority) || null,
    displayModePreference: normalizeText(context.displayModePreference) || null,
    displayScoreMode: normalizeText(context.displayScoreMode || context.displayMode) || null,
    signalRole: normalizeText(context.signalRole) || null,
    dataStatus: normalizeText(context.dataStatus) || null,
    availableFrames: Array.isArray(context.availableFrames) ? [...context.availableFrames] : [],
    missingFrames: Array.isArray(context.missingFrames) ? [...context.missingFrames] : [],
    executionFrameMinutes: Number.isFinite(Number(context.executionFrameMinutes))
      ? Number(context.executionFrameMinutes)
      : null,
  };
}

function normalizeRayAlgoScoringConfig(config = null) {
  if (!config || typeof config !== "object") {
    return null;
  }
  const normalized = normalizeRayAlgoScoringPreferences(config);
  return {
    precursorLadderId: normalizeText(normalized.precursorLadderId) || null,
    conflictPolicy: normalizeText(normalized.conflictPolicy) || null,
    authority: normalizeText(normalized.authority) || null,
    displayMode: normalizeText(normalized.displayMode) || null,
  };
}

function normalizeEquityPoint(point = {}, index = 0) {
  return {
    i: Number.isFinite(Number(point.i)) ? Number(point.i) : index + 1,
    bal: round(point.bal, 2) ?? 0,
    ts: normalizeText(point.ts) || null,
  };
}

function normalizeRiskStop(riskStop = null) {
  if (!riskStop || typeof riskStop !== "object") {
    return null;
  }
  return {
    policy: normalizeText(riskStop.policy) || null,
    triggered: Boolean(riskStop.triggered || riskStop.haltTriggered),
    reason: normalizeText(riskStop.reason || riskStop.haltReason) || null,
    triggerTs: normalizeText(riskStop.triggerTs) || null,
    triggerDate: normalizeText(riskStop.triggerDate) || null,
    peakDrawdownPct: round(riskStop.peakDrawdownPct, 2),
    dayLossPct: round(riskStop.dayLossPct, 2),
    config: riskStop.config && typeof riskStop.config === "object" ? { ...riskStop.config } : null,
  };
}

function normalizeMetrics(metrics = {}) {
  const profitFactor = metrics.pf === "∞" ? 99 : Number(metrics.pf);
  return {
    n: Number.isFinite(Number(metrics.n)) ? Number(metrics.n) : 0,
    wr: round(metrics.wr, 1),
    exp: round(metrics.exp, 2),
    roi: round(metrics.roi, 1),
    pf: Number.isFinite(profitFactor) ? round(profitFactor, 2) : null,
    sharpe: round(metrics.sharpe, 2),
    dd: round(metrics.dd, 1),
    pnl: round(metrics.pnl, 2),
    avgBars: round(metrics.avgBars, 1),
  };
}

function normalizeSetupSnapshot(setup = {}) {
  return {
    topRail: {
      marketSymbol: normalizeText(setup?.topRail?.marketSymbol, "SPY"),
      strategy: normalizeText(setup?.topRail?.strategy, "smc"),
      executionFidelity: normalizeText(setup?.topRail?.executionFidelity, "sub_candle"),
      optionCandleTf: normalizeText(setup?.topRail?.optionCandleTf, "1m"),
      chartsLinked: setup?.topRail?.chartsLinked !== false,
    },
    rayalgo: {
      candleTf: normalizeText(setup?.rayalgo?.candleTf, "auto"),
      spotChartType: normalizeChartType(setup?.rayalgo?.spotChartType, DEFAULT_CHART_TYPE),
      optionChartType: normalizeChartType(setup?.rayalgo?.optionChartType, DEFAULT_CHART_TYPE),
      rayalgoCandleColorMode: normalizeRayalgoCandleColorMode(
        setup?.rayalgo?.rayalgoCandleColorMode,
        DEFAULT_RAYALGO_CANDLE_COLOR_MODE,
      ),
      chartRange: normalizeText(setup?.rayalgo?.chartRange, "1W"),
      chartWindowMode: normalizeText(setup?.rayalgo?.chartWindowMode, "default"),
      indicatorSelections: Array.isArray(setup?.rayalgo?.indicatorSelections) ? [...setup.rayalgo.indicatorSelections] : [],
      indicatorOverlays: setup?.rayalgo?.indicatorOverlays || {},
      rayalgoSettings: setup?.rayalgo?.rayalgoSettings || null,
      rayalgoWatcher: setup?.rayalgo?.rayalgoWatcher || null,
      stagedConfigUi: normalizeBacktestV2StageConfig(setup?.rayalgo?.stagedConfigUi || null),
      selectedRayalgoBundleId: normalizeText(setup?.rayalgo?.selectedRayalgoBundleId) || null,
      scoringConfig: normalizeRayAlgoScoringConfig(
        setup?.rayalgo?.scoringConfig || setup?.rayalgo?.rayalgoScoringConfig || null,
      ),
      scoringContext: normalizeRayAlgoScoringContext(setup?.rayalgo?.scoringContext || null),
    },
  };
}

function normalizeBundleContext(bundleContext = {}) {
  return {
    bundleId: normalizeText(bundleContext?.bundleId) || null,
    label: normalizeText(bundleContext?.label),
    tier: normalizeText(bundleContext?.tier, "test"),
    isCustom: Boolean(bundleContext?.isCustom),
  };
}

function normalizeBucketRow(row = {}) {
  return {
    key: normalizeText(row.key),
    label: normalizeText(row.label),
    trades: Number.isFinite(Number(row.trades)) ? Number(row.trades) : 0,
    expectancyR: round(row.expectancyR, 2),
    maxDrawdownPct: round(row.maxDrawdownPct, 1),
    winRatePct: round(row.winRatePct, 1),
    profitFactor: round(row.profitFactor, 2),
    netReturnPct: round(row.netReturnPct, 1),
    avgHoldBars: round(row.avgHoldBars, 1),
    netPnl: round(row.netPnl, 2),
  };
}

function normalizeBundleEvaluation(bundleEvaluation = null) {
  if (!bundleEvaluation || typeof bundleEvaluation !== "object") {
    return null;
  }
  const summary = bundleEvaluation.summary || {};
  const report = bundleEvaluation.report || {};
  return {
    summary: {
      tierSuggestion: normalizeText(summary.tierSuggestion, "test"),
      trades: Number.isFinite(Number(summary.trades)) ? Number(summary.trades) : 0,
      expectancyR: round(summary.expectancyR, 2),
      maxDrawdownPct: round(summary.maxDrawdownPct, 1),
      winRatePct: round(summary.winRatePct, 1),
      profitFactor: round(summary.profitFactor, 2),
      netReturnPct: round(summary.netReturnPct, 1),
      avgHoldBars: round(summary.avgHoldBars, 1),
      holdoutExpectancyR: round(summary.holdoutExpectancyR, 2),
      holdoutProfitFactor: round(summary.holdoutProfitFactor, 2),
      holdoutMaxDrawdownPct: round(summary.holdoutMaxDrawdownPct, 1),
      sessionBadges: Array.isArray(summary.sessionBadges) ? [...summary.sessionBadges] : [],
      regimeBadges: Array.isArray(summary.regimeBadges) ? [...summary.regimeBadges] : [],
      statusText: normalizeText(summary.statusText),
      experimentalEligible: Boolean(summary.experimentalEligible),
      coreEligible: Boolean(summary.coreEligible),
    },
    report: {
      fullSample: normalizeBucketRow(report.fullSample),
      inSample: normalizeBucketRow(report.inSample),
      holdout: normalizeBucketRow(report.holdout),
      validation: {
        tierSuggestion: normalizeText(report?.validation?.tierSuggestion, "test"),
        statusText: normalizeText(report?.validation?.statusText),
        experimentalEligible: Boolean(report?.validation?.experimentalEligible),
        coreEligible: Boolean(report?.validation?.coreEligible),
        checks: Array.isArray(report?.validation?.checks)
          ? report.validation.checks.map((check) => ({
            key: normalizeText(check.key),
            label: normalizeText(check.label),
            passed: Boolean(check.passed),
            detail: normalizeText(check.detail),
          }))
          : [],
      },
      sessions: Array.isArray(report.sessions) ? report.sessions.map(normalizeBucketRow) : [],
      regimes: Array.isArray(report.regimes) ? report.regimes.map(normalizeBucketRow) : [],
      volatility: Array.isArray(report.volatility) ? report.volatility.map(normalizeBucketRow) : [],
      volatilityThresholds: {
        p10: round(report?.volatilityThresholds?.p10, 2),
        p25: round(report?.volatilityThresholds?.p25, 2),
        p75: round(report?.volatilityThresholds?.p75, 2),
        p90: round(report?.volatilityThresholds?.p90, 2),
      },
    },
  };
}

function normalizeSkippedByReason(value = {}) {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, count]) => [normalizeText(key), Number(count) || 0])
      .filter(([key]) => key),
  );
}

export function createResearchRunHistoryEntry({
  runId,
  resultId = null,
  createdAt = Date.now(),
  marketSymbol = "SPY",
  setup = {},
  selectedBundle = null,
  isCustom = false,
  metrics = {},
  trades = [],
  equity = [],
  skippedTrades = [],
  skippedByReason = {},
  bundleEvaluation = null,
  replayMeta = {},
  riskStop = null,
  rayalgoScoringContext = null,
  dataSource = "",
  spotDataMeta = null,
  bookmarkedAt = null,
} = {}) {
  const normalizedSetup = normalizeSetupSnapshot(setup);
  const normalizedMetrics = normalizeMetrics(metrics);
  const normalizedBundle = normalizeBundleContext({
    bundleId: selectedBundle?.id,
    label: selectedBundle?.label,
    tier: selectedBundle?.evaluation?.tier,
    isCustom,
  });
  const normalizedResultId = normalizeText(resultId) || null;
  const shouldStoreLocalPayload = !normalizedResultId;
  const compactTrades = shouldStoreLocalPayload
    ? (Array.isArray(trades) ? trades : []).slice(-MAX_STORED_TRADES).map(normalizeTrade)
    : [];
  const compactSkippedTrades = shouldStoreLocalPayload
    ? (Array.isArray(skippedTrades) ? skippedTrades : []).slice(-MAX_STORED_SKIPPED_TRADES).map(normalizeTrade)
    : [];
  const compactEquity = shouldStoreLocalPayload
    ? (Array.isArray(equity) ? equity : []).slice(-MAX_STORED_EQUITY_POINTS).map(normalizeEquityPoint)
    : [];
  const normalizedBundleEvaluation = normalizeBundleEvaluation(bundleEvaluation);
  const normalizedRiskStop = normalizeRiskStop(riskStop);
  const normalizedScoringContext = normalizeRayAlgoScoringContext(rayalgoScoringContext || normalizedSetup?.rayalgo?.scoringContext || null);
  const entry = {
    id: normalizeText(runId, `run-${createdAt}`),
    resultId: normalizedResultId,
    type: "backtest_run",
    createdAt: Number(createdAt) || Date.now(),
    marketSymbol: normalizeText(marketSymbol, "SPY"),
    strategy: normalizeText(normalizedSetup.topRail.strategy, "smc"),
    setup: normalizedSetup,
    bundleContext: normalizedBundle,
    metrics: normalizedMetrics,
    trades: compactTrades,
    equity: compactEquity,
    tradeCount: normalizedMetrics.n,
    skippedTrades: compactSkippedTrades,
    skippedTradeCount: Array.isArray(skippedTrades) ? skippedTrades.length : 0,
    skippedByReason: normalizeSkippedByReason(skippedByReason),
    bookmarkedAt: normalizeText(bookmarkedAt) || null,
    hasStoredPayload: shouldStoreLocalPayload,
    replayMeta: {
      selectionSummaryLabel: normalizeText(replayMeta?.selectionSummaryLabel),
      replayRunStatus: normalizeText(replayMeta?.replayRunStatus, "ready"),
      replayRunError: normalizeText(replayMeta?.replayRunError),
      replayDatasetSummary: replayMeta?.replayDatasetSummary || null,
      replaySampleLabel: normalizeText(replayMeta?.replaySampleLabel),
      dataSource: normalizeText(dataSource),
      spotSource: normalizeText(spotDataMeta?.source),
      spotDataStale: Boolean(spotDataMeta?.stale),
    },
    riskStop: normalizedRiskStop,
    rayalgoScoringContext: normalizedScoringContext,
    bundleEvaluation: normalizedBundleEvaluation,
  };
  entry.signature = JSON.stringify({
    marketSymbol: entry.marketSymbol,
    strategy: entry.strategy,
    setup: entry.setup,
    bundleContext: entry.bundleContext,
    metrics: entry.metrics,
  });
  return entry;
}

export function createResearchOptimizerHistoryEntry({
  batchId,
  createdAt = Date.now(),
  marketSymbol = "SPY",
  setup = {},
  selectedBundle = null,
  isCustom = false,
  results = [],
} = {}) {
  const normalizedSetup = normalizeSetupSnapshot(setup);
  const normalizedBundle = normalizeBundleContext({
    bundleId: selectedBundle?.id,
    label: selectedBundle?.label,
    tier: selectedBundle?.evaluation?.tier,
    isCustom,
  });
  const candidates = (Array.isArray(results) ? results : [])
    .slice(0, MAX_STORED_OPTIMIZER_CANDIDATES)
    .map((result, index) => ({
      id: normalizeText(result.id, `${batchId || "opt"}-${index + 1}`),
      strategy: normalizeText(result.strategy, normalizedSetup.topRail.strategy),
      dte: Number.isFinite(Number(result.dte)) ? Number(result.dte) : 0,
      exit: normalizeText(result.exit),
      sl: round(result.sl, 3),
      tp: round(result.tp, 3),
      trailStartPct: round(result.trailStartPct ?? result.ts, 3),
      trailPct: round(result.trailPct ?? result.tr, 3),
      regime: normalizeText(result.regime, "none"),
      n: Number.isFinite(Number(result.n)) ? Number(result.n) : 0,
      exp: round(result.exp, 2),
      roi: round(result.roi, 1),
      wr: round(result.wr, 1),
      pf: result.pf === "∞" ? 99 : round(result.pf, 2),
      sharpe: round(result.sharpe, 2),
      dd: round(result.dd, 1),
      pnl: round(result.pnl, 2),
      score: round(result.score, 4),
      bundleEvaluation: normalizeBundleEvaluation(result.bundleEvaluation || null),
    }));
  const entry = {
    id: normalizeText(batchId, `optimizer-${createdAt}`),
    type: "optimizer_batch",
    createdAt: Number(createdAt) || Date.now(),
    marketSymbol: normalizeText(marketSymbol, "SPY"),
    strategy: normalizeText(normalizedSetup.topRail.strategy, "smc"),
    setup: normalizedSetup,
    bundleContext: normalizedBundle,
    candidates,
    bestCandidateId: candidates[0]?.id || null,
  };
  entry.signature = JSON.stringify({
    marketSymbol: entry.marketSymbol,
    strategy: entry.strategy,
    setup: entry.setup,
    topCandidates: candidates.slice(0, 5).map((candidate) => ({
      dte: candidate.dte,
      exit: candidate.exit,
      score: candidate.score,
      n: candidate.n,
    })),
  });
  return entry;
}

export function normalizeResearchRunHistory(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => createResearchRunHistoryEntry(entry))
    .sort((left, right) => Number(right.createdAt) - Number(left.createdAt))
    .slice(0, MAX_RUN_HISTORY);
}

export function normalizeResearchOptimizerHistory(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => createResearchOptimizerHistoryEntry(entry))
    .sort((left, right) => Number(right.createdAt) - Number(left.createdAt))
    .slice(0, MAX_OPTIMIZER_HISTORY);
}

export function normalizeResearchHistoryStore(store = {}) {
  return {
    runHistory: normalizeResearchRunHistory(store?.runHistory),
    optimizerHistory: normalizeResearchOptimizerHistory(store?.optimizerHistory),
  };
}

export function mergeResearchRunHistory(...sources) {
  const seenIds = new Set();
  const seenSignatures = new Set();
  const merged = [];

  for (const source of sources) {
    for (const entry of normalizeResearchRunHistory(source)) {
      const entryId = normalizeText(entry?.id);
      const signature = normalizeText(entry?.signature);
      if ((entryId && seenIds.has(entryId)) || (signature && seenSignatures.has(signature))) {
        continue;
      }
      if (entryId) {
        seenIds.add(entryId);
      }
      if (signature) {
        seenSignatures.add(signature);
      }
      merged.push(entry);
    }
  }

  return normalizeResearchRunHistory(merged);
}

export function mergeResearchOptimizerHistory(...sources) {
  const seenIds = new Set();
  const seenSignatures = new Set();
  const merged = [];

  for (const source of sources) {
    for (const entry of normalizeResearchOptimizerHistory(source)) {
      const entryId = normalizeText(entry?.id);
      const signature = normalizeText(entry?.signature);
      if ((entryId && seenIds.has(entryId)) || (signature && seenSignatures.has(signature))) {
        continue;
      }
      if (entryId) {
        seenIds.add(entryId);
      }
      if (signature) {
        seenSignatures.add(signature);
      }
      merged.push(entry);
    }
  }

  return normalizeResearchOptimizerHistory(merged);
}

export function mergeResearchHistoryStores(...stores) {
  const normalizedStores = (stores || []).map((store) => normalizeResearchHistoryStore(store));
  return {
    runHistory: mergeResearchRunHistory(...normalizedStores.map((store) => store.runHistory)),
    optimizerHistory: mergeResearchOptimizerHistory(...normalizedStores.map((store) => store.optimizerHistory)),
  };
}
