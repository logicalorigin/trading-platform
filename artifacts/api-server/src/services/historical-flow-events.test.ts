import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { and, asc, eq, gte, lt } from "drizzle-orm";
import {
  db,
  flowEventHydrationSessionsTable,
  flowEventsTable,
} from "@workspace/db";
import { createTestDb, type TestDatabase } from "@workspace/db/testing";
import type {
  FlowEvent as ProviderFlowEvent,
} from "../providers/massive/market-data";

import {
  __hydrateHistoricalFlowSessionsForTests,
  __loadStoredHistoricalFlowEventsForTests,
  __resetHistoricalFlowEventsForTests,
  __resolveHistoricalFlowSampleWindowsForTests,
  resolveHistoricalFlowSamplePlan,
  resolveHistoricalFlowSessions,
} from "./historical-flow-events";

// Proves the N+1 fix in loadStoredHistoricalFlowEvents: the old code ran one
// pooled query PER sample window (~50-210 acquisitions/request against a 12-slot
// pool). The replacement runs a SINGLE range scan spanning
// [first window start, last window end) and applies the per-window top-N limit in
// JS. These tests run against real PGlite (same schema/SQL semantics as prod) and
// assert the new reader is ROW-FOR-ROW identical to a faithful reference of the
// original per-window loop, AND that it issues exactly one db.select().

const UNDERLYING = "SPY";
const PROVIDER = "massive" as const;
// A Tue-Thu span (2024-01-16..18); Mon 2024-01-15 (MLK) and the weekend fall
// outside, so resolveHistoricalFlowSessions yields exactly 3 sessions.
const FROM = new Date("2024-01-16T00:00:00.000Z");
const TO = new Date("2024-01-18T23:59:59.000Z");

type SampleWindow = { from: Date; to: Date };

// One flow_events insert row with sensible non-null defaults; only the fields
// that drive windowing/identity/filtering vary per event.
function makeRow(input: {
  key: string;
  occurredAt: Date;
  underlying?: string;
  provider?: string;
}) {
  return {
    provider: input.provider ?? PROVIDER,
    providerEventKey: input.key,
    underlyingSymbol: input.underlying ?? UNDERLYING,
    optionTicker: "SPY240119C00500000",
    strike: "500",
    expirationDate: "2024-01-19",
    right: "call" as const,
    price: "1.25",
    size: "10",
    premium: "60000",
    exchange: "XNAS",
    side: "buy",
    sentiment: "bullish" as const,
    tradeConditions: [] as string[],
    occurredAt: input.occurredAt,
  };
}

function makeProviderEvent(input: {
  id: string;
  occurredAt: Date;
  premium?: number;
}): ProviderFlowEvent {
  return {
    id: input.id,
    underlying: UNDERLYING,
    provider: PROVIDER,
    basis: "trade",
    optionTicker: "SPY240119C00500000",
    providerContractId: null,
    strike: 500,
    expirationDate: new Date("2026-07-17T00:00:00.000Z"),
    right: "call",
    price: 1.25,
    size: 10,
    premium: input.premium ?? 250_000,
    openInterest: 100,
    impliedVolatility: null,
    exchange: "XNAS",
    side: "buy",
    sentiment: "bullish",
    tradeConditions: [],
    occurredAt: input.occurredAt,
    unusualScore: 2,
    isUnusual: true,
    sourceBasis: "confirmed_trade",
  };
}

// Faithful reference of the ORIGINAL per-window loop (one query per bucket). This
// is the oracle the single-range-scan reader must reproduce exactly.
async function referencePerWindowLoop(input: {
  windows: SampleWindow[];
  perBucketLimit: number;
  rowLimit: number;
}): Promise<Array<typeof flowEventsTable.$inferSelect>> {
  const rows: Array<typeof flowEventsTable.$inferSelect> = [];
  for (const window of input.windows) {
    if (rows.length >= input.rowLimit) {
      break;
    }
    const bucketRows = await db
      .select()
      .from(flowEventsTable)
      .where(
        and(
          eq(flowEventsTable.underlyingSymbol, UNDERLYING),
          eq(flowEventsTable.provider, PROVIDER),
          gte(flowEventsTable.occurredAt, window.from),
          lt(flowEventsTable.occurredAt, window.to),
        ),
      )
      .orderBy(asc(flowEventsTable.occurredAt))
      .limit(Math.min(input.perBucketLimit, input.rowLimit - rows.length));
    rows.push(...bucketRows);
  }
  return rows;
}

// Distinct within-window time (1s apart) => globally distinct occurredAt across
// disjoint windows, so ordering is unambiguous and equivalence is deterministic
// (no reliance on Postgres tie ordering).
const eventAt = (window: SampleWindow, k: number): Date =>
  new Date(window.from.getTime() + (k + 1) * 1000);

let testDb: TestDatabase;
let selectCallCount = 0;
let flowEventsInsertCallCount = 0;

before(async () => {
  testDb = await createTestDb();
  // Count db.select() invocations by shadowing select on the active PGlite
  // instance the `db` proxy forwards to. One select() call == one SELECT query.
  const realSelect = testDb.db.select.bind(testDb.db);
  (testDb.db as unknown as { select: (...args: unknown[]) => unknown }).select = (
    ...args: unknown[]
  ) => {
    selectCallCount++;
    return realSelect(...(args as []));
  };
  const realInsert = testDb.db.insert.bind(testDb.db) as (
    ...args: unknown[]
  ) => unknown;
  (testDb.db as unknown as { insert: (...args: unknown[]) => unknown }).insert = (
    ...args: unknown[]
  ) => {
    if (args[0] === flowEventsTable) {
      flowEventsInsertCallCount++;
    }
    return realInsert(...args);
  };
});

after(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  __resetHistoricalFlowEventsForTests();
  selectCallCount = 0;
  flowEventsInsertCallCount = 0;
  await testDb.client.exec(
    "truncate table flow_events, flow_event_hydration_sessions restart identity cascade",
  );
});

test("single range scan is row-for-row identical to the per-window loop (per-window limit exceeded), in one query", async () => {
  const sessions = resolveHistoricalFlowSessions({ from: FROM, to: TO });
  assert.equal(sessions.length, 3, "fixture must span exactly 3 sessions");

  const limit = 42;
  const plan = resolveHistoricalFlowSamplePlan({ from: FROM, to: TO, limit });
  const windows = __resolveHistoricalFlowSampleWindowsForTests({
    sessions,
    bucketSeconds: plan.bucketSeconds,
    from: FROM,
    to: TO,
  });
  assert.ok(windows.length >= 3, "need >= 3 windows");

  const midIdx = Math.floor(windows.length / 2);
  const lastIdx = windows.length - 1;
  // window[0], window[1] are in session 1; midIdx/lastIdx land in sessions 2 & 3,
  // so events are spread across >= 3 windows in 3 sessions.
  const seeds: Array<ReturnType<typeof makeRow>> = [];
  // window[0]: MORE than the per-window limit => truncation exercised.
  const denseCount = plan.perBucketLimit + 3;
  for (let k = 0; k < denseCount; k++) {
    seeds.push(makeRow({ key: `w0-${k}`, occurredAt: eventAt(windows[0], k) }));
  }
  seeds.push(makeRow({ key: "w1-0", occurredAt: eventAt(windows[1], 0) }));
  for (let k = 0; k < 3; k++) {
    seeds.push(makeRow({ key: `mid-${k}`, occurredAt: eventAt(windows[midIdx], k) }));
  }
  for (let k = 0; k < 2; k++) {
    seeds.push(makeRow({ key: `last-${k}`, occurredAt: eventAt(windows[lastIdx], k) }));
  }
  // Noise: SPY/massive event in the OVERNIGHT GAP between session 1 and 2 — inside
  // the single-scan range but in NO window; must be dropped during bucketing.
  seeds.push(
    makeRow({
      key: "gap",
      occurredAt: new Date(sessions[0].windowTo.getTime() + 60 * 60 * 1000),
    }),
  );
  // Noise: wrong underlying / wrong provider inside window[0] — must be excluded
  // by the constant WHERE filters (never fetched at all).
  seeds.push(
    makeRow({ key: "qqq", occurredAt: eventAt(windows[0], 0), underlying: "QQQ" }),
  );
  seeds.push(
    makeRow({ key: "poly", occurredAt: eventAt(windows[0], 0), provider: "polygon" }),
  );

  await db.insert(flowEventsTable).values(seeds);

  // Oracle: original per-window loop against the seeded data.
  const expectedRows = await referencePerWindowLoop({
    windows,
    perBucketLimit: plan.perBucketLimit,
    rowLimit: plan.rowLimit,
  });
  assert.ok(expectedRows.length > 0, "reference produced no rows");

  selectCallCount = 0;
  const actual = await __loadStoredHistoricalFlowEventsForTests({
    underlying: UNDERLYING,
    provider: PROVIDER,
    from: FROM,
    to: TO,
    limit,
  });

  assert.equal(selectCallCount, 1, "reader must issue exactly one db.select()");

  // Row-for-row identical: same providerEventKey (== event id) and occurredAt
  // sequence, in the same order.
  assert.deepEqual(
    actual.map((event) => event.id),
    expectedRows.map((row) => row.providerEventKey),
  );
  assert.deepEqual(
    actual.map((event) => event.occurredAt.getTime()),
    expectedRows.map((row) => row.occurredAt.getTime()),
  );

  // window[0] truncated to the EARLIEST perBucketLimit events.
  const w0Keys = actual
    .map((event) => event.id)
    .filter((id) => id.startsWith("w0-"));
  assert.deepEqual(
    w0Keys,
    Array.from({ length: plan.perBucketLimit }, (_value, k) => `w0-${k}`),
  );
  // Out-of-window and filtered-out noise never appears.
  assert.ok(!actual.some((event) => event.id === "gap"));
  assert.ok(!actual.some((event) => event.id === "qqq" || event.id === "poly"));
});

test("single range scan matches the per-window loop when the global rowLimit forces an early break, in one query", async () => {
  const sessions = resolveHistoricalFlowSessions({ from: FROM, to: TO });
  assert.equal(sessions.length, 3, "fixture must span exactly 3 sessions");

  // limit=3 => perBucketLimit=1, rowLimit=3: seeding 2 events into each of the
  // first 5 windows exercises BOTH the per-window limit (2 > 1) and the global
  // rowLimit break (only 3 of the 5 windows contribute before the loop stops).
  const limit = 3;
  const plan = resolveHistoricalFlowSamplePlan({ from: FROM, to: TO, limit });
  const windows = __resolveHistoricalFlowSampleWindowsForTests({
    sessions,
    bucketSeconds: plan.bucketSeconds,
    from: FROM,
    to: TO,
  });
  const seededWindowCount = Math.min(5, windows.length);
  assert.ok(
    seededWindowCount * plan.perBucketLimit > plan.rowLimit,
    "seeding must overflow rowLimit so the break path is exercised",
  );

  const seeds: Array<ReturnType<typeof makeRow>> = [];
  for (let w = 0; w < seededWindowCount; w++) {
    for (let k = 0; k < 2; k++) {
      seeds.push(
        makeRow({ key: `w${w}-${k}`, occurredAt: eventAt(windows[w], k) }),
      );
    }
  }
  await db.insert(flowEventsTable).values(seeds);

  const expectedRows = await referencePerWindowLoop({
    windows,
    perBucketLimit: plan.perBucketLimit,
    rowLimit: plan.rowLimit,
  });
  assert.equal(
    expectedRows.length,
    plan.rowLimit,
    "reference should be truncated to rowLimit",
  );

  selectCallCount = 0;
  const actual = await __loadStoredHistoricalFlowEventsForTests({
    underlying: UNDERLYING,
    provider: PROVIDER,
    from: FROM,
    to: TO,
    limit,
  });

  assert.equal(selectCallCount, 1, "reader must issue exactly one db.select()");
  assert.deepEqual(
    actual.map((event) => event.id),
    expectedRows.map((row) => row.providerEventKey),
  );
  assert.deepEqual(
    actual.map((event) => event.occurredAt.getTime()),
    expectedRows.map((row) => row.occurredAt.getTime()),
  );
});

test("historical hydration persists the provider result once instead of streaming duplicate chunks", async () => {
  const event = makeProviderEvent({
    id: "streamed-then-returned",
    occurredAt: new Date("2026-07-02T14:00:00.000Z"),
  });
  let onEventsProvided = false;

  const totals = await __hydrateHistoricalFlowSessionsForTests({
    underlying: UNDERLYING,
    provider: PROVIDER,
    client: {
      async getHistoricalOptionFlowEvents(input) {
        onEventsProvided = typeof input.onEvents === "function";
        await input.onEvents?.([event]);
        return {
          events: [event],
          contractCount: 1,
          contractsScanned: 1,
        };
      },
    },
    sessions: [
      {
        marketDate: "2026-07-02",
        windowFrom: new Date("2026-07-02T13:30:00.000Z"),
        windowTo: new Date("2026-07-02T20:00:00.000Z"),
      },
    ],
    unusualThreshold: 1,
  });

  assert.equal(
    onEventsProvided,
    false,
    "hydration should not request per-contract streaming persistence",
  );
  assert.equal(
    flowEventsInsertCallCount,
    1,
    "one flow_events insert should persist the final provider result",
  );
  assert.equal(totals.eventCount, 1);

  const storedRows = await db.select().from(flowEventsTable);
  assert.equal(storedRows.length, 1);
  assert.equal(storedRows[0]?.providerEventKey, event.id);

  const hydrationRows = await db.select().from(flowEventHydrationSessionsTable);
  assert.equal(hydrationRows.length, 1);
  assert.equal(hydrationRows[0]?.status, "complete");
});
