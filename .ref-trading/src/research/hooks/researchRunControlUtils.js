import { createInputImpactInputSnapshot } from "../analysis/inputImpact.js";

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeFiniteNumber(value, precision = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return +numeric.toFixed(precision);
}

function normalizeTradeLike(trade = {}) {
  return {
    ts: normalizeText(trade.ts),
    et: normalizeText(trade.et),
    optionTicker: normalizeText(trade.optionTicker),
    expiryDate: normalizeText(trade.expiryDate),
    strat: normalizeText(trade.strat),
    dir: normalizeText(trade.dir),
    oe: normalizeFiniteNumber(trade.oe, 2),
    qty: Number.isFinite(Number(trade.qty)) ? Number(trade.qty) : null,
    pnl: normalizeFiniteNumber(trade.pnl, 2),
    er: normalizeText(trade.er),
    regime: normalizeText(trade.regime),
  };
}

function normalizeEquityPoint(point = {}, index = 0) {
  return {
    i: Number.isFinite(Number(point.i)) ? Number(point.i) : index + 1,
    bal: normalizeFiniteNumber(point.bal, 2) ?? 0,
    ts: normalizeText(point.ts) || null,
  };
}

function normalizeRuntimeBridgeForSignature(runtimeBridge = null) {
  if (!runtimeBridge || typeof runtimeBridge !== "object") {
    return null;
  }
  return {
    dateWindow: runtimeBridge.dateWindow || null,
    legacyOverrides: runtimeBridge.legacyOverrides || null,
    optionSelectionSpec: runtimeBridge.optionSelectionSpec || null,
    positionSizingConfig: runtimeBridge.positionSizingConfig || null,
    entryGateConfig: runtimeBridge.entryGateConfig || null,
    riskStopConfig: runtimeBridge.riskStopConfig || null,
    layerConfig: runtimeBridge.layerConfig || null,
    exitGovernorConfig: runtimeBridge.exitGovernorConfig || null,
    executionPolicyConfig: runtimeBridge.executionPolicyConfig || null,
  };
}

export function buildResearchRunDraftSignature({
  inputPayload = null,
  executionBars = [],
  signalBars = [],
  executionMode = "option_history",
  replayCredentialsReady = false,
  runtimeBridge = null,
} = {}) {
  const inputSnapshot = createInputImpactInputSnapshot(inputPayload || {});
  const normalizedExecutionBars = Array.isArray(executionBars) ? executionBars : [];
  const normalizedSignalBars = Array.isArray(signalBars) ? signalBars : [];
  return JSON.stringify({
    ...inputSnapshot,
    executionMode: normalizeText(executionMode, "option_history"),
    replayCredentialsReady: Boolean(replayCredentialsReady),
    executionBarCount: normalizedExecutionBars.length,
    executionBarStartTs: normalizedExecutionBars[0]?.ts || null,
    executionBarEndTs: normalizedExecutionBars[normalizedExecutionBars.length - 1]?.ts || null,
    signalBarCount: normalizedSignalBars.length,
    signalBarStartTs: normalizedSignalBars[0]?.ts || null,
    signalBarEndTs: normalizedSignalBars[normalizedSignalBars.length - 1]?.ts || null,
    runtimeBridge: normalizeRuntimeBridgeForSignature(runtimeBridge),
  });
}

export function resolveResearchRunRequestMode({
  runStatus = "idle",
  hasQueuedRun = false,
} = {}) {
  if (runStatus === "loading") {
    return hasQueuedRun ? "noop" : "queue";
  }
  return "start";
}

export function buildRestoredResearchRunState(entry = {}) {
  const normalizedStatus = normalizeText(entry?.replayMeta?.replayRunStatus, "ready").toLowerCase();
  return {
    status: normalizedStatus === "error" ? "error" : "ready",
    error: normalizeText(entry?.replayMeta?.replayRunError) || null,
    trades: Array.isArray(entry?.trades) ? entry.trades.map(normalizeTradeLike) : [],
    equity: Array.isArray(entry?.equity) ? entry.equity.map(normalizeEquityPoint) : [],
    skippedTrades: Array.isArray(entry?.skippedTrades) ? entry.skippedTrades.map(normalizeTradeLike) : [],
    skippedByReason: entry?.skippedByReason && typeof entry.skippedByReason === "object"
      ? { ...entry.skippedByReason }
      : {},
    replayDataset: entry?.replayMeta?.replayDatasetSummary
      ? {
          counts: entry.replayMeta.replayDatasetSummary,
          firstResolvedContract: null,
        }
      : null,
    riskStop: entry?.riskStop || null,
    rayalgoScoringContext: entry?.rayalgoScoringContext || entry?.setup?.rayalgo?.scoringContext || null,
    indicatorOverlayTape: { events: [], zones: [], windows: [] },
  };
}
