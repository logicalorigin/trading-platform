import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelResearchBacktestJob,
  cancelResearchScoreStudyJob,
  createResearchScoreStudyJob,
  createResearchBacktestJob,
  getResearchScoreStudyJob,
  getResearchScoreStudyLocalArtifacts,
  getResearchScoreStudyRun,
  getResearchScoreStudyRuns,
  getResearchBacktestJob,
  getResearchBacktestResult,
  getResearchBacktests,
  importResearchScoreStudyArtifact,
  runMassiveOptionReplayBacktest,
  saveResearchScoreStudyRun,
  saveResearchBacktestResult,
  subscribeResearchBacktestJobEvents,
  subscribeResearchScoreStudyJobEvents,
  streamMassiveOptionReplayBacktest,
  streamResearchBacktestJob,
  streamResearchScoreStudyJob,
} from "../../lib/brokerClient.js";
import {
  buildSignalOverlayTape,
  collectReplayEntryCandidates,
  computeMetrics as computeBacktestMetrics,
  detectRegimes as detectBacktestRegimes,
  RISK_STOP_DISABLED,
  BACKTEST_PHASES,
  runBacktest as runBacktestRuntime,
  runBacktestAsync as runBacktestRuntimeAsync,
} from "../engine/runtime.js";
import { normalizeRayAlgoScoringConfig } from "../engine/rayalgoScoring.js";
import {
  DEFAULT_RESEARCH_STRATEGY,
  EXIT_PRESETS,
  RECOMMENDATION_COMPUTE_STRATEGIES,
  REGIME_OPTIONS,
  STRATEGY_PRESETS,
  getStrategyLabel,
  normalizeResearchStrategy,
} from "../config/strategyPresets.js";
import {
  buildDefaultInputImpactVariants,
  createInputImpactInputSnapshot,
  createInputImpactPayload,
  summarizeInputImpactComparison,
  summarizeInputImpactDiagnostics,
} from "../analysis/inputImpact.js";
import { buildRayAlgoScoreStudy } from "../analysis/rayalgoScoreStudy.js";
import {
  RAYALGO_SCORE_STUDY_PRESET_DIRECTION_RANK_V1,
  getRayAlgoScoreStudyPresetDefinition,
  RAYALGO_SCORE_STUDY_PRESET_CURRENT_SETUP,
  RAYALGO_SCORE_STUDY_PRESET_REGIME_RANK_V1,
  RAYALGO_SCORE_STUDY_PRESET_TRANCHE2_2M,
  RAYALGO_SCORE_STUDY_PRESET_TRANCHE3_HARD_GATED,
  RAYALGO_SCORE_STUDY_PRESET_TRANCHE3_SPLIT_FLOOR,
  resolveRayAlgoScoreStudyPresetConfig,
} from "../analysis/rayalgoScoreStudyPresets.js";
import { aggregateBarsToMinutes } from "../data/aggregateBars.js";
import { getSupportedSignalOverlayTimeframes, timeframeToMinutes } from "../chart/timeframeModel.js";
import { evaluateRayAlgoBundleRun } from "../rayalgo/bundleEvaluation.js";
import {
  compileBacktestV2RuntimeBridge,
  filterBarsForBacktestV2Window,
} from "../config/backtestV2RuntimeBridge.js";
import {
  applyLegacyTopRailFieldsToStageConfig,
  extractLegacyTopRailFieldsFromRuntimePayload,
  resolveLegacyTopRailCompatFields,
} from "../config/backtestLegacyInputMapping.js";
import {
  resolveChartOverlaySourceBars,
  resolveResearchExecutionOverlayState,
} from "./researchExecutionOverlayUtils.js";
import { buildResearchRunDraftSignature, buildRestoredResearchRunState, resolveResearchRunRequestMode } from "./researchRunControlUtils.js";
import { resolveDefaultScoreStudySelectedRunId } from "./researchScoreStudySelectionUtils.js";
import {
  buildDisplayedResultRecord,
  buildRecentResultSummary,
} from "./researchExecutionResultRecordUtils.js";

const RESEARCH_RISK_STOP_POLICY = RISK_STOP_DISABLED;
const REPLAY_RUN_DEBOUNCE_MS = 180;
const BACKGROUND_REPLAY_CANDIDATE_THRESHOLD = 1200;
const BACKGROUND_EXECUTION_BAR_THRESHOLD = 50000;
const BACKTEST_JOB_POLL_MS = 2000;
const SCORE_STUDY_JOB_POLL_MS = 1000;
const SCORE_STUDY_COMPARE_LIMIT = 3;
const SCORE_STUDY_RUN_LIST_LIMIT = 40;
const ACTIVE_BACKTEST_JOB_STATUSES = ["queued", "running_background", "running_interactive", "cancel_requested"];
const SCORE_STUDY_ACTIVE_JOB_STATUSES = ["queued", "running_background", "cancel_requested"];

function resolveDefaultScoreStudyBaselineRunId({
  runs = [],
  selectedRunId = null,
  selectedRun = null,
} = {}) {
  const validRuns = [...(Array.isArray(runs) ? runs : [])]
    .filter((run) => (
      run?.runId
      && run.runId !== selectedRunId
      && String(run.validityStatus || "valid").trim().toLowerCase() !== "invalid"
    ))
    .sort((left, right) => {
      const leftTs = Date.parse(left?.completedAt || left?.updatedAt || left?.createdAt || "") || 0;
      const rightTs = Date.parse(right?.completedAt || right?.updatedAt || right?.createdAt || "") || 0;
      return rightTs - leftTs;
    });
  if (!validRuns.length) {
    return null;
  }
  const selectedSymbol = String(selectedRun?.symbol || "").trim().toUpperCase();
  const scopedRuns = selectedSymbol
    ? validRuns.filter((run) => String(run?.symbol || "").trim().toUpperCase() === selectedSymbol)
    : validRuns;
  const comparableRuns = scopedRuns.length ? scopedRuns : validRuns;
  return comparableRuns.find((run) => run.presetId === RAYALGO_SCORE_STUDY_PRESET_TRANCHE2_2M)?.runId
    || comparableRuns[0]?.runId
    || null;
}

function buildProgressFromGeneratorYield(progress) {
  const { phase, phasePct } = progress;
  return {
    steps: BACKTEST_PHASES.map((def) => {
      const done = def.id < phase;
      const active = def.id === phase;
      return {
        label: def.label,
        status: done ? "complete" : active ? "active" : "pending",
        pct: done ? 100 : active ? (phasePct || 0) : 0,
        detail: active && def.id === 1 ? (progress.currentDate || undefined) : undefined,
        metrics: active && def.id === 1 ? {
          tradeCount: progress.tradeCount || 0,
          winCount: progress.winCount || 0,
          capital: progress.capital || 0,
          initialCapital: progress.initialCapital || 0,
        } : undefined,
      };
    }),
  };
}

function buildAllCompleteSteps() {
  return {
    steps: BACKTEST_PHASES.map((def) => ({
      label: def.label,
      status: "complete",
      pct: 100,
    })),
  };
}

function buildRemoteBacktestProgress(stage = "hydrating-bars", counts = null) {
  const processed = Math.max(0, Number(counts?.processed) || 0);
  const candidates = Math.max(0, Number(counts?.candidates) || 0);
  const inFlight = Math.max(0, Number(counts?.inFlight) || 0);
  const resolutionPct = candidates > 0 ? Math.round((processed / candidates) * 100) : -1;
  const steps = [
    { label: "Hydrating replay bars", status: "pending", pct: 0 },
    { label: "Resolving option contracts", status: "pending", pct: 0 },
    { label: "Finalizing streamed replay", status: "pending", pct: 0 },
  ];

  if (stage === "hydrating-bars") {
    steps[0] = { ...steps[0], status: "active", pct: -1 };
  } else if (stage === "resolving-contracts") {
    steps[0] = { ...steps[0], status: "complete", pct: 100 };
    steps[1] = {
      ...steps[1],
      status: "active",
      pct: resolutionPct,
      detail: candidates > 0
        ? `${processed}/${candidates} candidates${inFlight > 0 ? ` · ${inFlight} active` : ""}`
        : undefined,
    };
  } else if (stage === "running-runtime") {
    steps[0] = { ...steps[0], status: "complete", pct: 100 };
    steps[1] = { ...steps[1], status: "complete", pct: 100 };
    steps[2] = { ...steps[2], status: "active", pct: -1 };
  } else if (stage === "finalizing" || stage === "fallback") {
    steps[0] = { ...steps[0], status: "complete", pct: 100 };
    steps[1] = { ...steps[1], status: "complete", pct: 100 };
    steps[2] = {
      ...steps[2],
      label: stage === "fallback" ? "Running blocking replay fallback" : steps[2].label,
      status: "active",
      pct: -1,
    };
  }

  return { steps };
}

function scheduleDeferredWork(timersRef, fn) {
  const timerId = setTimeout(() => {
    timersRef.current.delete(timerId);
    fn();
  }, 50);
  timersRef.current.add(timerId);
}

function emptyRunState(status = "idle", error = null) {
  return {
    status,
    error,
    trades: [],
    equity: [],
    skippedTrades: [],
    skippedByReason: {},
    replayDataset: null,
    riskStop: null,
    rayalgoScoringContext: null,
    indicatorOverlayTape: { events: [], zones: [], windows: [] },
  };
}

function normalizeReplayCounts(counts = null) {
  if (!counts) {
    return null;
  }
  return {
    processed: Math.max(0, Number(counts.processed) || 0),
    candidates: Math.max(0, Number(counts.candidates) || 0),
    resolved: Math.max(0, Number(counts.resolved) || 0),
    skipped: Math.max(0, Number(counts.skipped) || 0),
    uniqueContracts: Math.max(0, Number(counts.uniqueContracts) || 0),
    inFlight: Math.max(0, Number(counts.inFlight) || 0),
  };
}

function emptyLiveRunState() {
  return {
    source: null,
    stage: "idle",
    statusText: null,
    trades: [],
    equity: [],
    tradeCount: 0,
    winCount: 0,
    capital: null,
    initialCapital: null,
    replayResolution: null,
    replayDatasetSummary: null,
    firstResolvedContract: null,
  };
}

function emptyOverviewDiagnosticState(status = "idle", error = null) {
  return {
    status,
    error,
    summary: null,
    runId: null,
  };
}

function emptyScoreStudyJobState() {
  return {
    jobId: null,
    status: "idle",
    symbol: null,
    presetId: null,
    presetLabel: null,
    requestedTimeframes: [],
    requestedContextTimeframes: [],
    progress: null,
    runId: null,
    error: null,
    createdAt: null,
    startedAt: null,
    finishedAt: null,
    heartbeatAt: null,
    updatedAt: null,
  };
}

function emptyRayAlgoScoreStudyState(status = "idle", error = null) {
  return {
    status,
    error,
    result: null,
    stale: false,
    lastInputKey: null,
    lastRunAt: null,
    availability: {
      status: "checking",
      error: null,
    },
    selectedPresetId: RAYALGO_SCORE_STUDY_PRESET_CURRENT_SETUP,
    runsStatus: "idle",
    runsError: null,
    runs: [],
    jobs: [],
    activeJob: emptyScoreStudyJobState(),
    localArtifactsStatus: "idle",
    localArtifactsError: null,
    localArtifacts: [],
    selectedRunId: null,
    selectedComparisonRunIds: [],
    selectedRunDetailStatus: "idle",
    selectedRunDetailError: null,
    comparisonRunDetailStatusById: {},
    comparisonRunDetailErrorsById: {},
    runDetailsById: {},
  };
}

function emptyBacktestJobState() {
  return {
    jobId: null,
    jobType: "backtest",
    status: "idle",
    resultId: null,
    error: null,
    progress: null,
    metricsPreview: null,
    mode: null,
    createdAt: null,
    startedAt: null,
    finishedAt: null,
    updatedAt: null,
  };
}

function buildLocalScoreStudyArtifactPayload({
  marketSymbol = "SPY",
  presetConfig = null,
  result = null,
  dataSource = null,
  spotDataMeta = null,
} = {}) {
  return {
    generatedAt: new Date().toISOString(),
    symbol: String(marketSymbol || "SPY").trim().toUpperCase() || "SPY",
    initialDays: presetConfig?.initialDays || 60,
    mode: "local_ui",
    preferredTf: presetConfig?.preferredTf || "1m",
    studyMode: result?.metadata?.defaultStudyMode || "forward",
    requestedTimeframes: Array.isArray(presetConfig?.timeframes) ? [...presetConfig.timeframes] : [],
    scoringPreferences: presetConfig?.rayalgoScoringConfig || null,
    requestedContextTimeframes: Array.isArray(presetConfig?.requestedContextTimeframes)
      ? [...presetConfig.requestedContextTimeframes]
      : [],
    dataSource: dataSource || null,
    spotMeta: spotDataMeta || null,
    result,
  };
}

function mergeScoreStudyRuns(previous = [], run = null, limit = SCORE_STUDY_RUN_LIST_LIMIT) {
  if (!run?.runId) {
    return Array.isArray(previous) ? previous : [];
  }
  const next = [
    run,
    ...(Array.isArray(previous) ? previous : []).filter((entry) => entry?.runId !== run.runId),
  ];
  return next.slice(0, limit);
}

function mergeScoreStudyJobs(previous = [], job = null, limit = 18) {
  if (!job?.jobId) {
    return Array.isArray(previous) ? previous : [];
  }
  const next = [
    job,
    ...(Array.isArray(previous) ? previous : []).filter((entry) => entry?.jobId !== job.jobId),
  ];
  return next.slice(0, limit);
}

function parseClientJobUpdatedMs(job = null) {
  const candidates = [
    job?.updatedAt,
    job?.heartbeatAt,
    job?.progress?.heartbeatAt,
    job?.finishedAt,
    job?.startedAt,
    job?.createdAt,
  ];
  for (const candidate of candidates) {
    const parsed = Date.parse(String(candidate || ""));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function isTerminalJobStatus(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "completed" || normalized === "cancelled" || normalized === "failed";
}

function buildOptimisticCancelProgress(progress = null) {
  const timestamp = new Date().toISOString();
  const baseProgress = progress && typeof progress === "object" ? progress : {};
  const resolvedPct = Number.isFinite(Number(baseProgress?.pct))
    ? Math.max(0, Math.min(100, Number(baseProgress.pct)))
    : null;
  return {
    ...baseProgress,
    stage: "cancel_requested",
    detail: "Cancellation requested. Waiting for the current stage to stop safely.",
    cancelRequestedAt: timestamp,
    heartbeatAt: timestamp,
    ...(resolvedPct == null ? {} : { pct: resolvedPct }),
  };
}

function buildOptimisticBacktestCancelJob(job = null) {
  if (!job?.jobId) {
    return null;
  }
  const timestamp = new Date().toISOString();
  return {
    ...job,
    status: "cancel_requested",
    updatedAt: timestamp,
    progress: buildOptimisticCancelProgress(job.progress),
  };
}

function buildOptimisticScoreStudyCancelJob(job = null) {
  if (!job?.jobId) {
    return null;
  }
  const timestamp = new Date().toISOString();
  return {
    ...job,
    status: "cancel_requested",
    updatedAt: timestamp,
    heartbeatAt: timestamp,
    progress: buildOptimisticCancelProgress(job.progress),
  };
}

function resolvePreferredBacktestJob(previousJob = null, nextJob = null) {
  const current = previousJob?.jobId ? previousJob : null;
  const incoming = nextJob?.jobId ? nextJob : null;
  if (!current) {
    return incoming || emptyBacktestJobState();
  }
  if (!incoming) {
    return ACTIVE_BACKTEST_JOB_STATUSES.includes(String(current.status || ""))
      ? current
      : emptyBacktestJobState();
  }
  if (current.jobId !== incoming.jobId) {
    const currentUpdatedMs = parseClientJobUpdatedMs(current);
    const incomingUpdatedMs = parseClientJobUpdatedMs(incoming);
    if (
      ACTIVE_BACKTEST_JOB_STATUSES.includes(String(current.status || ""))
      && (!Number.isFinite(incomingUpdatedMs) || (Number.isFinite(currentUpdatedMs) && currentUpdatedMs > incomingUpdatedMs))
    ) {
      return current;
    }
    return incoming;
  }
  if (isTerminalJobStatus(incoming.status)) {
    return incoming;
  }
  if (isTerminalJobStatus(current.status)) {
    return current;
  }
  if (String(current.status || "") === "cancel_requested" && !isTerminalJobStatus(incoming.status)) {
    return current;
  }
  const currentUpdatedMs = parseClientJobUpdatedMs(current);
  const incomingUpdatedMs = parseClientJobUpdatedMs(incoming);
  if (Number.isFinite(currentUpdatedMs) && Number.isFinite(incomingUpdatedMs) && currentUpdatedMs > incomingUpdatedMs) {
    return current;
  }
  if (Number.isFinite(currentUpdatedMs) && Number.isFinite(incomingUpdatedMs) && incomingUpdatedMs > currentUpdatedMs) {
    return incoming;
  }
  const currentPct = Number.isFinite(Number(current?.progress?.pct)) ? Number(current.progress.pct) : -1;
  const incomingPct = Number.isFinite(Number(incoming?.progress?.pct)) ? Number(incoming.progress.pct) : -1;
  return currentPct > incomingPct ? current : incoming;
}

function resolvePreferredScoreStudyJob(previousJob = null, nextJob = null) {
  const current = previousJob?.jobId ? previousJob : null;
  const incoming = nextJob?.jobId ? nextJob : null;
  if (!current) {
    return incoming || emptyScoreStudyJobState();
  }
  if (!incoming) {
    return SCORE_STUDY_ACTIVE_JOB_STATUSES.includes(String(current.status || ""))
      ? current
      : emptyScoreStudyJobState();
  }
  if (current.jobId !== incoming.jobId) {
    const currentUpdatedMs = parseClientJobUpdatedMs(current);
    const incomingUpdatedMs = parseClientJobUpdatedMs(incoming);
    if (
      SCORE_STUDY_ACTIVE_JOB_STATUSES.includes(String(current.status || ""))
      && (!Number.isFinite(incomingUpdatedMs) || (Number.isFinite(currentUpdatedMs) && currentUpdatedMs > incomingUpdatedMs))
    ) {
      return current;
    }
    return incoming;
  }
  if (isTerminalJobStatus(incoming.status)) {
    return incoming;
  }
  if (isTerminalJobStatus(current.status)) {
    return current;
  }
  if (String(current.status || "") === "cancel_requested" && !isTerminalJobStatus(incoming.status)) {
    return current;
  }
  const currentUpdatedMs = parseClientJobUpdatedMs(current);
  const incomingUpdatedMs = parseClientJobUpdatedMs(incoming);
  if (Number.isFinite(currentUpdatedMs) && Number.isFinite(incomingUpdatedMs) && currentUpdatedMs > incomingUpdatedMs) {
    return current;
  }
  if (Number.isFinite(currentUpdatedMs) && Number.isFinite(incomingUpdatedMs) && incomingUpdatedMs > currentUpdatedMs) {
    return incoming;
  }
  const currentPct = Number.isFinite(Number(current?.progress?.pct)) ? Number(current.progress.pct) : -1;
  const incomingPct = Number.isFinite(Number(incoming?.progress?.pct)) ? Number(incoming.progress.pct) : -1;
  return currentPct > incomingPct ? current : incoming;
}

function mergeBacktestJobs(previous = [], job = null, limit = 18) {
  if (!job?.jobId) {
    return Array.isArray(previous) ? previous : [];
  }
  const existing = (Array.isArray(previous) ? previous : []).find((entry) => entry?.jobId === job.jobId) || null;
  const resolvedJob = resolvePreferredBacktestJob(existing, job);
  const next = [
    resolvedJob,
    ...(Array.isArray(previous) ? previous : []).filter((entry) => entry?.jobId !== resolvedJob.jobId),
  ];
  return next.slice(0, limit);
}

function mergeScoreStudyJobCollection(previous = [], incoming = [], activeJob = null, limit = 18) {
  const merged = new Map();
  for (const job of Array.isArray(previous) ? previous : []) {
    if (job?.jobId) {
      merged.set(job.jobId, job);
    }
  }
  for (const job of Array.isArray(incoming) ? incoming : []) {
    if (!job?.jobId) {
      continue;
    }
    merged.set(job.jobId, resolvePreferredScoreStudyJob(merged.get(job.jobId) || null, job));
  }
  if (activeJob?.jobId) {
    merged.set(activeJob.jobId, resolvePreferredScoreStudyJob(merged.get(activeJob.jobId) || null, activeJob));
  }
  return [...merged.values()]
    .sort((left, right) => (parseClientJobUpdatedMs(right) || 0) - (parseClientJobUpdatedMs(left) || 0))
    .slice(0, limit);
}

function normalizeSelectedComparisonRunIds(runIds = [], runs = []) {
  const availableIds = new Set((Array.isArray(runs) ? runs : []).map((run) => run?.runId).filter(Boolean));
  return (Array.isArray(runIds) ? runIds : [])
    .map((runId) => String(runId || "").trim())
    .filter((runId, index, all) => runId && availableIds.has(runId) && all.indexOf(runId) === index)
    .slice(0, SCORE_STUDY_COMPARE_LIMIT);
}

function resolveDefaultScoreStudyComparisonIds(runs = []) {
  const validRuns = (Array.isArray(runs) ? runs : []).filter((run) => run?.validityStatus !== "invalid");
  const preferredPresetOrder = [
    RAYALGO_SCORE_STUDY_PRESET_TRANCHE2_2M,
    RAYALGO_SCORE_STUDY_PRESET_DIRECTION_RANK_V1,
    RAYALGO_SCORE_STUDY_PRESET_REGIME_RANK_V1,
    RAYALGO_SCORE_STUDY_PRESET_TRANCHE3_SPLIT_FLOOR,
    RAYALGO_SCORE_STUDY_PRESET_TRANCHE3_HARD_GATED,
  ];

  const selected = [];
  for (const presetId of preferredPresetOrder) {
    const match = validRuns.find((run) => run?.symbol === "SPY" && run?.presetId === presetId);
    if (match?.runId && !selected.includes(match.runId)) {
      selected.push(match.runId);
    }
  }

  for (const run of validRuns) {
    if (!run?.runId || selected.includes(run.runId)) {
      continue;
    }
    selected.push(run.runId);
    if (selected.length >= SCORE_STUDY_COMPARE_LIMIT) {
      break;
    }
  }

  return selected.slice(0, SCORE_STUDY_COMPARE_LIMIT);
}

function buildCompactIndicatorOverlayTape(tape = null) {
  const windows = Array.isArray(tape?.windows) ? tape.windows : [];
  const latestWindow = windows.length ? windows[windows.length - 1] : null;
  return {
    events: [],
    zones: [],
    windows: latestWindow ? [latestWindow] : [],
  };
}

function mergeRecentResultSummary(previous = [], record = null, limit = 18) {
  const summary = buildRecentResultSummary(record);
  if (!summary) {
    return Array.isArray(previous) ? previous : [];
  }
  const next = [
    summary,
    ...(Array.isArray(previous) ? previous : []).filter((entry) => entry?.resultId !== summary.resultId),
  ];
  return next.slice(0, limit);
}

function hasHydratedResultPayload(record = null) {
  return Array.isArray(record?.trades) || Array.isArray(record?.equity) || Array.isArray(record?.skippedTrades);
}

function shouldRunBacktestInBackground({ replayCandidates = [], executionBars = [] } = {}) {
  const candidateCount = Array.isArray(replayCandidates) ? replayCandidates.length : 0;
  const barCount = Array.isArray(executionBars) ? executionBars.length : 0;
  return candidateCount >= BACKGROUND_REPLAY_CANDIDATE_THRESHOLD || barCount >= BACKGROUND_EXECUTION_BAR_THRESHOLD;
}

function buildReplayTradeSignature(trade = {}) {
  return [
    String(trade.ts || "").trim(),
    String(trade.et || "").trim(),
    String(trade.dir || "").trim(),
    String(trade.optionTicker || "").trim(),
    Number(trade.pnl || 0).toFixed(2),
  ].join("|");
}

function countRayAlgoSignalEvents(tape = null) {
  const events = Array.isArray(tape?.events) ? tape.events : [];
  return events.filter((event) => event?.eventType === "signal_fire" && String(event?.strategy || "").trim().toLowerCase() === "rayalgo").length;
}

function roundCompareValue(value, precision = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return +numeric.toFixed(precision);
}

function buildRayAlgoScoringComparisonSummary({
  baselineConfig,
  currentConfig,
  baselineRun,
  currentRun,
  baselineSignalCount = 0,
  currentSignalCount = 0,
  capital = 25000,
} = {}) {
  const baselineTrades = Array.isArray(baselineRun?.trades) ? baselineRun.trades : [];
  const currentTrades = Array.isArray(currentRun?.trades) ? currentRun.trades : [];
  const baselineMetrics = computeBacktestMetrics(baselineTrades, capital);
  const currentMetrics = computeBacktestMetrics(currentTrades, capital);
  const matchingTrades = JSON.stringify(currentTrades.map(buildReplayTradeSignature)) === JSON.stringify(baselineTrades.map(buildReplayTradeSignature));
  const matchingMetrics = JSON.stringify(currentMetrics) === JSON.stringify(baselineMetrics);
  const delta = {
    pnl: roundCompareValue(currentMetrics.pnl - baselineMetrics.pnl, 2),
    roi: roundCompareValue(currentMetrics.roi - baselineMetrics.roi, 2),
    wr: roundCompareValue(currentMetrics.wr - baselineMetrics.wr, 2),
    pf: roundCompareValue(currentMetrics.pf - baselineMetrics.pf, 2),
    sharpe: roundCompareValue(currentMetrics.sharpe - baselineMetrics.sharpe, 2),
    dd: roundCompareValue(currentMetrics.dd - baselineMetrics.dd, 2),
    tradeCount: Number(currentMetrics.n || 0) - Number(baselineMetrics.n || 0),
    signalCount: Number(currentSignalCount || 0) - Number(baselineSignalCount || 0),
  };

  const currentModeLabel = `${currentConfig?.precursorLadderId || "none"} · ${currentConfig?.authority || "observe_only"}`;
  const baselineModeLabel = `${baselineConfig?.precursorLadderId || "none"} · ${baselineConfig?.authority || "observe_only"}`;
  const isBaselineMode = currentModeLabel === baselineModeLabel;
  const hasAnyDelta = Object.values(delta).some((value) => Number(value) !== 0);
  let status = "baseline";
  let headline = "Current run is using the baseline RayAlgo scoring mode.";
  if (!isBaselineMode && !hasAnyDelta && matchingTrades && matchingMetrics) {
    status = "neutral";
    headline = "Current scoring mode matches the baseline run.";
  } else if (!isBaselineMode && hasAnyDelta) {
    const worsened = delta.pnl < 0 || delta.pf < 0 || delta.dd > 0;
    const improved = delta.pnl > 0 || delta.pf > 0 || delta.dd < 0;
    status = worsened && !improved ? "worse" : improved && !worsened ? "better" : "mixed";
    headline = "Current scoring mode changed sizing or execution versus the baseline.";
  }

  return {
    status,
    headline,
    currentModeLabel,
    baselineModeLabel,
    currentConfig,
    baselineConfig,
    currentMetrics,
    baselineMetrics,
    delta,
    matchingTrades,
    matchingMetrics,
    currentTradeCount: currentTrades.length,
    baselineTradeCount: baselineTrades.length,
    currentSignalCount,
    baselineSignalCount,
  };
}

function formatReplayContractLabel(contract) {
  if (!contract?.optionTicker) {
    return null;
  }
  const strike = Number(contract.strike);
  const strikeLabel = Number.isFinite(strike)
    ? (Number.isInteger(strike) ? String(strike) : strike.toFixed(2).replace(/\.?0+$/, ""))
    : "?";
  return `${contract.optionTicker} · ${contract.expiryDate || contract.expiry || "?"} ${String(contract.right || "").toUpperCase()} ${strikeLabel}`;
}

const OPTIMIZER_DTE_SHORTLIST = [0, 1, 3, 5, 7, 10];

function buildFixedDteSelectionSpec(optionSelectionSpec = {}, nextDte = 5) {
  return {
    ...(optionSelectionSpec || {}),
    targetDte: nextDte,
    minDte: nextDte,
    maxDte: nextDte,
  };
}

function createEmptyRecommendationCell() {
  return { n: 0, wr: 0, exp: 0, pnl: 0, rank: 0 };
}

function buildRecommendationMatrixFromTrades(trades = []) {
  const matrix = {};
  for (const regime of REGIME_OPTIONS) {
    const regimeTrades = (Array.isArray(trades) ? trades : []).filter((trade) => trade.regime === regime);
    const count = regimeTrades.length;
    if (!count) {
      matrix[regime] = createEmptyRecommendationCell();
      continue;
    }
    const wins = regimeTrades.filter((trade) => (trade.pnl - (trade.commIn || 0)) > 0);
    const losses = regimeTrades.filter((trade) => (trade.pnl - (trade.commIn || 0)) <= 0);
    const totalPnl = regimeTrades.reduce((sum, trade) => sum + trade.pnl - (trade.commIn || 0), 0);
    const winPnl = wins.reduce((sum, trade) => sum + trade.pnl - (trade.commIn || 0), 0);
    const lossPnl = losses.reduce((sum, trade) => sum + trade.pnl - (trade.commIn || 0), 0);
    const winRate = (wins.length / count) * 100;
    const avgWin = wins.length > 0 ? winPnl / wins.length : 0;
    const avgLoss = losses.length > 0 ? lossPnl / losses.length : 0;
    const expectancy = (winRate / 100) * avgWin + (1 - winRate / 100) * avgLoss;
    matrix[regime] = {
      n: count,
      wr: +winRate.toFixed(1),
      exp: +expectancy.toFixed(0),
      pnl: +totalPnl.toFixed(0),
      rank: 0,
    };
  }
  return matrix;
}

function rankRecommendationMatrix(matrix = {}) {
  const nextMatrix = { ...matrix };
  for (const regime of REGIME_OPTIONS) {
    const rankedStrategies = RECOMMENDATION_COMPUTE_STRATEGIES
      .filter((strategyKey) => (nextMatrix[strategyKey]?.[regime]?.n || 0) >= 3)
      .sort((left, right) => (nextMatrix[right]?.[regime]?.exp || 0) - (nextMatrix[left]?.[regime]?.exp || 0));
    rankedStrategies.forEach((strategyKey, index) => {
      nextMatrix[strategyKey] = {
        ...(nextMatrix[strategyKey] || {}),
        [regime]: {
          ...(nextMatrix[strategyKey]?.[regime] || createEmptyRecommendationCell()),
          rank: index + 1,
        },
      };
    });
  }
  return nextMatrix;
}

function computeOptimizerScore(metrics = {}) {
  const profitFactor = metrics.pf === "∞" ? 10 : parseFloat(metrics.pf);
  const cappedPf = Math.min(Math.max(Number.isFinite(profitFactor) ? profitFactor : 0, 0), 5);
  const drawdownPenalty = Math.pow(1 - Math.min(Number(metrics.dd) || 0, 80) / 100, 1.5);
  const significance = Math.log2(Math.max(Number(metrics.n) || 0, 2));
  const sharpe = Math.max(Number(metrics.sharpe) || 0, 0);
  const winRate = (Number(metrics.wr) || 0) / 100;
  return +(sharpe * cappedPf * drawdownPenalty * significance * winRate).toFixed(4);
}

function buildOptimizerDteCandidates(currentDte = 5) {
  const resolvedCurrent = Number.isFinite(Number(currentDte))
    ? Math.max(0, Math.min(10, Math.round(Number(currentDte))))
    : 5;
  const lower = [...OPTIMIZER_DTE_SHORTLIST].reverse().find((value) => value < resolvedCurrent);
  const higher = OPTIMIZER_DTE_SHORTLIST.find((value) => value > resolvedCurrent);
  return Array.from(new Set([lower, resolvedCurrent, higher].filter((value) => Number.isFinite(value))));
}

export function useResearchExecution({
  isActive = true,
  marketSymbol = "SPY",
  bars = [],
  capital,
  executionFidelity = "bar_close",
  strategy,
  dte,
  iv,
  slPct,
  tpPct,
  trailStartPct,
  trailPct,
  zombieBars,
  minConviction,
  allowShorts,
  kellyFrac,
  regimeFilter,
  maxPos,
  sessionBlocks,
  tfMin,
  regimeAdapt,
  commPerContract,
  slipBps,
  tradeDays,
  signalTimeframe = "5m",
  shadingTimeframe = null,
  requestedIndicatorOverlayTimeframes = null,
  rayalgoSettings = null,
  rayalgoScoringConfig: requestedRayalgoScoringConfig = null,
  backtestV2StageConfig = null,
  backtestV2RuntimeBridge: requestedBacktestV2RuntimeBridge = null,
  optionRuntimeConfig,
  setupSnapshot = null,
  resultMeta = null,
} = {}) {
  const [bottomTab, setBottomTab] = useState("overview");
  const [logPage, setLogPage] = useState(0);
  const [snap, setSnap] = useState(null);
  const [optResults, setOptResults] = useState(null);
  const [optRunning, setOptRunning] = useState(false);
  const [optError, setOptError] = useState(null);
  const [completedOptimizeRunId, setCompletedOptimizeRunId] = useState(0);
  const [recoMatrix, setRecoMatrix] = useState(null);
  const [recoComputing, setRecoComputing] = useState(false);
  const [recoError, setRecoError] = useState(null);
  const [runState, setRunState] = useState(() => emptyRunState());
  const [inputImpactState, setInputImpactState] = useState(() => emptyOverviewDiagnosticState());
  const [rayalgoScoringComparisonState, setRayalgoScoringComparisonState] = useState(() => emptyOverviewDiagnosticState());
  const [rayalgoScoreStudyState, setRayalgoScoreStudyState] = useState(() => emptyRayAlgoScoreStudyState());
  const [lastRunDelta, setLastRunDelta] = useState(null);
  const [completedRunId, setCompletedRunId] = useState(0);
  const [lastExecutedDraftSignature, setLastExecutedDraftSignature] = useState(null);
  const [pendingRunRequest, setPendingRunRequest] = useState(null);
  const [queuedRunRequested, setQueuedRunRequested] = useState(false);
  const [backtestProgress, setBacktestProgress] = useState(null);
  const [liveRunState, setLiveRunState] = useState(() => emptyLiveRunState());
  const [activeBacktestJob, setActiveBacktestJob] = useState(() => emptyBacktestJobState());
  const [activeOptimizerJob, setActiveOptimizerJob] = useState(() => emptyBacktestJobState());
  const [latestResultRecord, setLatestResultRecord] = useState(null);
  const [displayedResultRecord, setDisplayedResultRecord] = useState(null);
  const [recentBacktestJobs, setRecentBacktestJobs] = useState([]);
  const [recentBacktestResults, setRecentBacktestResults] = useState([]);
  const [recentOptimizerJobs, setRecentOptimizerJobs] = useState([]);
  const timersRef = useRef(new Set());
  const runCounterRef = useRef(0);
  const inputImpactRunRef = useRef(0);
  const scoringCompareRunRef = useRef(0);
  const recoRunRef = useRef(0);
  const optRunRef = useRef(0);
  const lastCompletedReplayRef = useRef(null);
  const latestDraftRunSignatureRef = useRef(null);
  const queuedRunRequestedRef = useRef(false);
  const latestResultRecordRef = useRef(null);
  const pendingRunAfterDraftChangeRef = useRef(null);
  const rayalgoScoreStudyRunRef = useRef(0);
  const rayalgoScoreStudyStateRef = useRef(emptyRayAlgoScoreStudyState());
  const rayalgoScoreStudyDetailRequestRef = useRef(new Map());
  const activeBacktestJobRef = useRef(emptyBacktestJobState());
  const activeScoreStudyJobRef = useRef(emptyScoreStudyJobState());

  useEffect(() => () => {
    for (const timerId of timersRef.current) {
      clearTimeout(timerId);
    }
    timersRef.current.clear();
  }, []);

  useEffect(() => {
    activeBacktestJobRef.current = activeBacktestJob;
  }, [activeBacktestJob]);

  useEffect(() => {
    rayalgoScoreStudyStateRef.current = rayalgoScoreStudyState;
  }, [rayalgoScoreStudyState]);

  useEffect(() => {
    activeScoreStudyJobRef.current = rayalgoScoreStudyState.activeJob;
  }, [rayalgoScoreStudyState.activeJob]);

  const signalTfMin = useMemo(
    () => Math.max(1, timeframeToMinutes(signalTimeframe) || 5),
    [signalTimeframe],
  );
  const activeBars = useMemo(
    () => (isActive ? (Array.isArray(bars) ? bars : []) : []),
    [bars, isActive],
  );
  const resolvedBacktestV2RuntimeBridge = useMemo(() => (
    requestedBacktestV2RuntimeBridge || compileBacktestV2RuntimeBridge({
      stageConfig: backtestV2StageConfig,
      signalTimeframe,
      fallbackCapital: capital,
      fallbackDte: dte,
      fallbackKellyFrac: kellyFrac,
      fallbackMaxPositions: maxPos,
      fallbackRiskStopPolicy: RESEARCH_RISK_STOP_POLICY,
      fallbackOptionSelectionSpec: optionRuntimeConfig?.optionSelectionSpec,
    })
  ), [
    backtestV2StageConfig,
    capital,
    dte,
    kellyFrac,
    maxPos,
    optionRuntimeConfig?.optionSelectionSpec,
    requestedBacktestV2RuntimeBridge,
    signalTimeframe,
  ]);
  const executionBars = useMemo(
    () => filterBarsForBacktestV2Window(activeBars, resolvedBacktestV2RuntimeBridge.stageConfig),
    [activeBars, resolvedBacktestV2RuntimeBridge.stageConfig],
  );
  const chartOverlayBars = useMemo(
    () => resolveChartOverlaySourceBars({ chartBars: activeBars, executionBars }),
    [activeBars, executionBars],
  );
  const effectiveStageConfig = resolvedBacktestV2RuntimeBridge.stageConfig || backtestV2StageConfig || null;
  const effectiveLegacyInputs = useMemo(() => resolveLegacyTopRailCompatFields({
    stageConfig: effectiveStageConfig,
    runtimeBridge: resolvedBacktestV2RuntimeBridge,
    fallbackFields: {
      capital,
      dte,
      slPct,
      tpPct,
      trailStartPct,
      trailPct,
      zombieBars,
      minConviction,
      allowShorts,
      kellyFrac,
      regimeFilter,
      maxPositions: maxPos,
      sessionBlocks,
      regimeAdapt,
      commPerContract,
      slipBps,
      tradeDays,
      riskStopPolicy: RESEARCH_RISK_STOP_POLICY,
      optionSelectionSpec: optionRuntimeConfig?.optionSelectionSpec,
    },
  }), [
    allowShorts,
    capital,
    commPerContract,
    dte,
    effectiveStageConfig,
    kellyFrac,
    maxPos,
    minConviction,
    optionRuntimeConfig?.optionSelectionSpec,
    regimeAdapt,
    regimeFilter,
    resolvedBacktestV2RuntimeBridge,
    sessionBlocks,
    slPct,
    slipBps,
    tpPct,
    tradeDays,
    trailPct,
    trailStartPct,
    zombieBars,
  ]);
  const effectiveCapital = effectiveLegacyInputs.capital;
  const effectiveDte = effectiveLegacyInputs.dte;
  const effectiveSlPct = effectiveLegacyInputs.slPct;
  const effectiveTpPct = effectiveLegacyInputs.tpPct;
  const effectiveTrailStartPct = effectiveLegacyInputs.trailStartPct;
  const effectiveTrailPct = effectiveLegacyInputs.trailPct;
  const effectiveZombieBars = effectiveLegacyInputs.zombieBars;
  const effectiveMinConviction = effectiveLegacyInputs.minConviction;
  const effectiveAllowShorts = effectiveLegacyInputs.allowShorts;
  const effectiveKellyFrac = effectiveLegacyInputs.kellyFrac;
  const effectiveRegimeFilter = effectiveLegacyInputs.regimeFilter;
  const effectiveMaxPositions = effectiveLegacyInputs.maxPositions;
  const effectiveSessionBlocks = effectiveLegacyInputs.sessionBlocks;
  const effectiveRegimeAdapt = effectiveLegacyInputs.regimeAdapt;
  const effectiveCommPerContract = effectiveLegacyInputs.commPerContract;
  const effectiveSlipBps = effectiveLegacyInputs.slipBps;
  const effectiveTradeDays = effectiveLegacyInputs.tradeDays;
  const effectiveRiskStopPolicy = effectiveLegacyInputs.riskStopPolicy || RESEARCH_RISK_STOP_POLICY;
  const effectiveOptionSelectionSpec = effectiveLegacyInputs.optionSelectionSpec;
  const signalBars = useMemo(
    () => aggregateBarsToMinutes(executionBars, signalTfMin),
    [executionBars, signalTfMin],
  );
  const chartOverlaySignalBars = useMemo(
    () => aggregateBarsToMinutes(chartOverlayBars, signalTfMin),
    [chartOverlayBars, signalTfMin],
  );
  const normalizedStrategy = useMemo(
    () => normalizeResearchStrategy(strategy),
    [strategy],
  );
  const rayalgoScoringConfig = useMemo(() => {
    if (normalizedStrategy !== "rayalgo") {
      return null;
    }
    const normalizedSymbol = String(marketSymbol || "").trim().toUpperCase();
    const defaultPrecursorFrames = normalizedSymbol === "SPY" && (signalTimeframe === "1m" || signalTimeframe === "2m")
      ? ["5m", "15m"]
      : [];
    return normalizeRayAlgoScoringConfig({
      activeTimeframe: signalTimeframe,
      marketSymbol,
      ...(defaultPrecursorFrames.length ? { precursorFrames: defaultPrecursorFrames } : { precursorLadderId: "none" }),
      ...(requestedRayalgoScoringConfig || {}),
    });
  }, [marketSymbol, normalizedStrategy, requestedRayalgoScoringConfig, signalTimeframe]);
  const rayalgoScoreStudyInputKey = useMemo(() => JSON.stringify({
    strategy: normalizedStrategy,
    marketSymbol,
    signalTimeframe,
    barCount: Array.isArray(executionBars) ? executionBars.length : 0,
    barStartTs: Array.isArray(executionBars) && executionBars.length ? executionBars[0]?.ts || null : null,
    barEndTs: Array.isArray(executionBars) && executionBars.length ? executionBars[executionBars.length - 1]?.ts || null : null,
    rayalgoSettings,
    rayalgoScoringConfig,
    profileName: resolvedBacktestV2RuntimeBridge.support.profileName,
  }), [executionBars, marketSymbol, normalizedStrategy, rayalgoScoringConfig, rayalgoSettings, resolvedBacktestV2RuntimeBridge.support.profileName, signalTimeframe]);
  const regimes = useMemo(() => detectBacktestRegimes(signalBars), [signalBars]);
  const chartOverlayRegimes = useMemo(
    () => detectBacktestRegimes(chartOverlaySignalBars),
    [chartOverlaySignalBars],
  );

  const cfg = useMemo(() => ({
    executionFidelity,
    executionBars,
    dte: effectiveDte,
    iv,
    slPct: effectiveSlPct,
    tpPct: effectiveTpPct,
    trailStartPct: effectiveTrailStartPct,
    trailPct: effectiveTrailPct,
    zombieBars: effectiveZombieBars,
    minConviction: effectiveMinConviction,
    allowShorts: effectiveAllowShorts,
    kellyFrac: effectiveKellyFrac,
    regimeFilter: effectiveRegimeFilter,
    maxPositions: effectiveMaxPositions,
    capital: effectiveCapital,
    sessionBlocks: effectiveSessionBlocks,
    tfMin: signalTfMin,
    regimeAdapt: effectiveRegimeAdapt,
    commPerContract: effectiveCommPerContract,
    slipBps: effectiveSlipBps,
    tradeDays: effectiveTradeDays,
    signalTimeframe,
    rayalgoSettings,
    rayalgoScoringConfig,
    positionSizingConfig: resolvedBacktestV2RuntimeBridge.positionSizingConfig,
    riskStopConfig: resolvedBacktestV2RuntimeBridge.riskStopConfig,
    ...optionRuntimeConfig,
    strategy: normalizedStrategy,
    includeIndicatorOverlays: true,
    riskStopPolicy: effectiveRiskStopPolicy,
  }), [
    effectiveCapital,
    effectiveDte,
    effectiveKellyFrac,
    effectiveMaxPositions,
    effectiveRiskStopPolicy,
    effectiveAllowShorts,
    effectiveCommPerContract,
    effectiveMinConviction,
    effectiveRegimeAdapt,
    effectiveRegimeFilter,
    effectiveSessionBlocks,
    effectiveSlipBps,
    effectiveSlPct,
    effectiveTpPct,
    effectiveTradeDays,
    effectiveTrailPct,
    effectiveTrailStartPct,
    effectiveZombieBars,
    executionBars,
    executionFidelity,
    iv,
    optionRuntimeConfig,
    rayalgoSettings,
    resolvedBacktestV2RuntimeBridge.positionSizingConfig,
    resolvedBacktestV2RuntimeBridge.riskStopConfig,
    signalTimeframe,
    signalTfMin,
    normalizedStrategy,
    rayalgoScoringConfig,
  ]);

  const inputImpactPayload = useMemo(() => createInputImpactPayload({
    marketSymbol,
    bars: executionBars,
    capital: effectiveCapital,
    executionFidelity,
    strategy: normalizedStrategy,
    dte: effectiveDte,
    iv,
    slPct: effectiveSlPct,
    tpPct: effectiveTpPct,
    trailStartPct: effectiveTrailStartPct,
    trailPct: effectiveTrailPct,
    zombieBars: effectiveZombieBars,
    minConviction: effectiveMinConviction,
    allowShorts: effectiveAllowShorts,
    kellyFrac: effectiveKellyFrac,
    regimeFilter: effectiveRegimeFilter,
    maxPositions: effectiveMaxPositions,
    sessionBlocks: effectiveSessionBlocks,
    regimeAdapt: effectiveRegimeAdapt,
    commPerContract: effectiveCommPerContract,
    slipBps: effectiveSlipBps,
    tradeDays: effectiveTradeDays,
    signalTimeframe,
    rayalgoSettings,
    rayalgoScoringConfig,
    riskStopPolicy: effectiveRiskStopPolicy,
    optionSelectionSpec: effectiveOptionSelectionSpec,
    backtestV2StageConfig: effectiveStageConfig,
  }), [
    effectiveCapital,
    effectiveDte,
    effectiveKellyFrac,
    effectiveMaxPositions,
    effectiveRiskStopPolicy,
    effectiveAllowShorts,
    effectiveCommPerContract,
    effectiveMinConviction,
    effectiveRegimeAdapt,
    effectiveRegimeFilter,
    effectiveSessionBlocks,
    effectiveSlipBps,
    effectiveSlPct,
    effectiveStageConfig,
    effectiveTpPct,
    effectiveTradeDays,
    effectiveTrailPct,
    effectiveTrailStartPct,
    effectiveZombieBars,
    executionBars,
    executionFidelity,
    iv,
    marketSymbol,
    normalizedStrategy,
    rayalgoSettings,
    rayalgoScoringConfig,
    effectiveOptionSelectionSpec,
    signalTimeframe,
  ]);


  const draftRunSignature = useMemo(() => buildResearchRunDraftSignature({
    inputPayload: inputImpactPayload,
    executionBars,
    signalBars,
    executionMode: optionRuntimeConfig?.executionMode || "option_history",
    replayCredentialsReady: optionRuntimeConfig?.replayCredentialsReady,
    runtimeBridge: resolvedBacktestV2RuntimeBridge,
  }), [
    executionBars,
    inputImpactPayload,
    optionRuntimeConfig?.executionMode,
    optionRuntimeConfig?.replayCredentialsReady,
    resolvedBacktestV2RuntimeBridge,
    signalBars,
  ]);

  useEffect(() => {
    if (isActive) {
      return undefined;
    }
    pendingRunAfterDraftChangeRef.current = null;
    latestResultRecordRef.current = null;
    setPendingRunRequest(null);
    setQueuedRunRequested(false);
    setBacktestProgress(null);
    setLiveRunState(emptyLiveRunState());
    setActiveBacktestJob(emptyBacktestJobState());
    setActiveOptimizerJob(emptyBacktestJobState());
    setLatestResultRecord(null);
    setRunState(emptyRunState());
    setInputImpactState(emptyOverviewDiagnosticState());
    setRayalgoScoringComparisonState(emptyOverviewDiagnosticState());
    setRayalgoScoreStudyState(emptyRayAlgoScoreStudyState());
    setRecoMatrix(null);
    setRecoComputing(false);
    setRecoError(null);
    setOptResults(null);
    setOptRunning(false);
    setOptError(null);
    return undefined;
  }, [isActive]);

  useEffect(() => {
    latestDraftRunSignatureRef.current = draftRunSignature;
  }, [draftRunSignature]);

  useEffect(() => {
    queuedRunRequestedRef.current = queuedRunRequested;
  }, [queuedRunRequested]);

  useEffect(() => {
    latestResultRecordRef.current = latestResultRecord;
  }, [latestResultRecord]);

  const hydrateStoredResultRecord = useCallback(async (record = null) => {
    if (!record) {
      return null;
    }
    if (hasHydratedResultPayload(record) || !record.resultId) {
      return record;
    }
    const response = await getResearchBacktestResult(record.resultId);
    return response?.result || null;
  }, []);

  const beginPendingRunRequest = useCallback((signature = draftRunSignature) => {
    runCounterRef.current += 1;
    const nextRunId = runCounterRef.current;
    setQueuedRunRequested(false);
    setBacktestProgress(null);
    setLiveRunState(emptyLiveRunState());
    setRunState((previous) => ({
      ...previous,
      status: "loading",
      error: null,
    }));
    setPendingRunRequest({ id: nextRunId, signature });
    return nextRunId;
  }, [draftRunSignature]);

  const runBacktestNow = useCallback(() => {
    const mode = resolveResearchRunRequestMode({
      runStatus: runState.status,
      hasQueuedRun: queuedRunRequestedRef.current,
    });
    if (mode === "queue") {
      setQueuedRunRequested(true);
      return { ok: true, queued: true };
    }
    if (mode === "noop") {
      return { ok: true, queued: true };
    }
    beginPendingRunRequest(draftRunSignature);
    return { ok: true, queued: false };
  }, [beginPendingRunRequest, draftRunSignature, runState.status]);

  const runBacktestOnNextDraftChange = useCallback(() => {
    pendingRunAfterDraftChangeRef.current = draftRunSignature;
    return { ok: true };
  }, [draftRunSignature]);

  useEffect(() => {
    const previousDraftSignature = pendingRunAfterDraftChangeRef.current;
    if (!previousDraftSignature || draftRunSignature === previousDraftSignature) {
      return;
    }
    pendingRunAfterDraftChangeRef.current = null;
    beginPendingRunRequest(draftRunSignature);
  }, [beginPendingRunRequest, draftRunSignature]);

  const restoreSavedRun = useCallback((entry = null) => {
    if (!entry) {
      return;
    }
    pendingRunAfterDraftChangeRef.current = null;
    setPendingRunRequest(null);
    setQueuedRunRequested(false);
    setCompletedRunId(0);
    setLastExecutedDraftSignature(latestDraftRunSignatureRef.current || draftRunSignature || null);
    setLastRunDelta(null);
    lastCompletedReplayRef.current = null;
    setBacktestProgress(null);
    setLiveRunState(emptyLiveRunState());
    setDisplayedResultRecord(buildDisplayedResultRecord(
      entry,
      entry?.bookmarkedAt ? "bookmark" : entry?.resultId ? "history" : "history",
    ));
    setRunState(buildRestoredResearchRunState(entry));
  }, [draftRunSignature]);

  const openStoredResultRecord = useCallback(async (entry = null) => {
    if (!entry) {
      return { ok: false, reason: "Stored result is unavailable." };
    }
    const hydrated = await hydrateStoredResultRecord(entry);
    if (!hydrated) {
      return { ok: false, reason: "Stored result could not be loaded." };
    }
    restoreSavedRun(hydrated);
    return { ok: true, record: hydrated };
  }, [hydrateStoredResultRecord, restoreSavedRun]);

  const clearLiveRunState = useCallback(() => {
    setLiveRunState(emptyLiveRunState());
  }, []);

  const restoreResultRecord = useCallback((record = null, nextCompletedRunId = null) => {
    if (!record) {
      return;
    }
    setLatestResultRecord(buildDisplayedResultRecord(record, record?.jobId ? "job" : "latest"));
    setRecentBacktestResults((previous) => mergeRecentResultSummary(previous, record));
    setActiveBacktestJob(emptyBacktestJobState());
    setBacktestProgress(null);
    setLiveRunState(emptyLiveRunState());
    setDisplayedResultRecord(buildDisplayedResultRecord(record, record?.jobId ? "job" : "latest"));
    setRunState(buildRestoredResearchRunState(record));
    if (Number.isFinite(Number(nextCompletedRunId)) && Number(nextCompletedRunId) > 0) {
      setCompletedRunId(Number(nextCompletedRunId));
    }
    if (record?.draftSignature) {
      setLastExecutedDraftSignature(record.draftSignature);
    }
  }, []);

  const applyRuntimeProgress = useCallback((progress, extras = {}) => {
    if (!progress) {
      return;
    }
    const tradeDelta = Array.isArray(progress.tradeDelta) ? progress.tradeDelta : [];
    const equityDelta = Array.isArray(progress.equityDelta) ? progress.equityDelta : [];
    const replayResolution = normalizeReplayCounts(extras.replayResolution || extras.replayDatasetSummary || null);
    const replayDatasetSummary = normalizeReplayCounts(extras.replayDatasetSummary || null);

    setBacktestProgress(buildProgressFromGeneratorYield(progress));
    setLiveRunState((previous) => {
      const nextTrades = tradeDelta.length ? previous.trades.concat(tradeDelta) : previous.trades;
      const nextEquity = equityDelta.length ? previous.equity.concat(equityDelta) : previous.equity;
      const nextTradeCount = Number.isFinite(Number(progress.tradeCount))
        ? Math.max(0, Number(progress.tradeCount))
        : nextTrades.length;
      const nextWinCount = Number.isFinite(Number(progress.winCount))
        ? Math.max(0, Number(progress.winCount))
        : previous.winCount;
      const nextCapital = Number.isFinite(Number(progress.capital))
        ? Number(progress.capital)
        : previous.capital;
      const nextInitialCapital = Number.isFinite(Number(progress.initialCapital))
        ? Number(progress.initialCapital)
        : previous.initialCapital;
      return {
        ...previous,
        source: extras.source || previous.source || "local",
        stage: "running-runtime",
        statusText: extras.statusText || (progress.currentDate ? `Scanning ${progress.currentDate}` : previous.statusText || null),
        trades: nextTrades,
        equity: nextEquity,
        tradeCount: nextTradeCount,
        winCount: nextWinCount,
        capital: nextCapital,
        initialCapital: nextInitialCapital,
        replayResolution: replayResolution || previous.replayResolution,
        replayDatasetSummary: replayDatasetSummary || previous.replayDatasetSummary,
        firstResolvedContract: extras.firstResolvedContract || previous.firstResolvedContract || null,
      };
    });
  }, []);

  const applyRemoteStatus = useCallback((stage = "hydrating-bars", detail = null, counts = null, extras = {}) => {
    const replayResolution = normalizeReplayCounts(counts);
    const replayDatasetSummary = normalizeReplayCounts(extras.replayDatasetSummary || counts || null);
    setBacktestProgress(buildRemoteBacktestProgress(stage, replayResolution));
    setLiveRunState((previous) => ({
      ...previous,
      source: "remote",
      stage,
      statusText: detail || previous.statusText || null,
      replayResolution: replayResolution || previous.replayResolution,
      replayDatasetSummary: replayDatasetSummary || previous.replayDatasetSummary,
      firstResolvedContract: extras.firstResolvedContract || previous.firstResolvedContract || null,
    }));
  }, []);

  const applyBackgroundJobSnapshot = useCallback((job = null) => {
    if (!job?.jobId) {
      activeBacktestJobRef.current = emptyBacktestJobState();
      setActiveBacktestJob(emptyBacktestJobState());
      return;
    }
    const normalizedJob = {
      jobId: job.jobId,
      jobType: job.jobType || "backtest",
      status: job.status || "queued",
      resultId: job.resultId || null,
      error: job.error || null,
      progress: job.progress || null,
      metricsPreview: job.metricsPreview || null,
      mode: job.mode || "background",
      createdAt: job.createdAt || null,
      startedAt: job.startedAt || null,
      finishedAt: job.finishedAt || null,
      updatedAt: job.updatedAt || null,
    };
    const preferredJob = resolvePreferredBacktestJob(activeBacktestJobRef.current, normalizedJob);
    activeBacktestJobRef.current = preferredJob;
    setRecentBacktestJobs((previous) => mergeBacktestJobs(previous, preferredJob));
    setActiveBacktestJob(preferredJob);
    if (ACTIVE_BACKTEST_JOB_STATUSES.includes(String(preferredJob.status || ""))) {
      setRunState((previous) => ({
        ...previous,
        status: "loading",
        error: null,
      }));
      applyRemoteStatus(
        preferredJob.progress?.stage || "preparing",
        preferredJob.progress?.detail || "Running background backtest.",
        preferredJob.progress?.counts || null,
        { replayDatasetSummary: preferredJob.progress?.counts || null },
      );
      setLiveRunState((previous) => ({
        ...previous,
        source: "background",
        stage: preferredJob.progress?.stage || "preparing",
        statusText: preferredJob.progress?.detail || "Running background backtest.",
        replayResolution: normalizeReplayCounts(preferredJob.progress?.counts || null),
        replayDatasetSummary: normalizeReplayCounts(preferredJob.progress?.counts || null),
      }));
    }
  }, [applyRemoteStatus]);

  const applyOptimizerJobSnapshot = useCallback((job = null) => {
    if (!job?.jobId) {
      setActiveOptimizerJob(emptyBacktestJobState());
      return;
    }
    setRecentOptimizerJobs((previous) => {
      const next = [job, ...(Array.isArray(previous) ? previous : []).filter((entry) => entry?.jobId !== job?.jobId)];
      return next.slice(0, 18);
    });
    setActiveOptimizerJob({
      jobId: job.jobId,
      jobType: job.jobType || "optimizer",
      status: job.status || "queued",
      resultId: job.resultId || null,
      error: job.error || null,
      progress: job.progress || null,
      metricsPreview: job.metricsPreview || null,
      mode: job.mode || "background",
      createdAt: job.createdAt || null,
      startedAt: job.startedAt || null,
      finishedAt: job.finishedAt || null,
      updatedAt: job.updatedAt || null,
      optimizerResult: job.optimizerResult || null,
    });
  }, []);

  const cancelActiveBacktestRun = useCallback(async (jobId = null) => {
    const activeJobId = String(jobId || activeBacktestJob?.jobId || "").trim();
    if (!activeJobId) {
      return { ok: false, error: "No active backtest job to cancel." };
    }
    const previousJob = activeBacktestJobRef.current?.jobId === activeJobId
      ? activeBacktestJobRef.current
      : null;
    const optimisticJob = buildOptimisticBacktestCancelJob(previousJob);
    if (optimisticJob) {
      applyBackgroundJobSnapshot(optimisticJob);
    }
    try {
      const response = await cancelResearchBacktestJob(activeJobId);
      if (response?.job?.status === "cancelled") {
        activeBacktestJobRef.current = emptyBacktestJobState();
        setActiveBacktestJob(emptyBacktestJobState());
        setBacktestProgress(null);
        clearLiveRunState();
        setRunState((previous) => ({
          ...previous,
          status: "idle",
          error: null,
        }));
      } else {
        applyBackgroundJobSnapshot(response?.job || null);
      }
      return { ok: true, job: response?.job || null };
    } catch (error) {
      const message = error?.message || "Failed to cancel the backtest job.";
      if (previousJob?.jobId) {
        activeBacktestJobRef.current = previousJob;
        setRecentBacktestJobs((previous) => mergeBacktestJobs(previous, previousJob));
        setActiveBacktestJob(previousJob);
      }
      setRunState((previous) => ({
        ...previous,
        error: message,
      }));
      return { ok: false, error: message };
    }
  }, [activeBacktestJob?.jobId, applyBackgroundJobSnapshot, clearLiveRunState]);

  const runIsStale = Boolean(lastExecutedDraftSignature && draftRunSignature !== lastExecutedDraftSignature);
  const hasQueuedRerun = queuedRunRequested;
  const inputImpactBlockedReason = useMemo(() => {
    if (optionRuntimeConfig?.executionMode !== "option_history") {
      return "Input impact is only available for Massive-backed options-history runs.";
    }
    if (runState.status === "loading") {
      return "Wait for the current backtest to finish before running input impact.";
    }
    if (runState.status !== "ready") {
      return "Run a backtest before running input impact.";
    }
    if (runIsStale) {
      return "Inputs changed since the last completed run. Re-run the backtest before running input impact.";
    }
    if (!optionRuntimeConfig?.replayCredentialsReady) {
      return "Massive options credentials are required before input impact diagnostics can run.";
    }
    if (!signalBars.length || !inputImpactPayload.bars.length) {
      return "Load more execution history before running input impact.";
    }
    return null;
  }, [
    inputImpactPayload.bars.length,
    optionRuntimeConfig?.executionMode,
    optionRuntimeConfig?.replayCredentialsReady,
    runIsStale,
    runState.status,
    signalBars.length,
  ]);
  const canRunInputImpact = !inputImpactBlockedReason;
  const rayalgoScoringComparisonBlockedReason = useMemo(() => {
    if (normalizedStrategy !== "rayalgo") {
      return "RayAlgo score comparison is only available when the active strategy is RayAlgo.";
    }
    if (optionRuntimeConfig?.executionMode !== "option_history") {
      return "RayAlgo score comparison requires Massive-backed options-history mode.";
    }
    if (runState.status === "loading") {
      return "Wait for the current backtest to finish before comparing RayAlgo scoring.";
    }
    if (runState.status !== "ready" || !signalBars.length) {
      return "Run a RayAlgo backtest before comparing scoring modes.";
    }
    if (runIsStale) {
      return "Inputs changed since the last completed run. Re-run the backtest before comparing RayAlgo scoring modes.";
    }
    if (!optionRuntimeConfig?.replayCredentialsReady) {
      return "Massive options credentials are required before RayAlgo score comparison can run.";
    }
    return null;
  }, [
    normalizedStrategy,
    optionRuntimeConfig?.executionMode,
    optionRuntimeConfig?.replayCredentialsReady,
    runIsStale,
    runState.status,
    signalBars.length,
  ]);
  const canRunRayalgoScoringComparison = !rayalgoScoringComparisonBlockedReason;

  const buildReplayBacktestPayload = useCallback((overrides = {}) => {
    const payloadFallbacks = {
      capital: effectiveCapital,
      dte: effectiveDte,
      slPct: effectiveSlPct,
      tpPct: effectiveTpPct,
      trailStartPct: effectiveTrailStartPct,
      trailPct: effectiveTrailPct,
      zombieBars: effectiveZombieBars,
      minConviction: effectiveMinConviction,
      allowShorts: effectiveAllowShorts,
      kellyFrac: effectiveKellyFrac,
      regimeFilter: effectiveRegimeFilter,
      maxPositions: effectiveMaxPositions,
      sessionBlocks: effectiveSessionBlocks,
      regimeAdapt: effectiveRegimeAdapt,
      commPerContract: effectiveCommPerContract,
      slipBps: effectiveSlipBps,
      tradeDays: effectiveTradeDays,
      riskStopPolicy: effectiveRiskStopPolicy,
      optionSelectionSpec: effectiveOptionSelectionSpec,
    };
    const stageOverrideFields = extractLegacyTopRailFieldsFromRuntimePayload(overrides);
    const payloadStageConfig = effectiveStageConfig
      ? applyLegacyTopRailFieldsToStageConfig(effectiveStageConfig, stageOverrideFields)
      : null;
    const payloadRuntimeBridge = payloadStageConfig
      ? compileBacktestV2RuntimeBridge({
        stageConfig: payloadStageConfig,
        signalTimeframe,
        fallbackCapital: overrides.capital ?? effectiveCapital,
        fallbackDte: overrides.dte ?? effectiveDte,
        fallbackKellyFrac: overrides.kellyFrac ?? effectiveKellyFrac,
        fallbackMaxPositions: overrides.maxPositions ?? overrides.maxPos ?? effectiveMaxPositions,
        fallbackRiskStopPolicy: overrides.riskStopPolicy ?? effectiveRiskStopPolicy,
        fallbackOptionSelectionSpec: overrides.optionSelectionSpec ?? effectiveOptionSelectionSpec,
      })
      : null;
    const payloadLegacyInputs = resolveLegacyTopRailCompatFields({
      stageConfig: payloadStageConfig,
      runtimeBridge: payloadRuntimeBridge,
      fallbackFields: {
        ...payloadFallbacks,
        ...overrides,
        optionSelectionSpec: overrides.optionSelectionSpec ?? effectiveOptionSelectionSpec,
      },
    });
    return {
      marketSymbol,
      bars: executionBars,
      ...overrides,
      capital: payloadLegacyInputs.capital,
      executionFidelity,
      strategy: normalizedStrategy || DEFAULT_RESEARCH_STRATEGY,
      dte: payloadLegacyInputs.dte,
      iv,
      slPct: payloadLegacyInputs.slPct,
      tpPct: payloadLegacyInputs.tpPct,
      trailStartPct: payloadLegacyInputs.trailStartPct,
      trailPct: payloadLegacyInputs.trailPct,
      zombieBars: payloadLegacyInputs.zombieBars,
      minConviction: payloadLegacyInputs.minConviction,
      allowShorts: payloadLegacyInputs.allowShorts,
      kellyFrac: payloadLegacyInputs.kellyFrac,
      regimeFilter: payloadLegacyInputs.regimeFilter,
      maxPositions: payloadLegacyInputs.maxPositions,
      sessionBlocks: payloadLegacyInputs.sessionBlocks,
      regimeAdapt: payloadLegacyInputs.regimeAdapt,
      commPerContract: payloadLegacyInputs.commPerContract,
      slipBps: payloadLegacyInputs.slipBps,
      tradeDays: payloadLegacyInputs.tradeDays,
      signalTimeframe,
      rayalgoSettings,
      rayalgoScoringConfig,
      riskStopPolicy: payloadLegacyInputs.riskStopPolicy,
      optionSelectionSpec: payloadLegacyInputs.optionSelectionSpec,
      backtestV2StageConfig: payloadStageConfig,
      backtestV2RuntimeBridge: payloadRuntimeBridge,
    };
  }, [
    effectiveCapital,
    effectiveDte,
    effectiveKellyFrac,
    effectiveMaxPositions,
    effectiveAllowShorts,
    effectiveCommPerContract,
    effectiveMinConviction,
    effectiveOptionSelectionSpec,
    effectiveRegimeAdapt,
    effectiveRegimeFilter,
    effectiveRiskStopPolicy,
    effectiveSessionBlocks,
    effectiveSlipBps,
    effectiveSlPct,
    effectiveStageConfig,
    effectiveTpPct,
    effectiveTradeDays,
    effectiveTrailPct,
    effectiveTrailStartPct,
    effectiveZombieBars,
    executionBars,
    executionFidelity,
    iv,
    marketSymbol,
    normalizedStrategy,
    rayalgoScoringConfig,
    rayalgoSettings,
    signalTimeframe,
  ]);

  const buildPersistentResultMeta = useCallback((overrides = {}) => ({
    createdAt: Date.now(),
    marketSymbol,
    selectionSummaryLabel: resultMeta?.selectionSummaryLabel || "",
    replaySampleLabel: resultMeta?.replaySampleLabel || "",
    dataSource: resultMeta?.dataSource || "",
    spotDataMeta: resultMeta?.spotDataMeta || null,
    selectedBundle: resultMeta?.selectedBundle || null,
    isCustom: Boolean(resultMeta?.isCustom),
    bundleEvaluation: resultMeta?.bundleEvaluation || null,
    rayalgoScoringContext: runState.rayalgoScoringContext || rayalgoScoringConfig,
    ...overrides,
  }), [marketSymbol, rayalgoScoringConfig, resultMeta, runState.rayalgoScoringContext]);

  const signalOverlayCfg = useMemo(() => ({
    strategy: normalizedStrategy,
    tfMin: signalTfMin,
    executionBars: chartOverlayBars,
    signalTimeframe,
    rayalgoSettings,
    rayalgoScoringConfig,
  }), [
    chartOverlayBars,
    normalizedStrategy,
    rayalgoSettings,
    rayalgoScoringConfig,
    signalTimeframe,
    signalTfMin,
  ]);

  const signalOverlayTape = useMemo(
    () => buildSignalOverlayTape(chartOverlaySignalBars, chartOverlayRegimes, signalOverlayCfg),
    [chartOverlayRegimes, chartOverlaySignalBars, signalOverlayCfg],
  );
  const resolveRayalgoScoreStudyPreset = useCallback((presetId = null) => (
    resolveRayAlgoScoreStudyPresetConfig({
      presetId: presetId || rayalgoScoreStudyState.selectedPresetId || RAYALGO_SCORE_STUDY_PRESET_CURRENT_SETUP,
      marketSymbol,
      signalTimeframe,
      currentRayalgoSettings: rayalgoSettings,
      currentRayalgoScoringConfig: rayalgoScoringConfig,
    })
  ), [
    marketSymbol,
    rayalgoScoringConfig,
    rayalgoScoreStudyState.selectedPresetId,
    rayalgoSettings,
    signalTimeframe,
  ]);

  const refreshRayalgoScoreStudyCatalog = useCallback(async ({ preserveSelection = true } = {}) => {
    try {
      const [runsResponse, localArtifactsResponse] = await Promise.all([
        getResearchScoreStudyRuns(),
        getResearchScoreStudyLocalArtifacts(),
      ]);
      const runs = Array.isArray(runsResponse?.runs) ? runsResponse.runs : [];
      const jobs = Array.isArray(runsResponse?.jobs) ? runsResponse.jobs : [];
      const activeJob = runsResponse?.activeJob || null;
      const localArtifacts = Array.isArray(localArtifactsResponse?.artifacts)
        ? localArtifactsResponse.artifacts
        : [];
      setRayalgoScoreStudyState((previous) => {
        const nextActiveJob = resolvePreferredScoreStudyJob(previous.activeJob, activeJob);
        const preservedComparisonIds = preserveSelection
          ? normalizeSelectedComparisonRunIds(previous.selectedComparisonRunIds, runs)
          : [];
        const nextComparisonIds = preservedComparisonIds.length
          ? preservedComparisonIds
          : resolveDefaultScoreStudyComparisonIds(runs);
        const nextSelectedRunId = resolveDefaultScoreStudySelectedRunId({
          runs,
          selectedRunId: preserveSelection ? previous.selectedRunId : null,
          presetId: previous.selectedPresetId,
          symbol: marketSymbol,
        });
        const availableRunIds = new Set(runs.map((run) => run?.runId).filter(Boolean));
        const nextRunDetailsById = Object.fromEntries(
          Object.entries(previous.runDetailsById || {}).filter(([runId]) => availableRunIds.has(runId)),
        );
        const nextComparisonDetailStatusById = Object.fromEntries(
          nextComparisonIds.map((runId) => [
            runId,
            nextRunDetailsById?.[runId]?.result
              ? "ready"
              : (previous.comparisonRunDetailStatusById?.[runId] === "loading" ? "loading" : "idle"),
          ]),
        );
        const nextComparisonDetailErrorsById = Object.fromEntries(
          nextComparisonIds
            .map((runId) => [runId, previous.comparisonRunDetailErrorsById?.[runId] || null])
            .filter(([, error]) => Boolean(error)),
        );
        const nextSelectedRunDetailStatus = nextSelectedRunId
          ? (nextRunDetailsById?.[nextSelectedRunId]?.result ? "ready" : "idle")
          : "idle";
        return {
          ...previous,
          availability: { status: "ready", error: null },
          runsStatus: "ready",
          runsError: null,
          runs,
          jobs: mergeScoreStudyJobCollection(previous.jobs, jobs, nextActiveJob),
          activeJob: nextActiveJob,
          localArtifactsStatus: "ready",
          localArtifactsError: null,
          localArtifacts,
          selectedComparisonRunIds: nextComparisonIds,
          selectedRunId: nextSelectedRunId,
          selectedRunDetailStatus: nextSelectedRunDetailStatus,
          selectedRunDetailError: null,
          comparisonRunDetailStatusById: nextComparisonDetailStatusById,
          comparisonRunDetailErrorsById: nextComparisonDetailErrorsById,
          runDetailsById: nextRunDetailsById,
        };
      });
      return { ok: true };
    } catch (error) {
      const message = error?.message || "Failed to load the score-testing catalog.";
      setRayalgoScoreStudyState((previous) => ({
        ...previous,
        availability: { status: "unavailable", error: message },
        runsStatus: "error",
        runsError: message,
        runs: [],
        jobs: [],
        activeJob: emptyScoreStudyJobState(),
        localArtifactsStatus: "error",
        localArtifactsError: message,
        localArtifacts: [],
        selectedRunId: null,
        selectedComparisonRunIds: [],
      }));
      return { ok: false, error: message };
    }
  }, [marketSymbol]);

  useEffect(() => {
    if (!isActive || normalizedStrategy !== "rayalgo") {
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const result = await refreshRayalgoScoreStudyCatalog();
      if (cancelled || result?.ok !== false) {
        return;
      }
      // Leave the error state visible; the next manual refresh or server run can recover it.
    })();
    return () => {
      cancelled = true;
    };
  }, [isActive, normalizedStrategy, refreshRayalgoScoreStudyCatalog]);

  const selectRayalgoScoreStudyPreset = useCallback((presetId) => {
    const normalizedPresetId = getRayAlgoScoreStudyPresetDefinition(presetId).id;
    setRayalgoScoreStudyState((previous) => {
      const nextSelectedRunId = resolveDefaultScoreStudySelectedRunId({
        runs: previous.runs,
        presetId: normalizedPresetId,
        symbol: marketSymbol,
      });
      return {
        ...previous,
        selectedPresetId: normalizedPresetId,
        selectedRunId: nextSelectedRunId,
        selectedRunDetailStatus: nextSelectedRunId && previous.runDetailsById?.[nextSelectedRunId]?.result ? "ready" : "idle",
        selectedRunDetailError: null,
      };
    });
  }, [marketSymbol]);

  const selectRayalgoScoreStudyRun = useCallback((runId) => {
    const normalizedRunId = String(runId || "").trim() || null;
    setRayalgoScoreStudyState((previous) => ({
      ...previous,
      selectedRunId: normalizedRunId,
      selectedRunDetailStatus: normalizedRunId && previous.runDetailsById?.[normalizedRunId]?.result ? "ready" : "idle",
      selectedRunDetailError: null,
    }));
  }, []);

  const toggleRayalgoScoreStudyComparisonRun = useCallback((runId) => {
    const normalizedRunId = String(runId || "").trim();
    if (!normalizedRunId) {
      return;
    }
    setRayalgoScoreStudyState((previous) => {
      const existing = normalizeSelectedComparisonRunIds(previous.selectedComparisonRunIds, previous.runs);
      const removing = existing.includes(normalizedRunId);
      const next = removing
        ? existing.filter((entry) => entry !== normalizedRunId)
        : [...existing, normalizedRunId].slice(-SCORE_STUDY_COMPARE_LIMIT);
      const nextStatuses = { ...previous.comparisonRunDetailStatusById };
      const nextErrors = { ...previous.comparisonRunDetailErrorsById };
      if (removing) {
        delete nextStatuses[normalizedRunId];
        delete nextErrors[normalizedRunId];
      } else if (!previous.runDetailsById?.[normalizedRunId]?.result) {
        nextStatuses[normalizedRunId] = "idle";
        delete nextErrors[normalizedRunId];
      }
      return {
        ...previous,
        selectedComparisonRunIds: normalizeSelectedComparisonRunIds(next, previous.runs),
        comparisonRunDetailStatusById: nextStatuses,
        comparisonRunDetailErrorsById: nextErrors,
      };
    });
  }, []);

  const importRayalgoScoreStudyLocalArtifact = useCallback(async (relativePath) => {
    try {
      const response = await importResearchScoreStudyArtifact({ relativePath });
      const run = response?.run || null;
      setRayalgoScoreStudyState((previous) => ({
        ...previous,
        runDetailsById: run?.runId
          ? { ...previous.runDetailsById, [run.runId]: run }
          : previous.runDetailsById,
        selectedRunId: run?.runId || previous.selectedRunId,
      }));
      await refreshRayalgoScoreStudyCatalog();
      return { ok: true, run };
    } catch (error) {
      const message = error?.message || "Failed to import the score-study artifact.";
      setRayalgoScoreStudyState((previous) => ({
        ...previous,
        localArtifactsStatus: "error",
        localArtifactsError: message,
      }));
      return { ok: false, error: message };
    }
  }, [refreshRayalgoScoreStudyCatalog]);

  const loadRayalgoScoreStudyRunDetail = useCallback(async (runId, { purpose = "selected" } = {}) => {
    const normalizedRunId = String(runId || "").trim();
    if (!normalizedRunId) {
      return { ok: false, error: "Score-study run unavailable." };
    }

    const markSelected = purpose === "selected";
    const markComparison = purpose === "comparison";
    const currentState = rayalgoScoreStudyStateRef.current;
    const cachedRun = currentState.runDetailsById?.[normalizedRunId] || null;

    if (cachedRun?.result) {
      setRayalgoScoreStudyState((previous) => {
        let changed = false;
        let nextSelectedRunDetailStatus = previous.selectedRunDetailStatus;
        let nextSelectedRunDetailError = previous.selectedRunDetailError;
        let nextComparisonRunDetailStatusById = previous.comparisonRunDetailStatusById;
        let nextComparisonRunDetailErrorsById = previous.comparisonRunDetailErrorsById;

        if (
          markSelected
          && previous.selectedRunId === normalizedRunId
          && (previous.selectedRunDetailStatus !== "ready" || previous.selectedRunDetailError)
        ) {
          changed = true;
          nextSelectedRunDetailStatus = "ready";
          nextSelectedRunDetailError = null;
        }

        if (markComparison) {
          const currentComparisonStatus = previous.comparisonRunDetailStatusById?.[normalizedRunId];
          const currentComparisonError = previous.comparisonRunDetailErrorsById?.[normalizedRunId];
          if (currentComparisonStatus !== "ready" || currentComparisonError) {
            changed = true;
            nextComparisonRunDetailStatusById = {
              ...previous.comparisonRunDetailStatusById,
              [normalizedRunId]: "ready",
            };
            nextComparisonRunDetailErrorsById = { ...previous.comparisonRunDetailErrorsById };
            delete nextComparisonRunDetailErrorsById[normalizedRunId];
          }
        }

        if (!changed) {
          return previous;
        }

        return {
          ...previous,
          selectedRunDetailStatus: nextSelectedRunDetailStatus,
          selectedRunDetailError: nextSelectedRunDetailError,
          comparisonRunDetailStatusById: nextComparisonRunDetailStatusById,
          comparisonRunDetailErrorsById: nextComparisonRunDetailErrorsById,
        };
      });
      return { ok: true, run: cachedRun };
    }

    const inFlightRequest = rayalgoScoreStudyDetailRequestRef.current.get(normalizedRunId);
    if (inFlightRequest) {
      return inFlightRequest;
    }

    setRayalgoScoreStudyState((previous) => {
      let changed = false;
      let nextSelectedRunDetailStatus = previous.selectedRunDetailStatus;
      let nextSelectedRunDetailError = previous.selectedRunDetailError;
      let nextComparisonRunDetailStatusById = previous.comparisonRunDetailStatusById;
      let nextComparisonRunDetailErrorsById = previous.comparisonRunDetailErrorsById;

      if (
        markSelected
        && previous.selectedRunId === normalizedRunId
        && (previous.selectedRunDetailStatus !== "loading" || previous.selectedRunDetailError)
      ) {
        changed = true;
        nextSelectedRunDetailStatus = "loading";
        nextSelectedRunDetailError = null;
      }

      if (markComparison) {
        const currentComparisonStatus = previous.comparisonRunDetailStatusById?.[normalizedRunId];
        const currentComparisonError = previous.comparisonRunDetailErrorsById?.[normalizedRunId];
        if (currentComparisonStatus !== "loading" || currentComparisonError) {
          changed = true;
          nextComparisonRunDetailStatusById = {
            ...previous.comparisonRunDetailStatusById,
            [normalizedRunId]: "loading",
          };
          nextComparisonRunDetailErrorsById = { ...previous.comparisonRunDetailErrorsById };
          delete nextComparisonRunDetailErrorsById[normalizedRunId];
        }
      }

      if (!changed) {
        return previous;
      }

      return {
        ...previous,
        selectedRunDetailStatus: nextSelectedRunDetailStatus,
        selectedRunDetailError: nextSelectedRunDetailError,
        comparisonRunDetailStatusById: nextComparisonRunDetailStatusById,
        comparisonRunDetailErrorsById: nextComparisonRunDetailErrorsById,
      };
    });

    const request = (async () => {
      try {
        const response = await getResearchScoreStudyRun(normalizedRunId);
        const run = response?.run || null;
        const unavailableMessage = markComparison
          ? "Compare run unavailable."
          : "Score-study run unavailable.";
        setRayalgoScoreStudyState((previous) => {
          const nextRunDetailsById = run?.runId
            ? { ...previous.runDetailsById, [run.runId]: run }
            : previous.runDetailsById;
          let nextSelectedRunDetailStatus = previous.selectedRunDetailStatus;
          let nextSelectedRunDetailError = previous.selectedRunDetailError;
          let nextComparisonRunDetailStatusById = previous.comparisonRunDetailStatusById;
          let nextComparisonRunDetailErrorsById = previous.comparisonRunDetailErrorsById;

          if (markSelected && previous.selectedRunId === normalizedRunId) {
            nextSelectedRunDetailStatus = run ? "ready" : "error";
            nextSelectedRunDetailError = run ? null : unavailableMessage;
          }

          if (markComparison) {
            nextComparisonRunDetailStatusById = {
              ...previous.comparisonRunDetailStatusById,
              [normalizedRunId]: run ? "ready" : "error",
            };
            nextComparisonRunDetailErrorsById = { ...previous.comparisonRunDetailErrorsById };
            if (run) {
              delete nextComparisonRunDetailErrorsById[normalizedRunId];
            } else {
              nextComparisonRunDetailErrorsById[normalizedRunId] = unavailableMessage;
            }
          }

          return {
            ...previous,
            selectedRunDetailStatus: nextSelectedRunDetailStatus,
            selectedRunDetailError: nextSelectedRunDetailError,
            comparisonRunDetailStatusById: nextComparisonRunDetailStatusById,
            comparisonRunDetailErrorsById: nextComparisonRunDetailErrorsById,
            runDetailsById: nextRunDetailsById,
          };
        });
        return run
          ? { ok: true, run }
          : { ok: false, error: unavailableMessage };
      } catch (error) {
        const message = markComparison
          ? (error?.message || "Failed to load the compare run detail.")
          : (error?.message || "Failed to load the score-study run.");
        setRayalgoScoreStudyState((previous) => {
          let nextSelectedRunDetailStatus = previous.selectedRunDetailStatus;
          let nextSelectedRunDetailError = previous.selectedRunDetailError;
          let nextComparisonRunDetailStatusById = previous.comparisonRunDetailStatusById;
          let nextComparisonRunDetailErrorsById = previous.comparisonRunDetailErrorsById;

          if (markSelected && previous.selectedRunId === normalizedRunId) {
            nextSelectedRunDetailStatus = "error";
            nextSelectedRunDetailError = message;
          }

          if (markComparison) {
            nextComparisonRunDetailStatusById = {
              ...previous.comparisonRunDetailStatusById,
              [normalizedRunId]: "error",
            };
            nextComparisonRunDetailErrorsById = {
              ...previous.comparisonRunDetailErrorsById,
              [normalizedRunId]: message,
            };
          }

          return {
            ...previous,
            selectedRunDetailStatus: nextSelectedRunDetailStatus,
            selectedRunDetailError: nextSelectedRunDetailError,
            comparisonRunDetailStatusById: nextComparisonRunDetailStatusById,
            comparisonRunDetailErrorsById: nextComparisonRunDetailErrorsById,
          };
        });
        return { ok: false, error: message };
      } finally {
        rayalgoScoreStudyDetailRequestRef.current.delete(normalizedRunId);
      }
    })();

    rayalgoScoreStudyDetailRequestRef.current.set(normalizedRunId, request);
    return request;
  }, []);

  const queueRayalgoScoreStudyRun = useCallback(async ({ presetId = null, includeAdvancedDiagnostics = false } = {}) => {
    const requestedPresetId = presetId || rayalgoScoreStudyState.selectedPresetId || RAYALGO_SCORE_STUDY_PRESET_CURRENT_SETUP;
    if (normalizedStrategy !== "rayalgo") {
      const message = "RayAlgo score testing is only available when the active strategy is RayAlgo.";
      setRayalgoScoreStudyState((previous) => ({
        ...previous,
        runsStatus: "error",
        runsError: message,
      }));
      return { ok: false, error: message };
    }
    if (rayalgoScoreStudyState.availability.status === "unavailable") {
      return { ok: false, error: rayalgoScoreStudyState.availability.error || "Score Testing requires Postgres." };
    }
    if (
      rayalgoScoreStudyState.activeJob?.jobId
      && SCORE_STUDY_ACTIVE_JOB_STATUSES.includes(String(rayalgoScoreStudyState.activeJob?.status || ""))
    ) {
      const message = "A server score-study run is already active. Cancel it or wait for it to finish.";
      setRayalgoScoreStudyState((previous) => ({
        ...previous,
        runsStatus: "error",
        runsError: message,
      }));
      return { ok: false, error: message };
    }

    try {
      const presetConfig = resolveRayalgoScoreStudyPreset(requestedPresetId);
      const response = await createResearchScoreStudyJob({
        symbol: marketSymbol,
        presetId: presetConfig.presetId,
        presetLabel: presetConfig.presetLabel,
        payload: {
          marketSymbol,
          initialDays: presetConfig.initialDays,
          mode: "full",
          preferredTf: presetConfig.preferredTf,
          includeAdvancedDiagnostics: Boolean(includeAdvancedDiagnostics),
          timeframes: presetConfig.timeframes,
          requestedContextTimeframes: presetConfig.requestedContextTimeframes,
          rayalgoSettings: presetConfig.rayalgoSettings,
          rayalgoScoringConfig: presetConfig.rayalgoScoringConfig,
        },
      }, {
        apiKey: optionRuntimeConfig?.replayApiKey,
      });
      const job = response?.job || null;
      setRayalgoScoreStudyState((previous) => ({
        ...previous,
        availability: { status: "ready", error: null },
        runsError: null,
        jobs: mergeScoreStudyJobs(previous.jobs, job),
        activeJob: job || previous.activeJob,
      }));
      return { ok: true, job };
    } catch (error) {
      const message = error?.message || "Failed to queue the score-study server run.";
      setRayalgoScoreStudyState((previous) => ({
        ...previous,
        runsStatus: "error",
        runsError: message,
      }));
      return { ok: false, error: message };
    }
  }, [
    rayalgoScoreStudyState.activeJob?.jobId,
    rayalgoScoreStudyState.activeJob?.status,
    marketSymbol,
    normalizedStrategy,
    optionRuntimeConfig?.replayApiKey,
    rayalgoScoreStudyState.availability.error,
    rayalgoScoreStudyState.availability.status,
    rayalgoScoreStudyState.selectedPresetId,
    resolveRayalgoScoreStudyPreset,
  ]);

  const cancelRayalgoScoreStudyRun = useCallback(async (jobId = null) => {
    const stateActiveJob = rayalgoScoreStudyState.activeJob?.jobId ? rayalgoScoreStudyState.activeJob : null;
    const activeJobId = String(jobId || activeScoreStudyJobRef.current?.jobId || stateActiveJob?.jobId || "").trim();
    if (!activeJobId) {
      return { ok: false, error: "No active score-study job to cancel." };
    }
    const previousJob = activeScoreStudyJobRef.current?.jobId === activeJobId
      ? activeScoreStudyJobRef.current
      : stateActiveJob?.jobId === activeJobId
        ? stateActiveJob
      : ((Array.isArray(rayalgoScoreStudyState.jobs) ? rayalgoScoreStudyState.jobs : []).find((entry) => entry?.jobId === activeJobId) || null);
    const optimisticJob = buildOptimisticScoreStudyCancelJob(previousJob);
    if (optimisticJob) {
      setRayalgoScoreStudyState((previous) => {
        const nextActiveJob = resolvePreferredScoreStudyJob(previous.activeJob, optimisticJob);
        activeScoreStudyJobRef.current = nextActiveJob;
        return {
          ...previous,
          runsError: null,
          jobs: mergeScoreStudyJobCollection(previous.jobs, [optimisticJob], nextActiveJob),
          activeJob: nextActiveJob,
        };
      });
    }
    try {
      const response = await cancelResearchScoreStudyJob(activeJobId);
      const job = response?.job || null;
      setRayalgoScoreStudyState((previous) => {
        const nextActiveJob = resolvePreferredScoreStudyJob(previous.activeJob, job);
        const resolvedActiveJob = SCORE_STUDY_ACTIVE_JOB_STATUSES.includes(String(nextActiveJob?.status || ""))
          ? nextActiveJob
          : emptyScoreStudyJobState();
        activeScoreStudyJobRef.current = resolvedActiveJob;
        return {
          ...previous,
          runsError: null,
          jobs: mergeScoreStudyJobCollection(previous.jobs, job ? [job] : [], resolvedActiveJob),
          activeJob: resolvedActiveJob,
        };
      });
      return { ok: true, job };
    } catch (error) {
      const message = error?.message || "Failed to cancel the score-study job.";
      if (previousJob?.jobId) {
        activeScoreStudyJobRef.current = previousJob;
      }
      setRayalgoScoreStudyState((previous) => ({
        ...previous,
        runsStatus: "error",
        runsError: message,
        jobs: previousJob?.jobId
          ? mergeScoreStudyJobCollection(previous.jobs, [previousJob], previousJob)
          : previous.jobs,
        activeJob: previousJob?.jobId ? previousJob : previous.activeJob,
      }));
      return { ok: false, error: message };
    }
  }, [rayalgoScoreStudyState.activeJob?.jobId, rayalgoScoreStudyState.jobs]);

  const runRayalgoScoreStudy = useCallback((options = {}) => {
    const requestedMode = String(options?.mode || "local").trim().toLowerCase() === "server"
      ? "server"
      : "local";
    if (requestedMode === "server") {
      return queueRayalgoScoreStudyRun({
        presetId: options?.presetId || null,
        includeAdvancedDiagnostics: Boolean(options?.includeAdvancedDiagnostics),
      });
    }

    const requestedPresetId = options?.presetId || rayalgoScoreStudyState.selectedPresetId || RAYALGO_SCORE_STUDY_PRESET_CURRENT_SETUP;
    const includeAdvancedDiagnostics = Boolean(options?.includeAdvancedDiagnostics);
    const nextInputKey = rayalgoScoreStudyInputKey;
    if (normalizedStrategy !== "rayalgo") {
      setRayalgoScoreStudyState((previous) => ({
        ...previous,
        status: "disabled",
        error: "RayAlgo score study is only available when the active strategy is RayAlgo.",
        result: null,
        stale: false,
        lastInputKey: nextInputKey,
        lastRunAt: null,
      }));
      return { ok: false, error: "RayAlgo strategy required." };
    }
    if (rayalgoScoreStudyState.availability.status === "unavailable") {
      setRayalgoScoreStudyState((previous) => ({
        ...previous,
        status: "error",
        error: rayalgoScoreStudyState.availability.error || "Score Testing requires Postgres.",
        stale: false,
        lastInputKey: nextInputKey,
      }));
      return { ok: false, error: rayalgoScoreStudyState.availability.error || "Score Testing requires Postgres." };
    }
    if (!Array.isArray(executionBars) || executionBars.length < 180) {
      setRayalgoScoreStudyState((previous) => ({
        ...previous,
        status: "error",
        error: "Load more spot history before running the RayAlgo score study.",
        result: null,
        stale: false,
        lastInputKey: nextInputKey,
        lastRunAt: null,
      }));
      return { ok: false, error: "Insufficient spot history." };
    }

    rayalgoScoreStudyRunRef.current += 1;
    const activeRunId = rayalgoScoreStudyRunRef.current;
    setRayalgoScoreStudyState((previous) => ({
      ...previous,
      status: "loading",
      error: null,
      stale: previous.lastInputKey != null && previous.lastInputKey !== nextInputKey,
    }));

    scheduleDeferredWork(timersRef, async () => {
      let localResult = null;
      try {
        const presetConfig = resolveRayalgoScoreStudyPreset(requestedPresetId);
        localResult = buildRayAlgoScoreStudy({
          marketSymbol,
          bars: executionBars,
          rayalgoSettings: presetConfig.rayalgoSettings,
          rayalgoScoringConfig: presetConfig.rayalgoScoringConfig,
          timeframes: presetConfig.timeframes,
          includeAdvancedDiagnostics,
        });
        if (rayalgoScoreStudyRunRef.current !== activeRunId) {
          return;
        }
        if (localResult?.status === "error") {
          setRayalgoScoreStudyState((previous) => ({
            ...previous,
            status: "error",
            error: localResult.error || "Failed to build the RayAlgo score study.",
            result: null,
            stale: false,
            lastInputKey: nextInputKey,
            lastRunAt: null,
          }));
          return;
        }

        const artifactPayload = buildLocalScoreStudyArtifactPayload({
          marketSymbol,
          presetConfig,
          result: localResult,
          dataSource: resultMeta?.dataSource || "",
          spotDataMeta: resultMeta?.spotDataMeta || null,
        });
        const persistedResponse = await saveResearchScoreStudyRun({
          source: "local_ui",
          presetId: presetConfig.presetId,
          presetLabel: presetConfig.presetLabel,
          payload: artifactPayload,
          validityStatus: "valid",
          provenance: {
            kind: "local_ui",
            lastInputKey: nextInputKey,
          },
        });
        if (rayalgoScoreStudyRunRef.current !== activeRunId) {
          return;
        }
        const persistedRun = persistedResponse?.run || null;
        setRayalgoScoreStudyState((previous) => {
          const nextRuns = mergeScoreStudyRuns(previous.runs, persistedRun);
          const optimisticComparisonIds = normalizeSelectedComparisonRunIds(
            [
              ...previous.selectedComparisonRunIds,
              persistedRun?.validityStatus !== "invalid" ? persistedRun?.runId : null,
            ],
            nextRuns,
          );
          const nextComparisonIds = optimisticComparisonIds.length
            ? optimisticComparisonIds
            : resolveDefaultScoreStudyComparisonIds(nextRuns);
          return {
            ...previous,
            status: "ready",
            error: null,
            result: localResult,
            stale: false,
            lastInputKey: nextInputKey,
            lastRunAt: artifactPayload.generatedAt,
            availability: { status: "ready", error: null },
            runsStatus: "ready",
            runsError: null,
            runs: nextRuns,
            runDetailsById: persistedRun?.runId
              ? { ...previous.runDetailsById, [persistedRun.runId]: persistedRun }
              : previous.runDetailsById,
            selectedRunId: persistedRun?.runId || previous.selectedRunId,
            selectedComparisonRunIds: nextComparisonIds,
            selectedRunDetailStatus: persistedRun?.runId ? "ready" : previous.selectedRunDetailStatus,
            selectedRunDetailError: null,
          };
        });
      } catch (error) {
        if (rayalgoScoreStudyRunRef.current !== activeRunId) {
          return;
        }
        setRayalgoScoreStudyState((previous) => ({
          ...previous,
          status: "error",
          error: error?.message || "Failed to build or persist the RayAlgo score study.",
          result: localResult || previous.result,
          stale: false,
          lastInputKey: nextInputKey,
          lastRunAt: localResult ? new Date().toISOString() : previous.lastRunAt,
        }));
      }
    });
    return { ok: true };
  }, [
    executionBars,
    marketSymbol,
    normalizedStrategy,
    optionRuntimeConfig?.replayApiKey,
    queueRayalgoScoreStudyRun,
    rayalgoScoreStudyInputKey,
    rayalgoScoreStudyState.availability.error,
    rayalgoScoreStudyState.availability.status,
    rayalgoScoreStudyState.selectedPresetId,
    resolveRayalgoScoreStudyPreset,
    resultMeta,
    timersRef,
  ]);

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }
    const jobId = rayalgoScoreStudyState.activeJob?.jobId;
    const status = String(rayalgoScoreStudyState.activeJob?.status || "");
    if (!jobId || !SCORE_STUDY_ACTIVE_JOB_STATUSES.includes(status)) {
      return undefined;
    }

    let cancelled = false;
    let fallbackTimerId = null;
    let streamController = null;
    let eventSubscription = null;
    let terminalHandled = false;

    const applyJobSnapshot = async (job = null) => {
      if (cancelled || !job) {
        return;
      }
      setRayalgoScoreStudyState((previous) => {
        const nextActiveJob = resolvePreferredScoreStudyJob(previous.activeJob, job);
        const resolvedActiveJob = SCORE_STUDY_ACTIVE_JOB_STATUSES.includes(String(nextActiveJob?.status || ""))
          ? nextActiveJob
          : previous.activeJob;
        activeScoreStudyJobRef.current = resolvedActiveJob?.jobId ? resolvedActiveJob : emptyScoreStudyJobState();
        return {
          ...previous,
          jobs: mergeScoreStudyJobCollection(previous.jobs, [job], resolvedActiveJob),
          activeJob: resolvedActiveJob,
        };
      });
      if (terminalHandled) {
        return;
      }
      if (job.status === "completed") {
        terminalHandled = true;
        await refreshRayalgoScoreStudyCatalog();
        if (cancelled) {
          return;
        }
        if (job.runId) {
          activeScoreStudyJobRef.current = emptyScoreStudyJobState();
          setRayalgoScoreStudyState((previous) => ({
            ...previous,
            activeJob: emptyScoreStudyJobState(),
            selectedRunId: job.runId,
          }));
        }
        return;
      }
      if (job.status === "cancelled") {
        terminalHandled = true;
        activeScoreStudyJobRef.current = emptyScoreStudyJobState();
        setRayalgoScoreStudyState((previous) => ({
          ...previous,
          activeJob: emptyScoreStudyJobState(),
          runsError: null,
        }));
        return;
      }
      if (job.status === "failed") {
        terminalHandled = true;
        activeScoreStudyJobRef.current = emptyScoreStudyJobState();
        setRayalgoScoreStudyState((previous) => ({
          ...previous,
          activeJob: emptyScoreStudyJobState(),
          runsStatus: "error",
          runsError: job.error || "Score-study job failed.",
        }));
      }
    };

    const poll = async () => {
      if (cancelled || terminalHandled) {
        return;
      }
      try {
        const response = await getResearchScoreStudyJob(jobId);
        await applyJobSnapshot(response?.job || null);
        if (!cancelled && !terminalHandled) {
          fallbackTimerId = setTimeout(poll, SCORE_STUDY_JOB_POLL_MS);
        }
      } catch {
        if (!cancelled && !terminalHandled) {
          fallbackTimerId = setTimeout(poll, SCORE_STUDY_JOB_POLL_MS);
        }
      }
    };

    (async () => {
      eventSubscription = subscribeResearchScoreStudyJobEvents(jobId, {
        onEvent: (event) => {
          if (cancelled || !event?.type) {
            return;
          }
          if (event.type === "job") {
            void applyJobSnapshot(event.job || null);
          }
        },
        onError: (error) => {
          if (cancelled || terminalHandled) {
            return;
          }
          fallbackTimerId = setTimeout(poll, 0);
        },
      });
      if (eventSubscription) {
        return;
      }
      try {
        streamController = typeof AbortController === "function" ? new AbortController() : null;
        await streamResearchScoreStudyJob(jobId, {
          signal: streamController?.signal,
          onEvent: (event) => {
            if (cancelled || !event?.type) {
              return;
            }
            if (event.type === "job") {
              void applyJobSnapshot(event.job || null);
            }
          },
        });
        if (!cancelled && !terminalHandled) {
          fallbackTimerId = setTimeout(poll, 0);
        }
      } catch (error) {
        if (cancelled || error?.name === "AbortError" || terminalHandled) {
          return;
        }
        fallbackTimerId = setTimeout(poll, 0);
      }
    })();

    return () => {
      cancelled = true;
      eventSubscription?.close?.();
      streamController?.abort?.();
      if (fallbackTimerId != null) {
        clearTimeout(fallbackTimerId);
      }
    };
  }, [
    isActive,
    rayalgoScoreStudyState.activeJob?.jobId,
    rayalgoScoreStudyState.activeJob?.status,
    refreshRayalgoScoreStudyCatalog,
  ]);
  const indicatorOverlaySupportedTimeframes = useMemo(
    () => getSupportedSignalOverlayTimeframes(tfMin || signalTfMin),
    [signalTfMin, tfMin],
  );
  const indicatorOverlayRequestedTimeframes = useMemo(() => {
    const nextTimeframes = new Set([signalTimeframe]);
    const requested = Array.isArray(requestedIndicatorOverlayTimeframes)
      ? requestedIndicatorOverlayTimeframes
      : [];
    for (const timeframe of requested) {
      const normalized = String(timeframe || "").trim();
      if (!normalized) {
        continue;
      }
      const bucketMinutes = timeframeToMinutes(normalized);
      if (!Number.isFinite(bucketMinutes)) {
        continue;
      }
      nextTimeframes.add(normalized);
    }
    return Array.from(nextTimeframes);
  }, [requestedIndicatorOverlayTimeframes, signalTimeframe]);
  const fullIndicatorOverlayTimeframes = useMemo(() => Array.from(new Set(
    [signalTimeframe, shadingTimeframe]
      .map((timeframe) => String(timeframe || "").trim())
      .filter(Boolean),
  )), [shadingTimeframe, signalTimeframe]);
  const localIndicatorOverlayTapesByTf = useMemo(() => {
    const nextTapes = {};
    for (const timeframe of indicatorOverlayRequestedTimeframes) {
      const bucketMinutes = timeframeToMinutes(timeframe);
      if (!Number.isFinite(bucketMinutes)) {
        continue;
      }
      const overlayBars = bucketMinutes === signalTfMin
        ? chartOverlaySignalBars
        : aggregateBarsToMinutes(chartOverlayBars, bucketMinutes);
      if (!overlayBars.length) {
        continue;
      }
      const overlayRegimes = detectBacktestRegimes(overlayBars);
      const overlayTape = buildSignalOverlayTape(overlayBars, overlayRegimes, {
        ...signalOverlayCfg,
        tfMin: bucketMinutes,
        signalTimeframe: timeframe,
        rayalgoScoringConfig: normalizedStrategy === "rayalgo"
          ? normalizeRayAlgoScoringConfig({
            ...(rayalgoScoringConfig || {}),
            activeTimeframe: timeframe,
          })
          : null,
      });
      nextTapes[timeframe] = fullIndicatorOverlayTimeframes.includes(timeframe)
        ? overlayTape
        : buildCompactIndicatorOverlayTape(overlayTape);
    }
    if (!nextTapes[signalTimeframe] && signalOverlayTape) {
      nextTapes[signalTimeframe] = signalOverlayTape;
    }
    return nextTapes;
  }, [chartOverlayBars, chartOverlaySignalBars, fullIndicatorOverlayTimeframes, indicatorOverlayRequestedTimeframes, normalizedStrategy, rayalgoScoringConfig, signalOverlayCfg, signalOverlayTape, signalTfMin, signalTimeframe]);

  const replayCandidateCfg = useMemo(() => ({
    strategy: normalizedStrategy,
    minConviction: effectiveMinConviction,
    allowShorts: effectiveAllowShorts,
    regimeFilter: effectiveRegimeFilter,
    sessionBlocks: effectiveSessionBlocks,
    tradeDays: effectiveTradeDays,
    executionFidelity,
    executionBars,
    regimeAdapt: effectiveRegimeAdapt,
    rayalgoSettings,
    signalTimeframe,
    rayalgoScoringConfig,
    optionSelectionSpec: effectiveOptionSelectionSpec,
    backtestV2RuntimeBridge: resolvedBacktestV2RuntimeBridge,
    tfMin: signalTfMin,
  }), [
    executionBars,
    executionFidelity,
    normalizedStrategy,
    resolvedBacktestV2RuntimeBridge,
    effectiveOptionSelectionSpec,
    rayalgoSettings,
    rayalgoScoringConfig,
    effectiveAllowShorts,
    effectiveMinConviction,
    effectiveRegimeAdapt,
    effectiveRegimeFilter,
    effectiveSessionBlocks,
    signalTimeframe,
    signalTfMin,
    effectiveTradeDays,
  ]);

  const replayCandidates = useMemo(
    () => (
      optionRuntimeConfig?.executionMode === "option_history"
        ? collectReplayEntryCandidates(signalBars, regimes, replayCandidateCfg)
        : []
    ),
    [optionRuntimeConfig?.executionMode, regimes, replayCandidateCfg, signalBars],
  );

  useEffect(() => {
    if (!isActive || optionRuntimeConfig?.executionMode !== "option_history") {
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await getResearchBacktests();
        if (cancelled) {
          return;
        }
        const jobs = Array.isArray(response?.jobs) ? response.jobs : [];
        const results = Array.isArray(response?.results) ? response.results : [];
        const activeJob = response?.activeJobs?.backtest || response?.activeJob || null;
        const activeOptimizer = response?.activeJobs?.optimizer || null;
        const latestResult = response?.latestResult || null;
        setRecentBacktestJobs(jobs.filter((job) => String(job?.jobType || "backtest") === "backtest"));
        setRecentOptimizerJobs(jobs.filter((job) => String(job?.jobType || "") === "optimizer"));
        setRecentBacktestResults(results.map((entry) => buildRecentResultSummary(entry)).filter(Boolean));
        if (activeJob?.jobId) {
          applyBackgroundJobSnapshot(activeJob);
        } else if (latestResult?.resultId && runState.status === "idle" && !latestResultRecordRef.current) {
          restoreResultRecord(latestResult, 0);
        }
        if (activeOptimizer?.jobId) {
          applyOptimizerJobSnapshot(activeOptimizer);
        }
      } catch {
        // Ignore reconnect failures; polling or manual runs can recover state later.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyBackgroundJobSnapshot, applyOptimizerJobSnapshot, hydrateStoredResultRecord, isActive, optionRuntimeConfig?.executionMode, restoreResultRecord, runState.status]);

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }
    const jobId = activeBacktestJob?.jobId;
    if (!jobId || !ACTIVE_BACKTEST_JOB_STATUSES.includes(String(activeBacktestJob.status || ""))) {
      return undefined;
    }
    let cancelled = false;
    let fallbackTimerId = null;
    let streamController = null;
    let eventSubscription = null;
    let terminalHandled = false;

    const mergeRecentBacktestJob = (job) => {
      setRecentBacktestJobs((previous) => mergeBacktestJobs(previous, job));
    };

    const handleCompletedResult = async (job) => {
      const resultResponse = await getResearchBacktestResult(job.resultId);
      if (cancelled) {
        return;
      }
      restoreResultRecord(resultResponse?.result || null, runCounterRef.current + 1);
      runCounterRef.current += 1;
      const nextDraftSignature = latestDraftRunSignatureRef.current || null;
      if (queuedRunRequestedRef.current && nextDraftSignature && nextDraftSignature !== (resultResponse?.result?.draftSignature || null)) {
        setQueuedRunRequested(false);
        beginPendingRunRequest(nextDraftSignature);
      } else {
        setQueuedRunRequested(false);
      }
    };

    const applyJobSnapshot = async (job = null) => {
      if (cancelled || !job) {
        return;
      }
      if (ACTIVE_BACKTEST_JOB_STATUSES.includes(String(job.status || ""))) {
        applyBackgroundJobSnapshot(job);
        return;
      }
      mergeRecentBacktestJob(job);
      if (terminalHandled) {
        return;
      }
      if (job.status === "completed" && job.resultId) {
        terminalHandled = true;
        await handleCompletedResult(job);
        return;
      }
      if (job.status === "failed") {
        terminalHandled = true;
        setRunState({
          ...emptyRunState("error", job.error || "Background backtest failed."),
          rayalgoScoringContext: rayalgoScoringConfig,
          indicatorOverlayTape: signalOverlayTape,
        });
        setActiveBacktestJob(emptyBacktestJobState());
        setBacktestProgress(null);
        return;
      }
      if (job.status === "cancelled") {
        terminalHandled = true;
        setActiveBacktestJob(emptyBacktestJobState());
        setBacktestProgress(null);
        clearLiveRunState();
        setRunState((previous) => ({
          ...previous,
          status: "idle",
          error: null,
        }));
      }
    };

    const poll = async () => {
      if (cancelled || terminalHandled) {
        return;
      }
      try {
        const response = await getResearchBacktestJob(jobId);
        await applyJobSnapshot(response?.job || null);
        if (!cancelled && !terminalHandled) {
          fallbackTimerId = setTimeout(poll, BACKTEST_JOB_POLL_MS);
        }
      } catch {
        if (!cancelled && !terminalHandled) {
          fallbackTimerId = setTimeout(poll, BACKTEST_JOB_POLL_MS);
        }
      }
    };

    (async () => {
      eventSubscription = subscribeResearchBacktestJobEvents(jobId, {
        onEvent: (event) => {
          if (cancelled || !event?.type) {
            return;
          }
          if (event.type === "job") {
            void applyJobSnapshot(event.job || null);
          }
        },
        onError: () => {
          if (cancelled || terminalHandled) {
            return;
          }
          fallbackTimerId = setTimeout(poll, 0);
        },
      });
      if (eventSubscription) {
        return;
      }
      try {
        streamController = typeof AbortController === "function" ? new AbortController() : null;
        await streamResearchBacktestJob(jobId, {
          signal: streamController?.signal,
          onEvent: (event) => {
            if (cancelled || !event?.type) {
              return;
            }
            if (event.type === "job") {
              void applyJobSnapshot(event.job || null);
            }
          },
        });
        if (!cancelled && !terminalHandled) {
          fallbackTimerId = setTimeout(poll, 0);
        }
      } catch (error) {
        if (cancelled || error?.name === "AbortError" || terminalHandled) {
          return;
        }
        fallbackTimerId = setTimeout(poll, 0);
      }
    })();

    return () => {
      cancelled = true;
      eventSubscription?.close?.();
      streamController?.abort?.();
      if (fallbackTimerId != null) {
        clearTimeout(fallbackTimerId);
      }
    };
  }, [
    activeBacktestJob?.jobId,
    activeBacktestJob?.status,
    applyBackgroundJobSnapshot,
    beginPendingRunRequest,
    clearLiveRunState,
    isActive,
    rayalgoScoringConfig,
    restoreResultRecord,
    signalOverlayTape,
  ]);

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }
    const jobId = activeOptimizerJob?.jobId;
    if (!jobId || !ACTIVE_BACKTEST_JOB_STATUSES.includes(String(activeOptimizerJob.status || ""))) {
      return undefined;
    }
    let cancelled = false;
    let fallbackTimerId = null;
    let streamController = null;
    let eventSubscription = null;
    let terminalHandled = false;

    const applyJobSnapshot = async (job = null) => {
      if (cancelled || !job) {
        return;
      }
      applyOptimizerJobSnapshot(job);
      if (terminalHandled) {
        return;
      }
      if (job.status === "completed") {
        terminalHandled = true;
        const nextResults = Array.isArray(job.optimizerResult?.results) ? job.optimizerResult.results : [];
        setOptResults(nextResults);
        setOptError(nextResults.length ? null : "No optimizer candidates produced at least 5 real-data trades.");
        setOptRunning(false);
        setCompletedOptimizeRunId((previous) => Math.max(previous + 1, 1));
        return;
      }
      if (job.status === "failed") {
        terminalHandled = true;
        setOptRunning(false);
        setOptError(job.error || "Background optimizer failed.");
        return;
      }
      if (job.status === "cancelled") {
        terminalHandled = true;
        setOptRunning(false);
        setOptError(null);
      }
    };

    const poll = async () => {
      if (cancelled || terminalHandled) {
        return;
      }
      try {
        const response = await getResearchBacktestJob(jobId);
        await applyJobSnapshot(response?.job || null);
        if (!cancelled && !terminalHandled) {
          fallbackTimerId = setTimeout(poll, BACKTEST_JOB_POLL_MS);
        }
      } catch {
        if (!cancelled && !terminalHandled) {
          fallbackTimerId = setTimeout(poll, BACKTEST_JOB_POLL_MS);
        }
      }
    };

    (async () => {
      eventSubscription = subscribeResearchBacktestJobEvents(jobId, {
        onEvent: (event) => {
          if (cancelled || !event?.type) {
            return;
          }
          if (event.type === "job") {
            void applyJobSnapshot(event.job || null);
          }
        },
        onError: () => {
          if (cancelled || terminalHandled) {
            return;
          }
          fallbackTimerId = setTimeout(poll, 0);
        },
      });
      if (eventSubscription) {
        return;
      }
      try {
        streamController = typeof AbortController === "function" ? new AbortController() : null;
        await streamResearchBacktestJob(jobId, {
          signal: streamController?.signal,
          onEvent: (event) => {
            if (cancelled || !event?.type) {
              return;
            }
            if (event.type === "job") {
              void applyJobSnapshot(event.job || null);
            }
          },
        });
        if (!cancelled && !terminalHandled) {
          fallbackTimerId = setTimeout(poll, 0);
        }
      } catch (error) {
        if (cancelled || error?.name === "AbortError" || terminalHandled) {
          return;
        }
        fallbackTimerId = setTimeout(poll, 0);
      }
    })();

    return () => {
      cancelled = true;
      eventSubscription?.close?.();
      streamController?.abort?.();
      if (fallbackTimerId != null) {
        clearTimeout(fallbackTimerId);
      }
    };
  }, [
    activeOptimizerJob?.jobId,
    activeOptimizerJob?.status,
    applyOptimizerJobSnapshot,
    isActive,
  ]);

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }
    if (!pendingRunRequest) {
      return undefined;
    }

    let cancelled = false;
    let streamController = null;
    const activeRunId = Number(pendingRunRequest.id) || 0;
    const executedDraftSignature = pendingRunRequest.signature || null;

    const triggerQueuedRerunIfNeeded = () => {
      const nextDraftSignature = latestDraftRunSignatureRef.current || null;
      if (!queuedRunRequestedRef.current || !nextDraftSignature || nextDraftSignature === executedDraftSignature) {
        setQueuedRunRequested(false);
        return;
      }
      setQueuedRunRequested(false);
      beginPendingRunRequest(nextDraftSignature);
    };

    const finalizeRun = (nextRunState) => {
      if (cancelled) {
        return;
      }
      setRunState(nextRunState);
      setDisplayedResultRecord(buildDisplayedResultRecord({
        resultId: null,
        createdAt: Date.now(),
        completedAt: new Date().toISOString(),
        mode: "interactive",
        status: nextRunState.status === "error" ? "failed" : "completed",
        metrics: computeBacktestMetrics(nextRunState.trades || [], effectiveCapital),
        setup: setupSnapshot,
        setupSnapshot,
        tradeCount: Array.isArray(nextRunState.trades) ? nextRunState.trades.length : 0,
        replayMeta: {
          replayDatasetSummary: nextRunState.replayDataset?.counts || null,
        },
      }, "latest"));
      setActiveBacktestJob(emptyBacktestJobState());
      clearLiveRunState();
      setCompletedRunId(activeRunId);
      setLastExecutedDraftSignature(executedDraftSignature);
      setPendingRunRequest((current) => (current?.id === activeRunId ? null : current));
      triggerQueuedRerunIfNeeded();
    };

    const persistCompletedResult = async (nextRunState) => {
      try {
        const response = await saveResearchBacktestResult({
          result: {
            trades: nextRunState.trades || [],
            equity: nextRunState.equity || [],
            skippedTrades: nextRunState.skippedTrades || [],
            skippedByReason: nextRunState.skippedByReason || {},
            riskStop: nextRunState.riskStop || null,
            rayalgoScoringContext: nextRunState.rayalgoScoringContext || rayalgoScoringConfig,
            replayDatasetSummary: nextRunState.replayDataset?.counts || null,
            firstResolvedContract: nextRunState.replayDataset?.firstResolvedContract || null,
            indicatorOverlayTape: nextRunState.indicatorOverlayTape || signalOverlayTape,
            metrics: computeBacktestMetrics(nextRunState.trades || [], effectiveCapital),
          },
          draftSignature: executedDraftSignature,
          setupSnapshot,
          resultMeta: buildPersistentResultMeta({
            bundleEvaluation,
            rayalgoScoringContext: nextRunState.rayalgoScoringContext || rayalgoScoringConfig,
          }),
        });
        if (!cancelled) {
          setLatestResultRecord(buildDisplayedResultRecord(response?.result || null, "latest"));
          setDisplayedResultRecord(buildDisplayedResultRecord(response?.result || null, "latest"));
          setRecentBacktestResults((previous) => mergeRecentResultSummary(previous, response?.result || null));
        }
      } catch {
        // Keep the local completed run even if persistence fails.
      }
    };

    if (!signalBars.length) {
      finalizeRun(emptyRunState("ready", null));
      return () => {
        cancelled = true;
      };
    }

    const executeRun = async () => {
      if (optionRuntimeConfig?.executionMode !== "option_history") {
        const result = await runBacktestRuntimeAsync(
          signalBars, regimes, cfg,
          (progress) => {
            if (!cancelled) {
              applyRuntimeProgress(progress, {
                source: "local",
                statusText: progress.currentDate ? `Scanning ${progress.currentDate}` : null,
              });
            }
          },
          () => cancelled,
        );
        if (!result || cancelled) { setBacktestProgress(null); return; }
        setBacktestProgress(buildAllCompleteSteps());
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        finalizeRun({
          status: "ready",
          error: null,
          trades: result.trades || [],
          equity: result.equity || [],
          skippedTrades: result.skippedTrades || [],
          skippedByReason: result.skippedByReason || {},
          replayDataset: null,
          riskStop: result.riskStop || null,
          rayalgoScoringContext: result.rayalgoScoringContext || rayalgoScoringConfig,
          indicatorOverlayTape: result.indicatorOverlayTape || signalOverlayTape,
        });
        setBacktestProgress(null);
        return;
      }

      if (!optionRuntimeConfig?.replayCredentialsReady) {
        finalizeRun({
          ...emptyRunState("error", "Massive options credentials are required for real option backtests."),
          rayalgoScoringContext: rayalgoScoringConfig,
          indicatorOverlayTape: signalOverlayTape,
        });
        return;
      }

      if (shouldRunBacktestInBackground({ replayCandidates, executionBars })) {
        const response = await createResearchBacktestJob({
          payload: buildReplayBacktestPayload(),
          draftSignature: executedDraftSignature,
          setupSnapshot,
          resultMeta: buildPersistentResultMeta({
            bundleEvaluation,
          }),
        }, {
          apiKey: optionRuntimeConfig.replayApiKey,
        });
        if (cancelled) {
          return;
        }
        setPendingRunRequest((current) => (current?.id === activeRunId ? null : current));
        applyBackgroundJobSnapshot(response?.job || null);
        return;
      }

      if (!marketSymbol || !replayCandidates.length) {
        const emptyReplaySummary = {
          processed: replayCandidates.length,
          candidates: replayCandidates.length,
          resolved: 0,
          skipped: 0,
          uniqueContracts: 0,
        };
        const result = await runBacktestRuntimeAsync(
          signalBars, regimes, {
            ...cfg,
            optionReplayDataset: {
              contractsByKey: {},
              skippedByKey: {},
              barsByTicker: {},
              counts: {
                candidates: replayCandidates.length,
                resolved: 0,
                skipped: 0,
                uniqueContracts: 0,
              },
              firstResolvedContract: null,
            },
          },
          (progress) => {
            if (!cancelled) {
              applyRuntimeProgress(progress, {
                source: "remote",
                statusText: progress.currentDate ? `Scanning ${progress.currentDate}` : null,
                replayResolution: emptyReplaySummary,
                replayDatasetSummary: emptyReplaySummary,
              });
            }
          },
          () => cancelled,
        );
        if (!result || cancelled) { setBacktestProgress(null); return; }
        setBacktestProgress(buildAllCompleteSteps());
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        const nextRunState = {
          status: "ready",
          error: null,
          trades: result.trades || [],
          equity: result.equity || [],
          skippedTrades: result.skippedTrades || [],
          skippedByReason: result.skippedByReason || {},
          riskStop: result.riskStop || null,
          rayalgoScoringContext: result.rayalgoScoringContext || rayalgoScoringConfig,
          replayDataset: {
            contractsByKey: {},
            skippedByKey: {},
            barsByTicker: {},
            counts: {
              candidates: replayCandidates.length,
              resolved: 0,
              skipped: 0,
              uniqueContracts: 0,
            },
            firstResolvedContract: null,
          },
          indicatorOverlayTape: result.indicatorOverlayTape || signalOverlayTape,
        };
        finalizeRun(nextRunState);
        await persistCompletedResult(nextRunState);
        setBacktestProgress(null);
        return;
      }

      try {
        let sawStreamEvent = false;
        const initialReplayCounts = {
          processed: 0,
          candidates: replayCandidates.length,
          resolved: 0,
          skipped: 0,
          uniqueContracts: 0,
        };
        streamController = typeof AbortController === "function" ? new AbortController() : null;
        applyRemoteStatus(
          "resolving-contracts",
          replayCandidates.length
            ? `0/${replayCandidates.length} replay candidates processed.`
            : "No replay candidates were generated.",
          initialReplayCounts,
          { replayDatasetSummary: initialReplayCounts },
        );
        const replayRun = await streamMassiveOptionReplayBacktest({
          ...buildReplayBacktestPayload({
            apiKey: optionRuntimeConfig.replayApiKey,
          }),
          onEvent: (event) => {
            if (cancelled || !event?.type) {
              return;
            }
            sawStreamEvent = true;
            if (event.type === "status") {
              applyRemoteStatus(event.stage, event.detail || null, event.counts || null, {
                replayDatasetSummary: event.replayDatasetSummary || event.counts || null,
                firstResolvedContract: event.firstResolvedContract || null,
              });
              return;
            }
            if (event.type === "progress") {
              applyRuntimeProgress(event.progress, {
                source: "remote",
                statusText: event.progress?.currentDate ? `Scanning ${event.progress.currentDate}` : null,
                replayResolution: event.replayDatasetSummary || null,
                replayDatasetSummary: event.replayDatasetSummary || null,
                firstResolvedContract: event.firstResolvedContract || null,
              });
            }
          },
          signal: streamController?.signal,
        });
        if (cancelled) {
          setBacktestProgress(null);
          return;
        }
        setBacktestProgress(buildAllCompleteSteps());
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        const nextRunState = {
          status: "ready",
          error: null,
          trades: replayRun.trades || [],
          equity: replayRun.equity || [],
          skippedTrades: replayRun.skippedTrades || [],
          skippedByReason: replayRun.skippedByReason || {},
          riskStop: replayRun.riskStop || null,
          rayalgoScoringContext: replayRun.rayalgoScoringContext || rayalgoScoringConfig,
          replayDataset: {
            counts: replayRun.replayDatasetSummary || null,
            firstResolvedContract: replayRun.firstResolvedContract || null,
          },
          indicatorOverlayTape: replayRun.indicatorOverlayTape || signalOverlayTape,
        };
        finalizeRun(nextRunState);
        await persistCompletedResult(nextRunState);
        setBacktestProgress(null);
      } catch (error) {
        if (cancelled || error?.name === "AbortError") {
          setBacktestProgress(null);
          return;
        }
        if (error?.code === "BACKTEST_STREAM_UNAVAILABLE" && !sawStreamEvent) {
          try {
            const fallbackCounts = {
              processed: replayCandidates.length,
              candidates: replayCandidates.length,
              resolved: 0,
              skipped: 0,
              uniqueContracts: 0,
            };
            applyRemoteStatus(
              "fallback",
              "Streaming unavailable. Falling back to blocking replay.",
              fallbackCounts,
              { replayDatasetSummary: fallbackCounts },
            );
            const replayRun = await runMassiveOptionReplayBacktest(buildReplayBacktestPayload({
              apiKey: optionRuntimeConfig.replayApiKey,
            }));
            if (cancelled) {
              setBacktestProgress(null);
              return;
            }
            setBacktestProgress(buildAllCompleteSteps());
            await new Promise((resolve) => { setTimeout(resolve, 0); });
            const nextRunState = {
              status: "ready",
              error: null,
              trades: replayRun.trades || [],
              equity: replayRun.equity || [],
              skippedTrades: replayRun.skippedTrades || [],
              skippedByReason: replayRun.skippedByReason || {},
              riskStop: replayRun.riskStop || null,
              rayalgoScoringContext: replayRun.rayalgoScoringContext || rayalgoScoringConfig,
              replayDataset: {
                counts: replayRun.replayDatasetSummary || null,
                firstResolvedContract: replayRun.firstResolvedContract || null,
              },
              indicatorOverlayTape: replayRun.indicatorOverlayTape || signalOverlayTape,
            };
            finalizeRun(nextRunState);
            await persistCompletedResult(nextRunState);
            setBacktestProgress(null);
            return;
          } catch (fallbackError) {
            error = fallbackError;
          }
        }
        setBacktestProgress(null);
        finalizeRun({
          ...emptyRunState("error", error?.message || "Failed to run Massive options-history backtest."),
          rayalgoScoringContext: rayalgoScoringConfig,
          indicatorOverlayTape: signalOverlayTape,
        });
      }
    };

    let timerId = null;
    if (optionRuntimeConfig?.executionMode === "option_history") {
      timerId = setTimeout(() => {
        if (!cancelled) {
          executeRun();
        }
      }, REPLAY_RUN_DEBOUNCE_MS);
    } else {
      executeRun();
    }

    return () => {
      cancelled = true;
      streamController?.abort?.();
      if (timerId != null) {
        clearTimeout(timerId);
      }
    };
  }, [applyRemoteStatus, applyRuntimeProgress, beginPendingRunRequest, clearLiveRunState, isActive, pendingRunRequest]);

  const trades = runState.trades || [];
  const equity = runState.equity || [];
  const skippedTrades = runState.skippedTrades || [];
  const skippedByReason = runState.skippedByReason || {};
  const {
    chartIndicatorOverlayTape: indicatorOverlayTape,
    chartIndicatorOverlayTapesByTf: indicatorOverlayTapesByTf,
    replayIndicatorOverlayTape,
  } = useMemo(() => resolveResearchExecutionOverlayState({
    signalOverlayTape,
    localIndicatorOverlayTapesByTf,
    replayIndicatorOverlayTape: runState.indicatorOverlayTape,
  }), [localIndicatorOverlayTapesByTf, runState.indicatorOverlayTape, signalOverlayTape]);
  const rayalgoLatestSignal = useMemo(() => {
    const signalEvents = Array.isArray(indicatorOverlayTape?.events)
      ? indicatorOverlayTape.events
      : [];
    const latestSignal = [...signalEvents]
      .filter((event) => event?.eventType === "signal_fire" && String(event?.strategy || "").trim().toLowerCase() === "rayalgo")
      .sort((left, right) => String(left?.ts || "").localeCompare(String(right?.ts || "")))
      .at(-1);
    if (!latestSignal) {
      return null;
    }
    const scoringMeta = latestSignal?.meta?.scoring || null;
    return {
      ts: String(latestSignal.ts || "").trim() || null,
      direction: latestSignal.direction === "short" ? "short" : "long",
      activeTimeframe: String(latestSignal.activeTimeframe || scoringMeta?.activeTimeframe || "").trim() || null,
      signalRole: String(latestSignal.signalRole || scoringMeta?.signalRole || "").trim() || null,
      rawScore: Number.isFinite(Number(latestSignal.rawScore)) ? Number(latestSignal.rawScore) : null,
      precursorBonus: Number.isFinite(Number(latestSignal.precursorBonus)) ? Number(latestSignal.precursorBonus) : null,
      score: Number.isFinite(Number(latestSignal.score)) ? Number(latestSignal.score) : null,
      ladderId: String(latestSignal.precursorLadderId || scoringMeta?.precursorLadderId || "").trim() || null,
      hasConflict: Boolean(scoringMeta?.precursorContext?.hasConflict),
      dataStatus: String(scoringMeta?.precursorContext?.dataStatus || "").trim() || null,
    };
  }, [indicatorOverlayTape]);

  const metrics = useMemo(
    () => computeBacktestMetrics(trades, effectiveCapital),
    [effectiveCapital, trades],
  );

  const currentReplayBaselineRun = useMemo(() => ({
    trades,
    equity,
    skippedTrades,
    skippedByReason,
    replayDataset: runState.replayDataset,
    replayDatasetSummary: runState.replayDataset?.counts || null,
    firstResolvedContract: runState.replayDataset?.firstResolvedContract || null,
    riskStop: runState.riskStop,
    rayalgoScoringContext: runState.rayalgoScoringContext,
    indicatorOverlayTape: replayIndicatorOverlayTape,
  }), [equity, replayIndicatorOverlayTape, runState.rayalgoScoringContext, runState.replayDataset, runState.riskStop, skippedByReason, skippedTrades, trades]);

  useEffect(() => {
    if (optionRuntimeConfig?.executionMode !== "option_history") {
      lastCompletedReplayRef.current = null;
      setLastRunDelta(null);
      return;
    }

    if (runState.status !== "ready" || !signalBars.length || !inputImpactPayload.bars.length) {
      return;
    }

    const currentSnapshot = {
      inputSnapshot: createInputImpactInputSnapshot(inputImpactPayload),
      run: {
        trades: currentReplayBaselineRun.trades,
        equity: currentReplayBaselineRun.equity,
        skippedTrades: currentReplayBaselineRun.skippedTrades,
        skippedByReason: currentReplayBaselineRun.skippedByReason,
        replayDatasetSummary: currentReplayBaselineRun.replayDatasetSummary,
        firstResolvedContract: currentReplayBaselineRun.firstResolvedContract,
        riskStop: currentReplayBaselineRun.riskStop,
      },
    };
    const previousSnapshot = lastCompletedReplayRef.current;

    if (!previousSnapshot) {
      setLastRunDelta(null);
      lastCompletedReplayRef.current = currentSnapshot;
      return;
    }

    const previousKey = JSON.stringify(previousSnapshot.inputSnapshot);
    const currentKey = JSON.stringify(currentSnapshot.inputSnapshot);
    if (previousKey === currentKey) {
      setLastRunDelta(null);
      lastCompletedReplayRef.current = currentSnapshot;
      return;
    }

    const previousLabel = previousSnapshot.inputSnapshot.optionSelectionLabel;
    const currentLabel = currentSnapshot.inputSnapshot.optionSelectionLabel;
    setLastRunDelta(summarizeInputImpactComparison({
      variant: {
        key: "last_completed_run",
        family: "last_run",
        label: "Last Run Delta",
        description: previousLabel !== currentLabel
          ? previousLabel + " -> " + currentLabel
          : "Previous run -> current run",
      },
      baselineInput: previousSnapshot.inputSnapshot,
      variantInput: currentSnapshot.inputSnapshot,
      baselineRun: previousSnapshot.run,
      variantRun: currentSnapshot.run,
      capital: effectiveCapital,
    }));
    lastCompletedReplayRef.current = currentSnapshot;
  }, [completedRunId, currentReplayBaselineRun, effectiveCapital, inputImpactPayload, optionRuntimeConfig?.executionMode, runState.status, signalBars.length]);

  const runInputImpact = useCallback(() => {
    if (optionRuntimeConfig?.executionMode !== "option_history") {
      setInputImpactState(emptyOverviewDiagnosticState("disabled"));
      return;
    }
    if (inputImpactBlockedReason) {
      setInputImpactState(emptyOverviewDiagnosticState("error", inputImpactBlockedReason));
      return;
    }

    inputImpactRunRef.current += 1;
    const activeImpactRunId = inputImpactRunRef.current;
    const baselineRun = currentReplayBaselineRun;
    const variants = buildDefaultInputImpactVariants(inputImpactPayload);

    setInputImpactState((previous) => ({
      status: "loading",
      error: null,
      summary: previous.runId === completedRunId ? previous.summary : null,
      runId: completedRunId,
    }));

    scheduleDeferredWork(timersRef, async () => {
      try {
        const comparisons = [];
        for (const variant of variants) {
          const variantRun = await runMassiveOptionReplayBacktest({
            ...variant.variantInput,
            apiKey: optionRuntimeConfig.replayApiKey,
          });
          if (inputImpactRunRef.current !== activeImpactRunId) {
            return;
          }
          comparisons.push(summarizeInputImpactComparison({
            variant,
            baselineInput: inputImpactPayload,
            variantInput: variant.variantInput,
            baselineRun,
            variantRun,
            capital: effectiveCapital,
          }));
        }

        if (inputImpactRunRef.current !== activeImpactRunId) {
          return;
        }

        setInputImpactState({
          status: "ready",
          error: null,
          summary: summarizeInputImpactDiagnostics(comparisons),
          runId: completedRunId,
        });
      } catch (error) {
        if (inputImpactRunRef.current !== activeImpactRunId) {
          return;
        }
        setInputImpactState({
          status: "error",
          error: error?.message || "Failed to compute options-history input impact diagnostics.",
          summary: null,
          runId: completedRunId,
        });
      }
    });
  }, [
    completedRunId,
    currentReplayBaselineRun,
    effectiveCapital,
    inputImpactBlockedReason,
    inputImpactPayload,
    optionRuntimeConfig?.executionMode,
    optionRuntimeConfig?.replayApiKey,
  ]);

  useEffect(() => {
    if (normalizedStrategy !== "rayalgo") {
      setRayalgoScoreStudyState((previous) => (
        previous.status === "disabled" && previous.error
          ? previous
          : {
            ...emptyRayAlgoScoreStudyState("disabled", "RayAlgo score study is only available when the active strategy is RayAlgo."),
            lastInputKey: rayalgoScoreStudyInputKey,
          }
      ));
      return;
    }
    setRayalgoScoreStudyState((previous) => {
      if (!previous.result && previous.status === "idle" && previous.lastInputKey === rayalgoScoreStudyInputKey) {
        return previous;
      }
      if (previous.lastInputKey === rayalgoScoreStudyInputKey && previous.status !== "disabled") {
        return previous;
      }
      return {
        ...previous,
        status: previous.result ? "ready" : "idle",
        stale: Boolean(previous.result),
        error: previous.status === "error" ? previous.error : null,
        lastInputKey: rayalgoScoreStudyInputKey,
      };
    });
  }, [normalizedStrategy, rayalgoScoreStudyInputKey]);

  const runRayalgoScoringComparison = useCallback(() => {
    if (normalizedStrategy !== "rayalgo" || optionRuntimeConfig?.executionMode !== "option_history") {
      setRayalgoScoringComparisonState(emptyOverviewDiagnosticState("disabled"));
      return;
    }
    if (rayalgoScoringComparisonBlockedReason) {
      setRayalgoScoringComparisonState(emptyOverviewDiagnosticState("error", rayalgoScoringComparisonBlockedReason));
      return;
    }

    const currentConfig = normalizeRayAlgoScoringConfig({
      ...(currentReplayBaselineRun.rayalgoScoringContext || rayalgoScoringConfig || {}),
      activeTimeframe: signalTimeframe,
    });
    const baselineConfig = normalizeRayAlgoScoringConfig({
      activeTimeframe: signalTimeframe,
      precursorLadderId: "none",
      authority: "observe_only",
    });
    const currentSignalCount = countRayAlgoSignalEvents(currentReplayBaselineRun.indicatorOverlayTape);

    if (
      currentConfig?.precursorLadderId === baselineConfig?.precursorLadderId
      && currentConfig?.authority === baselineConfig?.authority
    ) {
      setRayalgoScoringComparisonState({
        status: "ready",
        error: null,
        summary: buildRayAlgoScoringComparisonSummary({
          baselineConfig,
          currentConfig,
          baselineRun: currentReplayBaselineRun,
          currentRun: currentReplayBaselineRun,
          baselineSignalCount: currentSignalCount,
          currentSignalCount,
          capital: effectiveCapital,
        }),
        runId: completedRunId,
      });
      return;
    }

    scoringCompareRunRef.current += 1;
    const activeCompareRunId = scoringCompareRunRef.current;

    setRayalgoScoringComparisonState((previous) => ({
      status: "loading",
      error: null,
      summary: previous.runId === completedRunId ? previous.summary : null,
      runId: completedRunId,
    }));

    scheduleDeferredWork(timersRef, async () => {
      try {
        const baselineRun = await runMassiveOptionReplayBacktest(buildReplayBacktestPayload({
          rayalgoScoringConfig: baselineConfig,
          apiKey: optionRuntimeConfig?.replayApiKey,
        }));
        if (scoringCompareRunRef.current !== activeCompareRunId) {
          return;
        }
        setRayalgoScoringComparisonState({
          status: "ready",
          error: null,
          summary: buildRayAlgoScoringComparisonSummary({
            baselineConfig,
            currentConfig,
            baselineRun,
            currentRun: currentReplayBaselineRun,
            baselineSignalCount: countRayAlgoSignalEvents(baselineRun?.indicatorOverlayTape),
            currentSignalCount,
            capital: effectiveCapital,
          }),
          runId: completedRunId,
        });
      } catch (error) {
        if (scoringCompareRunRef.current !== activeCompareRunId) {
          return;
        }
        setRayalgoScoringComparisonState({
          status: "error",
          error: error?.message || "Failed to compute RayAlgo score comparison against the baseline mode.",
          summary: null,
          runId: completedRunId,
        });
      }
    });
  }, [
    buildReplayBacktestPayload,
    completedRunId,
    currentReplayBaselineRun,
    effectiveCapital,
    normalizedStrategy,
    optionRuntimeConfig?.executionMode,
    optionRuntimeConfig?.replayApiKey,
    rayalgoScoringComparisonBlockedReason,
    rayalgoScoringConfig,
    signalTimeframe,
  ]);

  const eqDomain = useMemo(() => {
    if (!equity.length) return [Math.round(effectiveCapital * 0.82), Math.round(effectiveCapital * 1.18)];
    const values = equity.map((entry) => entry.bal);
    let min = values[0];
    let max = values[0];
    for (let index = 1; index < values.length; index += 1) {
      if (values[index] < min) min = values[index];
      if (values[index] > max) max = values[index];
    }
    if (!isFinite(min) || !isFinite(max)) {
      return [Math.round(effectiveCapital * 0.82), Math.round(effectiveCapital * 1.18)];
    }
    const range = max - min;
    const pad = Math.max(range * 0.10, effectiveCapital * 0.03);
    return [Math.floor(min - pad), Math.ceil(max + pad)];
  }, [effectiveCapital, equity]);

  const pinSnap = useCallback(() => {
    setSnap({
      eq: [...equity],
      m: { ...metrics },
      lbl: `${getStrategyLabel(normalizedStrategy)} ${(slPct * 100).toFixed(0)}/${(tpPct * 100).toFixed(0)} ${effectiveDte}D`,
    });
  }, [effectiveDte, equity, metrics, normalizedStrategy, slPct, tpPct]);

  const clearSnap = useCallback(() => {
    setSnap(null);
  }, []);

  const selectBottomTab = useCallback((tab) => {
    setBottomTab(tab);
    setLogPage(0);
  }, []);

  const runOptimize = useCallback(() => {
    if (optRunning) return;
    setBottomTab("optimize");
    if (optionRuntimeConfig?.executionMode !== "option_history") {
      setOptError("Real-data optimizer requires Massive option-history mode.");
      setOptResults(null);
      return;
    }
    if (!optionRuntimeConfig?.replayCredentialsReady) {
      setOptError("Massive options credentials are required before the optimizer can run.");
      setOptResults(null);
      return;
    }
    if (!marketSymbol || !executionBars.length) {
      setOptError("Load real spot history before running the optimizer.");
      setOptResults(null);
      return;
    }

    setOptRunning(true);
    setOptError(null);
    setOptResults(null);

    scheduleDeferredWork(timersRef, async () => {
      try {
        const dteCandidates = buildOptimizerDteCandidates(effectiveDte);
        const exitCandidates = Object.entries(EXIT_PRESETS).map(([key, preset]) => ({
          key,
          sl: preset.sl,
          tp: preset.tp,
          ts: preset.ts,
          tr: preset.tr,
        }));
        const basePayload = buildReplayBacktestPayload({
          strategy: normalizedStrategy,
          dte: effectiveDte,
          optionSelectionSpec: buildFixedDteSelectionSpec(optionRuntimeConfig?.optionSelectionSpec, effectiveDte),
        });
        const response = await createResearchBacktestJob({
          jobType: "optimizer",
          payload: {
            marketSymbol,
            basePayload,
            dteCandidates,
            exitCandidates,
          },
          setupSnapshot,
          resultMeta: buildPersistentResultMeta(),
        }, {
          apiKey: optionRuntimeConfig?.replayApiKey,
        });
        applyOptimizerJobSnapshot(response?.job || null);
        setRecentOptimizerJobs((previous) => {
          const next = [response?.job, ...(Array.isArray(previous) ? previous : [])].filter(Boolean);
          return next.slice(0, 18);
        });
      } catch (error) {
        setOptRunning(false);
        setOptResults(null);
        setOptError(error?.message || "Failed to queue the Massive-backed optimizer.");
      }
    });
  }, [
    buildReplayBacktestPayload,
    effectiveDte,
    marketSymbol,
    normalizedStrategy,
    optRunning,
    optionRuntimeConfig,
    setupSnapshot,
    buildPersistentResultMeta,
    applyOptimizerJobSnapshot,
  ]);

  const computeReco = useCallback(() => {
    if (recoComputing) return;
    setBottomTab("overview");
    if (optionRuntimeConfig?.executionMode !== "option_history") {
      setRecoError("Real-data recommendations require Massive option-history mode.");
      setRecoMatrix(null);
      return;
    }
    if (!optionRuntimeConfig?.replayCredentialsReady) {
      setRecoError("Massive options credentials are required before recommendations can run.");
      setRecoMatrix(null);
      return;
    }
    if (!marketSymbol || !executionBars.length) {
      setRecoError("Load real spot history before computing recommendations.");
      setRecoMatrix(null);
      return;
    }

    const activeRunId = recoRunRef.current + 1;
    recoRunRef.current = activeRunId;
    setRecoComputing(true);
    setRecoError(null);

    scheduleDeferredWork(timersRef, async () => {
      try {
        const nextMatrix = {};
        for (const strategyKey of RECOMMENDATION_COMPUTE_STRATEGIES) {
          const strategyPreset = STRATEGY_PRESETS[strategyKey];
          const exitPreset = EXIT_PRESETS[strategyPreset.exit];
          const result = await runMassiveOptionReplayBacktest(buildReplayBacktestPayload({
            strategy: strategyKey,
            dte: strategyPreset.dte,
            slPct: exitPreset.sl,
            tpPct: exitPreset.tp,
            trailStartPct: exitPreset.ts,
            trailPct: exitPreset.tr,
            zombieBars: strategyPreset.zb,
            minConviction: strategyPreset.mc,
            regimeFilter: "none",
            optionSelectionSpec: buildFixedDteSelectionSpec(optionRuntimeConfig?.optionSelectionSpec, strategyPreset.dte),
            apiKey: optionRuntimeConfig?.replayApiKey,
          }));
          if (recoRunRef.current !== activeRunId) {
            return;
          }
          nextMatrix[strategyKey] = buildRecommendationMatrixFromTrades(result?.trades || []);
        }

        if (recoRunRef.current !== activeRunId) {
          return;
        }
        setRecoMatrix(rankRecommendationMatrix(nextMatrix));
        setRecoError(null);
      } catch (error) {
        if (recoRunRef.current !== activeRunId) {
          return;
        }
        setRecoMatrix(null);
        setRecoError(error?.message || "Failed to compute Massive-backed recommendations.");
      } finally {
        if (recoRunRef.current === activeRunId) {
          setRecoComputing(false);
        }
      }
    });
  }, [
    allowShorts,
    buildReplayBacktestPayload,
    commPerContract,
    effectiveCapital,
    executionBars.length,
    executionFidelity,
    iv,
    marketSymbol,
    optionRuntimeConfig,
    recoComputing,
    regimeAdapt,
    sessionBlocks,
    slipBps,
    tradeDays,
  ]);

  useEffect(() => {
    recoRunRef.current += 1;
    optRunRef.current += 1;
    setRecoMatrix(null);
    setRecoError(null);
    setRecoComputing(false);
    setOptResults(null);
    setOptError(null);
    setOptRunning(false);
  }, [
    allowShorts,
    commPerContract,
    effectiveCapital,
    effectiveDte,
    executionBars,
    executionFidelity,
    iv,
    marketSymbol,
    minConviction,
    normalizedStrategy,
    optionRuntimeConfig,
    rayalgoScoringConfig,
    regimeAdapt,
    regimeFilter,
    sessionBlocks,
    signalBars,
    signalTfMin,
    slipBps,
    tradeDays,
    trailPct,
    trailStartPct,
    tpPct,
    zombieBars,
  ]);

  const selectedRayalgoScoreStudyRun = useMemo(
    () => (
      rayalgoScoreStudyState.selectedRunId
        ? rayalgoScoreStudyState.runDetailsById?.[rayalgoScoreStudyState.selectedRunId] || null
        : null
    ),
    [rayalgoScoreStudyState.runDetailsById, rayalgoScoreStudyState.selectedRunId],
  );

  const selectedRayalgoScoreStudyComparisonRuns = useMemo(
    () => rayalgoScoreStudyState.selectedComparisonRunIds
      .map((runId) => {
        const summaryRun = rayalgoScoreStudyState.runs.find((entry) => entry?.runId === runId) || null;
        const detailRun = rayalgoScoreStudyState.runDetailsById?.[runId] || null;
        if (!summaryRun && !detailRun) {
          return null;
        }
        return {
          ...(summaryRun || {}),
          ...(detailRun || {}),
          summary: detailRun?.summary || summaryRun?.summary || null,
          result: detailRun?.result || null,
          detailStatus: detailRun?.result
            ? "ready"
            : (rayalgoScoreStudyState.comparisonRunDetailStatusById?.[runId] || "idle"),
          detailError: rayalgoScoreStudyState.comparisonRunDetailErrorsById?.[runId] || null,
        };
      })
      .filter(Boolean),
    [
      rayalgoScoreStudyState.comparisonRunDetailErrorsById,
      rayalgoScoreStudyState.comparisonRunDetailStatusById,
      rayalgoScoreStudyState.runDetailsById,
      rayalgoScoreStudyState.runs,
      rayalgoScoreStudyState.selectedComparisonRunIds,
    ],
  );

  const merged = useMemo(() => {
    if (!snap) return equity;
    const snapMap = {};
    for (const snapPoint of snap.eq) {
      snapMap[snapPoint.i] = snapPoint.bal;
    }
    return equity.map((entry) => ({
      ...entry,
      snap: snapMap[entry.i] ?? null,
    }));
  }, [equity, snap]);

  const exitBreakdown = useMemo(() => {
    const summary = {};
    for (const trade of trades) {
      if (!summary[trade.er]) {
        summary[trade.er] = { n: 0, pnl: 0, w: 0 };
      }
      summary[trade.er].n += 1;
      summary[trade.er].pnl += trade.pnl;
      if (trade.pnl > 0) {
        summary[trade.er].w += 1;
      }
    }
    return Object.entries(summary)
      .map(([name, value]) => ({
        name,
        ...value,
        wr: +(value.w / value.n * 100).toFixed(1),
        avg: +(value.pnl / value.n).toFixed(0),
      }))
      .sort((left, right) => right.pnl - left.pnl);
  }, [trades]);

  const regimeStats = useMemo(() => {
    const summary = {};
    for (const trade of trades) {
      const regime = trade.regime || "?";
      if (!summary[regime]) {
        summary[regime] = { n: 0, w: 0, pnl: 0 };
      }
      summary[regime].n += 1;
      if (trade.pnl > 0) {
        summary[regime].w += 1;
      }
      summary[regime].pnl += trade.pnl;
    }
    return Object.entries(summary)
      .map(([regime, value]) => ({
        regime,
        ...value,
        wr: +(value.w / value.n * 100).toFixed(1),
      }))
      .sort((left, right) => right.pnl - left.pnl);
  }, [trades]);

  const hourly = useMemo(() => {
    const summary = {};
    for (const trade of trades) {
      const hour = parseInt(trade.ts?.split(" ")[1]?.split(":")[0], 10) || 0;
      if (!summary[hour]) {
        summary[hour] = { n: 0, w: 0, pnl: 0 };
      }
      summary[hour].n += 1;
      if (trade.pnl > 0) {
        summary[hour].w += 1;
      }
      summary[hour].pnl += trade.pnl;
    }
    return Object.entries(summary)
      .map(([hour, value]) => ({
        hour: +hour,
        trades: value.n,
        pnl: +value.pnl.toFixed(2),
      }))
      .sort((left, right) => left.hour - right.hour);
  }, [trades]);

  const tradePnls = useMemo(
    () => trades.map((trade, index) => ({ i: index + 1, pnl: +trade.pnl.toFixed(2) })),
    [trades],
  );

  const displayTrades = useMemo(
    () => (runState.status === "loading" ? liveRunState.trades : trades),
    [liveRunState.trades, runState.status, trades],
  );

  const displayTradePnls = useMemo(
    () => displayTrades.map((trade, index) => ({ i: index + 1, pnl: +Number(trade.pnl || 0).toFixed(2) })),
    [displayTrades],
  );

  const bundleEvaluation = useMemo(() => (
    normalizedStrategy === "rayalgo"
      ? evaluateRayAlgoBundleRun({
        trades,
        bars: executionBars,
        capital: effectiveCapital,
      })
      : null
  ), [effectiveCapital, executionBars, normalizedStrategy, trades]);

  const pnlDist = useMemo(() => {
    if (!trades.length) return [];
    const buckets = {};
    for (const trade of trades) {
      const bucket = Math.floor(trade.pnl / 50) * 50;
      buckets[bucket] = (buckets[bucket] || 0) + 1;
    }
    return Object.entries(buckets)
      .map(([range, count]) => ({ range: +range, count }))
      .sort((left, right) => left.range - right.range);
  }, [trades]);

  const displayPnlDist = useMemo(() => {
    if (!displayTrades.length) return [];
    const buckets = {};
    for (const trade of displayTrades) {
      const bucket = Math.floor((Number(trade.pnl) || 0) / 50) * 50;
      buckets[bucket] = (buckets[bucket] || 0) + 1;
    }
    return Object.entries(buckets)
      .map(([range, count]) => ({ range: +range, count }))
      .sort((left, right) => left.range - right.range);
  }, [displayTrades]);

  const replayDatasetSummary = useMemo(() => runState.replayDataset?.counts || null, [runState.replayDataset]);
  const replaySampleTicker = runState.replayDataset?.firstResolvedContract?.optionTicker || null;
  const replaySampleLabel = useMemo(
    () => formatReplayContractLabel(runState.replayDataset?.firstResolvedContract),
    [runState.replayDataset],
  );

  return {
    regimes,
    trades,
    skippedTrades,
    skippedByReason,
    indicatorOverlayTape,
    indicatorOverlayTapesByTf,
    indicatorOverlaySupportedTimeframes,
    equity,
    metrics,
    eqDomain,
    snap,
    merged,
    pinSnap,
    clearSnap,
    bottomTab,
    selectBottomTab,
    logPage,
    setLogPage,
    optResults,
    optRunning,
    optError,
    completedOptimizeRunId,
    runOptimize,
    recoMatrix,
    recoComputing,
    recoError,
    computeReco,
    exitBreakdown,
    regimeStats,
    hourly,
    tradePnls,
    pnlDist,
    displayTrades,
    displayTradePnls,
    displayPnlDist,
    bundleEvaluation,
    completedRunId,
    replayRunStatus: runState.status,
    backtestProgress,
    liveRunState,
    activeBacktestJob,
    activeOptimizerJob,
    latestResultRecord,
    displayedResultRecord,
    recentBacktestJobs,
    recentBacktestResults,
    recentOptimizerJobs,
    cancelActiveBacktestRun,
    runBacktestNow,
    runBacktestOnNextDraftChange,
    restoreSavedRun,
    openStoredResultRecord,
    runIsStale,
    hasQueuedRerun,
    replayRunError: runState.error,
    replayDatasetSummary,
    replaySampleTicker,
    replaySampleLabel,
    riskStop: runState.riskStop,
    rayalgoScoringContext: runState.rayalgoScoringContext || rayalgoScoringConfig,
    rayalgoLatestSignal,
    rayalgoScoringComparison: {
      ...rayalgoScoringComparisonState,
      status: normalizedStrategy !== "rayalgo" || optionRuntimeConfig?.executionMode !== "option_history"
        ? "disabled"
        : rayalgoScoringComparisonState.status,
      canRun: canRunRayalgoScoringComparison,
      blockedReason: rayalgoScoringComparisonBlockedReason,
      isCurrent: rayalgoScoringComparisonState.runId != null && rayalgoScoringComparisonState.runId === completedRunId,
    },
    rayalgoScoreStudy: {
      ...rayalgoScoreStudyState,
      selectedRunDetail: selectedRayalgoScoreStudyRun,
      selectedComparisonRuns: selectedRayalgoScoreStudyComparisonRuns,
    },
    runInputImpact,
    runRayalgoScoringComparison,
    runRayalgoScoreStudy,
    queueRayalgoScoreStudyRun,
    cancelRayalgoScoreStudyRun,
    refreshRayalgoScoreStudyCatalog,
    selectRayalgoScoreStudyPreset,
    selectRayalgoScoreStudyRun,
    toggleRayalgoScoreStudyComparisonRun,
    loadRayalgoScoreStudyRunDetail,
    importRayalgoScoreStudyLocalArtifact,
    inputImpact: {
      ...inputImpactState,
      status: optionRuntimeConfig?.executionMode !== "option_history" ? "disabled" : inputImpactState.status,
      canRun: canRunInputImpact,
      blockedReason: inputImpactBlockedReason,
      isCurrent: inputImpactState.runId != null && inputImpactState.runId === completedRunId,
      lastRunDelta,
      currentRiskStop: runState.riskStop,
    },
    executionBarCount: Array.isArray(executionBars) ? executionBars.length : 0,
  };
}
