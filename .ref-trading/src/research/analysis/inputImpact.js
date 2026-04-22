import {
  computeMetrics,
  normalizeRiskStopPolicy,
  RISK_STOP_DISABLED,
  RISK_STOP_LEGACY_HALT,
} from "../engine/runtime.js";
import { normalizeRayAlgoScoringConfig } from "../engine/rayalgoScoring.js";
import { normalizeRayAlgoSettings } from "../config/rayalgoSettings.js";
import { timeframeToMinutes } from "../chart/timeframeModel.js";
import { compileBacktestV2RuntimeBridge } from "../config/backtestV2RuntimeBridge.js";
import {
  applyLegacyTopRailFieldsToStageConfig,
  resolveLegacyTopRailCompatFields,
} from "../config/backtestLegacyInputMapping.js";
import {
  DEFAULT_STRIKE_SLOT,
  clampStrikeSlot,
  formatStrikeSlotLabel,
} from "../options/strikeSelection.js";

const MONEY_TOLERANCE = 0.01;
const PCT_TOLERANCE = 0.05;

function toFiniteNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundValue(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Number(numeric.toFixed(digits));
}

function sameNumber(left, right, tolerance = MONEY_TOLERANCE) {
  if (!Number.isFinite(left) && !Number.isFinite(right)) {
    return true;
  }
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return false;
  }
  return Math.abs(left - right) <= tolerance;
}

function normalizeBooleanArray(values, expectedLength, fallback = true) {
  if (!Array.isArray(values) || values.length !== expectedLength) {
    return Array(expectedLength).fill(Boolean(fallback));
  }
  return values.map(Boolean);
}

function normalizeSignalTimeframe(value) {
  const normalized = String(value || "").trim();
  return Number.isFinite(timeframeToMinutes(normalized)) ? normalized : "5m";
}

function hasFiniteNumber(value) {
  return value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number(value));
}

function normalizeOptionSelectionSpec(optionSelectionSpec = {}) {
  const targetDte = hasFiniteNumber(optionSelectionSpec?.targetDte)
    ? toFiniteNumber(optionSelectionSpec?.targetDte, null)
    : null;
  const strikeSlot = hasFiniteNumber(optionSelectionSpec?.strikeSlot)
    ? clampStrikeSlot(optionSelectionSpec?.strikeSlot)
    : null;
  const rawMoneyness = String(optionSelectionSpec?.moneyness || "").trim().toLowerCase();
  const moneyness = ["itm", "atm", "otm"].includes(rawMoneyness) ? rawMoneyness : null;
  const strikeSteps = hasFiniteNumber(optionSelectionSpec?.strikeSteps)
    ? Math.max(0, Math.min(25, Math.round(Number(optionSelectionSpec?.strikeSteps))))
    : null;

  return {
    targetDte: targetDte == null ? null : Math.max(0, Math.min(60, Math.round(targetDte))),
    strikeSlot,
    moneyness,
    strikeSteps,
  };
}

function resolveInputImpactRuntimeBridge(payload = {}, signalTimeframe, optionSelectionSpec) {
  if (payload?.backtestV2RuntimeBridge?.stageConfig) {
    return payload.backtestV2RuntimeBridge;
  }
  if (
    !payload?.backtestV2StageConfig
    || typeof payload.backtestV2StageConfig !== "object"
    || Array.isArray(payload.backtestV2StageConfig)
  ) {
    return null;
  }
  return compileBacktestV2RuntimeBridge({
    stageConfig: payload.backtestV2StageConfig,
    signalTimeframe,
    fallbackCapital: payload.capital,
    fallbackDte: payload.dte,
    fallbackKellyFrac: payload.kellyFrac,
    fallbackMaxPositions: payload.maxPositions,
    fallbackRiskStopPolicy: payload.riskStopPolicy,
    fallbackOptionSelectionSpec: optionSelectionSpec,
  });
}

export function createInputImpactPayload(payload = {}) {
  const signalTimeframe = normalizeSignalTimeframe(payload.signalTimeframe);
  const optionSelectionSpec = normalizeOptionSelectionSpec(payload.optionSelectionSpec);
  const backtestV2RuntimeBridge = resolveInputImpactRuntimeBridge(
    payload,
    signalTimeframe,
    optionSelectionSpec,
  );
  const compatFields = resolveLegacyTopRailCompatFields({
    stageConfig: payload.backtestV2StageConfig,
    runtimeBridge: backtestV2RuntimeBridge,
    fallbackFields: {
      ...payload,
      optionSelectionSpec,
    },
  });

  return {
    marketSymbol: String(payload.marketSymbol || "SPY").trim().toUpperCase() || "SPY",
    bars: Array.isArray(payload.bars) ? payload.bars : [],
    capital: toFiniteNumber(compatFields.capital, 25000),
    executionFidelity: String(payload.executionFidelity || "sub_candle").trim().toLowerCase() === "bar_close"
      ? "bar_close"
      : "sub_candle",
    strategy: String(payload.strategy || "").trim() || "rayalgo",
    dte: Math.max(0, Math.min(60, Math.round(toFiniteNumber(compatFields.dte, 5)))),
    iv: roundValue(toFiniteNumber(payload.iv, 0.2), 4),
    slPct: roundValue(toFiniteNumber(compatFields.slPct, 0.25), 4),
    tpPct: roundValue(toFiniteNumber(compatFields.tpPct, 0.35), 4),
    trailStartPct: roundValue(toFiniteNumber(compatFields.trailStartPct, 0.08), 4),
    trailPct: roundValue(toFiniteNumber(compatFields.trailPct, 0.18), 4),
    zombieBars: Math.max(1, Math.round(toFiniteNumber(compatFields.zombieBars, 30))),
    minConviction: roundValue(toFiniteNumber(compatFields.minConviction, 0.48), 4),
    allowShorts: Boolean(compatFields.allowShorts),
    kellyFrac: roundValue(toFiniteNumber(compatFields.kellyFrac, 0.25), 4),
    regimeFilter: String(compatFields.regimeFilter || "none").trim() || "none",
    maxPositions: Math.max(1, Math.round(toFiniteNumber(compatFields.maxPositions, 4))),
    sessionBlocks: normalizeBooleanArray(compatFields.sessionBlocks, 13, true),
    regimeAdapt: Boolean(compatFields.regimeAdapt),
    commPerContract: roundValue(toFiniteNumber(compatFields.commPerContract, 0.65), 4),
    slipBps: Math.max(0, Math.round(toFiniteNumber(compatFields.slipBps, 150))),
    tradeDays: normalizeBooleanArray(compatFields.tradeDays, 5, true),
    signalTimeframe,
    rayalgoSettings: normalizeRayAlgoSettings(payload.rayalgoSettings || {}),
    rayalgoScoringConfig: normalizeRayAlgoScoringConfig({
      activeTimeframe: signalTimeframe,
      marketSymbol: String(payload.marketSymbol || "SPY").trim().toUpperCase() || "SPY",
      ...(payload.rayalgoScoringConfig || {}),
    }),
    riskStopPolicy: normalizeRiskStopPolicy(compatFields.riskStopPolicy ?? RISK_STOP_DISABLED),
    optionSelectionSpec: normalizeOptionSelectionSpec(compatFields.optionSelectionSpec),
    backtestV2StageConfig: backtestV2RuntimeBridge?.stageConfig || payload.backtestV2StageConfig || null,
  };
}

function formatTargetDteLabel(value) {
  const numeric = toFiniteNumber(value, null);
  return Number.isFinite(numeric) ? `${numeric}d` : "--";
}

function formatPercentLabel(value) {
  const numeric = toFiniteNumber(value, null);
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(0)}%` : "--";
}

function formatBpsLabel(value) {
  const numeric = toFiniteNumber(value, null);
  return Number.isFinite(numeric) ? `${numeric.toFixed(0)}bp` : "--";
}

export function createInputImpactInputSnapshot(payload = {}) {
  const normalized = createInputImpactPayload(payload);
  return {
    marketSymbol: normalized.marketSymbol,
    executionFidelity: normalized.executionFidelity,
    strategy: normalized.strategy,
    signalTimeframe: normalized.signalTimeframe,
    rayalgoSettings: normalized.rayalgoSettings,
    rayalgoScoringConfig: normalized.rayalgoScoringConfig,
    dte: normalized.dte,
    slPct: normalized.slPct,
    tpPct: normalized.tpPct,
    trailStartPct: normalized.trailStartPct,
    trailPct: normalized.trailPct,
    zombieBars: normalized.zombieBars,
    commPerContract: normalized.commPerContract,
    slipBps: normalized.slipBps,
    riskStopPolicy: normalized.riskStopPolicy,
    optionSelectionSpec: normalized.optionSelectionSpec,
    optionSelectionLabel: [
      formatTargetDteLabel(normalized.optionSelectionSpec.targetDte ?? normalized.dte),
      formatStrikeSlotLabel(normalized.optionSelectionSpec.strikeSlot),
    ].join(" · "),
  };
}

function chooseDteVariant(targetDte) {
  const baseline = Math.max(0, Math.round(toFiniteNumber(targetDte, 5)));
  if (baseline <= 1) {
    return 5;
  }
  if (baseline <= 3) {
    return 0;
  }
  return 1;
}

function chooseStrikeSlotVariant(strikeSlot) {
  const baseline = Number.isFinite(Number(strikeSlot))
    ? clampStrikeSlot(strikeSlot)
    : DEFAULT_STRIKE_SLOT;
  return baseline >= DEFAULT_STRIKE_SLOT ? 0 : 5;
}

function chooseSlipBpsVariant(slipBps) {
  const baseline = Math.max(0, Math.round(toFiniteNumber(slipBps, 150)));
  return baseline <= 250 ? 500 : 75;
}

function chooseStopLossVariant(slPct) {
  const baseline = roundValue(toFiniteNumber(slPct, 0.25), 4);
  return baseline > 0.15 ? 0.1 : 0.35;
}

export function buildDefaultInputImpactVariants(payload = {}) {
  const normalized = createInputImpactPayload(payload);
  const optionSelectionSpec = normalizeOptionSelectionSpec(normalized.optionSelectionSpec);
  const baselineTargetDte = optionSelectionSpec.targetDte ?? normalized.dte;
  const nextTargetDte = chooseDteVariant(baselineTargetDte);
  const baselineStrikeSlot = optionSelectionSpec.strikeSlot;
  const nextStrikeSlot = chooseStrikeSlotVariant(baselineStrikeSlot);
  const nextSlipBps = chooseSlipBpsVariant(normalized.slipBps);
  const nextStopLoss = chooseStopLossVariant(normalized.slPct);
  const applyStageVariant = (legacyOverrides = {}) => (
    normalized.backtestV2StageConfig
      ? applyLegacyTopRailFieldsToStageConfig(normalized.backtestV2StageConfig, legacyOverrides)
      : null
  );

  return [
    {
      key: "contract_dte",
      family: "contract_selection",
      label: "Contract DTE",
      description: `${formatTargetDteLabel(baselineTargetDte)} -> ${formatTargetDteLabel(nextTargetDte)}`,
      variantInput: createInputImpactPayload({
        ...normalized,
        backtestV2StageConfig: applyStageVariant({ dte: nextTargetDte }),
        dte: nextTargetDte,
        optionSelectionSpec: {
          ...optionSelectionSpec,
          targetDte: nextTargetDte,
        },
      }),
    },
    {
      key: "contract_strike",
      family: "contract_selection",
      label: "Strike Slot",
      description: `${formatStrikeSlotLabel(baselineStrikeSlot)} -> ${formatStrikeSlotLabel(nextStrikeSlot)}`,
      variantInput: createInputImpactPayload({
        ...normalized,
        backtestV2StageConfig: applyStageVariant({ optionStrikeSlot: nextStrikeSlot }),
        optionSelectionSpec: {
          ...optionSelectionSpec,
          strikeSlot: nextStrikeSlot,
        },
      }),
    },
    {
      key: "entry_slippage",
      family: "entry_cost",
      label: "Entry Slippage",
      description: `${formatBpsLabel(normalized.slipBps)} -> ${formatBpsLabel(nextSlipBps)}`,
      variantInput: createInputImpactPayload({
        ...normalized,
        backtestV2StageConfig: applyStageVariant({ slipBps: nextSlipBps }),
        slipBps: nextSlipBps,
      }),
    },
    {
      key: "exit_stop_loss",
      family: "exit",
      label: "Stop Loss",
      description: `${formatPercentLabel(normalized.slPct)} -> ${formatPercentLabel(nextStopLoss)}`,
      variantInput: createInputImpactPayload({
        ...normalized,
        backtestV2StageConfig: applyStageVariant({ slPct: nextStopLoss }),
        slPct: nextStopLoss,
      }),
    },
  ];
}

function buildReplayDatasetSummary(runResult = {}) {
  const counts = runResult?.replayDatasetSummary || runResult?.replayDataset?.counts || null;
  const firstResolvedContract = runResult?.firstResolvedContract || runResult?.replayDataset?.firstResolvedContract || null;
  return {
    candidates: Math.max(0, Math.round(toFiniteNumber(counts?.candidates, 0))),
    resolved: Math.max(0, Math.round(toFiniteNumber(counts?.resolved, 0))),
    skipped: Math.max(0, Math.round(toFiniteNumber(counts?.skipped, 0))),
    uniqueContracts: Math.max(0, Math.round(toFiniteNumber(counts?.uniqueContracts, 0))),
    firstResolvedTicker: String(firstResolvedContract?.optionTicker || "").trim() || null,
    firstResolvedContract,
  };
}

function buildRiskStopSummary(runResult = {}) {
  const riskStop = runResult?.riskStop && typeof runResult.riskStop === "object"
    ? runResult.riskStop
    : {};
  return {
    policy: normalizeRiskStopPolicy(riskStop.policy ?? runResult?.riskStopPolicy ?? RISK_STOP_LEGACY_HALT),
    haltTriggered: Boolean(riskStop.triggered || riskStop.haltTriggered),
    haltReason: riskStop.reason || riskStop.haltReason || null,
    triggerTs: riskStop.triggerTs || null,
    triggerDate: riskStop.triggerDate || null,
    peakDrawdownPct: toFiniteNumber(riskStop.peakDrawdownPct, 0),
    dayLossPct: toFiniteNumber(riskStop.dayLossPct, 0),
  };
}

function summarizeTrade(trade = null) {
  if (!trade) {
    return null;
  }
  return {
    signalTs: trade.signalTs || null,
    entryAt: trade.ts || null,
    exitAt: trade.et || null,
    contract: trade.optionTicker || null,
    actualDte: toFiniteNumber(trade.actualDteAtEntry, null),
    strikeSlot: toFiniteNumber(trade.selectionStrikeSlot, null),
    strikeTool: trade.selectionStrikeLabel || null,
    entryFill: toFiniteNumber(trade.oe, null),
    exitFill: toFiniteNumber(trade.exitFill, null),
    exitReason: trade.er || null,
    pnl: toFiniteNumber(trade.pnl, null),
  };
}

export function createReplayRunSummary(runResult = {}, capital = 25000) {
  const trades = Array.isArray(runResult?.trades) ? runResult.trades : [];
  const skippedTrades = Array.isArray(runResult?.skippedTrades) ? runResult.skippedTrades : [];
  const skippedByReason = runResult?.skippedByReason && typeof runResult.skippedByReason === "object"
    ? runResult.skippedByReason
    : {};
  const equity = Array.isArray(runResult?.equity) ? runResult.equity : [];
  const metrics = computeMetrics(trades, capital);
  const dataset = buildReplayDatasetSummary(runResult);

  return {
    trades,
    skippedTrades,
    skippedByReason,
    equity,
    tradeCount: trades.length,
    skippedCount: skippedTrades.length,
    dataset,
    riskStop: buildRiskStopSummary(runResult),
    metrics: {
      netPnl: metrics.pnl,
      roi: metrics.roi,
      winRate: metrics.wr,
      profitFactor: metrics.pf,
      expectancy: metrics.exp,
      sharpe: metrics.sharpe,
      maxDrawdown: metrics.dd,
      avgBars: metrics.avgBars,
    },
    firstTrade: summarizeTrade(trades[0] || null),
  };
}

export function compactReplayRunSummary(summary = {}) {
  return {
    tradeCount: summary.tradeCount || 0,
    skippedCount: summary.skippedCount || 0,
    dataset: summary.dataset || {
      candidates: 0,
      resolved: 0,
      skipped: 0,
      uniqueContracts: 0,
      firstResolvedTicker: null,
    },
    riskStop: summary.riskStop || {
      policy: RISK_STOP_LEGACY_HALT,
      haltTriggered: false,
      haltReason: null,
      triggerTs: null,
      triggerDate: null,
      peakDrawdownPct: 0,
      dayLossPct: 0,
    },
    metrics: summary.metrics || {
      netPnl: 0,
      roi: 0,
      winRate: 0,
      profitFactor: 0,
      expectancy: 0,
      sharpe: 0,
      maxDrawdown: 0,
      avgBars: 0,
    },
    firstTrade: summary.firstTrade || null,
  };
}

function metricValueChanged(left, right) {
  const leftNumber = toFiniteNumber(left, null);
  const rightNumber = toFiniteNumber(right, null);
  if (leftNumber != null || rightNumber != null) {
    const tolerance = Number.isInteger(leftNumber) && Number.isInteger(rightNumber) ? 0 : PCT_TOLERANCE;
    return !sameNumber(leftNumber, rightNumber, tolerance);
  }
  return String(left ?? "") !== String(right ?? "");
}

function buildDatasetDelta(baseline, variant) {
  const counts = {
    candidates: variant.dataset.candidates - baseline.dataset.candidates,
    resolved: variant.dataset.resolved - baseline.dataset.resolved,
    skipped: variant.dataset.skipped - baseline.dataset.skipped,
    uniqueContracts: variant.dataset.uniqueContracts - baseline.dataset.uniqueContracts,
  };
  const changed =
    counts.candidates !== 0
    || counts.resolved !== 0
    || counts.skipped !== 0
    || counts.uniqueContracts !== 0
    || baseline.dataset.firstResolvedTicker !== variant.dataset.firstResolvedTicker;

  return {
    changed,
    ...counts,
    baselineFirstResolvedTicker: baseline.dataset.firstResolvedTicker,
    variantFirstResolvedTicker: variant.dataset.firstResolvedTicker,
  };
}

function buildTradeDelta(baseline, variant) {
  const maxLength = Math.max(baseline.trades.length, variant.trades.length);
  let firstDivergentTradeIndex = null;
  let changedTradeCount = 0;
  let changedContractCount = 0;
  let changedEntryFillCount = 0;
  let changedExitFillCount = 0;
  let changedExitReasonCount = 0;

  for (let index = 0; index < maxLength; index += 1) {
    const left = baseline.trades[index] || null;
    const right = variant.trades[index] || null;
    const rowChanged = !left
      || !right
      || left.optionTicker !== right.optionTicker
      || !sameNumber(toFiniteNumber(left.oe, null), toFiniteNumber(right.oe, null))
      || !sameNumber(toFiniteNumber(left.exitFill, null), toFiniteNumber(right.exitFill, null))
      || String(left.er || "") !== String(right.er || "")
      || !sameNumber(toFiniteNumber(left.pnl, null), toFiniteNumber(right.pnl, null));
    if (!rowChanged) {
      continue;
    }
    changedTradeCount += 1;
    if (firstDivergentTradeIndex == null) {
      firstDivergentTradeIndex = index + 1;
    }
    if (!left || !right || String(left.optionTicker || "") !== String(right.optionTicker || "")) {
      changedContractCount += 1;
    }
    if (!left || !right || !sameNumber(toFiniteNumber(left.oe, null), toFiniteNumber(right.oe, null))) {
      changedEntryFillCount += 1;
    }
    if (!left || !right || !sameNumber(toFiniteNumber(left.exitFill, null), toFiniteNumber(right.exitFill, null))) {
      changedExitFillCount += 1;
    }
    if (!left || !right || String(left.er || "") !== String(right.er || "")) {
      changedExitReasonCount += 1;
    }
  }

  const baselineReasons = baseline.skippedByReason || {};
  const variantReasons = variant.skippedByReason || {};
  const changedSkipReasons = [...new Set([...Object.keys(baselineReasons), ...Object.keys(variantReasons)])]
    .filter((reason) => Math.round(toFiniteNumber(baselineReasons[reason], 0)) !== Math.round(toFiniteNumber(variantReasons[reason], 0)))
    .sort();

  return {
    changed: changedTradeCount > 0 || changedSkipReasons.length > 0 || baseline.tradeCount !== variant.tradeCount,
    tradeCountDelta: variant.tradeCount - baseline.tradeCount,
    skippedCountDelta: variant.skippedCount - baseline.skippedCount,
    firstDivergentTradeIndex,
    changedTradeCount,
    changedContractCount,
    changedEntryFillCount,
    changedExitFillCount,
    changedExitReasonCount,
    changedSkipReasons,
  };
}

function buildAggregateDelta(baseline, variant) {
  const deltas = {
    tradeCount: variant.tradeCount - baseline.tradeCount,
    skippedCount: variant.skippedCount - baseline.skippedCount,
    netPnl: roundValue(variant.metrics.netPnl - baseline.metrics.netPnl, 2),
    roi: roundValue(variant.metrics.roi - baseline.metrics.roi, 2),
    winRate: roundValue(variant.metrics.winRate - baseline.metrics.winRate, 2),
    expectancy: roundValue(variant.metrics.expectancy - baseline.metrics.expectancy, 2),
    sharpe: roundValue(variant.metrics.sharpe - baseline.metrics.sharpe, 2),
    maxDrawdown: roundValue(variant.metrics.maxDrawdown - baseline.metrics.maxDrawdown, 2),
    avgBars: roundValue(variant.metrics.avgBars - baseline.metrics.avgBars, 2),
  };
  const changedMetricKeys = Object.entries(deltas)
    .filter(([key, value]) => {
      if (key === "tradeCount" || key === "skippedCount") {
        return value !== 0;
      }
      return !sameNumber(value, 0, key === "avgBars" ? PCT_TOLERANCE : MONEY_TOLERANCE);
    })
    .map(([key]) => key);
  if (metricValueChanged(baseline.metrics.profitFactor, variant.metrics.profitFactor)) {
    changedMetricKeys.push("profitFactor");
  }

  return {
    changed: changedMetricKeys.length > 0,
    deltas,
    changedMetricKeys,
    baselineProfitFactor: baseline.metrics.profitFactor,
    variantProfitFactor: variant.metrics.profitFactor,
  };
}

function buildEquityDelta(baseline, variant) {
  const maxLength = Math.max(baseline.equity.length, variant.equity.length);
  let firstChangedPointIndex = null;
  let maxAbsBalanceDelta = 0;

  for (let index = 0; index < maxLength; index += 1) {
    const left = toFiniteNumber(baseline.equity[index]?.bal, null);
    const right = toFiniteNumber(variant.equity[index]?.bal, null);
    if (left == null || right == null) {
      if ((left == null) !== (right == null) && firstChangedPointIndex == null) {
        firstChangedPointIndex = index + 1;
      }
      continue;
    }
    const delta = Math.abs(right - left);
    if (delta > MONEY_TOLERANCE && firstChangedPointIndex == null) {
      firstChangedPointIndex = index + 1;
    }
    maxAbsBalanceDelta = Math.max(maxAbsBalanceDelta, delta);
  }

  const baselineEndingBalance = toFiniteNumber(baseline.equity[baseline.equity.length - 1]?.bal, null);
  const variantEndingBalance = toFiniteNumber(variant.equity[variant.equity.length - 1]?.bal, null);
  const endingBalanceDelta = baselineEndingBalance != null && variantEndingBalance != null
    ? roundValue(variantEndingBalance - baselineEndingBalance, 2)
    : 0;

  return {
    changed: !sameNumber(maxAbsBalanceDelta, 0, MONEY_TOLERANCE) || !sameNumber(endingBalanceDelta, 0, MONEY_TOLERANCE),
    firstChangedPointIndex,
    maxAbsBalanceDelta: roundValue(maxAbsBalanceDelta, 2),
    endingBalanceDelta,
    lengthDelta: variant.equity.length - baseline.equity.length,
  };
}

function buildRiskStopDelta(baseline, variant) {
  const baselineRiskStop = baseline.riskStop || buildRiskStopSummary();
  const variantRiskStop = variant.riskStop || buildRiskStopSummary();
  const samePolicy = baselineRiskStop.policy === variantRiskStop.policy;
  const bothHaltedSamePolicy = samePolicy
    && baselineRiskStop.haltTriggered
    && variantRiskStop.haltTriggered;

  return {
    changed: !samePolicy
      || baselineRiskStop.haltTriggered !== variantRiskStop.haltTriggered
      || baselineRiskStop.haltReason !== variantRiskStop.haltReason,
    baselinePolicy: baselineRiskStop.policy,
    variantPolicy: variantRiskStop.policy,
    baselineHaltTriggered: baselineRiskStop.haltTriggered,
    variantHaltTriggered: variantRiskStop.haltTriggered,
    baselineHaltReason: baselineRiskStop.haltReason,
    variantHaltReason: variantRiskStop.haltReason,
    bothHaltedSamePolicy,
  };
}

function classifyImpactStatus({ propagationChanged, datasetDelta, tradeDelta, aggregateDelta, equityDelta, riskStopDelta }) {
  if (!propagationChanged) {
    return "no_change";
  }
  if (aggregateDelta.changed || equityDelta.changed) {
    return "aggregate_changed";
  }
  if (riskStopDelta.bothHaltedSamePolicy && (datasetDelta.changed || tradeDelta.changed)) {
    return "halt_collapsed";
  }
  if (datasetDelta.changed || tradeDelta.changed) {
    return "trade_changed";
  }
  return "propagated_only";
}

export function summarizeInputImpactComparison({
  variant,
  baselineInput,
  variantInput,
  baselineRun,
  variantRun,
  capital,
}) {
  const baseline = createReplayRunSummary(baselineRun, capital);
  const variantSummary = createReplayRunSummary(variantRun, capital);
  const datasetDelta = buildDatasetDelta(baseline, variantSummary);
  const tradeDelta = buildTradeDelta(baseline, variantSummary);
  const aggregateDelta = buildAggregateDelta(baseline, variantSummary);
  const equityDelta = buildEquityDelta(baseline, variantSummary);
  const riskStopDelta = buildRiskStopDelta(baseline, variantSummary);
  const propagationChanged = JSON.stringify(createInputImpactInputSnapshot(baselineInput))
    !== JSON.stringify(createInputImpactInputSnapshot(variantInput));
  const status = classifyImpactStatus({
    propagationChanged,
    datasetDelta,
    tradeDelta,
    aggregateDelta,
    equityDelta,
    riskStopDelta,
  });

  return {
    key: variant.key,
    family: variant.family,
    label: variant.label,
    description: variant.description,
    status,
    propagationChanged,
    tradeRealizationChanged: datasetDelta.changed || tradeDelta.changed,
    aggregateResultsChanged: aggregateDelta.changed || equityDelta.changed,
    baselineInput: createInputImpactInputSnapshot(baselineInput),
    variantInput: createInputImpactInputSnapshot(variantInput),
    baseline: compactReplayRunSummary(baseline),
    variant: compactReplayRunSummary(variantSummary),
    datasetDelta,
    tradeDelta,
    aggregateDelta,
    equityDelta,
    riskStopDelta,
  };
}

export function summarizeInputImpactDiagnostics(variants = []) {
  const counts = {
    aggregate_changed: 0,
    halt_collapsed: 0,
    trade_changed: 0,
    propagated_only: 0,
    no_change: 0,
  };
  for (const variant of variants) {
    counts[variant.status] = (counts[variant.status] || 0) + 1;
  }

  let status = "no_change";
  if (counts.aggregate_changed > 0) {
    status = "aggregate_changed";
  } else if (counts.halt_collapsed > 0) {
    status = "halt_collapsed";
  } else if (counts.trade_changed > 0) {
    status = "trade_changed";
  } else if (counts.propagated_only > 0) {
    status = "propagated_only";
  }

  const headline = status === "aggregate_changed"
    ? "At least one tested input changed the aggregate replay results."
    : status === "halt_collapsed"
      ? "At least one tested input changed trades, but both runs hit the same legacy halt."
      : status === "trade_changed"
        ? "At least one tested input changed contracts or fills without moving the full run."
        : status === "propagated_only"
          ? "Tested inputs propagated, but the replay collapsed to the same aggregate outcome."
          : "Tested inputs did not produce a detectable downstream change in this run.";

  return {
    status,
    counts,
    headline,
    variants,
  };
}
