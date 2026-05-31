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
