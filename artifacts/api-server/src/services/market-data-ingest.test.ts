import assert from "node:assert/strict";
import test from "node:test";
import {
  __marketDataIngestInternalsForTests,
  buildIngestDedupeKey,
  isSupportedMarketDataIngestJobKind,
  SUPPORTED_MARKET_DATA_INGEST_JOB_KINDS,
} from "./market-data-ingest";

test("market-data ingest only advertises Rust-implemented job kinds", () => {
  assert.deepEqual(SUPPORTED_MARKET_DATA_INGEST_JOB_KINDS, [
    "stock_snapshot",
    "option_chain_snapshot",
    "gex_snapshot",
  ]);
  assert.equal(isSupportedMarketDataIngestJobKind("stock_snapshot"), true);
  assert.equal(isSupportedMarketDataIngestJobKind("stock_bars"), false);
  assert.equal(isSupportedMarketDataIngestJobKind("flow_summary"), false);
});

test("market-data ingest dedupe key includes the refresh bucket", () => {
  assert.equal(
    buildIngestDedupeKey({
      kind: "gex_snapshot",
      symbol: " spy ",
      payload: { dedupeBucket: "2026-05-29T14:30" },
    }),
    "gex_snapshot:SPY::::2026-05-29T14:30",
  );
});

test("market-data ingest only treats numeric refresh buckets as supersedable", () => {
  assert.equal(
    __marketDataIngestInternalsForTests.numericDedupeBucket({
      dedupeBucket: 29667979,
    }),
    29667979,
  );
  assert.equal(
    __marketDataIngestInternalsForTests.numericDedupeBucket({
      dedupeBucket: "29667979",
    }),
    29667979,
  );
  assert.equal(
    __marketDataIngestInternalsForTests.numericDedupeBucket({
      dedupeBucket: "2026-05-29T14:30",
    }),
    null,
  );
  assert.equal(
    __marketDataIngestInternalsForTests.numericDedupeBucket(null),
    null,
  );
});

test("market-data ingest maps claimable queued jobs by kind", () => {
  const diagnostics =
    __marketDataIngestInternalsForTests.mapClaimableQueuedJobRows([
      { kind: "stock_snapshot", value: "3" },
      { kind: "option_chain_snapshot", value: 2 },
      { kind: "gex_snapshot", value: "1" },
    ]);

  assert.equal(diagnostics.count, 6);
  assert.deepEqual(diagnostics.byKind, {
    stock_snapshot: 3,
    option_chain_snapshot: 2,
    gex_snapshot: 1,
  });
});

test("market-data ingest flags an inactive worker when claimable jobs are waiting", () => {
  assert.deepEqual(
    __marketDataIngestInternalsForTests.resolveWorkerActivityDiagnostics({
      configured: true,
      providerConfigured: true,
      runningCount: 0,
      claimableQueuedJobCount: 4,
    }),
    {
      workerLikelyInactive: true,
      workerInactiveReason: "claimable_jobs_waiting_without_running_worker",
    },
  );

  assert.deepEqual(
    __marketDataIngestInternalsForTests.resolveWorkerActivityDiagnostics({
      configured: true,
      providerConfigured: true,
      runningCount: 1,
      claimableQueuedJobCount: 4,
    }),
    {
      workerLikelyInactive: false,
      workerInactiveReason: null,
    },
  );

  assert.deepEqual(
    __marketDataIngestInternalsForTests.resolveWorkerActivityDiagnostics({
      configured: false,
      providerConfigured: true,
      runningCount: 0,
      claimableQueuedJobCount: 4,
    }),
    {
      workerLikelyInactive: false,
      workerInactiveReason: null,
    },
  );
});

test("market-data ingest maps blocked GEX diagnostics with counts and ages", () => {
  const now = new Date("2026-05-29T16:00:00.000Z");
  const diagnostics =
    __marketDataIngestInternalsForTests.mapBlockedGexDiagnosticsRows(
      [
        {
          symbol: "SPY",
          dedupe_bucket: "2026-05-29T15:59",
          created_at: new Date("2026-05-29T15:59:30.000Z"),
          missing_kind: "option_chain_snapshot",
          prerequisite_status: "failed",
          last_error: "option-chain snapshot truncated",
          total_count: "2",
          oldest_created_at: new Date("2026-05-29T15:59:00.000Z"),
        },
      ],
      now,
    );

  assert.equal(diagnostics.count, 2);
  assert.equal(diagnostics.oldestAgeMs, 60_000);
  assert.deepEqual(diagnostics.jobs, [
    {
      symbol: "SPY",
      dedupeBucket: "2026-05-29T15:59",
      createdAt: new Date("2026-05-29T15:59:30.000Z"),
      ageMs: 30_000,
      missingKind: "option_chain_snapshot",
      prerequisiteStatus: "failed",
      lastError: "option-chain snapshot truncated",
    },
  ]);
});
