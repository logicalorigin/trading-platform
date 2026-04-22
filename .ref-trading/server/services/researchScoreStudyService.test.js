import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScoreStudyCancelledError,
  isActiveJobStatus,
  isScoreStudyCancelledError,
  resolveExpiredJobFailureReason,
  serializeJobRow,
  serializeRunRow,
  shouldKeepScoreStudyWorkerScheduled,
} from "./researchScoreStudyService.js";

test("isActiveJobStatus keeps cancel_requested jobs visible as active work", () => {
  assert.equal(isActiveJobStatus("queued"), true);
  assert.equal(isActiveJobStatus("running_background"), true);
  assert.equal(isActiveJobStatus("cancel_requested"), true);
  assert.equal(isActiveJobStatus("cancelled"), false);
});

test("resolveExpiredJobFailureReason ignores terminal cancelled jobs", () => {
  const reason = resolveExpiredJobFailureReason({
    status: "cancelled",
    created_at: "2026-04-02T00:00:00.000Z",
    heartbeat_at: "2026-04-02T00:01:00.000Z",
  }, {
    nowMs: Date.parse("2026-04-02T00:30:00.000Z"),
  });
  assert.equal(reason, null);
});

test("resolveExpiredJobFailureReason still fails cancel_requested jobs with stale heartbeats", () => {
  const reason = resolveExpiredJobFailureReason({
    status: "cancel_requested",
    created_at: "2026-04-02T00:00:00.000Z",
    started_at: "2026-04-02T00:00:05.000Z",
    progress: {
      heartbeatAt: "2026-04-02T00:01:00.000Z",
    },
  }, {
    nowMs: Date.parse("2026-04-02T00:25:30.000Z"),
  });
  assert.match(reason, /heartbeat stalled|max runtime/i);
});

test("isScoreStudyCancelledError recognizes the service cancellation sentinel", () => {
  assert.equal(isScoreStudyCancelledError(buildScoreStudyCancelledError()), true);
  assert.equal(isScoreStudyCancelledError(new Error("other")), false);
});

test("shouldKeepScoreStudyWorkerScheduled keeps the loop alive in full mode", () => {
  assert.equal(shouldKeepScoreStudyWorkerScheduled({
    keepWorkerAliveWhenIdle: true,
    hasActiveJobs: false,
  }), true);
});

test("shouldKeepScoreStudyWorkerScheduled lets lean mode go dormant when idle", () => {
  assert.equal(shouldKeepScoreStudyWorkerScheduled({
    keepWorkerAliveWhenIdle: false,
    hasActiveJobs: false,
  }), false);
  assert.equal(shouldKeepScoreStudyWorkerScheduled({
    keepWorkerAliveWhenIdle: false,
    hasActiveJobs: true,
  }), true);
});

test("serializeRunRow preserves stored summary without hydrating the full artifact payload", () => {
  const storedSummary = {
    marketSymbol: "SPY",
    scoringVersion: "v1",
    executionProfile: "profile-a",
    defaultStudyMode: "forward",
    requestedTimeframes: ["1m"],
    requestedContextTimeframes: ["5m"],
    analyzedTimeframes: ["1m"],
    skippedTimeframes: [],
    signalCount: 42,
    directions: {
      combined: {
        validatedQualityScore: 1.234,
        meanExcursionEdgeAtr: 0.456,
        meanCloseReturnAtr: 0.123,
        guidanceRatePct: 67.8,
        frontierTiers: {
          top_decile: {
            key: "top_decile",
            count: 4,
          },
        },
      },
    },
  };

  const row = {
    run_id: "run-123",
    source: "server_job",
    symbol: "SPY",
    preset_id: "preset-1",
    preset_label: "Preset 1",
    execution_profile: "profile-a",
    scoring_version: "v1",
    requested_timeframes: ["1m"],
    requested_context_timeframes: ["5m"],
    study_mode: "forward",
    validity_status: "valid",
    validity_reason: null,
    summary: storedSummary,
    provenance: { kind: "server_job" },
    created_at: "2026-04-06T00:00:00.000Z",
    completed_at: "2026-04-06T00:05:00.000Z",
    imported_at: "2026-04-06T00:06:00.000Z",
    updated_at: "2026-04-06T00:07:00.000Z",
    has_payload: true,
  };

  const serialized = serializeRunRow(row);
  assert.equal(serialized.runId, "run-123");
  assert.equal(serialized.hasPayload, true);
  assert.equal(serialized.summary, storedSummary);
  assert.equal(serialized.artifact, undefined);
  assert.equal(serialized.result, undefined);
});

test("serializeJobRow works with the trimmed job-read projection", () => {
  const serialized = serializeJobRow({
    job_id: "job-123",
    status: "running_background",
    symbol: "SPY",
    preset_id: "preset-1",
    preset_label: "Preset 1",
    requested_timeframes: ["1m"],
    requested_context_timeframes: ["5m"],
    progress: {
      stage: "hydrating-bars",
      pct: 12,
    },
    run_id: null,
    error: null,
    created_at: "2026-04-06T00:00:00.000Z",
    started_at: "2026-04-06T00:00:05.000Z",
    finished_at: null,
    heartbeat_at: "2026-04-06T00:01:00.000Z",
    updated_at: "2026-04-06T00:01:05.000Z",
  });

  assert.deepEqual(serialized, {
    jobId: "job-123",
    status: "running_background",
    symbol: "SPY",
    presetId: "preset-1",
    presetLabel: "Preset 1",
    requestedTimeframes: ["1m"],
    requestedContextTimeframes: ["5m"],
    progress: {
      stage: "hydrating-bars",
      pct: 12,
    },
    runId: null,
    error: null,
    createdAt: "2026-04-06T00:00:00.000Z",
    startedAt: "2026-04-06T00:00:05.000Z",
    finishedAt: null,
    heartbeatAt: "2026-04-06T00:01:00.000Z",
    updatedAt: "2026-04-06T00:01:05.000Z",
    cancelRequested: false,
  });
});
