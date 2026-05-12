import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  dedupeHistoricalFlowEventsForStore,
  resolveHistoricalFlowSamplePlan,
} from "./historical-flow-events";
import type { FlowEvent } from "../providers/polygon/market-data";

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
  assert.match(
    source,
    /HISTORICAL_FLOW_NONBLOCKING_DIRECT_FALLBACK_TIMEOUT_MS = 4_000/,
  );
  assert.match(source, /loadNonblockingDirectHistoricalFlowFallback/);
  assert.match(source, /preferDerived: true/);
  assert.match(source, /controller\.abort\(\)/);
});

test("historical flow upserts refresh classified payload fields", () => {
  assert.match(source, /side:\s*sql`excluded\.side`/);
  assert.match(source, /sentiment:\s*sql`excluded\.sentiment`/);
  assert.match(source, /rawProviderPayload:\s*sql`excluded\.raw_provider_payload`/);
});

test("historical flow store batches dedupe duplicate provider keys before upsert", () => {
  const first: FlowEvent = {
    id: "same-provider-event",
    underlying: "SPY",
    provider: "polygon",
    basis: "trade",
    optionTicker: "O:SPY260515C00500000",
    providerContractId: null,
    strike: 500,
    expirationDate: new Date("2026-05-15T00:00:00.000Z"),
    right: "call",
    price: 1.25,
    size: 10,
    premium: 1250,
    openInterest: 100,
    impliedVolatility: null,
    exchange: "CBOE",
    side: "ask",
    sentiment: "bullish",
    tradeConditions: [],
    occurredAt: new Date("2026-05-12T14:30:00.000Z"),
    unusualScore: 1,
    isUnusual: false,
  };
  const replacement = {
    ...first,
    price: 1.4,
    premium: 1400,
  };
  const other = {
    ...first,
    id: "other-provider-event",
    price: 2,
    premium: 2000,
  };

  const deduped = dedupeHistoricalFlowEventsForStore([
    first,
    other,
    replacement,
  ]);

  assert.equal(deduped.length, 2);
  assert.deepEqual(
    deduped.map((event) => event.id),
    ["same-provider-event", "other-provider-event"],
  );
  assert.equal(deduped[0]?.price, replacement.price);
  assert.match(source, /dedupeHistoricalFlowEventsForStore\(input\.events\)/);
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
