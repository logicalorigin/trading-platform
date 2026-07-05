import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createTestDb, type TestDatabase } from "@workspace/db/testing";

import {
  __resetMarketDataStoreBackoffForTests,
  __resetStoreInstrumentCacheForTests,
  onBarCacheRowsChanged,
  persistMarketDataBars,
  persistMarketDataBarsForSymbols,
  type BarCacheChange,
} from "./market-data-store";

// Proves the cross-cycle cache invalidation hook (onBarCacheRowsChanged) fires
// EXACTLY on the rows the bar_cache skip-guard actually inserts/updates — and NEVER
// on a no-op re-upsert of unchanged closed bars. This is the safety mechanism for
// Lever-2 Option E (cache immutable closed history, fetch only the delta): a missed
// below-high-water change would serve stale bars to signal evaluation, so the
// dispatched set must equal the skip-guard's changed set. Runs against real PGlite so
// the ON CONFLICT ... WHERE ... RETURNING semantics are observed, not rendered SQL.

const TWO_HOURS_MS = 2 * 60 * 60_000;
const TIMEFRAME = "1m" as const;
const SOURCE = "massive-history";
const batchParams = {
  assetClass: "equity" as const,
  outsideRth: true,
  source: "trades" as const,
  recentWindowMinutes: 0,
};

let testDb: TestDatabase;
const dispatched: BarCacheChange[][] = [];
let unsubscribe: (() => void) | null = null;

before(async () => {
  testDb = await createTestDb();
});
after(async () => {
  unsubscribe?.();
  await testDb.cleanup();
});
beforeEach(async () => {
  __resetMarketDataStoreBackoffForTests();
  __resetStoreInstrumentCacheForTests();
  dispatched.length = 0;
  unsubscribe?.();
  unsubscribe = onBarCacheRowsChanged((changes) => dispatched.push(changes));
  await testDb.client.exec(
    "truncate table bar_cache, instruments restart identity cascade",
  );
});

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

const flat = () => dispatched.flat();

test("first persist dispatches every inserted bar's key (symbol/timeframe/source/startsAtMs)", async () => {
  const bars = makeBars(100, 2);
  await persistMarketDataBars({
    request: { symbol: "AAPL", timeframe: TIMEFRAME, ...batchParams },
    sourceName: SOURCE,
    bars,
  });

  const got = flat();
  assert.equal(got.length, 2);
  for (const change of got) {
    assert.equal(change.symbol, "AAPL");
    assert.equal(change.timeframe, TIMEFRAME);
    assert.equal(change.sourceName, SOURCE);
  }
  assert.deepEqual(
    got.map((c) => c.startsAtMs).sort((a, b) => a - b),
    bars.map((b) => b.timestamp.getTime()).sort((a, b) => a - b),
  );
});

test("re-persisting identical bars dispatches NOTHING (no-op upsert returns no rows)", async () => {
  await persistMarketDataBars({
    request: { symbol: "AAPL", timeframe: TIMEFRAME, ...batchParams },
    sourceName: SOURCE,
    bars: makeBars(100, 2),
  });
  dispatched.length = 0; // discard the insert dispatch; assert ONLY the re-upsert

  await persistMarketDataBars({
    request: { symbol: "AAPL", timeframe: TIMEFRAME, ...batchParams },
    sourceName: SOURCE,
    bars: makeBars(100, 2),
  });

  assert.equal(flat().length, 0, "no-op re-upsert must dispatch nothing");
});

test("a single changed bar dispatches ONLY that bar's key (unchanged sibling skipped)", async () => {
  await persistMarketDataBars({
    request: { symbol: "AAPL", timeframe: TIMEFRAME, ...batchParams },
    sourceName: SOURCE,
    bars: makeBars(100, 2),
  });
  dispatched.length = 0;

  const changed = makeBars(100, 2);
  changed[1] = { ...changed[1]!, close: 999 };
  await persistMarketDataBars({
    request: { symbol: "AAPL", timeframe: TIMEFRAME, ...batchParams },
    sourceName: SOURCE,
    bars: changed,
  });

  const got = flat();
  assert.equal(got.length, 1, "only the changed bar dispatches");
  assert.equal(got[0]!.startsAtMs, changed[1]!.timestamp.getTime());
});

test("multi-symbol: only the changed symbol dispatches", async () => {
  await persistMarketDataBarsForSymbols({
    timeframe: TIMEFRAME,
    sourceName: SOURCE,
    ...batchParams,
    bySymbol: [
      { symbol: "AAPL", bars: makeBars(100, 1) },
      { symbol: "MSFT", bars: makeBars(200, 1) },
    ],
  });
  dispatched.length = 0;

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

  const got = flat();
  assert.equal(got.length, 1);
  assert.equal(got[0]!.symbol, "AAPL");
});

test("unsubscribe stops delivery", async () => {
  unsubscribe?.();
  unsubscribe = null;
  await persistMarketDataBars({
    request: { symbol: "AAPL", timeframe: TIMEFRAME, ...batchParams },
    sourceName: SOURCE,
    bars: makeBars(100, 1),
  });
  assert.equal(flat().length, 0, "no delivery after unsubscribe");
});
