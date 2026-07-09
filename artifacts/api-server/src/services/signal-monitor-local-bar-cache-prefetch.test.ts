import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";

import { barCacheTable, db, instrumentsTable } from "@workspace/db";
import { createTestDb, type TestDatabase } from "@workspace/db/testing";

import { isMassiveStocksRealtimeConfigured } from "../lib/runtime";
import {
  __resetMarketDataStoreBackoffForTests,
  __resetStoreInstrumentCacheForTests,
  loadStoredMarketBarsForSymbols,
  loadStoredMarketBarsForSymbolsSince,
  persistMarketDataBarsForSymbols,
} from "./market-data-store";
import {
  __signalMonitorLocalBarCacheInternalsForTests,
  getSignalMonitorLocalBarCacheDiagnostics,
  loadSignalMonitorLocalBarCache,
  runWithSignalMonitorStoredBarsPrefetch,
} from "./signal-monitor-local-bar-cache";
import {
  __resetApiResourcePressureForTests,
  updateApiResourcePressure,
} from "./resource-pressure";

const TWO_HOURS_MS = 2 * 60 * 60_000;
const TIMEFRAME = "1m" as const;
// Mirror storeSourceNames() so seeded rows match what readStoredBars queries.
const SOURCES = isMassiveStocksRealtimeConfigured()
  ? ["massive-websocket", "massive-history"]
  : ["massive-delayed-websocket", "massive-history"];

let testDb: TestDatabase;
const internals = __signalMonitorLocalBarCacheInternalsForTests;
const signalMonitorSource = readFileSync(
  new URL("./signal-monitor.ts", import.meta.url),
  "utf8",
);
const localBarCacheSource = readFileSync(
  new URL("./signal-monitor-local-bar-cache.ts", import.meta.url),
  "utf8",
);
before(async () => {
  testDb = await createTestDb();
});
after(async () => {
  internals.reset();
  await testDb.cleanup();
});
beforeEach(async () => {
  internals.reset();
  __resetApiResourcePressureForTests();
  __resetMarketDataStoreBackoffForTests();
  __resetStoreInstrumentCacheForTests();
  await testDb.client.exec(
    "truncate table bar_cache, instruments restart identity cascade",
  );
});

test("database-backed Signal Matrix evaluation uses the stored-bars prefetch", () => {
  const buildFreshMatrixStart = signalMonitorSource.indexOf(
    "const buildFreshMatrixResponse = async",
  );
  const buildFreshMatrixEnd = signalMonitorSource.indexOf(
    "const buildEmptyMatrixResponse",
  );
  assert.ok(buildFreshMatrixStart > 0, "expected database matrix evaluator");
  assert.ok(
    buildFreshMatrixEnd > buildFreshMatrixStart,
    "expected database matrix evaluator end",
  );
  const buildFreshMatrixBlock = signalMonitorSource.slice(
    buildFreshMatrixStart,
    buildFreshMatrixEnd,
  );

  assert.match(
    buildFreshMatrixBlock,
    /runWithSignalMonitorStoredBarsPrefetch\(/,
  );
  assert.match(buildFreshMatrixBlock, /limit:\s*SIGNAL_MONITOR_MATRIX_BARS_LIMIT/);
});

async function seed(symbol: string, count: number): Promise<Date[]> {
  const [instrument] = await db
    .insert(instrumentsTable)
    .values({
      symbol,
      assetClass: "equity",
      name: symbol,
      currency: "USD",
      isActive: true,
    })
    .returning({ id: instrumentsTable.id });
  if (!count) {
    return [];
  }
  const base = Math.floor((Date.now() - TWO_HOURS_MS) / 60_000) * 60_000;
  const startsAt = Array.from(
    { length: count },
    (_unused, index) => new Date(base + index * 60_000),
  );
  const rows = SOURCES.flatMap((source) =>
    Array.from({ length: count }, (_unused, index) => {
      const price = 100 + index + (source === "massive-history" ? 0 : 0.1);
      return {
        instrumentId: instrument!.id,
        symbol,
        timeframe: TIMEFRAME,
        startsAt: startsAt[index]!,
        open: String(price),
        high: String(price + 0.5),
        low: String(price - 0.5),
        close: String(price + 0.25),
        volume: String((index + 1) * 1000),
        source,
      };
    }),
  );
  await db.insert(barCacheTable).values(rows);
  return startsAt;
}

test("loadSignalMonitorLocalBarCache is identical with and without the batch prefetch", async () => {
  await seed("AAPL", 4);
  await seed("MSFT", 3);
  await seed("NVDA", 0); // instrument only, no bars

  const symbols = ["AAPL", "MSFT", "NVDA"];
  const evaluatedAt = new Date();
  const limit = 50;

  const without: Record<string, unknown[]> = {};
  for (const symbol of symbols) {
    without[symbol] = await loadSignalMonitorLocalBarCache({
      symbol,
      timeframe: TIMEFRAME,
      evaluatedAt,
      limit,
    });
  }

  const withPrefetch = await runWithSignalMonitorStoredBarsPrefetch(
    { symbols, timeframes: [TIMEFRAME], evaluatedAt, limit },
    async () => {
      const out: Record<string, unknown[]> = {};
      for (const symbol of symbols) {
        out[symbol] = await loadSignalMonitorLocalBarCache({
          symbol,
          timeframe: TIMEFRAME,
          evaluatedAt,
          limit,
        });
      }
      return out;
    },
  );

  for (const symbol of symbols) {
    assert.deepEqual(
      withPrefetch[symbol],
      without[symbol],
      `prefetch path must equal non-prefetch path for ${symbol}`,
    );
  }
  // Meaningful: bars actually flowed through both paths.
  assert.ok(without["AAPL"]!.length > 0, "AAPL should return bars");
  assert.ok(without["MSFT"]!.length > 0, "MSFT should return bars");
  assert.equal(without["NVDA"]!.length, 0, "NVDA has no bars");
});

test("a mismatched evaluatedAt/limit falls through to the per-symbol path identically", async () => {
  await seed("AAPL", 4);
  const evaluatedAt = new Date();
  const limit = 50;

  const baseline = await loadSignalMonitorLocalBarCache({
    symbol: "AAPL",
    timeframe: TIMEFRAME,
    evaluatedAt,
    limit,
  });

  // Prefetch built for a DIFFERENT limit -> readStoredBars must ignore it and
  // fall back to the per-symbol read, still producing the same bars.
  const mismatched = await runWithSignalMonitorStoredBarsPrefetch(
    { symbols: ["AAPL"], timeframes: [TIMEFRAME], evaluatedAt, limit: limit + 1 },
    async () =>
      loadSignalMonitorLocalBarCache({
        symbol: "AAPL",
        timeframe: TIMEFRAME,
        evaluatedAt,
        limit,
      }),
  );

  assert.deepEqual(mismatched, baseline);
  assert.ok(baseline.length > 0);
});

test("readStoredBars accounts prefetch hits vs per-symbol fallback by reason", async () => {
  await seed("AAPL", 4);
  const evaluatedAt = new Date();
  const limit = 50;
  const read = () => getSignalMonitorLocalBarCacheDiagnostics().storedBarsRead;

  // (1) No prefetch context -> per-symbol fallback, attributed to "no prefetch".
  const before1 = read();
  await loadSignalMonitorLocalBarCache({
    symbol: "AAPL",
    timeframe: TIMEFRAME,
    evaluatedAt,
    limit,
  });
  const after1 = read();
  assert.equal(after1.fallbackCount - before1.fallbackCount, 1, "no-prefetch read is a fallback");
  assert.equal(
    after1.fallbackNoPrefetchCount - before1.fallbackNoPrefetchCount,
    1,
    "attributed to missing prefetch",
  );
  assert.equal(after1.prefetchHitCount - before1.prefetchHitCount, 0);
  assert.equal(after1.fallbackMismatchCount - before1.fallbackMismatchCount, 0);

  // (2) Matching prefetch -> served from the batch, counted as a hit (no pooled read).
  const before2 = read();
  await runWithSignalMonitorStoredBarsPrefetch(
    { symbols: ["AAPL"], timeframes: [TIMEFRAME], evaluatedAt, limit },
    async () =>
      loadSignalMonitorLocalBarCache({ symbol: "AAPL", timeframe: TIMEFRAME, evaluatedAt, limit }),
  );
  const after2 = read();
  assert.equal(after2.prefetchHitCount - before2.prefetchHitCount, 1, "matching prefetch is a hit");
  assert.equal(after2.fallbackCount - before2.fallbackCount, 0, "no fallback on a prefetch hit");

  // (3) Prefetch present but key-mismatched (different limit) -> fallback, attributed to "mismatch".
  const before3 = read();
  await runWithSignalMonitorStoredBarsPrefetch(
    { symbols: ["AAPL"], timeframes: [TIMEFRAME], evaluatedAt, limit: limit + 1 },
    async () =>
      loadSignalMonitorLocalBarCache({ symbol: "AAPL", timeframe: TIMEFRAME, evaluatedAt, limit }),
  );
  const after3 = read();
  assert.equal(
    after3.fallbackMismatchCount - before3.fallbackMismatchCount,
    1,
    "mismatched prefetch attributed to mismatch",
  );
  assert.equal(after3.fallbackNoPrefetchCount - before3.fallbackNoPrefetchCount, 0);
  assert.equal(after3.prefetchHitCount - before3.prefetchHitCount, 0);
});

test("the cross-cycle prefetch cache avoids repeated full bar_cache reads", async () => {
  await seed("AAPL", 4);
  await seed("MSFT", 3);
  let fullReads = 0;
  let deltaReads = 0;
  internals.__setLoadStoredMarketBarsForSymbolsForTests(async (input) => {
    fullReads += 1;
    return loadStoredMarketBarsForSymbols(input);
  });
  internals.__setLoadStoredMarketBarsForSymbolsSinceForTests(async (input) => {
    deltaReads += 1;
    return loadStoredMarketBarsForSymbolsSince(input);
  });

  const symbols = ["AAPL", "MSFT"];
  const evaluatedAt = new Date();
  const limit = 50;
  const loadAll = async () =>
    runWithSignalMonitorStoredBarsPrefetch(
      { symbols, timeframes: [TIMEFRAME], evaluatedAt, limit },
      async () => {
        const out: Record<string, unknown[]> = {};
        for (const symbol of symbols) {
          out[symbol] = await loadSignalMonitorLocalBarCache({
            symbol,
            timeframe: TIMEFRAME,
            evaluatedAt,
            limit,
          });
        }
        return out;
      },
    );

  const first = await loadAll();
  assert.equal(fullReads, SOURCES.length);
  assert.equal(deltaReads, 0);

  const second = await loadAll();
  assert.deepEqual(second, first);
  assert.equal(
    fullReads,
    SOURCES.length,
    "second cycle should serve cached closed bars without full DB reads",
  );
  assert.equal(deltaReads, 0);
});

test("above-high-water persisted bars use the delta reader instead of full reload", async () => {
  const startsAt = await seed("AAPL", 2);
  let fullReads = 0;
  let deltaReads = 0;
  internals.__setLoadStoredMarketBarsForSymbolsForTests(async (input) => {
    fullReads += 1;
    return loadStoredMarketBarsForSymbols(input);
  });
  internals.__setLoadStoredMarketBarsForSymbolsSinceForTests(async (input) => {
    deltaReads += 1;
    return loadStoredMarketBarsForSymbolsSince(input);
  });

  const evaluatedAt = new Date();
  const limit = 50;
  const loadAapl = async () =>
    runWithSignalMonitorStoredBarsPrefetch(
      { symbols: ["AAPL"], timeframes: [TIMEFRAME], evaluatedAt, limit },
      () =>
        loadSignalMonitorLocalBarCache({
          symbol: "AAPL",
          timeframe: TIMEFRAME,
          evaluatedAt,
          limit,
        }),
    );

  await loadAapl();
  assert.equal(fullReads, SOURCES.length);

  const appendedAt = new Date(startsAt.at(-1)!.getTime() + 60_000);
  const beforeInvalidation =
    getSignalMonitorLocalBarCacheDiagnostics().storedBarsCache;
  await persistMarketDataBarsForSymbols({
    timeframe: TIMEFRAME,
    sourceName: SOURCES[0]!,
    assetClass: "equity",
    outsideRth: true,
    source: "trades",
    recentWindowMinutes: 0,
    bySymbol: [
      {
        symbol: "AAPL",
        bars: [
          {
            timestamp: appendedAt,
            open: 150,
            high: 151,
            low: 149,
            close: 150.5,
            volume: 5_000,
          },
        ],
      },
    ],
  });
  const afterInvalidation =
    getSignalMonitorLocalBarCacheDiagnostics().storedBarsCache;
  assert.equal(
    afterInvalidation.invalidationEventsCount -
      beforeInvalidation.invalidationEventsCount,
    1,
    "one appended row dispatches one invalidation event",
  );
  assert.equal(
    afterInvalidation.invalidationCount - beforeInvalidation.invalidationCount,
    1,
    "one cached source cell is marked by that event",
  );
  assert.equal(
    afterInvalidation.invalidationDeltaDueCount -
      beforeInvalidation.invalidationDeltaDueCount,
    1,
    "append above high-water is counted as delta-due",
  );
  assert.equal(
    afterInvalidation.invalidationFullCount -
      beforeInvalidation.invalidationFullCount,
    0,
  );

  const afterAppend = await loadAapl();
  assert.equal(
    fullReads,
    SOURCES.length,
    "append above high-water should not force a full prefetch reload",
  );
  assert.equal(deltaReads, 1);
  assert.ok(
    afterAppend.some((bar) => bar.timestamp.getTime() === appendedAt.getTime()),
    "delta row should be visible after the append",
  );
});

test("below-high-water persisted changes invalidate the affected source cell", async () => {
  const startsAt = await seed("AAPL", 3);
  let fullReads = 0;
  let deltaReads = 0;
  internals.__setLoadStoredMarketBarsForSymbolsForTests(async (input) => {
    fullReads += 1;
    return loadStoredMarketBarsForSymbols(input);
  });
  internals.__setLoadStoredMarketBarsForSymbolsSinceForTests(async (input) => {
    deltaReads += 1;
    return loadStoredMarketBarsForSymbolsSince(input);
  });

  const evaluatedAt = new Date();
  const limit = 50;
  const loadAapl = async () =>
    runWithSignalMonitorStoredBarsPrefetch(
      { symbols: ["AAPL"], timeframes: [TIMEFRAME], evaluatedAt, limit },
      () =>
        loadSignalMonitorLocalBarCache({
          symbol: "AAPL",
          timeframe: TIMEFRAME,
          evaluatedAt,
          limit,
        }),
    );

  await loadAapl();
  assert.equal(fullReads, SOURCES.length);

  const beforeInvalidation =
    getSignalMonitorLocalBarCacheDiagnostics().storedBarsCache;
  await persistMarketDataBarsForSymbols({
    timeframe: TIMEFRAME,
    sourceName: SOURCES[0]!,
    assetClass: "equity",
    outsideRth: true,
    source: "trades",
    recentWindowMinutes: 0,
    bySymbol: [
      {
        symbol: "AAPL",
        bars: [
          {
            timestamp: startsAt[0]!,
            open: 175,
            high: 176,
            low: 174,
            close: 175.5,
            volume: 7_500,
          },
        ],
      },
    ],
  });
  const afterInvalidation =
    getSignalMonitorLocalBarCacheDiagnostics().storedBarsCache;
  assert.equal(
    afterInvalidation.invalidationEventsCount -
      beforeInvalidation.invalidationEventsCount,
    1,
    "one changed historical row dispatches one invalidation event",
  );
  assert.equal(
    afterInvalidation.invalidationCount - beforeInvalidation.invalidationCount,
    1,
    "one cached source cell is marked by that event",
  );
  assert.equal(
    afterInvalidation.invalidationFullCount -
      beforeInvalidation.invalidationFullCount,
    1,
    "below-high-water change is counted as a full invalidation",
  );
  assert.equal(
    afterInvalidation.invalidationDeltaDueCount -
      beforeInvalidation.invalidationDeltaDueCount,
    0,
  );

  await loadAapl();
  assert.equal(
    fullReads,
    SOURCES.length + 1,
    "only the changed below-high-water source should do a full refresh",
  );
  assert.equal(deltaReads, 0);
});

test("stored-bar invalidation diagnostics separate change events from per-cell branch counts", async () => {
  const startsAt = await seed("AAPL", 2);
  const evaluatedAt = new Date();
  await runWithSignalMonitorStoredBarsPrefetch(
    { symbols: ["AAPL"], timeframes: [TIMEFRAME], evaluatedAt, limit: 50 },
    async () => null,
  );
  await runWithSignalMonitorStoredBarsPrefetch(
    { symbols: ["AAPL"], timeframes: [TIMEFRAME], evaluatedAt, limit: 3 },
    async () => null,
  );

  const appendedAt = new Date(startsAt.at(-1)!.getTime() + 60_000);
  const beforeInvalidation =
    getSignalMonitorLocalBarCacheDiagnostics().storedBarsCache;
  await persistMarketDataBarsForSymbols({
    timeframe: TIMEFRAME,
    sourceName: SOURCES[0]!,
    assetClass: "equity",
    outsideRth: true,
    source: "trades",
    recentWindowMinutes: 0,
    bySymbol: [
      {
        symbol: "AAPL",
        bars: [
          {
            timestamp: appendedAt,
            open: 150,
            high: 151,
            low: 149,
            close: 150.5,
            volume: 5_000,
          },
        ],
      },
    ],
  });

  const afterInvalidation =
    getSignalMonitorLocalBarCacheDiagnostics().storedBarsCache;
  assert.equal(
    afterInvalidation.invalidationEventsCount -
      beforeInvalidation.invalidationEventsCount,
    1,
    "one changed row is one received event",
  );
  assert.equal(
    afterInvalidation.invalidationCount - beforeInvalidation.invalidationCount,
    2,
    "the event fans out to both cached limit variants for the same base key",
  );
  assert.equal(
    afterInvalidation.invalidationDeltaDueCount -
      beforeInvalidation.invalidationDeltaDueCount,
    2,
  );
  assert.equal(
    afterInvalidation.invalidationFullCount -
      beforeInvalidation.invalidationFullCount,
    0,
  );
});

test("event-loop-only pressure does not suppress stored-bar DB augmentation", async () => {
  let fullReads = 0;
  let deltaReads = 0;
  internals.__setLoadStoredMarketBarsForSymbolsForTests(async () => {
    fullReads += 1;
    return new Map();
  });
  internals.__setLoadStoredMarketBarsForSymbolsSinceForTests(async () => {
    deltaReads += 1;
    return new Map();
  });
  updateApiResourcePressure({ eventLoopUtilization: 0.95 });

  await runWithSignalMonitorStoredBarsPrefetch(
    {
      symbols: ["AAPL", "MSFT"],
      timeframes: [TIMEFRAME],
      evaluatedAt: new Date(),
      limit: 50,
    },
    async () => null,
  );

  assert.equal(fullReads, SOURCES.length);
  assert.equal(deltaReads, 0);
});

test("high API pressure skips unbatched stored-bar fallback reads", async () => {
  await seed("AAPL", 4);
  updateApiResourcePressure({ eventLoopUtilization: 0.95 });

  const before = getSignalMonitorLocalBarCacheDiagnostics().storedBarsRead;
  const bars = await loadSignalMonitorLocalBarCache({
    symbol: "AAPL",
    timeframe: TIMEFRAME,
    evaluatedAt: new Date(),
    limit: 50,
  });
  const after = getSignalMonitorLocalBarCacheDiagnostics().storedBarsRead;

  assert.deepEqual(bars, []);
  assert.equal(after.pressureSkipCount - before.pressureSkipCount, 1);
  assert.equal(after.fallbackCount - before.fallbackCount, 0);
});

test("finite DB-pool pressure skips stored-bar DB augmentation without fallback reads", async () => {
  internals.__setLoadStoredMarketBarsForSymbolsForTests(async () => {
    throw new Error("full stored-bar prefetch should be skipped");
  });
  internals.__setLoadStoredMarketBarsForSymbolsSinceForTests(async () => {
    throw new Error("delta stored-bar prefetch should be skipped");
  });
  updateApiResourcePressure({ dbPoolActive: 12, dbPoolWaiting: 8, dbPoolMax: 12 });
  updateApiResourcePressure({ dbPoolActive: 12, dbPoolWaiting: 8, dbPoolMax: 12 });

  const evaluatedAt = new Date();
  const bars = await runWithSignalMonitorStoredBarsPrefetch(
    {
      symbols: ["AAPL", "MSFT"],
      timeframes: [TIMEFRAME],
      evaluatedAt,
      limit: 50,
    },
    () =>
      loadSignalMonitorLocalBarCache({
        symbol: "AAPL",
        timeframe: TIMEFRAME,
        evaluatedAt,
        limit: 50,
      }),
  );

  assert.deepEqual(bars, []);
  const diagnostics = getSignalMonitorLocalBarCacheDiagnostics();
  assert.equal(diagnostics.storedBarsCache.fullReadCount, 0);
  assert.equal(diagnostics.storedBarsCache.deltaReadCount, 0);
  assert.equal(diagnostics.storedBarsRead.prefetchHitCount, 1);
  assert.equal(diagnostics.storedBarsRead.fallbackCount, 0);
  assert.equal(diagnostics.storedBarsRead.pressureSkipCount, 1);
  assert.match(
    diagnostics.storedBarsRead.lastPressureSkippedAt ?? "",
    /^\d{4}-\d{2}-\d{2}T/,
  );
});

test("stored-bar prefetch chunks broad symbol batches by row budget before reading bar_cache", async () => {
  const batchSizes: number[] = [];
  const loadedPairs = new Set<string>();
  internals.__setLoadStoredMarketBarsForSymbolsForTests(async (input) => {
    batchSizes.push(input.symbols.length);
    for (const symbol of input.symbols) {
      loadedPairs.add(`${input.sourceName}:${symbol}`);
    }
    return new Map();
  });

  const symbols = Array.from({ length: 80 }, (_unused, index) => `SYM${index}`);
  await runWithSignalMonitorStoredBarsPrefetch(
    {
      symbols,
      timeframes: [TIMEFRAME],
      evaluatedAt: new Date(),
      limit: 50,
    },
    async () => null,
  );

  assert.ok(
    batchSizes.length > SOURCES.length,
    "broad stored-bar prefetch should be split per source",
  );
  assert.ok(
    batchSizes.every((size) => size > 0 && size <= 9),
    `expected every DB read to stay within the 480-row budget for limit=50, got ${batchSizes.join(", ")}`,
  );
  assert.equal(loadedPairs.size, symbols.length * SOURCES.length);
});

test("stored-bar prefetch no longer has a fixed 32-symbol ceiling", async () => {
  const batchSizes: number[] = [];
  internals.__setLoadStoredMarketBarsForSymbolsForTests(async (input) => {
    batchSizes.push(input.symbols.length);
    return new Map();
  });

  const symbols = Array.from({ length: 80 }, (_unused, index) => `SYM${index}`);
  await runWithSignalMonitorStoredBarsPrefetch(
    {
      symbols,
      timeframes: [TIMEFRAME],
      evaluatedAt: new Date(),
      limit: 3,
    },
    async () => null,
  );

  assert.ok(
    batchSizes.some((size) => size > 32),
    `expected low-limit reads to batch beyond the removed 32-symbol ceiling, got ${batchSizes.join(", ")}`,
  );
  assert.ok(
    batchSizes.every((size) => size > 0 && size <= 160),
    `expected low-limit reads to stay within the 480-row budget for limit=3, got ${batchSizes.join(", ")}`,
  );
  assert.doesNotMatch(
    localBarCacheSource,
    /STORED_BARS_PREFETCH_MAX_SYMBOL_BATCH_SIZE/,
  );
});

test("stored-bar prefetch shrinks high-limit full reads down to the 8-symbol floor", async () => {
  const batchSizes: number[] = [];
  internals.__setLoadStoredMarketBarsForSymbolsForTests(async (input) => {
    batchSizes.push(input.symbols.length);
    return new Map();
  });

  const symbols = Array.from({ length: 40 }, (_unused, index) => `SYM${index}`);
  await runWithSignalMonitorStoredBarsPrefetch(
    {
      symbols,
      timeframes: [TIMEFRAME],
      evaluatedAt: new Date(),
      limit: 240,
    },
    async () => null,
  );

  // floor(480 / 240) = 2 by row budget alone, but the 8-symbol floor keeps full
  // OHLCV reads from degrading toward one pooled acquisition per symbol.
  assert.ok(
    batchSizes.every((size) => size > 0 && size <= 8),
    `expected high-limit full reads to stay at/under the 8-symbol floor, got ${batchSizes.join(", ")}`,
  );
  assert.ok(
    batchSizes.every((size) => size >= 8),
    `expected the 8-symbol floor to prevent one-symbol-per-query reads, got ${batchSizes.join(", ")}`,
  );
});

test("full-read symbol batch size never drops below the 8-symbol floor", () => {
  const sizeFor = internals.storedBarsPrefetchSymbolBatchSize;
  // High limits are clamped up to the floor rather than shrinking toward 1.
  assert.equal(sizeFor(240), 8);
  assert.equal(sizeFor(480), 8);
  assert.equal(sizeFor(1000), 8);
  // The 480-row budget still widens batches when the per-symbol limit is small.
  assert.equal(sizeFor(50), 9);
  assert.equal(sizeFor(3), 160);
  // Degenerate limits still respect the floor.
  for (const limit of [0, -5, Number.NaN, 240, 999]) {
    assert.ok(
      sizeFor(limit) >= 8,
      `expected batch size >= 8 for limit=${String(limit)}, got ${sizeFor(limit)}`,
    );
  }
});

test("default stored-bar cache holds the normal full-universe prefetch footprint", async () => {
  const originalMaxCells =
    process.env["PYRUS_SIGNAL_MONITOR_STORED_BARS_CACHE_MAX_CELLS"];
  delete process.env["PYRUS_SIGNAL_MONITOR_STORED_BARS_CACHE_MAX_CELLS"];

  const symbols = Array.from(
    { length: 1001 },
    (_unused, index) => `UNIV${index}`,
  );
  const timeframes = ["1m", "2m", "5m", "15m", "1h", "1d"];
  const requiredCells = symbols.length * timeframes.length * SOURCES.length;
  let fullReadCalls = 0;
  internals.__setLoadStoredMarketBarsForSymbolsForTests(async () => {
    fullReadCalls += 1;
    return new Map();
  });

  try {
    const evaluatedAt = new Date();
    await runWithSignalMonitorStoredBarsPrefetch(
      {
        symbols,
        timeframes,
        evaluatedAt,
        limit: 3,
      },
      async () => null,
    );
    const afterFirst = getSignalMonitorLocalBarCacheDiagnostics().storedBarsCache;
    assert.ok(
      afterFirst.maxCells >= requiredCells,
      `default cache cap ${afterFirst.maxCells} must hold ${requiredCells} cells`,
    );
    assert.equal(afterFirst.cellCount, requiredCells);
    assert.equal(afterFirst.evictionCount, 0);

    const callsAfterFirst = fullReadCalls;
    await runWithSignalMonitorStoredBarsPrefetch(
      {
        symbols,
        timeframes,
        evaluatedAt,
        limit: 3,
      },
      async () => null,
    );
    const afterSecond =
      getSignalMonitorLocalBarCacheDiagnostics().storedBarsCache;
    assert.equal(
      fullReadCalls,
      callsAfterFirst,
      "second identical prefetch should be served entirely from cache",
    );
    assert.ok(
      afterSecond.hitCount >= requiredCells,
      `expected at least ${requiredCells} cache hits, got ${afterSecond.hitCount}`,
    );
    assert.equal(afterSecond.evictionCount, 0);
  } finally {
    if (originalMaxCells === undefined) {
      delete process.env["PYRUS_SIGNAL_MONITOR_STORED_BARS_CACHE_MAX_CELLS"];
    } else {
      process.env["PYRUS_SIGNAL_MONITOR_STORED_BARS_CACHE_MAX_CELLS"] =
        originalMaxCells;
    }
  }
});

test("delta reads batch by the wide delta constant, not the limit-based full-read size", async () => {
  const symbols = Array.from({ length: 40 }, (_unused, index) => `DSYM${index}`);
  for (const symbol of symbols) {
    await seed(symbol, 2);
  }

  const limit = 240;
  const bucketMs = 60_000; // 1m timeframe bucket
  // Cycle 1 evaluatedAt floored to a minute so cycle 2 lands in the next bucket,
  // advancing every cell into the delta path without any bar_cache mutation.
  const cycle1EvaluatedAt = new Date(
    Math.floor(Date.now() / bucketMs) * bucketMs,
  );
  const cycle2EvaluatedAt = new Date(cycle1EvaluatedAt.getTime() + bucketMs);

  const deltaBatchSizes: number[] = [];
  internals.__setLoadStoredMarketBarsForSymbolsSinceForTests(async (input) => {
    deltaBatchSizes.push(input.symbols.length);
    return new Map();
  });

  // Cycle 1: full read populates the cross-cycle cache (real DB loader).
  await runWithSignalMonitorStoredBarsPrefetch(
    { symbols, timeframes: [TIMEFRAME], evaluatedAt: cycle1EvaluatedAt, limit },
    async () => null,
  );
  assert.equal(deltaBatchSizes.length, 0, "cycle 1 should not read deltas");

  // Cycle 2: next bucket -> every symbol takes the delta path.
  await runWithSignalMonitorStoredBarsPrefetch(
    { symbols, timeframes: [TIMEFRAME], evaluatedAt: cycle2EvaluatedAt, limit },
    async () => null,
  );

  assert.ok(deltaBatchSizes.length > 0, "cycle 2 should read deltas");
  // Full-read sizing at limit 240 would cap each query at 8 symbols; the delta
  // path coalesces far wider because delta rows are bounded by the high-water
  // filter, not by `limit`.
  const fullReadBatch = internals.storedBarsPrefetchSymbolBatchSize(limit);
  assert.equal(fullReadBatch, 8, "sanity: full-read batch would be 8 at limit 240");
  assert.ok(
    Math.max(...deltaBatchSizes) > fullReadBatch,
    `expected delta batches wider than the ${fullReadBatch}-symbol full-read size, got ${deltaBatchSizes.join(", ")}`,
  );
  assert.ok(
    deltaBatchSizes.every(
      (size) => size > 0 && size <= internals.STORED_BARS_DELTA_SYMBOL_BATCH,
    ),
    `expected delta batches within the ${internals.STORED_BARS_DELTA_SYMBOL_BATCH}-symbol delta cap, got ${deltaBatchSizes.join(", ")}`,
  );
});

test("stored-bar prefetch uses bounded concurrency", async () => {
  const originalConcurrency =
    process.env["PYRUS_SIGNAL_MONITOR_STORED_BARS_PREFETCH_CONCURRENCY"];
  process.env["PYRUS_SIGNAL_MONITOR_STORED_BARS_PREFETCH_CONCURRENCY"] = "1";

  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  internals.__setLoadStoredMarketBarsForSymbolsForTests(async () => {
    calls += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return new Map();
  });

  try {
    await runWithSignalMonitorStoredBarsPrefetch(
      {
        symbols: ["AAPL", "MSFT"],
        timeframes: ["1m", "5m"],
        evaluatedAt: new Date(),
        limit: 50,
      },
      async () => null,
    );
  } finally {
    if (originalConcurrency === undefined) {
      delete process.env["PYRUS_SIGNAL_MONITOR_STORED_BARS_PREFETCH_CONCURRENCY"];
    } else {
      process.env["PYRUS_SIGNAL_MONITOR_STORED_BARS_PREFETCH_CONCURRENCY"] =
        originalConcurrency;
    }
  }

  assert.equal(calls, SOURCES.length * 2);
  assert.equal(maxInFlight, 1);
});

test("stored-bar prefetch defaults to one durable read at a time", async () => {
  const originalConcurrency =
    process.env["PYRUS_SIGNAL_MONITOR_STORED_BARS_PREFETCH_CONCURRENCY"];
  delete process.env["PYRUS_SIGNAL_MONITOR_STORED_BARS_PREFETCH_CONCURRENCY"];

  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  internals.__setLoadStoredMarketBarsForSymbolsForTests(async () => {
    calls += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return new Map();
  });

  try {
    await runWithSignalMonitorStoredBarsPrefetch(
      {
        symbols: ["AAPL", "MSFT"],
        timeframes: ["1m", "5m"],
        evaluatedAt: new Date(),
        limit: 50,
      },
      async () => null,
    );
  } finally {
    if (originalConcurrency === undefined) {
      delete process.env["PYRUS_SIGNAL_MONITOR_STORED_BARS_PREFETCH_CONCURRENCY"];
    } else {
      process.env["PYRUS_SIGNAL_MONITOR_STORED_BARS_PREFETCH_CONCURRENCY"] =
        originalConcurrency;
    }
  }

  assert.equal(calls, SOURCES.length * 2);
  assert.equal(maxInFlight, 1);
});
