import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { Pool } from "pg";

import {
  getRayAlgoScoreStudyPresetDefinition,
  inferRayAlgoScoreStudyPresetId,
  RAYALGO_SCORE_STUDY_PRESET_TRANCHE2_2M,
  RAYALGO_SCORE_STUDY_PRESET_TRANCHE3_HARD_GATED,
  RAYALGO_SCORE_STUDY_PRESET_TRANCHE3_SPLIT_FLOOR,
} from "../../src/research/analysis/rayalgoScoreStudyPresets.js";

const RUNS_TABLE = "research_score_study_runs";
const JOBS_TABLE = "research_score_study_jobs";
const REQUIRED_DB_ERROR = "Score Testing requires Postgres. Set BACKTEST_DATABASE_URL or DATABASE_URL to enable the workbench.";
const LOCAL_ARTIFACT_DIR = path.join(process.cwd(), "output", "rayalgo-score-study");
const WORKER_LOOP_MS = 2500;
const JOB_HEARTBEAT_INTERVAL_MS = 30 * 1000;
const JOB_QUEUE_STALE_MS = 10 * 60_000;
const JOB_HEARTBEAT_STALE_MS = 5 * 60_000;
const JOB_MAX_RUNTIME_MS = 90 * 60_000;
const DEFAULT_LIST_LIMIT = 40;
const SCORE_STUDY_WORKER_URL = new URL("./researchScoreStudyWorker.js", import.meta.url);
const SCORE_STUDY_RUN_LIST_SELECT_SQL = `
  run_id,
  source,
  symbol,
  preset_id,
  preset_label,
  execution_profile,
  scoring_version,
  requested_timeframes,
  requested_context_timeframes,
  study_mode,
  validity_status,
  validity_reason,
  summary,
  provenance,
  created_at,
  completed_at,
  imported_at,
  updated_at,
  (result_payload IS NOT NULL) AS has_payload
`;
const SCORE_STUDY_JOB_READ_SELECT_SQL = `
  job_id,
  status,
  symbol,
  preset_id,
  preset_label,
  requested_timeframes,
  requested_context_timeframes,
  progress,
  run_id,
  error,
  created_at,
  started_at,
  finished_at,
  heartbeat_at,
  updated_at
`;

const SEEDED_LOCAL_ARTIFACTS = Object.freeze({
  "score-study-SPY-2026-04-01T00-55-52-184Z.json": Object.freeze({
    presetId: RAYALGO_SCORE_STUDY_PRESET_TRANCHE2_2M,
    validityStatus: "valid",
    validityReason: null,
  }),
  "score-study-SPY-2026-04-01T01-02-45-621Z.json": Object.freeze({
    presetId: RAYALGO_SCORE_STUDY_PRESET_TRANCHE3_HARD_GATED,
    validityStatus: "valid",
    validityReason: null,
  }),
  "score-study-SPY-2026-04-01T18-40-42-047Z.json": Object.freeze({
    presetId: RAYALGO_SCORE_STUDY_PRESET_TRANCHE3_SPLIT_FLOOR,
    validityStatus: "valid",
    validityReason: null,
  }),
  "score-study-SPY-2026-04-01T18-32-05-468Z.json": Object.freeze({
    presetId: RAYALGO_SCORE_STUDY_PRESET_TRANCHE3_SPLIT_FLOOR,
    validityStatus: "invalid",
    validityReason: "Generated before the null-floor normalization fix; split-floor comparisons from this artifact are invalid.",
  }),
});

let pool = null;
let initPromise = null;
let seedPromise = null;

function nowIso() {
  return new Date().toISOString();
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

function normalizeSymbol(value) {
  return String(value || "SPY").trim().toUpperCase() || "SPY";
}

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeArray(value = []) {
  return Array.isArray(value) ? value.filter(Boolean).map((entry) => String(entry).trim()).filter(Boolean) : [];
}

function toFiniteNumber(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string" && !value.trim()) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeNumber(value, digits = 3) {
  const numeric = toFiniteNumber(value);
  return numeric == null ? null : +numeric.toFixed(digits);
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const numeric = toFiniteNumber(value);
    if (numeric != null) {
      return numeric;
    }
  }
  return null;
}

function parseTimeMs(value) {
  const timeMs = Date.parse(String(value || ""));
  return Number.isFinite(timeMs) ? timeMs : null;
}

function toIsoOrNull(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function normalizeErrorMessage(error, fallback = "Score-study worker failed.") {
  const message = String(error?.message || error || "").trim();
  return message || fallback;
}

export function isActiveJobStatus(status) {
  return ["queued", "running_background", "cancel_requested"].includes(String(status || ""));
}

function isTerminalJobStatus(status) {
  return ["completed", "failed", "cancelled"].includes(String(status || ""));
}

export function buildScoreStudyCancelledError(message = "Score-study job cancelled.") {
  const error = new Error(message);
  error.code = "SCORE_STUDY_CANCELLED";
  return error;
}

export function isScoreStudyCancelledError(error) {
  return error?.code === "SCORE_STUDY_CANCELLED";
}

function buildRequiredDbError() {
  const error = new Error(REQUIRED_DB_ERROR);
  error.statusCode = 503;
  return error;
}

function resolvePgConfig() {
  const connectionString = [
    process.env.BACKTEST_DATABASE_URL,
    process.env.DATABASE_URL,
    process.env.MASSIVE_DB_URL,
  ].find((value) => String(value || "").trim());

  if (!connectionString) {
    return null;
  }

  return {
    connectionString,
    application_name: "rayalgo-score-study",
    ssl: process.env.PGSSLMODE === "disable" ? false : undefined,
  };
}

function scoreStudyDbConfigured() {
  return Boolean(resolvePgConfig());
}

async function getPoolIfConfigured() {
  const config = resolvePgConfig();
  if (!config) {
    return null;
  }
  if (!pool) {
    pool = new Pool(config);
    pool.on("error", (error) => {
      console.error("[research-score-study] PostgreSQL pool error:", error?.message || error);
    });
  }
  return pool;
}

async function ensureSchema(client) {
  if (initPromise) {
    return initPromise;
  }

  initPromise = client.query(`
    CREATE TABLE IF NOT EXISTS ${RUNS_TABLE} (
      run_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      symbol TEXT NOT NULL,
      preset_id TEXT NOT NULL,
      preset_label TEXT,
      execution_profile TEXT,
      scoring_version TEXT,
      requested_timeframes JSONB NOT NULL DEFAULT '[]'::jsonb,
      requested_context_timeframes JSONB NOT NULL DEFAULT '[]'::jsonb,
      study_mode TEXT,
      validity_status TEXT NOT NULL DEFAULT 'valid',
      validity_reason TEXT,
      summary JSONB NOT NULL,
      result_payload JSONB NOT NULL,
      provenance_key TEXT,
      provenance JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_${RUNS_TABLE}_provenance_key
      ON ${RUNS_TABLE} (provenance_key)
      WHERE provenance_key IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_${RUNS_TABLE}_completed_at
      ON ${RUNS_TABLE} (completed_at DESC NULLS LAST, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_${RUNS_TABLE}_symbol_preset
      ON ${RUNS_TABLE} (symbol, preset_id, completed_at DESC NULLS LAST);

    CREATE TABLE IF NOT EXISTS ${JOBS_TABLE} (
      job_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      symbol TEXT NOT NULL,
      preset_id TEXT NOT NULL,
      preset_label TEXT,
      requested_timeframes JSONB NOT NULL DEFAULT '[]'::jsonb,
      requested_context_timeframes JSONB NOT NULL DEFAULT '[]'::jsonb,
      request_payload JSONB NOT NULL,
      progress JSONB,
      run_id TEXT,
      error TEXT,
      claimed_by TEXT,
      heartbeat_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_${JOBS_TABLE}_status_created
      ON ${JOBS_TABLE} (status, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_${JOBS_TABLE}_run_id
      ON ${JOBS_TABLE} (run_id);
  `).catch((error) => {
    initPromise = null;
    throw error;
  });

  return initPromise;
}

async function requireClient() {
  const nextPool = await getPoolIfConfigured();
  if (!nextPool) {
    throw buildRequiredDbError();
  }
  await ensureSchema(nextPool);
  return nextPool;
}

function summarizeDirection(directionSummary = null) {
  const summary = directionSummary?.overallSummary || {};
  const predictedScore = directionSummary?.predictedScoreSummary || {};
  const validatedOutcome = directionSummary?.validatedOutcomeSummary || {};
  const rankValidity = directionSummary?.rankValiditySummary || {};
  return {
    totalSignals: Number(summary.totalSignals) || 0,
    predictedScoreType: normalizeText(predictedScore.preferredScoreType || summary.preferredScoreType) || null,
    meanRawScore: normalizeNumber(firstFiniteNumber(predictedScore.meanRawScore, summary.headlineMeanPredictedRawScore), 3),
    meanFinalScore: normalizeNumber(firstFiniteNumber(predictedScore.meanFinalScore, summary.headlineMeanPredictedFinalScore), 3),
    meanEffectiveScore: normalizeNumber(firstFiniteNumber(predictedScore.meanEffectiveScore, summary.headlineMeanPredictedEffectiveScore), 3),
    validatedQualityScore: normalizeNumber(firstFiniteNumber(
      validatedOutcome.validatedQualityScore,
      summary.headlineValidatedQualityScore,
      summary.headlineMeanRealizedQualityScore,
      summary.meanRealizedQualityScore,
    ), 3),
    guidanceRatePct: normalizeNumber(firstFiniteNumber(validatedOutcome.directionCorrectPct, summary.headlineMeanDirectionCorrectPct, summary.headlineGuidanceRatePct), 1),
    meanCloseReturnAtr: normalizeNumber(firstFiniteNumber(validatedOutcome.closeResultAtr, summary.headlineMeanCloseResultAtr, summary.headlineMeanCloseReturnAtr), 3),
    meanExcursionEdgeAtr: normalizeNumber(firstFiniteNumber(validatedOutcome.bestMoveAtr, summary.headlineMeanBestMoveAtr, summary.headlineMeanExcursionEdgeAtr), 3),
    stayedRightPct: normalizeNumber(firstFiniteNumber(validatedOutcome.stayedRightPct, summary.headlineMeanStayedRightPct, summary.headlineMeanTenurePct), 1),
    fewCandleCorrectRatePct: normalizeNumber(summary.headlineFewCandleCorrectRatePct, 1),
    sustainedCorrectRatePct: normalizeNumber(summary.headlineSustainedCorrectRatePct, 1),
    majorityCorrectRatePct: normalizeNumber(summary.headlineMajorityCorrectRatePct, 1),
    meanTenurePct: normalizeNumber(summary.headlineMeanTenurePct, 1),
    preferredScoreType: normalizeText(summary.preferredScoreType || predictedScore.preferredScoreType) || null,
    renderFloorScore: normalizeNumber(summary.renderFloorScore, 2),
    renderAction: normalizeText(summary.renderAction) || null,
    rankValidity: {
      status: normalizeText(rankValidity.status) || null,
      verdict: normalizeText(rankValidity.verdict) || null,
      headline: normalizeText(rankValidity.headline) || null,
      orderReliabilityPct: normalizeNumber(rankValidity.orderReliabilityPct, 1),
      topBottomValidatedQualityLift: normalizeNumber(rankValidity.topBottomValidatedQualityLift, 3),
      topBottomBestMoveLiftAtr: normalizeNumber(rankValidity.topBottomBestMoveLiftAtr, 3),
      topBottomCloseLiftAtr: normalizeNumber(rankValidity.topBottomCloseLiftAtr, 3),
      topBottomDirectionCorrectLiftPct: normalizeNumber(rankValidity.topBottomDirectionCorrectLiftPct, 1),
      topBottomStayedRightLiftPct: normalizeNumber(rankValidity.topBottomStayedRightLiftPct, 1),
      evaluatedTimeframeCount: Number(rankValidity.evaluatedTimeframeCount) || 0,
      workingTimeframeCount: Number(rankValidity.workingTimeframeCount) || 0,
      stabilityPct: normalizeNumber(rankValidity.stabilityPct, 1),
    },
  };
}

function summarizeCoverageTier(tier = null) {
  if (!tier || typeof tier !== "object") {
    return null;
  }
  return {
    key: normalizeText(tier.key) || null,
    label: normalizeText(tier.label) || null,
    count: Number(tier.count) || 0,
    coveragePct: normalizeNumber(tier.coveragePct, 1),
    thresholdScore: normalizeNumber(tier.thresholdScore, 3),
    meanPredictedScore: normalizeNumber(tier.meanPredictedScore, 3),
    meanRealizedQualityScore: normalizeNumber(tier.meanRealizedQualityScore, 3),
    guidance3xRatePct: normalizeNumber(tier.guidance3xRatePct, 1),
    guidance6xRatePct: normalizeNumber(tier.guidance6xRatePct, 1),
    fewCandleCorrectRatePct: normalizeNumber(tier.fewCandleCorrectRatePct, 1),
    sustainedCorrectRatePct: normalizeNumber(tier.sustainedCorrectRatePct, 1),
    meanExcursionEdgeAtr3x: normalizeNumber(tier.meanExcursionEdgeAtr3x, 3),
    meanExcursionEdgeAtr6x: normalizeNumber(tier.meanExcursionEdgeAtr6x, 3),
    meanFewCandleQualityScore: normalizeNumber(tier.meanFewCandleQualityScore, 3),
  };
}

function summarizeDirectionFrontier(directionSummary = null) {
  const tiers = Array.isArray(directionSummary?.precisionCoverageFrontier?.tiers)
    ? directionSummary.precisionCoverageFrontier.tiers
    : [];
  return Object.fromEntries(
    tiers
      .map((tier) => summarizeCoverageTier(tier))
      .filter((tier) => tier?.key)
      .map((tier) => [tier.key, tier]),
  );
}

function extractResultPayload(payload = null) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const candidate = payload.result && typeof payload.result === "object" ? payload.result : payload;
  return candidate && typeof candidate === "object" ? candidate : null;
}

function buildScoreStudySummary(payload = null) {
  const artifact = payload && typeof payload === "object" ? payload : {};
  const result = extractResultPayload(artifact);
  const metadata = result?.metadata || {};
  const scoringPreview = metadata.scoringConfigPreview || {};
  const presetId = inferRayAlgoScoreStudyPresetId({
    scoringVersion: scoringPreview.scoringVersion || artifact?.scoringPreferences?.scoringVersion,
    executionProfile: scoringPreview.executionProfile || artifact?.scoringPreferences?.executionProfile,
  });

  return {
    marketSymbol: normalizeSymbol(metadata.marketSymbol || artifact.symbol),
    scoringVersion: normalizeText(scoringPreview.scoringVersion || artifact?.scoringPreferences?.scoringVersion) || null,
    executionProfile: normalizeText(scoringPreview.executionProfile || artifact?.scoringPreferences?.executionProfile) || null,
    defaultStudyMode: normalizeText(metadata.defaultStudyMode || artifact.studyMode || "forward"),
    requestedTimeframes: normalizeArray(
      artifact.requestedTimeframes
      || metadata.requestedTimeframes
      || metadata.analyzedTimeframes,
    ),
    requestedContextTimeframes: normalizeArray(
      artifact.requestedContextTimeframes
      || artifact?.scoringPreferences?.precursorFrames
      || scoringPreview.precursorFrames,
    ),
    analyzedTimeframes: normalizeArray(metadata.analyzedTimeframes),
    skippedTimeframes: normalizeArray(metadata.skippedTimeframes),
    signalCount: Number(metadata.signalCount) || 0,
    barCount: Number(metadata.barCount) || 0,
    sourceBarMinutes: Number(metadata.sourceBarMinutes) || null,
    barStartTs: normalizeText(metadata.barStartTs) || null,
    barEndTs: normalizeText(metadata.barEndTs) || null,
    presetId,
    validatedQualityDefinition: metadata?.validatedQualityDefinition && typeof metadata.validatedQualityDefinition === "object"
      ? metadata.validatedQualityDefinition
      : null,
    directions: {
      combined: {
        ...summarizeDirection(result?.directionSummaries?.combined || result),
        frontierTiers: summarizeDirectionFrontier(result?.directionSummaries?.combined || result),
      },
      long: {
        ...summarizeDirection(result?.directionSummaries?.long),
        frontierTiers: summarizeDirectionFrontier(result?.directionSummaries?.long),
      },
      short: {
        ...summarizeDirection(result?.directionSummaries?.short),
        frontierTiers: summarizeDirectionFrontier(result?.directionSummaries?.short),
      },
    },
  };
}

export function serializeRunRow(row = {}, { includePayload = false } = {}) {
  const storedSummary = row?.summary && typeof row.summary === "object" ? row.summary : {};
  const storedCombinedSummary = storedSummary?.directions?.combined || null;
  const hasOperatorSummary = storedCombinedSummary && (
    storedCombinedSummary.validatedQualityScore != null
    || storedCombinedSummary.meanExcursionEdgeAtr != null
    || storedCombinedSummary.meanCloseReturnAtr != null
    || storedCombinedSummary.guidanceRatePct != null
  );
  const artifact = row?.result_payload && typeof row.result_payload === "object" ? row.result_payload : null;
  const summary = storedCombinedSummary?.frontierTiers && hasOperatorSummary
    ? storedSummary
    : (artifact ? buildScoreStudySummary(artifact) : storedSummary);
  const provenance = row?.provenance && typeof row.provenance === "object" ? row.provenance : null;
  const response = {
    runId: row.run_id,
    source: row.source,
    symbol: row.symbol,
    presetId: row.preset_id,
    presetLabel: row.preset_label || getRayAlgoScoreStudyPresetDefinition(row.preset_id).label,
    executionProfile: row.execution_profile || summary.executionProfile || null,
    scoringVersion: row.scoring_version || summary.scoringVersion || null,
    requestedTimeframes: normalizeArray(row.requested_timeframes || summary.requestedTimeframes),
    requestedContextTimeframes: normalizeArray(row.requested_context_timeframes || summary.requestedContextTimeframes),
    studyMode: row.study_mode || summary.defaultStudyMode || "forward",
    validityStatus: row.validity_status || "valid",
    validityReason: row.validity_reason || null,
    summary,
    provenance,
    createdAt: toIsoOrNull(row.created_at),
    completedAt: toIsoOrNull(row.completed_at || row.created_at),
    importedAt: toIsoOrNull(row.imported_at),
    updatedAt: toIsoOrNull(row.updated_at),
    hasPayload: Boolean(
      row.has_payload != null
        ? row.has_payload
        : row.result_payload,
    ),
  };

  if (includePayload) {
    response.artifact = artifact;
    response.result = extractResultPayload(artifact);
  }

  return response;
}

export function serializeJobRow(row = {}) {
  return {
    jobId: row.job_id,
    status: row.status,
    symbol: row.symbol,
    presetId: row.preset_id,
    presetLabel: row.preset_label || getRayAlgoScoreStudyPresetDefinition(row.preset_id).label,
    requestedTimeframes: normalizeArray(row.requested_timeframes),
    requestedContextTimeframes: normalizeArray(row.requested_context_timeframes),
    progress: row.progress && typeof row.progress === "object" ? row.progress : null,
    runId: row.run_id || null,
    error: row.error || null,
    createdAt: toIsoOrNull(row.created_at),
    startedAt: toIsoOrNull(row.started_at),
    finishedAt: toIsoOrNull(row.finished_at),
    heartbeatAt: toIsoOrNull(row.heartbeat_at),
    updatedAt: toIsoOrNull(row.updated_at),
    cancelRequested: row.status === "cancel_requested" || Boolean(row?.progress?.cancelRequestedAt),
  };
}

async function loadRunRowById(client, runId) {
  const { rows } = await client.query(
    `SELECT * FROM ${RUNS_TABLE} WHERE run_id = $1 LIMIT 1`,
    [String(runId)],
  );
  return rows[0] || null;
}

async function loadRunRowByProvenanceKey(client, provenanceKey) {
  if (!provenanceKey) {
    return null;
  }
  const { rows } = await client.query(
    `SELECT * FROM ${RUNS_TABLE} WHERE provenance_key = $1 LIMIT 1`,
    [String(provenanceKey)],
  );
  return rows[0] || null;
}

async function loadJobRowById(client, jobId) {
  const { rows } = await client.query(
    `SELECT * FROM ${JOBS_TABLE} WHERE job_id = $1 LIMIT 1`,
    [String(jobId)],
  );
  return rows[0] || null;
}

async function loadJobReadRowById(client, jobId) {
  const { rows } = await client.query(
    `SELECT ${SCORE_STUDY_JOB_READ_SELECT_SQL} FROM ${JOBS_TABLE} WHERE job_id = $1 LIMIT 1`,
    [String(jobId)],
  );
  return rows[0] || null;
}

async function upsertRunRecord(client, {
  runId = null,
  source = "cli_import",
  presetId = null,
  presetLabel = null,
  validityStatus = "valid",
  validityReason = null,
  payload = null,
  provenanceKey = null,
  provenance = null,
  createdAt = null,
  completedAt = null,
} = {}) {
  const artifactPayload = clone(payload || null);
  const result = extractResultPayload(artifactPayload);
  if (!result || result.status !== "ready") {
    throw new Error("Score study payload is missing a ready result.");
  }

  const summary = buildScoreStudySummary(artifactPayload);
  const effectivePresetId = presetId || summary.presetId;
  const effectivePresetLabel = presetLabel || getRayAlgoScoreStudyPresetDefinition(effectivePresetId).label;
  const existing = provenanceKey ? await loadRunRowByProvenanceKey(client, provenanceKey) : null;
  const effectiveRunId = existing?.run_id || String(runId || "").trim() || crypto.randomUUID();
  const effectiveCreatedAt = createdAt || artifactPayload.generatedAt || nowIso();
  const effectiveCompletedAt = completedAt || artifactPayload.generatedAt || nowIso();

  await client.query(
    `
      INSERT INTO ${RUNS_TABLE} (
        run_id,
        source,
        symbol,
        preset_id,
        preset_label,
        execution_profile,
        scoring_version,
        requested_timeframes,
        requested_context_timeframes,
        study_mode,
        validity_status,
        validity_reason,
        summary,
        result_payload,
        provenance_key,
        provenance,
        created_at,
        completed_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8::jsonb, $9::jsonb, $10, $11, $12,
        $13::jsonb, $14::jsonb, $15, $16::jsonb,
        $17::timestamptz, $18::timestamptz, NOW()
      )
      ON CONFLICT (run_id)
      DO UPDATE SET
        source = EXCLUDED.source,
        symbol = EXCLUDED.symbol,
        preset_id = EXCLUDED.preset_id,
        preset_label = EXCLUDED.preset_label,
        execution_profile = EXCLUDED.execution_profile,
        scoring_version = EXCLUDED.scoring_version,
        requested_timeframes = EXCLUDED.requested_timeframes,
        requested_context_timeframes = EXCLUDED.requested_context_timeframes,
        study_mode = EXCLUDED.study_mode,
        validity_status = EXCLUDED.validity_status,
        validity_reason = EXCLUDED.validity_reason,
        summary = EXCLUDED.summary,
        result_payload = EXCLUDED.result_payload,
        provenance_key = EXCLUDED.provenance_key,
        provenance = EXCLUDED.provenance,
        created_at = EXCLUDED.created_at,
        completed_at = EXCLUDED.completed_at,
        updated_at = NOW()
    `,
    [
      effectiveRunId,
      source,
      summary.marketSymbol,
      effectivePresetId,
      effectivePresetLabel,
      summary.executionProfile,
      summary.scoringVersion,
      JSON.stringify(summary.requestedTimeframes || []),
      JSON.stringify(summary.requestedContextTimeframes || []),
      summary.defaultStudyMode,
      validityStatus,
      validityReason,
      JSON.stringify(summary),
      JSON.stringify(artifactPayload),
      provenanceKey || null,
      JSON.stringify(provenance || null),
      effectiveCreatedAt,
      effectiveCompletedAt,
    ],
  );

  return loadRunRowById(client, effectiveRunId);
}

async function markJobFailed(client, row, errorMessage) {
  const finishedAt = nowIso();
  const { rows } = await client.query(
    `
      UPDATE ${JOBS_TABLE}
      SET
        status = 'failed',
        error = $2,
        progress = $3::jsonb,
        finished_at = $4::timestamptz,
        heartbeat_at = $4::timestamptz,
        updated_at = NOW()
      WHERE job_id = $1
      RETURNING *
    `,
    [
      row.job_id,
      errorMessage,
      JSON.stringify({
        stage: "failed",
        detail: errorMessage,
        heartbeatAt: finishedAt,
      }),
      finishedAt,
    ],
  );
  return rows[0] || null;
}

async function markJobCancelled(client, row, detail = "Cancelled by user.") {
  const finishedAt = nowIso();
  const { rows } = await client.query(
    `
      UPDATE ${JOBS_TABLE}
      SET
        status = 'cancelled',
        error = NULL,
        progress = $2::jsonb,
        finished_at = $3::timestamptz,
        heartbeat_at = $3::timestamptz,
        updated_at = NOW()
      WHERE job_id = $1
      RETURNING *
    `,
    [
      row.job_id,
      JSON.stringify({
        ...(row?.progress && typeof row.progress === "object" ? row.progress : {}),
        stage: "cancelled",
        detail,
        pct: 100,
        heartbeatAt: finishedAt,
        cancelRequestedAt: row?.progress?.cancelRequestedAt || finishedAt,
      }),
      finishedAt,
    ],
  );
  return rows[0] || null;
}

async function markJobCancelRequested(client, row, detail = "Cancellation requested. Waiting for the current stage to stop safely.") {
  if (row?.status === "cancel_requested") {
    return row;
  }
  const requestedAt = nowIso();
  const { rows } = await client.query(
    `
      UPDATE ${JOBS_TABLE}
      SET
        status = 'cancel_requested',
        error = NULL,
        progress = $2::jsonb,
        heartbeat_at = $3::timestamptz,
        updated_at = NOW()
      WHERE job_id = $1
      RETURNING *
    `,
    [
      row.job_id,
      JSON.stringify({
        ...(row?.progress && typeof row.progress === "object" ? row.progress : {}),
        stage: "cancel_requested",
        detail,
        heartbeatAt: requestedAt,
        cancelRequestedAt: requestedAt,
      }),
      requestedAt,
    ],
  );
  return rows[0] || null;
}

export function resolveExpiredJobFailureReason(job = {}, { nowMs = Date.now() } = {}) {
  if (!isActiveJobStatus(job?.status)) {
    return null;
  }

  const createdAtMs = parseTimeMs(job?.created_at);
  const startedAtMs = parseTimeMs(job?.started_at);
  const heartbeatAtMs = parseTimeMs(job?.heartbeat_at || job?.progress?.heartbeatAt);

  if (String(job?.status || "") === "queued") {
    if (createdAtMs != null && nowMs - createdAtMs > JOB_QUEUE_STALE_MS) {
      return `Score-study job stalled in queue for more than ${Math.round(JOB_QUEUE_STALE_MS / 60000)} minutes.`;
    }
    return null;
  }

  if (startedAtMs != null && nowMs - startedAtMs > JOB_MAX_RUNTIME_MS) {
    return `Score-study job exceeded max runtime (${Math.round(JOB_MAX_RUNTIME_MS / 60000)} minutes).`;
  }

  if (heartbeatAtMs != null && nowMs - heartbeatAtMs > JOB_HEARTBEAT_STALE_MS) {
    return `Score-study job heartbeat stalled for more than ${Math.round(JOB_HEARTBEAT_STALE_MS / 60000)} minutes.`;
  }

  return null;
}

async function readArtifactFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!extractResultPayload(parsed)) {
    throw new Error("Artifact does not contain a score-study result.");
  }
  return parsed;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildArtifactRelativePath(filePath) {
  return path.relative(process.cwd(), filePath).split(path.sep).join("/");
}

function buildArtifactProvenance(relativePath) {
  return `local-artifact:${relativePath}`;
}

function parseGeneratedAtFromArtifactFileName(fileName = "") {
  const match = String(fileName || "").match(/^score-study-[^-]+-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.json$/);
  if (!match) {
    return null;
  }
  const isoLike = match[1].replace(
    /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)$/,
    "$1:$2:$3.$4",
  );
  const parsed = new Date(isoLike);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function inferSymbolFromArtifactFileName(fileName = "") {
  const match = String(fileName || "").match(/^score-study-([^-]+)-/);
  return match?.[1] ? normalizeSymbol(match[1]) : null;
}

export function shouldKeepScoreStudyWorkerScheduled({
  keepWorkerAliveWhenIdle = true,
  hasActiveJobs = false,
} = {}) {
  return Boolean(keepWorkerAliveWhenIdle || hasActiveJobs);
}

export function createResearchScoreStudyService(options = {}) {
  const workerId = `score-study-worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const jobApiKeys = new Map();
  const cancelRequestedJobIds = new Set();
  const activeWorkers = new Map();
  const jobListenersById = new Map();
  let workerTimer = null;
  let workerInFlight = false;
  const keepWorkerAliveWhenIdle = options?.keepWorkerAliveWhenIdle !== false;

  function publishJobUpdate(row = null) {
    if (!row?.job_id) {
      return;
    }
    const listeners = jobListenersById.get(row.job_id);
    if (!listeners?.size) {
      return;
    }
    const payload = serializeJobRow(row);
    for (const listener of [...listeners]) {
      try {
        listener(payload);
      } catch {
        // Ignore subscriber failures and keep the worker path alive.
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

  async function seedKnownArtifacts() {
    if (seedPromise) {
      return seedPromise;
    }
    seedPromise = (async () => {
      const client = await requireClient();
      for (const [fileName, seeded] of Object.entries(SEEDED_LOCAL_ARTIFACTS)) {
        const absolutePath = path.join(LOCAL_ARTIFACT_DIR, fileName);
        if (!(await fileExists(absolutePath))) {
          continue;
        }
        const relativePath = buildArtifactRelativePath(absolutePath);
        const provenanceKey = buildArtifactProvenance(relativePath);
        const existing = await loadRunRowByProvenanceKey(client, provenanceKey);
        if (existing?.run_id) {
          continue;
        }
        const payload = await readArtifactFile(absolutePath);
        await upsertRunRecord(client, {
          source: "cli_import",
          presetId: seeded.presetId,
          presetLabel: getRayAlgoScoreStudyPresetDefinition(seeded.presetId).label,
          validityStatus: seeded.validityStatus,
          validityReason: seeded.validityReason,
          payload,
          provenanceKey,
          provenance: {
            kind: "local_artifact",
            fileName,
            relativePath,
          },
          createdAt: payload.generatedAt || nowIso(),
          completedAt: payload.generatedAt || nowIso(),
        });
      }
    })().finally(() => {
      seedPromise = null;
    });
    return seedPromise;
  }

  async function listRuns({ limit = DEFAULT_LIST_LIMIT } = {}) {
    const client = await requireClient();
    const maxRows = Math.max(1, Math.min(200, Number(limit) || DEFAULT_LIST_LIMIT));
    const { rows } = await client.query(
      `
        SELECT ${SCORE_STUDY_RUN_LIST_SELECT_SQL}
        FROM ${RUNS_TABLE}
        ORDER BY completed_at DESC NULLS LAST, updated_at DESC
        LIMIT $1
      `,
      [maxRows],
    );
    return rows.map((row) => serializeRunRow(row));
  }

  async function getRun(runId) {
    const client = await requireClient();
    const row = await loadRunRowById(client, runId);
    return row ? serializeRunRow(row, { includePayload: true }) : null;
  }

  async function listJobs({ limit = 18 } = {}) {
    const client = await requireClient();
    const maxRows = Math.max(1, Math.min(100, Number(limit) || 18));
    const { rows } = await client.query(
      `
        SELECT ${SCORE_STUDY_JOB_READ_SELECT_SQL}
        FROM ${JOBS_TABLE}
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [maxRows],
    );
    return rows.map((row) => serializeJobRow(row));
  }

  async function getLatestActiveJob() {
    const client = await requireClient();
    const { rows } = await client.query(
      `
        SELECT ${SCORE_STUDY_JOB_READ_SELECT_SQL}
        FROM ${JOBS_TABLE}
        WHERE status IN ('queued', 'running_background', 'cancel_requested')
        ORDER BY created_at DESC
        LIMIT 1
      `,
    );
    return rows[0] ? serializeJobRow(rows[0]) : null;
  }

  async function getJob(jobId) {
    const client = await requireClient();
    const row = await loadJobReadRowById(client, jobId);
    return row ? serializeJobRow(row) : null;
  }

  async function saveRun({
    source = "local_ui",
    presetId = null,
    presetLabel = null,
    payload,
    validityStatus = "valid",
    validityReason = null,
    provenance = null,
    provenanceKey = null,
  } = {}) {
    const client = await requireClient();
    const row = await upsertRunRecord(client, {
      source,
      presetId,
      presetLabel,
      payload,
      validityStatus,
      validityReason,
      provenance,
      provenanceKey,
      createdAt: payload?.generatedAt || nowIso(),
      completedAt: payload?.generatedAt || nowIso(),
    });
    return serializeRunRow(row, { includePayload: true });
  }

  async function listLocalArtifacts() {
    const client = await requireClient();
    let entries = [];
    try {
      entries = await fs.readdir(LOCAL_ARTIFACT_DIR, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const fileNames = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort()
      .reverse();

    if (!fileNames.length) {
      return [];
    }

    const relativePathByFileName = new Map(
      fileNames.map((fileName) => [
        fileName,
        buildArtifactRelativePath(path.join(LOCAL_ARTIFACT_DIR, fileName)),
      ]),
    );
    const provenanceKeys = fileNames.map((fileName) => buildArtifactProvenance(relativePathByFileName.get(fileName)));
    const { rows } = await client.query(
      `
        SELECT run_id, provenance_key, validity_status, validity_reason, preset_id, preset_label, symbol, summary
        FROM ${RUNS_TABLE}
        WHERE provenance_key = ANY($1::text[])
      `,
      [provenanceKeys],
    );
    const importedByProvenance = new Map(
      rows.map((row) => [
        row.provenance_key,
        {
          runId: row.run_id,
          validityStatus: row.validity_status,
          validityReason: row.validity_reason,
          presetId: row.preset_id,
          presetLabel: row.preset_label,
          symbol: row.symbol,
          summary: row.summary && typeof row.summary === "object" ? row.summary : null,
        },
      ]),
    );

    const artifacts = [];
    for (const fileName of fileNames) {
      const relativePath = relativePathByFileName.get(fileName);
      const seeded = SEEDED_LOCAL_ARTIFACTS[fileName] || null;
      const importedRun = importedByProvenance.get(buildArtifactProvenance(relativePath)) || null;
      const presetId = importedRun?.presetId || seeded?.presetId || null;
      artifacts.push({
        fileName,
        relativePath,
        presetId,
        presetLabel: presetId ? getRayAlgoScoreStudyPresetDefinition(presetId).label : null,
        symbol: importedRun?.symbol || inferSymbolFromArtifactFileName(fileName),
        generatedAt: parseGeneratedAtFromArtifactFileName(fileName),
        validityStatus: importedRun?.validityStatus || seeded?.validityStatus || "imported_unverified",
        validityReason: importedRun?.validityReason || seeded?.validityReason || null,
        importedRunId: importedRun?.runId || null,
        imported: Boolean(importedRun?.runId),
        summary: importedRun?.summary || null,
      });
    }

    return artifacts;
  }

  async function importLocalArtifact({ relativePath = null, fileName = null } = {}) {
    const resolvedRelativePath = normalizeText(relativePath)
      || (normalizeText(fileName) ? path.posix.join("output", "rayalgo-score-study", normalizeText(fileName)) : "");
    if (!resolvedRelativePath) {
      throw new Error("Artifact path is required.");
    }

    const absolutePath = path.join(process.cwd(), resolvedRelativePath);
    const artifact = await readArtifactFile(absolutePath);
    const normalizedFileName = path.basename(absolutePath);
    const seeded = SEEDED_LOCAL_ARTIFACTS[normalizedFileName] || null;
    return saveRun({
      source: "cli_import",
      presetId: seeded?.presetId || null,
      presetLabel: seeded?.presetId ? getRayAlgoScoreStudyPresetDefinition(seeded.presetId).label : null,
      payload: artifact,
      validityStatus: seeded?.validityStatus || "imported_unverified",
      validityReason: seeded?.validityReason || null,
      provenance: {
        kind: "local_artifact",
        fileName: normalizedFileName,
        relativePath: resolvedRelativePath,
      },
      provenanceKey: buildArtifactProvenance(resolvedRelativePath),
    });
  }

  async function createJob({
    requestPayload = null,
    presetId,
    presetLabel = null,
    symbol = "SPY",
    apiKey = "",
  } = {}) {
    const client = await requireClient();
    const normalizedPresetId = normalizeText(presetId);
    if (!normalizedPresetId) {
      throw new Error("Score-study preset is required.");
    }
    if (!requestPayload || typeof requestPayload !== "object") {
      throw new Error("Score-study request payload is required.");
    }

    const jobId = crypto.randomUUID();
    const createdAt = nowIso();
    const normalizedSymbol = normalizeSymbol(symbol || requestPayload.marketSymbol);
    const requestedTimeframes = normalizeArray(requestPayload.timeframes);
    const requestedContextTimeframes = normalizeArray(requestPayload.requestedContextTimeframes);
    const resolvedPresetLabel = presetLabel || getRayAlgoScoreStudyPresetDefinition(normalizedPresetId).label;
    const safeApiKey = String(apiKey || "").trim();
    if (safeApiKey) {
      jobApiKeys.set(jobId, safeApiKey);
    }

    const { rows } = await client.query(
      `
        INSERT INTO ${JOBS_TABLE} (
          job_id,
          status,
          symbol,
          preset_id,
          preset_label,
          requested_timeframes,
          requested_context_timeframes,
          request_payload,
          progress,
          heartbeat_at,
          created_at,
          updated_at
        ) VALUES (
          $1, 'queued', $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb,
          $9::timestamptz, $9::timestamptz, NOW()
        )
        RETURNING *
      `,
      [
        jobId,
        normalizedSymbol,
        normalizedPresetId,
        resolvedPresetLabel,
        JSON.stringify(requestedTimeframes),
        JSON.stringify(requestedContextTimeframes),
        JSON.stringify(clone(requestPayload)),
        JSON.stringify({
          stage: "queued",
          detail: "Queued full-history score-study run.",
          pct: 2,
          heartbeatAt: createdAt,
        }),
        createdAt,
      ],
    );

    scheduleWorker(50);
    publishJobUpdate(rows[0]);
    return serializeJobRow(rows[0]);
  }

  async function sweepExpiredJobs() {
    if (!scoreStudyDbConfigured()) {
      return false;
    }
    const client = await requireClient();
    const { rows } = await client.query(
      `
        SELECT *
        FROM ${JOBS_TABLE}
        WHERE status IN ('queued', 'running_background', 'cancel_requested')
      `,
    );
    let changed = false;
    for (const row of rows) {
      const reason = resolveExpiredJobFailureReason(row, { nowMs: Date.now() });
      if (!reason) {
        continue;
      }
      if (row.status === "cancel_requested") {
        const cancelledRow = await markJobCancelled(client, row, "Cancelled after the worker stopped responding.");
        publishJobUpdate(cancelledRow);
      } else {
        const failedRow = await markJobFailed(client, row, reason);
        publishJobUpdate(failedRow);
      }
      jobApiKeys.delete(row.job_id);
      cancelRequestedJobIds.delete(row.job_id);
      changed = true;
    }
    return changed;
  }

  async function hasActiveOrQueuedJobs() {
    if (!scoreStudyDbConfigured()) {
      return false;
    }
    const client = await requireClient();
    const { rows } = await client.query(
      `
        SELECT 1
        FROM ${JOBS_TABLE}
        WHERE status IN ('queued', 'running_background', 'cancel_requested')
        LIMIT 1
      `,
    );
    return Boolean(rows[0]);
  }

  async function claimNextQueuedJob() {
    const client = await requireClient();
    const dbClient = await client.connect();
    try {
      await dbClient.query("BEGIN");
      const { rows } = await dbClient.query(
        `
          SELECT *
          FROM ${JOBS_TABLE}
          WHERE status = 'queued'
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `,
      );
      const row = rows[0] || null;
      if (!row) {
        await dbClient.query("COMMIT");
        return null;
      }

      const startedAt = nowIso();
      const { rows: updatedRows } = await dbClient.query(
        `
          UPDATE ${JOBS_TABLE}
          SET
            status = 'running_background',
            claimed_by = $2,
            started_at = COALESCE(started_at, $3::timestamptz),
            heartbeat_at = $3::timestamptz,
            progress = $4::jsonb,
            updated_at = NOW()
          WHERE job_id = $1
          RETURNING *
        `,
        [
          row.job_id,
          workerId,
          startedAt,
          JSON.stringify({
            stage: "hydrating-bars",
            detail: "Loading full-history spot bars for the score study.",
            pct: 12,
            heartbeatAt: startedAt,
          }),
        ],
      );
      await dbClient.query("COMMIT");
      publishJobUpdate(updatedRows[0]);
      return updatedRows[0] || null;
    } catch (error) {
      await dbClient.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      dbClient.release();
    }
  }

  async function updateJob(jobId, patch = {}) {
    const client = await requireClient();
    const current = await loadJobRowById(client, jobId);
    if (!current) {
      return null;
    }
    const next = {
      ...current,
      ...patch,
      progress: patch.progress ?? current.progress,
    };
    const { rows } = await client.query(
      `
        UPDATE ${JOBS_TABLE}
        SET
          status = $2,
          preset_label = $3,
          requested_timeframes = $4::jsonb,
          requested_context_timeframes = $5::jsonb,
          request_payload = $6::jsonb,
          progress = $7::jsonb,
          run_id = $8,
          error = $9,
          claimed_by = $10,
          heartbeat_at = $11::timestamptz,
          started_at = $12::timestamptz,
          finished_at = $13::timestamptz,
          updated_at = NOW()
        WHERE job_id = $1
        RETURNING *
      `,
      [
        jobId,
        next.status,
        next.preset_label,
        JSON.stringify(next.requested_timeframes || []),
        JSON.stringify(next.requested_context_timeframes || []),
        JSON.stringify(next.request_payload || {}),
        JSON.stringify(next.progress || null),
        next.run_id || null,
        next.error || null,
        next.claimed_by || null,
        next.heartbeat_at || null,
        next.started_at || null,
        next.finished_at || null,
      ],
    );
    publishJobUpdate(rows[0] || null);
    return rows[0] || null;
  }

  async function writeJobProgress(jobId, progressPatch = {}, patch = {}) {
    const client = await requireClient();
    const current = await loadJobRowById(client, jobId);
    if (!current || isTerminalJobStatus(current.status)) {
      return current || null;
    }
    const currentPct = Number.isFinite(Number(current?.progress?.pct))
      ? Number(current.progress.pct)
      : null;
    const requestedPct = Number.isFinite(Number(progressPatch?.pct))
      ? Number(progressPatch.pct)
      : null;
    const heartbeatAt = nowIso();
    const progress = {
      ...(current?.progress && typeof current.progress === "object" ? current.progress : {}),
      ...(progressPatch && typeof progressPatch === "object" ? progressPatch : {}),
      pct: requestedPct == null
        ? currentPct
        : (currentPct == null ? requestedPct : Math.max(currentPct, requestedPct)),
      heartbeatAt,
    };
    return updateJob(jobId, {
      ...patch,
      progress,
      heartbeat_at: heartbeatAt,
    });
  }

  async function ensureJobNotCancelled(jobId) {
    const normalizedJobId = String(jobId || "");
    if (cancelRequestedJobIds.has(normalizedJobId)) {
      throw buildScoreStudyCancelledError();
    }
    const client = await requireClient();
    const row = await loadJobRowById(client, normalizedJobId);
    if (!row) {
      throw new Error("Score-study job not found.");
    }
    if (row.status === "cancel_requested" || row.status === "cancelled") {
      cancelRequestedJobIds.add(normalizedJobId);
      throw buildScoreStudyCancelledError();
    }
    return row;
  }

  async function cancelJob(jobId) {
    const client = await requireClient();
    const row = await loadJobRowById(client, jobId);
    if (!row) {
      return null;
    }
    if (isTerminalJobStatus(row.status)) {
      cancelRequestedJobIds.delete(row.job_id);
      jobApiKeys.delete(row.job_id);
      return serializeJobRow(row);
    }

    cancelRequestedJobIds.add(row.job_id);
    const activeWorker = activeWorkers.get(row.job_id);
    if (row.status === "cancel_requested" && !activeWorker) {
      const cancelled = await markJobCancelled(client, row, "Cancelled after the active worker stopped.");
      cancelRequestedJobIds.delete(row.job_id);
      jobApiKeys.delete(row.job_id);
      publishJobUpdate(cancelled);
      return cancelled ? serializeJobRow(cancelled) : null;
    }
    if (row.status === "queued") {
      const cancelled = await markJobCancelled(client, row, "Cancelled before the worker started.");
      cancelRequestedJobIds.delete(row.job_id);
      jobApiKeys.delete(row.job_id);
      publishJobUpdate(cancelled);
      return cancelled ? serializeJobRow(cancelled) : null;
    }

    const requested = await markJobCancelRequested(client, row);
    if (activeWorker) {
      activeWorker.terminate().catch(() => {});
    } else if (row.claimed_by === workerId) {
      const cancelled = await markJobCancelled(client, requested || row, "Cancelled after the active worker stopped.");
      cancelRequestedJobIds.delete(row.job_id);
      jobApiKeys.delete(row.job_id);
      publishJobUpdate(cancelled);
      return cancelled ? serializeJobRow(cancelled) : null;
    }
    publishJobUpdate(requested);
    return requested ? serializeJobRow(requested) : null;
  }

  async function runScoreStudyWorkerTask({
    jobId,
    marketSymbol = "SPY",
    requestPayload = null,
    apiKey = "",
    onProgress = null,
  } = {}) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(SCORE_STUDY_WORKER_URL, {
        workerData: {
          marketSymbol,
          requestPayload,
          apiKey,
        },
      });
      activeWorkers.set(jobId, worker);
      let settled = false;

      const finalize = (fn) => (value) => {
        if (settled) {
          return;
        }
        settled = true;
        activeWorkers.delete(jobId);
        fn(value);
      };

      worker.on("message", (message = null) => {
        if (!message || typeof message !== "object") {
          return;
        }
        if (message.type === "progress") {
          onProgress?.(message.progress && typeof message.progress === "object" ? message.progress : {});
          return;
        }
        if (message.type === "result") {
          finalize(resolve)(message.result || null);
          return;
        }
        if (message.type === "error") {
          finalize(reject)(new Error(normalizeErrorMessage(message.error)));
        }
      });
      worker.once("error", finalize(reject));
      worker.once("exit", (code) => {
        activeWorkers.delete(jobId);
        if (settled) {
          return;
        }
        settled = true;
        if (cancelRequestedJobIds.has(jobId)) {
          reject(buildScoreStudyCancelledError());
          return;
        }
        if (code !== 0) {
          reject(new Error(`Score-study worker exited with code ${code}.`));
          return;
        }
        reject(new Error("Score-study worker exited before returning a result."));
      });
    });
  }

  async function processClaimedJob(job) {
    const requestPayload = job?.request_payload && typeof job.request_payload === "object"
      ? clone(job.request_payload)
      : null;
    if (!requestPayload) {
      throw new Error("Score-study job payload is unavailable.");
    }

    await ensureJobNotCancelled(job.job_id);
    const apiKey = jobApiKeys.get(job.job_id) || process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || "";

    let progressWriteChain = Promise.resolve();
    const enqueueProgressWrite = (progressPatch = {}, patch = {}) => {
      progressWriteChain = progressWriteChain
        .catch(() => {})
        .then(() => writeJobProgress(job.job_id, {
          ...(progressPatch && typeof progressPatch === "object" ? progressPatch : {}),
        }, patch))
        .catch(() => {});
      return progressWriteChain;
    };
    const heartbeatTimer = setInterval(() => {
      enqueueProgressWrite({});
    }, JOB_HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();

    try {
      const workerResult = await runScoreStudyWorkerTask({
        jobId: job.job_id,
        marketSymbol: requestPayload.marketSymbol || job.symbol,
        requestPayload,
        apiKey,
        onProgress: (progress = {}) => {
          enqueueProgressWrite(progress);
        },
      });
      await progressWriteChain;
      await ensureJobNotCancelled(job.job_id);
      const result = workerResult?.scoreStudy || null;
      const history = workerResult?.history || null;
      if (result?.status === "error") {
        throw new Error(result.error || "Failed to build score-study result.");
      }
      const barCount = Number(history?.barCount) || 0;

      await enqueueProgressWrite({
        stage: "persisting-run",
        detail: "Persisting the completed score-study run.",
        pct: 99,
        signalCount: Number(result?.metadata?.signalCount) || 0,
        ...(barCount > 0 ? { barCount } : {}),
      });
      await progressWriteChain;
      await ensureJobNotCancelled(job.job_id);

      const artifactPayload = {
        generatedAt: nowIso(),
        symbol: normalizeSymbol(requestPayload.marketSymbol || job.symbol),
        initialDays: requestPayload.initialDays || 60,
        mode: requestPayload.mode || "full",
        preferredTf: requestPayload.preferredTf || "1m",
        studyMode: result?.metadata?.defaultStudyMode || "forward",
        requestedTimeframes: normalizeArray(requestPayload.timeframes),
        scoringPreferences: clone(requestPayload.rayalgoScoringConfig || null),
        requestedContextTimeframes: normalizeArray(requestPayload.requestedContextTimeframes),
        dataSource: history?.dataSource || null,
        spotMeta: clone(history?.meta || null),
        result,
      };

      const client = await requireClient();
      const runRow = await upsertRunRecord(client, {
        source: "server_job",
        presetId: job.preset_id,
        presetLabel: job.preset_label,
        validityStatus: "valid",
        validityReason: null,
        payload: artifactPayload,
        provenanceKey: `job:${job.job_id}`,
        provenance: {
          kind: "server_job",
          jobId: job.job_id,
        },
        createdAt: artifactPayload.generatedAt,
        completedAt: artifactPayload.generatedAt,
      });

      const finishedAt = nowIso();
      await updateJob(job.job_id, {
        ...job,
        status: "completed",
        run_id: runRow.run_id,
        finished_at: finishedAt,
        heartbeat_at: finishedAt,
        progress: {
          stage: "completed",
          detail: `Completed ${runRow.summary?.signalCount || 0} signals across ${(runRow.summary?.analyzedTimeframes || []).join(", ") || "the requested matrix"}.`,
          pct: 100,
          signalCount: runRow.summary?.signalCount || 0,
          barCount,
          heartbeatAt: finishedAt,
        },
        error: null,
      });
      cancelRequestedJobIds.delete(job.job_id);
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  async function pumpWorker() {
    if (workerInFlight || !scoreStudyDbConfigured()) {
      scheduleWorker();
      return;
    }
    workerInFlight = true;
    try {
      await sweepExpiredJobs();
      const claimed = await claimNextQueuedJob();
      if (claimed) {
        try {
          await processClaimedJob(claimed);
        } catch (error) {
          const client = await requireClient();
          if (isScoreStudyCancelledError(error)) {
            const cancelledRow = await markJobCancelled(client, claimed, "Cancelled by user.");
            publishJobUpdate(cancelledRow);
          } else {
            const failedRow = await markJobFailed(
              client,
              claimed,
              error?.message || "Background score-study job failed.",
            );
            publishJobUpdate(failedRow);
          }
        } finally {
          jobApiKeys.delete(claimed.job_id);
          cancelRequestedJobIds.delete(claimed.job_id);
          activeWorkers.delete(claimed.job_id);
        }
      }
    } catch {
      // Leave the last state intact; the next loop will retry.
    } finally {
      workerInFlight = false;
      try {
        const hasActiveJobs = await hasActiveOrQueuedJobs();
        if (shouldKeepScoreStudyWorkerScheduled({
          keepWorkerAliveWhenIdle,
          hasActiveJobs,
        })) {
          scheduleWorker();
        }
      } catch {
        scheduleWorker();
      }
    }
  }

  function scheduleWorker(delayMs = WORKER_LOOP_MS) {
    if (workerTimer != null) {
      clearTimeout(workerTimer);
    }
    workerTimer = setTimeout(() => {
      workerTimer = null;
      pumpWorker().catch(() => {});
    }, Math.max(50, Number(delayMs) || WORKER_LOOP_MS));
  }

  async function init() {
    if (!scoreStudyDbConfigured()) {
      return { configured: false };
    }
    const client = await requireClient();
    await ensureSchema(client);
    seedKnownArtifacts().catch((error) => {
      console.error("[research-score-study] Failed to seed local artifacts:", error?.message || error);
    });
    const hasActiveJobs = await hasActiveOrQueuedJobs();
    if (shouldKeepScoreStudyWorkerScheduled({
      keepWorkerAliveWhenIdle,
      hasActiveJobs,
    })) {
      scheduleWorker(50);
    }
    return { configured: true };
  }

  return {
    init,
    isConfigured: scoreStudyDbConfigured,
    getRequiredDbError: () => REQUIRED_DB_ERROR,
    listRuns,
    getRun,
    listJobs,
    getJob,
    getLatestActiveJob,
    saveRun,
    createJob,
    cancelJob,
    subscribeJob,
    listLocalArtifacts,
    importLocalArtifact,
    seedKnownArtifacts,
    sweepExpiredJobs,
  };
}
