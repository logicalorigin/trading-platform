import assert from "node:assert/strict";
import test from "node:test";

import {
  createResearchBacktestJobManager,
  resolveExpiredJobFailureReason,
} from "./researchBacktestJobManager.js";

test("resolveExpiredJobFailureReason ignores completed jobs", () => {
  const reason = resolveExpiredJobFailureReason({
    status: "completed",
    createdAt: "2026-03-27T00:00:00.000Z",
  }, {
    nowMs: Date.parse("2026-03-27T00:30:00.000Z"),
  });
  assert.equal(reason, null);
});

test("resolveExpiredJobFailureReason fails queued jobs that never start", () => {
  const reason = resolveExpiredJobFailureReason({
    status: "queued",
    createdAt: "2026-03-27T00:00:00.000Z",
    updatedAt: "2026-03-27T00:00:00.000Z",
  }, {
    nowMs: Date.parse("2026-03-27T00:01:05.000Z"),
  });
  assert.match(reason, /stalled in queue/i);
});

test("resolveExpiredJobFailureReason fails running jobs with stale heartbeats", () => {
  const reason = resolveExpiredJobFailureReason({
    status: "running_background",
    createdAt: "2026-03-27T00:00:00.000Z",
    startedAt: "2026-03-27T00:00:05.000Z",
    progress: {
      heartbeatAt: "2026-03-27T00:01:00.000Z",
    },
  }, {
    nowMs: Date.parse("2026-03-27T00:05:10.000Z"),
  });
  assert.match(reason, /heartbeat stalled/i);
});

test("resolveExpiredJobFailureReason treats cancel_requested jobs as still active until they settle", () => {
  const reason = resolveExpiredJobFailureReason({
    status: "cancel_requested",
    createdAt: "2026-03-27T00:00:00.000Z",
    startedAt: "2026-03-27T00:00:05.000Z",
    progress: {
      heartbeatAt: "2026-03-27T00:01:00.000Z",
    },
  }, {
    nowMs: Date.parse("2026-03-27T00:05:10.000Z"),
  });
  assert.match(reason, /heartbeat stalled/i);
});

test("resolveExpiredJobFailureReason fails long-running jobs even with heartbeats", () => {
  const reason = resolveExpiredJobFailureReason({
    status: "running_background",
    createdAt: "2026-03-27T00:00:00.000Z",
    startedAt: "2026-03-27T00:00:05.000Z",
    progress: {
      heartbeatAt: "2026-03-27T00:19:59.000Z",
    },
  }, {
    nowMs: Date.parse("2026-03-27T00:20:10.000Z"),
  });
  assert.match(reason, /max runtime/i);
});

test("subscribeJob publishes queued cancellation updates", async () => {
  const queuedJob = {
    jobId: "job-1",
    jobType: "backtest",
    status: "queued",
    mode: "background",
    createdAt: "2026-03-27T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    updatedAt: "2026-03-27T00:00:00.000Z",
    resultId: null,
    error: null,
    marketSymbol: "SPY",
    draftSignature: null,
    setupSnapshot: null,
    payload: null,
    resultMeta: null,
    progress: {
      stage: "queued",
      detail: "Queued for background execution.",
      heartbeatAt: "2026-03-27T00:00:00.000Z",
    },
    metricsPreview: null,
    optimizerResult: null,
  };
  const store = {
    state: {
      researchBacktests: {
        jobs: [queuedJob],
        results: [],
        updatedAt: queuedJob.updatedAt,
      },
    },
    getResearchBacktests() {
      return this.state.researchBacktests;
    },
    async upsertResearchBacktests(nextState) {
      this.state.researchBacktests = nextState;
      return nextState;
    },
  };
  const manager = createResearchBacktestJobManager({ store });
  const events = [];
  const unsubscribe = manager.subscribeJob("job-1", (job) => {
    events.push(job);
  });

  const cancelled = await manager.cancelJob("job-1");
  unsubscribe();

  assert.equal(cancelled?.status, "cancelled");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.jobId, "job-1");
  assert.equal(events[0]?.status, "cancelled");
  assert.match(String(events[0]?.progress?.detail || ""), /cancelled/i);
});
