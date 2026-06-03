import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  compactHistoricalFlowEventsForStore,
  dedupeHistoricalFlowEventsForStore,
  resolveHistoricalFlowSamplePlan,
} from "./historical-flow-events";
import type { FlowEvent } from "../providers/massive/market-data";

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

test("historical flow listing uses durable flow event storage", () => {
  const listFunction = source.match(
    /export async function listHistoricalFlowEvents[\s\S]*?\n}\n\nexport function __resetHistoricalFlowEventsForTests/,
  )?.[0];

  assert.ok(listFunction);
  assert.match(listFunction, /loadDirectHistoricalFlowWithin/);
  assert.match(listFunction, /loadStoredHistoricalFlowEvents/);
  assert.match(listFunction, /loadIncompleteSessions/);
  assert.match(listFunction, /hydrateHistoricalFlowSessions/);
  assert.match(listFunction, /persistHistoricalFlowEvents/);
  assert.match(listFunction, /options_flow_historical_store/);
});

test("historical chart flow hydrates missing sessions even from a cold store", () => {
  const listFunction = source.match(
    /export async function listHistoricalFlowEvents[\s\S]*?\n}\n\nexport function __resetHistoricalFlowEventsForTests/,
  )?.[0];

  assert.ok(listFunction);
  assert.match(
    listFunction,
    /input\.historicalBucketSeconds !== undefined/,
  );
  assert.match(listFunction, /hydrateHistoricalFlowSessions/);
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

test("historical aggregate flow can read the latest durable rows directly", () => {
  const recentListFunction = source.match(
    /export async function listRecentStoredHistoricalFlowEvents[\s\S]*?\n}\n\nasync function persistHistoricalFlowEvents/,
  )?.[0];

  assert.ok(recentListFunction);
  assert.match(recentListFunction, /from\(flowEventsTable\)/);
  assert.match(recentListFunction, /eq\(flowEventsTable\.provider, provider\)/);
  assert.match(recentListFunction, /orderBy\(desc\(flowEventsTable\.occurredAt\)\)/);
  assert.match(recentListFunction, /filterFlowEventsForRequest/);
  assert.match(recentListFunction, /Math\.max\(input\.candidateLimit \?\? 0, limit \* 10\)/);
  assert.match(recentListFunction, /listRecentStoredHistoricalFlowEvents/);
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

const makeFlowEvent = (overrides: Partial<FlowEvent> = {}): FlowEvent => ({
  id: "event-id",
  underlying: "SPY",
  provider: "massive",
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
  ...overrides,
});

test("historical flow durable writes use compact immutable rows", () => {
  assert.match(source, /compactHistoricalFlowEventsForStore\(input\)/);
  assert.match(
    source,
    /rawProviderPayload:\s*storeRawPayload \? toRawPayload\(event\) : null/,
  );
  assert.match(source, /\.onConflictDoNothing\(\{/);
  assert.doesNotMatch(source, /rawProviderPayload:\s*sql`excluded/);
});

test("historical flow store batches dedupe duplicate provider keys before compaction", () => {
  const first = makeFlowEvent({ id: "same-provider-event", premium: 1250 });
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

test("historical flow compaction drops low-value events", () => {
  const compacted = compactHistoricalFlowEventsForStore({
    underlying: "SPY",
    provider: "massive",
    events: [
      makeFlowEvent({ id: "small", premium: 49_999, isUnusual: false }),
      makeFlowEvent({ id: "small-unusual", premium: 1_000, isUnusual: true }),
      makeFlowEvent({ id: "minimum", premium: 50_000, isUnusual: false }),
    ],
  });

  assert.deepEqual(
    compacted.map((event) => event.id).sort(),
    ["minimum"],
  );
});

test("historical flow compaction caps ordinary rows per minute bucket", () => {
  const compacted = compactHistoricalFlowEventsForStore({
    underlying: "SPY",
    provider: "massive",
    events: [60_000, 80_000, 70_000, 100_000, 90_000].map((premium, index) =>
      makeFlowEvent({
        id: `ordinary-${index}`,
        premium,
        occurredAt: new Date(`2026-05-12T14:30:0${index}.000Z`),
      }),
    ),
  });

  assert.equal(compacted.length, 3);
  assert.deepEqual(
    compacted.map((event) => event.premium).sort((left, right) => right - left),
    [100_000, 90_000, 80_000],
  );
});

test("historical flow compaction preserves high-premium and unusual events above the storage floor", () => {
  const compacted = compactHistoricalFlowEventsForStore({
    underlying: "SPY",
    provider: "massive",
    events: [60_000, 70_000, 80_000, 90_000, 250_000, 55_000].map(
      (premium, index) =>
        makeFlowEvent({
          id: `preserved-${index}`,
          premium,
          isUnusual: index === 5,
          occurredAt: new Date(`2026-05-12T14:31:0${index}.000Z`),
        }),
    ),
  });

  assert.equal(compacted.length, 5);
  assert(compacted.some((event) => event.id === "preserved-4"));
  assert(compacted.some((event) => event.id === "preserved-5"));
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
