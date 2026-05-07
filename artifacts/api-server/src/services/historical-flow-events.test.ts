import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolveHistoricalFlowSamplePlan } from "./historical-flow-events";

const source = readFileSync(
  fileURLToPath(new URL("./historical-flow-events.ts", import.meta.url)),
  "utf8",
);

test("historical flow service stays isolated from live IBKR streaming modules", () => {
  assert.doesNotMatch(source, /bridge-option-quote-stream/);
  assert.doesNotMatch(source, /market-data-admission/);
  assert.doesNotMatch(source, /options-flow-scanner/);
  assert.doesNotMatch(source, /IbkrBridgeClient/);
  assert.doesNotMatch(source, /fetchBridgeOptionQuoteSnapshots/);
});

test("historical flow nonblocking store reads have a bounded response budget", () => {
  assert.match(
    source,
    /HISTORICAL_FLOW_NONBLOCKING_STORE_READ_TIMEOUT_MS = 3_000/,
  );
  assert.match(source, /HISTORICAL_FLOW_STORE_DISABLE_COOLDOWN_MS = 5 \* 60_000/);
  assert.match(source, /settleHistoricalFlowStoreRead/);
  assert.match(source, /historical flow store read timed out/);
});

test("historical flow nonblocking direct fallback is explicitly bounded", () => {
  assert.match(source, /HISTORICAL_FLOW_DIRECT_FALLBACK_CONTRACT_LIMIT = 40/);
  assert.match(source, /HISTORICAL_FLOW_DIRECT_FALLBACK_SNAPSHOT_PAGE_LIMIT = 1/);
  assert.match(source, /HISTORICAL_FLOW_DIRECT_FALLBACK_TRADE_PAGE_LIMIT = 1/);
  assert.match(source, /HISTORICAL_FLOW_DIRECT_FALLBACK_TRADE_LIMIT = 500/);
  assert.match(source, /HISTORICAL_FLOW_DIRECT_FALLBACK_MAX_DTE = 60/);
  assert.match(source, /HISTORICAL_FLOW_DIRECT_FALLBACK_TIMEOUT_MS = 20_000/);
  assert.match(source, /preferDerived: true/);
  assert.match(source, /controller\.abort\(\)/);
});

test("historical flow sampling budgets markers across regular sessions", () => {
  const plan = resolveHistoricalFlowSamplePlan({
    from: new Date("2026-05-05T13:30:00.000Z"),
    to: new Date("2026-05-07T20:00:00.000Z"),
    limit: 1_000,
  });

  assert.equal(plan.bucketSeconds, 5 * 60);
  assert.equal(plan.bucketCount, 234);
  assert.equal(plan.perBucketLimit, 5);
  assert.equal(plan.rowLimit, 1_000);
});

test("historical flow sampling can align to chart timeframe buckets", () => {
  const plan = resolveHistoricalFlowSamplePlan({
    from: new Date("2026-05-05T13:30:00.000Z"),
    to: new Date("2026-05-07T20:00:00.000Z"),
    limit: 1_000,
    bucketSeconds: 15 * 60,
  });

  assert.equal(plan.bucketSeconds, 15 * 60);
  assert.equal(plan.bucketCount, 78);
  assert.equal(plan.perBucketLimit, 13);
  assert.equal(plan.rowLimit, 1_000);
});

test("historical flow sampling caps total rows at the request limit", () => {
  const plan = resolveHistoricalFlowSamplePlan({
    from: new Date("2026-05-05T13:30:00.000Z"),
    to: new Date("2026-05-05T20:00:00.000Z"),
    limit: 12,
    bucketSeconds: 60,
  });

  assert.equal(plan.rowLimit, 12);
  assert.equal(plan.perBucketLimit, 2);
});
