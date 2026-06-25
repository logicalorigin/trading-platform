import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { barCacheTable, db } from "@workspace/db";
import { createTestDb, type TestDatabase } from "@workspace/db/testing";

import {
  __resetMarketDataStoreBackoffForTests,
  __resetStoreInstrumentCacheForTests,
  persistMarketDataBars,
  persistMarketDataBarsForSymbols,
} from "./market-data-store";

// Proves the bar_cache upsert skip-guard (setWhere: ... IS DISTINCT FROM excluded.*)
// only DO-UPDATEs rows whose OHLCV actually changed. Re-persisting the SAME already-
// stored closed bars (the hot /bars cache-miss case) must NOT rewrite the row — that
// churn (n_tup_upd 3.62M vs n_tup_ins 831K) is the primary bar_cache DB-pressure
// driver this change targets. Runs against real PGlite so we observe the actual DB
// effect (updated_at) of the ON CONFLICT ... WHERE clause, not rendered SQL.

const TWO_HOURS_MS = 2 * 60 * 60_000;
const TIMEFRAME = "1m" as const;
const SOURCE = "massive-history";

// A fixed past sentinel: stamp every row's updated_at to this, re-persist, then read
// it back. If the guard SKIPPED the update the sentinel survives; if the update fired
// updated_at moves to write-time. This is robust against millisecond clock resolution
// (no reliance on two wall-clock writes landing on different timestamps).
const SENTINEL = new Date("2000-01-01T00:00:00.000Z");

const batchParams = {
  assetClass: "equity" as const,
  outsideRth: true,
  source: "trades" as const,
  recentWindowMinutes: 0,
};

let testDb: TestDatabase;
before(async () => {
  testDb = await createTestDb();
});
after(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  __resetMarketDataStoreBackoffForTests();
  __resetStoreInstrumentCacheForTests();
  await testDb.client.exec(
    "truncate table bar_cache, instruments restart identity cascade",
  );
});

// Bars on exact 1m boundaries, two hours back (outside the writer's recent-window
// gate is irrelevant for writes, but keeps timestamps stable/closed). seed sets the
// OHLCV; identical seed => identical rows.
function makeBars(seed: number, count: number) {
  const base = Math.floor((Date.now() - TWO_HOURS_MS) / 60_000) * 60_000;
  return Array.from({ length: count }, (_unused, index) => {
    const price = seed + index;
    return {
      timestamp: new Date(base + index * 60_000),
      open: price,
      high: price + 0.5,
      low: price - 0.5,
      close: price + 0.25,
      volume: (index + 1) * 100,
    };
  });
}

async function stampSentinel() {
  await testDb.client.exec(
    `update bar_cache set updated_at = '${SENTINEL.toISOString()}'`,
  );
}

async function readRows() {
  const rows = await db
    .select({
      symbol: barCacheTable.symbol,
      startsAt: barCacheTable.startsAt,
      close: barCacheTable.close,
      updatedAt: barCacheTable.updatedAt,
    })
    .from(barCacheTable);
  return rows
    .map((r) => ({
      symbol: r.symbol,
      startsAtMs: (r.startsAt instanceof Date
        ? r.startsAt
        : new Date(r.startsAt)
      ).getTime(),
      close: Number(r.close),
      updatedAtMs: (r.updatedAt instanceof Date
        ? r.updatedAt
        : new Date(r.updatedAt as string)
      ).getTime(),
    }))
    .sort((a, b) =>
      a.symbol === b.symbol
        ? a.startsAtMs - b.startsAtMs
        : a.symbol < b.symbol
          ? -1
          : 1,
    );
}

test("per-symbol: re-persisting identical bars does NOT bump updated_at", async () => {
  const bars = makeBars(100, 2);
  assert.equal(
    await persistMarketDataBars({
      request: { symbol: "AAPL", timeframe: TIMEFRAME, ...batchParams },
      sourceName: SOURCE,
      bars,
    }),
    true,
  );
  await stampSentinel();

  // Identical re-persist — the common cache-miss case.
  assert.equal(
    await persistMarketDataBars({
      request: { symbol: "AAPL", timeframe: TIMEFRAME, ...batchParams },
      sourceName: SOURCE,
      bars: makeBars(100, 2),
    }),
    true,
  );

  const rows = await readRows();
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(
      row.updatedAtMs,
      SENTINEL.getTime(),
      "identical bar must be skipped (updated_at unchanged)",
    );
  }
});

test("per-symbol: a changed bar IS updated; an unchanged sibling is skipped", async () => {
  const bars = makeBars(100, 2);
  await persistMarketDataBars({
    request: { symbol: "AAPL", timeframe: TIMEFRAME, ...batchParams },
    sourceName: SOURCE,
    bars,
  });
  await stampSentinel();

  // Change ONLY the second bar's close; first bar stays identical.
  const changed = makeBars(100, 2);
  changed[1] = { ...changed[1]!, close: 999 };
  await persistMarketDataBars({
    request: { symbol: "AAPL", timeframe: TIMEFRAME, ...batchParams },
    sourceName: SOURCE,
    bars: changed,
  });

  const rows = await readRows();
  assert.equal(rows.length, 2);
  // bar[0] unchanged => skipped => sentinel survives.
  assert.equal(
    rows[0]!.updatedAtMs,
    SENTINEL.getTime(),
    "unchanged bar must keep its updated_at",
  );
  // bar[1] changed => updated => close moved and updated_at bumped off the sentinel.
  assert.equal(rows[1]!.close, 999, "changed bar's close must persist");
  assert.notEqual(
    rows[1]!.updatedAtMs,
    SENTINEL.getTime(),
    "changed bar must bump updated_at",
  );
});

// Lock the predicate's column set: a change to ANY single OHLCV column must fire the
// update. If a future edit dropped a column from barCacheRowChangedPredicate, the
// matching case here would fail (a real data-staleness bug otherwise undetected —
// every other "changed" assertion mutates only `close`).
for (const field of ["open", "high", "low", "volume"] as const) {
  test(`per-symbol: a change to ${field} alone bumps updated_at`, async () => {
    await persistMarketDataBars({
      request: { symbol: "AAPL", timeframe: TIMEFRAME, ...batchParams },
      sourceName: SOURCE,
      bars: makeBars(100, 2),
    });
    await stampSentinel();

    const changed = makeBars(100, 2);
    // Mutate ONLY `field` on the first bar; everything else stays identical.
    changed[0] = { ...changed[0]!, [field]: changed[0]![field] + 7 };
    await persistMarketDataBars({
      request: { symbol: "AAPL", timeframe: TIMEFRAME, ...batchParams },
      sourceName: SOURCE,
      bars: changed,
    });

    const rows = await readRows();
    assert.notEqual(
      rows[0]!.updatedAtMs,
      SENTINEL.getTime(),
      `a ${field}-only change must be detected and update the row`,
    );
    assert.equal(
      rows[1]!.updatedAtMs,
      SENTINEL.getTime(),
      "the untouched sibling must stay skipped",
    );
  });
}

test("multi-symbol: a changed symbol updates while an unchanged symbol stays skipped", async () => {
  const seed = () => [
    { symbol: "AAPL", bars: makeBars(100, 1) },
    { symbol: "MSFT", bars: makeBars(200, 1) },
  ];
  await persistMarketDataBarsForSymbols({
    timeframe: TIMEFRAME,
    sourceName: SOURCE,
    ...batchParams,
    bySymbol: seed(),
  });
  await stampSentinel();

  // Change ONLY AAPL's bar; MSFT re-persisted identically. Both rows live in the same
  // batched INSERT chunk, so this exercises setWhere + set.symbol=excluded.symbol together.
  const changedAapl = makeBars(100, 1);
  changedAapl[0] = { ...changedAapl[0]!, close: 777 };
  await persistMarketDataBarsForSymbols({
    timeframe: TIMEFRAME,
    sourceName: SOURCE,
    ...batchParams,
    bySymbol: [
      { symbol: "AAPL", bars: changedAapl },
      { symbol: "MSFT", bars: makeBars(200, 1) },
    ],
  });

  const rows = await readRows();
  const aapl = rows.find((r) => r.symbol === "AAPL")!;
  const msft = rows.find((r) => r.symbol === "MSFT")!;
  assert.equal(aapl.close, 777, "changed symbol's close persists");
  assert.notEqual(
    aapl.updatedAtMs,
    SENTINEL.getTime(),
    "changed symbol must bump updated_at",
  );
  assert.equal(
    msft.updatedAtMs,
    SENTINEL.getTime(),
    "unchanged symbol in the same chunk must stay skipped",
  );
});

test("multi-symbol: re-persisting identical bars does NOT bump updated_at", async () => {
  const bySymbol = [
    { symbol: "AAPL", bars: makeBars(100, 2) },
    { symbol: "MSFT", bars: makeBars(200, 2) },
  ];
  assert.equal(
    await persistMarketDataBarsForSymbols({
      timeframe: TIMEFRAME,
      sourceName: SOURCE,
      ...batchParams,
      bySymbol,
    }),
    true,
  );
  await stampSentinel();

  assert.equal(
    await persistMarketDataBarsForSymbols({
      timeframe: TIMEFRAME,
      sourceName: SOURCE,
      ...batchParams,
      bySymbol: [
        { symbol: "AAPL", bars: makeBars(100, 2) },
        { symbol: "MSFT", bars: makeBars(200, 2) },
      ],
    }),
    true,
  );

  const rows = await readRows();
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal(
      row.updatedAtMs,
      SENTINEL.getTime(),
      "identical bar must be skipped on the batched path too",
    );
  }
});
