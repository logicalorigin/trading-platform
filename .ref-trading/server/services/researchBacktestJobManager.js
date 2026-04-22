import crypto from "node:crypto";
import {
  createResearchOptimizerHistoryEntry,
  createResearchRunHistoryEntry,
} from "../../src/research/history/researchHistory.js";
import {
  runMassiveOptionReplayBacktest,
  streamMassiveOptionReplayBacktest,
} from "./researchBacktest.js";

const JOB_PERSIST_PROGRESS_INTERVAL_MS = 1500;
const JOB_QUEUE_STALE_MS = 60_000;
const JOB_HEARTBEAT_STALE_MS = 240_000;
const JOB_MAX_RUNTIME_MS = 20 * 60_000;

function nowIso() {
  return new Date().toISOString();
}

function parseTimeMs(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isActiveJobStatus(status) {
  return ["queued", "running_background", "running_interactive", "cancel_requested"].includes(String(status || ""));
}

function formatDurationMs(durationMs) {
  const totalSeconds = Math.max(1, Math.round(Math.max(0, Number(durationMs) || 0) / 1000));
  if (totalSeconds % 60 === 0) {
    return `${Math.round(totalSeconds / 60)}m`;
  }
  return `${totalSeconds}s`;
}

function resolveJobHeartbeatMs(job = {}) {
  return (
    parseTimeMs(job?.progress?.heartbeatAt)
    ?? parseTimeMs(job?.updatedAt)
    ?? parseTimeMs(job?.startedAt)
    ?? parseTimeMs(job?.createdAt)
  );
}

export function resolveExpiredJobFailureReason(job = {}, { nowMs = Date.now() } = {}) {
  if (!isActiveJobStatus(job?.status)) {
    return null;
  }

  const startedAtMs = parseTimeMs(job?.startedAt);
  if (
    startedAtMs != null
    && Number.isFinite(nowMs)
    && nowMs - startedAtMs > JOB_MAX_RUNTIME_MS
  ) {
    return `Backtest job exceeded max runtime (${formatDurationMs(JOB_MAX_RUNTIME_MS)}).`;
  }

  if (String(job?.status || "") === "queued") {
    const queuedAtMs = parseTimeMs(job?.createdAt) ?? parseTimeMs(job?.updatedAt);
    if (
      queuedAtMs != null
      && Number.isFinite(nowMs)
      && nowMs - queuedAtMs > JOB_QUEUE_STALE_MS
    ) {
      return `Backtest job stalled in queue for more than ${formatDurationMs(JOB_QUEUE_STALE_MS)}.`;
    }
    return null;
  }

  const heartbeatAtMs = resolveJobHeartbeatMs(job);
  if (
    heartbeatAtMs != null
    && Number.isFinite(nowMs)
    && nowMs - heartbeatAtMs > JOB_HEARTBEAT_STALE_MS
  ) {
    return `Backtest job heartbeat stalled for more than ${formatDurationMs(JOB_HEARTBEAT_STALE_MS)}.`;
  }
  return null;
}

function clone(value) {
  if (value == null || typeof value !== "object") {
    return value;
  }
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeCounts(counts = null) {
  if (!counts || typeof counts !== "object") {
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

function buildMetricsPreview(result = null) {
  const metrics = result?.metrics || {};
  return {
    n: Number(metrics.n) || 0,
    roi: Number.isFinite(Number(metrics.roi)) ? Number(metrics.roi) : null,
    pnl: Number.isFinite(Number(metrics.pnl)) ? Number(metrics.pnl) : null,
    wr: Number.isFinite(Number(metrics.wr)) ? Number(metrics.wr) : null,
    dd: Number.isFinite(Number(metrics.dd)) ? Number(metrics.dd) : null,
  };
}

function computeOptimizerScore(metrics = {}) {
  const expectancy = Number(metrics.exp) || 0;
  const roi = Number(metrics.roi) || 0;
  const winRate = Number(metrics.wr) || 0;
  const profitFactor = metrics.pf === "∞" ? 99 : (Number(metrics.pf) || 0);
  const sharpe = Number(metrics.sharpe) || 0;
  const drawdown = Number(metrics.dd) || 0;
  const trades = Number(metrics.n) || 0;
  return +(
    expectancy * 4.0
    + roi * 0.45
    + winRate * 0.2
    + profitFactor * 8.0
    + sharpe * 9.0
    - drawdown * 0.35
    + trades * 0.12
  ).toFixed(4);
}

function normalizeOptimizerResult(result = {}, index = 0, fallbackId = "opt") {
  return {
    id: String(result.id || `${fallbackId}-${index + 1}`),
    strategy: String(result.strategy || "").trim().toLowerCase() || "smc",
    dte: Number.isFinite(Number(result.dte)) ? Number(result.dte) : 0,
    exit: String(result.exit || "").trim() || "current",
    sl: Number.isFinite(Number(result.sl)) ? Number(result.sl) : null,
    tp: Number.isFinite(Number(result.tp)) ? Number(result.tp) : null,
    trailStartPct: Number.isFinite(Number(result.trailStartPct ?? result.ts))
      ? Number(result.trailStartPct ?? result.ts)
      : null,
    trailPct: Number.isFinite(Number(result.trailPct ?? result.tr))
      ? Number(result.trailPct ?? result.tr)
      : null,
    regime: String(result.regime || "").trim() || "all",
    n: Number(result.n) || 0,
    exp: Number.isFinite(Number(result.exp)) ? Number(result.exp) : null,
    roi: Number.isFinite(Number(result.roi)) ? Number(result.roi) : null,
    wr: Number.isFinite(Number(result.wr)) ? Number(result.wr) : null,
    pf: Number.isFinite(Number(result.pf)) ? Number(result.pf) : result.pf === "∞" ? 99 : null,
    sharpe: Number.isFinite(Number(result.sharpe)) ? Number(result.sharpe) : null,
    dd: Number.isFinite(Number(result.dd)) ? Number(result.dd) : null,
    pnl: Number.isFinite(Number(result.pnl)) ? Number(result.pnl) : null,
    score: Number.isFinite(Number(result.score)) ? Number(result.score) : computeOptimizerScore(result),
    bundleEvaluation: clone(result.bundleEvaluation || null),
  };
}

function buildOptimizerSummary(results = [], context = {}) {
  const normalizedResults = (Array.isArray(results) ? results : [])
    .map((result, index) => normalizeOptimizerResult(result, index, context.jobId || "optimizer"))
    .sort((left, right) => (Number(right.score) || 0) - (Number(left.score) || 0))
    .slice(0, 50);
  const historyEntry = createResearchOptimizerHistoryEntry({
    batchId: context.batchId || context.jobId || crypto.randomUUID(),
    createdAt: context.createdAt || Date.now(),
    marketSymbol: context.marketSymbol || "SPY",
    setup: context.setupSnapshot || {},
    selectedBundle: context.selectedBundle || null,
    isCustom: Boolean(context.isCustom),
    results: normalizedResults,
  });
  return {
    batchId: historyEntry.id,
    createdAt: historyEntry.createdAt,
    marketSymbol: historyEntry.marketSymbol,
    strategy: historyEntry.strategy,
    results: normalizedResults,
    candidateCount: normalizedResults.length,
    bestCandidateId: historyEntry.bestCandidateId || normalizedResults[0]?.id || null,
  };
}

function buildResultRecord({
  resultId,
  jobId = null,
  mode = "interactive",
  draftSignature = null,
  setupSnapshot = null,
  result = {},
  resultMeta = {},
} = {}) {
  const createdAt = Number(resultMeta.createdAt) || Date.now();
  const completedAt = nowIso();
  const historyEntry = createResearchRunHistoryEntry({
    runId: resultId,
    createdAt,
    marketSymbol: resultMeta.marketSymbol || "SPY",
    setup: setupSnapshot || {},
    selectedBundle: resultMeta.selectedBundle || null,
    isCustom: Boolean(resultMeta.isCustom),
    metrics: result.metrics || {},
    trades: result.trades || [],
    equity: result.equity || [],
    skippedTrades: result.skippedTrades || [],
    skippedByReason: result.skippedByReason || {},
    bundleEvaluation: resultMeta.bundleEvaluation || null,
    replayMeta: {
      selectionSummaryLabel: resultMeta.selectionSummaryLabel || "",
      replayRunStatus: "ready",
      replayRunError: "",
      replayDatasetSummary: result.replayDatasetSummary || null,
      replaySampleLabel: resultMeta.replaySampleLabel || "",
    },
    riskStop: result.riskStop || null,
    rayalgoScoringContext: result.rayalgoScoringContext || resultMeta.rayalgoScoringContext || null,
    dataSource: resultMeta.dataSource || "",
    spotDataMeta: resultMeta.spotDataMeta || null,
  });

  return {
    ...historyEntry,
    resultId: historyEntry.id,
    jobId: jobId || null,
    mode,
    status: "completed",
    bookmarkedAt: resultMeta.bookmarkedAt || null,
    createdAt,
    completedAt,
    updatedAt: completedAt,
    draftSignature: draftSignature || null,
    setupSnapshot: clone(setupSnapshot || null),
    resultMeta: {
      selectionSummaryLabel: resultMeta.selectionSummaryLabel || "",
      replaySampleLabel: resultMeta.replaySampleLabel || "",
      dataSource: resultMeta.dataSource || "",
      spotDataMeta: clone(resultMeta.spotDataMeta || null),
    },
    phaseTimings: clone(resultMeta.phaseTimings || null),
    diagnostics: clone(resultMeta.diagnostics || null),
    metricsPreview: buildMetricsPreview(historyEntry),
  };
}

function summarizeResultRecord(record = {}) {
  if (!record || typeof record !== "object") {
    return null;
  }
  return {
    resultId: record.resultId || record.id || null,
    id: record.resultId || record.id || null,
    type: record.type || "backtest_run",
    createdAt: record.createdAt || null,
    completedAt: record.completedAt || null,
    updatedAt: record.updatedAt || null,
    marketSymbol: record.marketSymbol || "SPY",
    strategy: record.strategy || "smc",
    mode: record.mode || "interactive",
    status: record.status || "completed",
    bookmarkedAt: record.bookmarkedAt || null,
    jobId: record.jobId || null,
    setup: clone(record.setup || record.setupSnapshot || null),
    metrics: clone(record.metrics || null),
    metricsPreview: clone(record.metricsPreview || buildMetricsPreview(record)),
    tradeCount: Number(record.tradeCount) || Number(record?.metrics?.n) || 0,
    skippedTradeCount: Number(record.skippedTradeCount) || 0,
    replayMeta: clone(record.replayMeta || null),
    resultMeta: {
      selectionSummaryLabel: record?.resultMeta?.selectionSummaryLabel || record?.replayMeta?.selectionSummaryLabel || "",
      replaySampleLabel: record?.resultMeta?.replaySampleLabel || record?.replayMeta?.replaySampleLabel || "",
      dataSource: record?.resultMeta?.dataSource || record?.replayMeta?.dataSource || "",
      spotDataMeta: clone(record?.resultMeta?.spotDataMeta || null),
    },
  };
}

function summarizeJob(job = {}) {
  return {
    jobId: job.jobId,
    jobType: job.jobType || "backtest",
    status: job.status,
    mode: job.mode || "background",
    createdAt: job.createdAt || null,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    updatedAt: job.updatedAt || null,
    resultId: job.resultId || null,
    error: job.error || null,
    draftSignature: job.draftSignature || null,
    marketSymbol: job.marketSymbol || "SPY",
    progress: clone(job.progress || null),
    metricsPreview: clone(job.metricsPreview || null),
    optimizerResult: clone(job.optimizerResult || null),
  };
}

function summarizeInlineBars(bars = []) {
  const list = Array.isArray(bars) ? bars : [];
  if (!list.length) {
    return null;
  }
  return {
    barCount: list.length,
    firstTs: list[0]?.ts || null,
    lastTs: list[list.length - 1]?.ts || null,
  };
}

function buildPersistedJobPayload(payload = null) {
  if (!payload || typeof payload !== "object") {
    return clone(payload);
  }
  const nextPayload = { ...payload };
  if (Array.isArray(payload.bars)) {
    nextPayload.barsSummary = summarizeInlineBars(payload.bars);
    delete nextPayload.bars;
  }
  if (payload.basePayload && typeof payload.basePayload === "object") {
    nextPayload.basePayload = {
      ...payload.basePayload,
    };
    if (Array.isArray(payload.basePayload.bars)) {
      nextPayload.basePayload.barsSummary = summarizeInlineBars(payload.basePayload.bars);
      delete nextPayload.basePayload.bars;
    }
  }
  return nextPayload;
}

export function createResearchBacktestJobManager({ store }) {
  const activeJobs = new Map();
  const jobPayloads = new Map();
  const cancelRequestedJobIds = new Set();
  const jobListenersById = new Map();

  async function persistState(nextState) {
    return store.upsertResearchBacktests(nextState);
  }

  function getState() {
    return store.getResearchBacktests();
  }

  function publishJobUpdate(job = null) {
    if (!job?.jobId) {
      return;
    }
    const listeners = jobListenersById.get(job.jobId);
    if (!listeners?.size) {
      return;
    }
    const payload = summarizeJob(job);
    for (const listener of [...listeners]) {
      try {
        listener(payload);
      } catch {
        // Ignore subscriber failures and keep the job loop alive.
      }
    }
  }

  function subscribeJob(jobId, listener) {
    const normalizedJobId = String(jobId || "").trim();
    if (!normalizedJobId || typeof listener !== "function") {
      return () => {};
    }
    const current = jobListenersById.get(normalizedJobId) || new Set();
    current.add(listener);
    jobListenersById.set(normalizedJobId, current);
    return () => {
      const listeners = jobListenersById.get(normalizedJobId);
      if (!listeners) {
        return;
      }
      listeners.delete(listener);
      if (!listeners.size) {
        jobListenersById.delete(normalizedJobId);
      }
    };
  }

  async function sweepExpiredJobs() {
    const state = getState();
    const currentJobs = Array.isArray(state.jobs) ? state.jobs : [];
    if (!currentJobs.length) {
      return false;
    }

    let changed = false;
    const nowMs = Date.now();
    const finishedAt = nowIso();
    const expiredJobs = [];
    const nextJobs = currentJobs.map((job) => {
      const reason = resolveExpiredJobFailureReason(job, { nowMs });
      if (!reason) {
        return job;
      }
      changed = true;
      activeJobs.delete(job.jobId);
      jobPayloads.delete(job.jobId);
      cancelRequestedJobIds.delete(job.jobId);
      const failedJob = {
        ...job,
        status: "failed",
        error: reason,
        finishedAt,
        updatedAt: finishedAt,
        progress: {
          ...(job.progress || {}),
          stage: "failed",
          detail: reason,
          heartbeatAt: finishedAt,
        },
      };
      expiredJobs.push(failedJob);
      return failedJob;
    });

    if (!changed) {
      return false;
    }

    await persistState({
      ...state,
      jobs: nextJobs,
    });
    expiredJobs.forEach((job) => publishJobUpdate(job));
    return true;
  }

  async function markInterruptedJobs() {
    const state = getState();
    const interruptedJobs = [];
    const nextJobs = (state.jobs || []).map((job) => {
      if (!["queued", "running_background", "running_interactive", "cancel_requested"].includes(String(job?.status || ""))) {
        return job;
      }
      jobPayloads.delete(job.jobId);
      cancelRequestedJobIds.delete(job.jobId);
      const failedJob = {
        ...job,
        status: "failed",
        error: "Server restarted before the backtest job completed.",
        finishedAt: nowIso(),
        updatedAt: nowIso(),
      };
      interruptedJobs.push(failedJob);
      return failedJob;
    });
    await persistState({
      ...state,
      jobs: nextJobs,
    });
    interruptedJobs.forEach((job) => publishJobUpdate(job));
  }

  async function upsertJob(jobPatch = {}, options = {}) {
    const state = getState();
    const currentJobs = Array.isArray(state.jobs) ? state.jobs : [];
    const jobId = String(jobPatch.jobId || "").trim();
    const current = currentJobs.find((job) => job.jobId === jobId) || null;
    const next = {
      ...(current || {}),
      ...jobPatch,
      jobId,
      updatedAt: nowIso(),
    };
    const jobs = [
      next,
      ...currentJobs.filter((job) => job.jobId !== jobId),
    ];
    if (options.persist !== false) {
      await persistState({
        ...state,
        jobs,
      });
    } else {
      store.state.researchBacktests = {
        ...state,
        jobs,
        updatedAt: nowIso(),
      };
    }
    publishJobUpdate(next);
    return next;
  }

  async function upsertResult(resultRecord = {}) {
    const state = getState();
    const currentResults = Array.isArray(state.results) ? state.results : [];
    const resultId = String(resultRecord.resultId || resultRecord.id || "").trim();
    const next = {
      ...(currentResults.find((row) => row.resultId === resultId) || {}),
      ...resultRecord,
      resultId,
      id: resultId,
      updatedAt: nowIso(),
    };
    const results = [
      next,
      ...currentResults.filter((row) => row.resultId !== resultId),
    ];
    await persistState({
      ...state,
      results,
    });
    return next;
  }

  async function persistInteractiveResult({ result, draftSignature = null, setupSnapshot = null, resultMeta = {} } = {}) {
    const resultId = String(resultMeta.resultId || "").trim() || crypto.randomUUID();
    const record = buildResultRecord({
      resultId,
      jobId: null,
      mode: "interactive",
      draftSignature,
      setupSnapshot,
      result,
      resultMeta,
    });
    return upsertResult(record);
  }

  async function createJob({ payload, draftSignature = null, setupSnapshot = null, resultMeta = {}, apiKey, jobType = "backtest" }) {
    const jobId = crypto.randomUUID();
    const createdAt = nowIso();
    jobPayloads.set(jobId, payload || null);
    const job = {
      jobId,
      jobType: String(jobType || "backtest").trim().toLowerCase() || "backtest",
      status: "queued",
      mode: "background",
      createdAt,
      startedAt: null,
      finishedAt: null,
      updatedAt: createdAt,
      resultId: null,
      error: null,
      marketSymbol: String(payload?.marketSymbol || resultMeta.marketSymbol || "SPY").trim().toUpperCase() || "SPY",
      draftSignature: draftSignature || null,
      setupSnapshot: clone(setupSnapshot || null),
      payload: buildPersistedJobPayload(payload || null),
      resultMeta: clone(resultMeta || null),
      progress: {
        stage: "queued",
        detail: String(jobType || "backtest").trim().toLowerCase() === "optimizer"
          ? "Queued optimizer shortlist."
          : "Queued for background execution.",
        counts: null,
        heartbeatAt: createdAt,
      },
      metricsPreview: null,
      optimizerResult: null,
    };
    await upsertJob(job);
    runJob({ jobId, apiKey }).catch(() => {});
    return summarizeJob(job);
  }

  async function cancelJob(jobId) {
    const state = getState();
    const job = (state.jobs || []).find((row) => row.jobId === String(jobId || "").trim()) || null;
    if (!job) {
      return null;
    }
    if (["completed", "failed", "cancelled"].includes(String(job.status || ""))) {
      cancelRequestedJobIds.delete(job.jobId);
      return summarizeJob(job);
    }

    cancelRequestedJobIds.add(job.jobId);
    if (job.status === "queued") {
      jobPayloads.delete(job.jobId);
      activeJobs.delete(job.jobId);
      cancelRequestedJobIds.delete(job.jobId);
      const cancelledJob = await upsertJob({
        ...job,
        status: "cancelled",
        finishedAt: nowIso(),
        error: null,
        progress: {
          ...(job.progress || {}),
          stage: "cancelled",
          detail: "Cancelled before background execution started.",
          heartbeatAt: nowIso(),
        },
      });
      return summarizeJob(cancelledJob);
    }

    const requestedJob = await upsertJob({
      ...job,
      status: "cancel_requested",
      error: null,
      progress: {
        ...(job.progress || {}),
        stage: "cancel_requested",
        detail: "Cancellation requested. Stopping the background backtest.",
        heartbeatAt: nowIso(),
      },
    });
    return summarizeJob(requestedJob);
  }

  async function runJob({ jobId, apiKey }) {
    if (activeJobs.has(jobId)) {
      return;
    }
    activeJobs.set(jobId, true);
    let lastProgressPersistAt = 0;
    try {
      const state = getState();
      const job = (state.jobs || []).find((row) => row.jobId === jobId);
      if (!job || ["cancelled", "completed", "failed"].includes(String(job.status || ""))) {
        return;
      }
      if (String(job.status || "") === "cancel_requested") {
        await upsertJob({
          ...job,
          status: "cancelled",
          finishedAt: nowIso(),
          error: null,
          progress: {
            ...(job.progress || {}),
            stage: "cancelled",
            detail: "Background backtest cancelled before execution started.",
            heartbeatAt: nowIso(),
          },
        });
        return;
      }
      const runtimePayload = clone(jobPayloads.get(jobId) || job?.payload || null);
      if (!runtimePayload) {
        throw new Error("Backtest job payload is unavailable.");
      }
      await upsertJob({
        ...job,
        status: "running_background",
        startedAt: nowIso(),
        progress: {
          ...(job.progress || {}),
          stage: "preparing",
          detail: job.jobType === "optimizer"
            ? "Preparing optimizer shortlist."
            : "Preparing background backtest.",
          heartbeatAt: nowIso(),
        },
      });
      if (job.jobType === "optimizer") {
        const optimizerPayload = runtimePayload || {};
        const basePayload = clone(optimizerPayload.basePayload || {});
        const dteCandidates = Array.isArray(optimizerPayload.dteCandidates) ? optimizerPayload.dteCandidates : [];
        const exitCandidates = Array.isArray(optimizerPayload.exitCandidates) ? optimizerPayload.exitCandidates : [];
        const results = [];
        const totalRuns = Math.max(1, dteCandidates.length * exitCandidates.length);
        let processedRuns = 0;

        for (const nextDte of dteCandidates) {
          for (const exitPreset of exitCandidates) {
            if (cancelRequestedJobIds.has(jobId)) {
              break;
            }
            const result = await runMassiveOptionReplayBacktest({
              ...basePayload,
              dte: Number(nextDte) || basePayload.dte,
              slPct: Number.isFinite(Number(exitPreset?.sl)) ? Number(exitPreset.sl) : basePayload.slPct,
              tpPct: Number.isFinite(Number(exitPreset?.tp)) ? Number(exitPreset.tp) : basePayload.tpPct,
              trailStartPct: Number.isFinite(Number(exitPreset?.ts)) ? Number(exitPreset.ts) : basePayload.trailStartPct,
              trailPct: Number.isFinite(Number(exitPreset?.tr)) ? Number(exitPreset.tr) : basePayload.trailPct,
            }, {
              apiKey,
              timeoutMs: 180000,
            });
            processedRuns += 1;
            const metrics = result?.metrics || {};
            if ((Number(metrics.n) || 0) >= 5) {
              results.push(normalizeOptimizerResult({
                id: `${job.jobId}-${nextDte}-${String(exitPreset?.key || "exit")}`,
                strategy: basePayload.strategy,
                dte: nextDte,
                exit: exitPreset?.key || "exit",
                sl: exitPreset?.sl,
                tp: exitPreset?.tp,
                trailStartPct: exitPreset?.ts,
                trailPct: exitPreset?.tr,
                regime: basePayload.regimeFilter || "all",
                bundleEvaluation: result?.bundleEvaluation || null,
                ...metrics,
                score: computeOptimizerScore(metrics),
              }));
            }
            const currentState = getState();
            const currentJob = (currentState.jobs || []).find((row) => row.jobId === jobId);
            if (!currentJob) {
              continue;
            }
            if (cancelRequestedJobIds.has(jobId) || currentJob.status === "cancel_requested") {
              continue;
            }
            await upsertJob({
              ...currentJob,
              status: "running_background",
              progress: {
                stage: "running_runtime",
                detail: `Evaluated ${processedRuns}/${totalRuns} optimizer variants.`,
                counts: {
                  processed: processedRuns,
                  candidates: totalRuns,
                  resolved: results.length,
                  skipped: Math.max(0, processedRuns - results.length),
                  uniqueContracts: 0,
                  inFlight: 0,
                },
                heartbeatAt: nowIso(),
              },
              optimizerResult: {
                results: results.slice(0, 10),
                candidateCount: results.length,
                bestCandidateId: results[0]?.id || null,
              },
            });
          }
          if (cancelRequestedJobIds.has(jobId)) {
            break;
          }
        }

        if (cancelRequestedJobIds.has(jobId)) {
          const currentState = getState();
          const currentJob = (currentState.jobs || []).find((row) => row.jobId === jobId) || job;
          await upsertJob({
            ...currentJob,
            status: "cancelled",
            finishedAt: nowIso(),
            error: null,
            progress: {
              ...(currentJob.progress || {}),
              stage: "cancelled",
              detail: "Optimizer run cancelled.",
              heartbeatAt: nowIso(),
            },
          });
          return;
        }

        const currentState = getState();
        const currentJob = (currentState.jobs || []).find((row) => row.jobId === jobId) || job;
        const optimizerResult = buildOptimizerSummary(results, {
          jobId,
          createdAt: Date.parse(currentJob.createdAt || "") || Date.now(),
          marketSymbol: currentJob.marketSymbol,
          setupSnapshot: currentJob.setupSnapshot,
          selectedBundle: currentJob.resultMeta?.selectedBundle || null,
          isCustom: currentJob.resultMeta?.isCustom,
        });
        await upsertJob({
          ...currentJob,
          status: "completed",
          finishedAt: nowIso(),
          optimizerResult,
          progress: {
            stage: "completed",
            detail: optimizerResult.candidateCount
              ? `Completed ${optimizerResult.candidateCount} optimizer candidates.`
              : "Completed optimizer shortlist with no qualifying candidates.",
            counts: {
              processed: processedRuns,
              candidates: totalRuns,
              resolved: optimizerResult.candidateCount,
              skipped: Math.max(0, processedRuns - optimizerResult.candidateCount),
              uniqueContracts: 0,
              inFlight: 0,
            },
            heartbeatAt: nowIso(),
          },
        });
      } else {
        const replayRun = await streamMassiveOptionReplayBacktest(runtimePayload, {
          apiKey,
          timeoutMs: 180000,
          isCancelled: () => cancelRequestedJobIds.has(jobId),
          onEvent(event) {
            const currentState = getState();
            const currentJob = (currentState.jobs || []).find((row) => row.jobId === jobId);
            if (!currentJob) {
              return;
            }
            if (cancelRequestedJobIds.has(jobId) || currentJob.status === "cancel_requested") {
              return;
            }
            if (event?.type === "status") {
              upsertJob({
                ...currentJob,
                status: "running_background",
                progress: {
                  stage: event.stage || "running",
                  detail: event.detail || null,
                  counts: normalizeCounts(event.counts),
                  heartbeatAt: nowIso(),
                },
              }).catch(() => {});
              lastProgressPersistAt = Date.now();
              return;
            }
            if (event?.type === "progress") {
              const nowMs = Date.now();
              const nextJob = {
                ...currentJob,
                status: "running_background",
                progress: {
                  stage: "running_runtime",
                  detail: event.progress?.currentDate
                    ? `Scanning ${event.progress.currentDate}`
                    : "Running runtime replay.",
                  counts: normalizeCounts(event.replayDatasetSummary),
                  heartbeatAt: nowIso(),
                  tradeCount: Number(event.progress?.tradeCount) || 0,
                  winCount: Number(event.progress?.winCount) || 0,
                  capital: Number.isFinite(Number(event.progress?.capital)) ? Number(event.progress.capital) : null,
                },
              };
              if (nowMs - lastProgressPersistAt >= JOB_PERSIST_PROGRESS_INTERVAL_MS) {
                upsertJob(nextJob).catch(() => {});
                lastProgressPersistAt = nowMs;
              } else {
                upsertJob(nextJob, { persist: false }).catch(() => {});
              }
            }
          },
        });

        if (!replayRun && cancelRequestedJobIds.has(jobId)) {
          const currentState = getState();
          const currentJob = (currentState.jobs || []).find((row) => row.jobId === jobId) || job;
          await upsertJob({
            ...currentJob,
            status: "cancelled",
            finishedAt: nowIso(),
            error: null,
            progress: {
              ...(currentJob.progress || {}),
              stage: "cancelled",
              detail: "Background backtest cancelled.",
              heartbeatAt: nowIso(),
            },
          });
          return;
        }

        const currentState = getState();
        const currentJob = (currentState.jobs || []).find((row) => row.jobId === jobId) || job;
        const resultRecord = await upsertResult(buildResultRecord({
          resultId: crypto.randomUUID(),
          jobId,
          mode: "background",
          draftSignature: currentJob.draftSignature,
          setupSnapshot: currentJob.setupSnapshot,
          result: replayRun,
          resultMeta: currentJob.resultMeta || {},
        }));
        await upsertJob({
          ...currentJob,
          status: "completed",
          finishedAt: nowIso(),
          resultId: resultRecord.resultId,
          metricsPreview: resultRecord.metricsPreview,
          progress: {
            stage: "completed",
            detail: `Completed ${resultRecord.tradeCount || 0} trades.`,
            counts: normalizeCounts(resultRecord?.replayMeta?.replayDatasetSummary),
            heartbeatAt: nowIso(),
          },
        });
      }
    } catch (error) {
      const currentState = getState();
      const currentJob = (currentState.jobs || []).find((row) => row.jobId === jobId);
      if (currentJob) {
        if (cancelRequestedJobIds.has(jobId)) {
          await upsertJob({
            ...currentJob,
            status: "cancelled",
            error: null,
            finishedAt: nowIso(),
            progress: {
              ...(currentJob.progress || {}),
              stage: "cancelled",
              detail: "Background backtest cancelled.",
              heartbeatAt: nowIso(),
            },
          });
          return;
        }
        await upsertJob({
          ...currentJob,
          status: "failed",
          error: error?.message || "Background backtest failed.",
          finishedAt: nowIso(),
          progress: {
            ...(currentJob.progress || {}),
            stage: "failed",
            detail: error?.message || "Background backtest failed.",
            heartbeatAt: nowIso(),
          },
        });
      }
    } finally {
      activeJobs.delete(jobId);
      jobPayloads.delete(jobId);
      cancelRequestedJobIds.delete(jobId);
    }
  }

  async function bookmarkResult(resultId) {
    const state = getState();
    const currentResult = (state.results || []).find((row) => row.resultId === resultId);
    if (!currentResult) {
      return null;
    }
    return upsertResult({
      ...currentResult,
      bookmarkedAt: nowIso(),
    });
  }

  return {
    init: markInterruptedJobs,
    sweepExpiredJobs,
    getState: () => clone(getState()),
    listJobs: ({ jobType = null } = {}) => clone(getState().jobs || [])
      .filter((job) => !jobType || job.jobType === jobType)
      .map(summarizeJob),
    getJob(jobId) {
      const job = (getState().jobs || []).find((row) => row.jobId === jobId);
      return job ? summarizeJob(job) : null;
    },
    getResult(resultId) {
      const result = (getState().results || []).find((row) => row.resultId === resultId);
      return result ? clone(result) : null;
    },
    getLatestActiveJob(jobType = null) {
      const active = (getState().jobs || []).find((row) => (
        ["queued", "running_background", "running_interactive", "cancel_requested"].includes(String(row?.status || ""))
        && (!jobType || row.jobType === jobType)
      ));
      return active ? summarizeJob(active) : null;
    },
    getLatestResult() {
      const latest = (getState().results || []).find((result) => result?.type === "backtest_run") || null;
      return latest ? summarizeResultRecord(latest) : null;
    },
    listResults({ limit = 12 } = {}) {
      return (getState().results || [])
        .filter((result) => result?.type === "backtest_run")
        .map(summarizeResultRecord)
        .filter(Boolean)
        .slice(0, Math.max(1, Number(limit) || 12));
    },
    subscribeJob,
    createJob,
    cancelJob,
    persistInteractiveResult,
    bookmarkResult,
  };
}
