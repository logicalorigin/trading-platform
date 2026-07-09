import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import {
  barCacheTable,
  db,
  instrumentsTable,
} from "@workspace/db";
import { createTestDb, type TestDatabase } from "@workspace/db/testing";

import {
  loadStoredMarketBars,
  loadStoredMarketBarsBySymbol,
  loadStoredMarketBarsForSymbols,
  loadStoredMarketBarsForSymbolsSince,
  onBarCacheRowsChanged,
  persistMarketDataBars,
  persistMarketDataBarsMixed,
  type BarCacheChange,
  __resetMarketDataStoreBackoffForTests,
  __resetStoreInstrumentCacheForTests,
} from "./market-data-store";
import {
  __resetApiResourcePressureForTests,
  updateApiResourcePressure,
} from "./resource-pressure";

// Bars must sit OUTSIDE the durable store's recent-window (default 60 min): the
// reader intentionally only serves bars older than that boundary. Anchor the
// seed two hours back so the window includes them.
const TWO_HOURS_MS = 2 * 60 * 60_000;

let testDb: TestDatabase;

before(async () => {
  testDb = await createTestDb();
});

after(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  __resetApiResourcePressureForTests();
  __resetMarketDataStoreBackoffForTests();
  __resetStoreInstrumentCacheForTests();
  // Fresh state per test: truncate the tables this suite touches.
  await testDb.client.exec(
    "truncate table bar_cache, instruments restart identity cascade",
  );
});

async function seedBars(input: {
  symbol: string;
  sourceName: string;
  timeframe: "1m";
}): Promise<Date[]> {
  const [instrument] = await db
    .insert(instrumentsTable)
    .values({
      symbol: input.symbol,
      assetClass: "equity",
      name: input.symbol,
      currency: "USD",
      isActive: true,
    })
    .returning({ id: instrumentsTable.id });
  assert.ok(instrument?.id, "instrument should be inserted into PGlite");

  const olderTs = new Date(
    Math.floor((Date.now() - TWO_HOURS_MS) / 60_000) * 60_000,
  );
  const newerTs = new Date(olderTs.getTime() + 60_000);
  await db.insert(barCacheTable).values([
    {
      instrumentId: instrument.id,
      symbol: input.symbol,
      timeframe: input.timeframe,
      startsAt: olderTs,
      open: "100.5",
      high: "101.25",
      low: "100.0",
      close: "101.0",
      volume: "1000",
      source: input.sourceName,
    },
    {
      instrumentId: instrument.id,
      symbol: input.symbol,
      timeframe: input.timeframe,
      startsAt: newerTs,
      open: "101.0",
      high: "102.5",
      low: "100.75",
      close: "102.0",
      volume: "2000",
      source: input.sourceName,
    },
  ]);
  return [olderTs, newerTs];
}

test("loadStoredMarketBars returns seeded bar_cache rows via the real reader", async () => {
  const symbol = "AAPL";
  const sourceName = "massive";
  const timeframe = "1m" as const;

  // The reader buckets bars to the timeframe boundary (1m -> floor to minute),
  // so seed on exact minute boundaries to keep returned timestamps equal to the
  // seeded ones.
  const [olderTs, newerTs] = await seedBars({ symbol, sourceName, timeframe });

  const bars = await loadStoredMarketBars({
    symbol,
    timeframe,
    sourceName,
    limit: 100,
  });

  assert.equal(bars.length, 2, "both seeded bars should be returned");

  // Ascending by timestamp.
  const [first, second] = bars;
  assert.equal(first.timestamp.getTime(), olderTs.getTime());
  assert.equal(second.timestamp.getTime(), newerTs.getTime());

  // numeric columns come back as strings from pg; the reader coerces to number.
  assert.deepEqual(
    { open: first.open, high: first.high, low: first.low, close: first.close, volume: first.volume },
    { open: 100.5, high: 101.25, low: 100, close: 101, volume: 1000 },
  );
  assert.deepEqual(
    { open: second.open, high: second.high, low: second.low, close: second.close, volume: second.volume },
    { open: 101, high: 102.5, low: 100.75, close: 102, volume: 2000 },
  );
  assert.equal(first.source, sourceName);
});

test("durable bar reads continue while API pressure is high", async () => {
  const symbol = "AAPL";
  const sourceName = "massive";
  const timeframe = "1m" as const;
  await seedBars({ symbol, sourceName, timeframe });
  updateApiResourcePressure({ eventLoopUtilization: 0.95 });

  const bars = await loadStoredMarketBars({
    symbol,
    timeframe,
    sourceName,
    limit: 100,
  });

  assert.equal(bars.length, 2);
});

test("durable bar reads yield to hard DB-pool pressure", async () => {
  const symbol = "AAPL";
  const sourceName = "massive";
  const timeframe = "1m" as const;
  const [olderTs] = await seedBars({ symbol, sourceName, timeframe });
  updateApiResourcePressure({ dbPoolActive: 12, dbPoolWaiting: 8, dbPoolMax: 12 });
  updateApiResourcePressure({ dbPoolActive: 12, dbPoolWaiting: 8, dbPoolMax: 12 });

  const single = await loadStoredMarketBars({
    symbol,
    timeframe,
    sourceName,
    limit: 100,
  });
  const bySymbol = await loadStoredMarketBarsBySymbol({
    symbols: [symbol],
    timeframe,
    sourceName,
    limit: 100,
  });
  const batch = await loadStoredMarketBarsForSymbols({
    symbols: [symbol],
    timeframe,
    sourceName,
    limit: 100,
  });
  const delta = await loadStoredMarketBarsForSymbolsSince({
    symbols: [symbol],
    timeframe,
    sourceName,
    limit: 100,
    after: olderTs,
  });

  assert.deepEqual(single, []);
  assert.deepEqual(bySymbol, {});
  assert.equal(batch.size, 0);
  assert.equal(delta.size, 0);
});

test("loadStoredMarketBars filters by source and timeframe", async () => {
  const symbol = "MSFT";
  const baseTs = new Date(Math.floor((Date.now() - TWO_HOURS_MS) / 60_000) * 60_000);

  const [instrument] = await db
    .insert(instrumentsTable)
    .values({ symbol, assetClass: "equity", name: symbol, currency: "USD", isActive: true })
    .returning({ id: instrumentsTable.id });

  await db.insert(barCacheTable).values([
    // wanted
    { instrumentId: instrument.id, symbol, timeframe: "1m", startsAt: baseTs, open: "1", high: "1", low: "1", close: "1", volume: "1", source: "massive" },
    // wrong source
    { instrumentId: instrument.id, symbol, timeframe: "1m", startsAt: new Date(baseTs.getTime() + 60_000), open: "9", high: "9", low: "9", close: "9", volume: "9", source: "ibkr" },
    // wrong timeframe
    { instrumentId: instrument.id, symbol, timeframe: "5m", startsAt: new Date(baseTs.getTime() + 120_000), open: "9", high: "9", low: "9", close: "9", volume: "9", source: "massive" },
  ]);

  const bars = await loadStoredMarketBars({ symbol, timeframe: "1m", sourceName: "massive", limit: 100 });

  assert.equal(bars.length, 1, "only the matching (source, timeframe) bar should return");
  assert.equal(bars[0].close, 1);
});

test("durable readers ignore stale dirty rows not aligned to the requested timeframe", async () => {
  const symbol = "SPY";
  const sourceName = "massive-history";
  const baseTs = new Date(
    Math.floor((Date.now() - TWO_HOURS_MS) / (15 * 60_000)) * 15 * 60_000,
  );

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

  assert.ok(instrument?.id, "instrument should be inserted into PGlite");

  await db.insert(barCacheTable).values([
    {
      instrumentId: instrument.id,
      symbol,
      timeframe: "15m",
      startsAt: baseTs,
      open: "100",
      high: "101",
      low: "99",
      close: "100",
      volume: "1000",
      source: sourceName,
    },
    {
      instrumentId: instrument.id,
      symbol,
      timeframe: "15m",
      startsAt: new Date(baseTs.getTime() + 4 * 60_000),
      open: "900",
      high: "901",
      low: "899",
      close: "900",
      volume: "9000",
      source: sourceName,
    },
    {
      instrumentId: instrument.id,
      symbol,
      timeframe: "15m",
      startsAt: new Date(baseTs.getTime() + 15 * 60_000),
      open: "101",
      high: "102",
      low: "100",
      close: "101",
      volume: "1100",
      source: sourceName,
    },
    {
      instrumentId: instrument.id,
      symbol,
      timeframe: "15m",
      startsAt: new Date(baseTs.getTime() + 19 * 60_000),
      open: "901",
      high: "902",
      low: "900",
      close: "901",
      volume: "9100",
      source: sourceName,
    },
  ]);

  const perSymbol = await loadStoredMarketBars({
    symbol,
    timeframe: "15m",
    sourceName,
    limit: 10,
  });
  const batched = await loadStoredMarketBarsForSymbols({
    symbols: [symbol],
    timeframe: "15m",
    sourceName,
    limit: 10,
  });

  assert.deepEqual(
    perSymbol.map((bar) => [bar.timestamp.getTime(), bar.close]),
    [
      [baseTs.getTime(), 100],
      [baseTs.getTime() + 15 * 60_000, 101],
    ],
  );
  assert.deepEqual(batched.get(symbol), perSymbol);
});

test("durable writer normalizes misaligned intraday bars before they enter bar_cache", async () => {
  const symbol = "SPY";
  const sourceName = "massive-history";
  const baseTs = new Date(
    Math.floor((Date.now() - TWO_HOURS_MS) / (15 * 60_000)) * 15 * 60_000,
  );

  await persistMarketDataBars({
    request: {
      symbol,
      assetClass: "equity",
      timeframe: "15m",
      limit: 10,
    },
    sourceName,
    bars: [
      {
        timestamp: baseTs,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1000,
      },
      {
        timestamp: new Date(baseTs.getTime() + 4 * 60_000),
        open: 100,
        high: 105,
        low: 98,
        close: 104,
        volume: 4000,
      },
      {
        timestamp: new Date(baseTs.getTime() + 15 * 60_000),
        open: 101,
        high: 102,
        low: 100,
        close: 101,
        volume: 1100,
      },
      {
        timestamp: new Date(baseTs.getTime() + 19 * 60_000),
        open: 101,
        high: 106,
        low: 99,
        close: 105,
        volume: 4100,
      },
    ],
  });

  const storedRows = await db.select().from(barCacheTable);
  assert.deepEqual(
    storedRows
      .map((row) => row.startsAt.getTime())
      .sort((left, right) => left - right),
    [baseTs.getTime(), baseTs.getTime() + 15 * 60_000],
  );

  const perSymbol = await loadStoredMarketBars({
    symbol,
    timeframe: "15m",
    sourceName,
    limit: 2,
  });
  const batched = await loadStoredMarketBarsForSymbols({
    symbols: [symbol],
    timeframe: "15m",
    sourceName,
    limit: 2,
  });
  const sparkline = await loadStoredMarketBarsBySymbol({
    symbols: [symbol],
    timeframe: "15m",
    sourceName,
    limit: 2,
  });

  const expected = [
    [baseTs.getTime(), 104],
    [baseTs.getTime() + 15 * 60_000, 105],
  ];
  assert.deepEqual(
    perSymbol.map((bar) => [bar.timestamp.getTime(), bar.close]),
    expected,
  );
  assert.deepEqual(
    (batched.get(symbol) ?? []).map((bar) => [
      bar.timestamp.getTime(),
      bar.close,
    ]),
    expected,
  );
  assert.deepEqual(
    (sparkline[symbol] ?? []).map((bar) => [
      bar.timestamp.getTime(),
      bar.close,
    ]),
    expected,
  );
});

test("bar-cache notifications classify tail appends and historical corrections against the pre-write max", async () => {
  const symbol = "AAPL";
  const sourceName = "massive-history";
  const timeframe = "1m" as const;
  const base = Math.floor((Date.now() - TWO_HOURS_MS) / 60_000) * 60_000;
  const bars = [0, 1, 2, 3].map((offset) => ({
    timestamp: new Date(base + offset * 60_000),
    open: 100 + offset,
    high: 101 + offset,
    low: 99 + offset,
    close: 100.5 + offset,
    volume: 1_000 + offset,
  }));
  const dispatched: BarCacheChange[][] = [];
  const unsubscribe = onBarCacheRowsChanged((changes) =>
    dispatched.push(changes),
  );

  try {
    await persistMarketDataBars({
      request: { symbol, timeframe, assetClass: "equity" },
      sourceName,
      bars: bars.slice(0, 2),
    });
    assert.equal(dispatched.flat().length, 2);
    assert.ok(dispatched.flat().every((change) => change.kind === "append"));
    assert.ok(
      dispatched
        .flat()
        .every((change) => change.maxStartsAtMs === bars[1]!.timestamp.getTime()),
    );

    dispatched.length = 0;
    await persistMarketDataBars({
      request: { symbol, timeframe, assetClass: "equity" },
      sourceName,
      bars: [bars[2]!],
    });
    assert.deepEqual(dispatched.flat(), [
      {
        symbol,
        timeframe,
        sourceName,
        startsAtMs: bars[2]!.timestamp.getTime(),
        maxStartsAtMs: bars[2]!.timestamp.getTime(),
        kind: "append",
      },
    ]);

    dispatched.length = 0;
    await persistMarketDataBars({
      request: { symbol, timeframe, assetClass: "equity" },
      sourceName,
      bars: [{ ...bars[0]!, close: 999 }, bars[3]!],
    });
    const correction = dispatched.flat();
    assert.equal(correction.length, 2);
    assert.ok(correction.every((change) => change.kind === "historical"));
    assert.ok(
      correction.every(
        (change) => change.maxStartsAtMs === bars[3]!.timestamp.getTime(),
      ),
    );
  } finally {
    unsubscribe();
  }
});

test("mixed bar-cache writes classify each symbol/timeframe/source tuple independently", async () => {
  const sourceName = "massive-history";
  const base = Math.floor((Date.now() - TWO_HOURS_MS) / 60_000) * 60_000;
  const makeBar = (symbolOffset: number, minuteOffset: number) => ({
    timestamp: new Date(base + minuteOffset * 60_000),
    open: 100 + symbolOffset + minuteOffset,
    high: 101 + symbolOffset + minuteOffset,
    low: 99 + symbolOffset + minuteOffset,
    close: 100.5 + symbolOffset + minuteOffset,
    volume: 1_000 + minuteOffset,
  });
  const dispatched: BarCacheChange[][] = [];
  const unsubscribe = onBarCacheRowsChanged((changes) =>
    dispatched.push(changes),
  );

  try {
    await persistMarketDataBarsMixed({
      assetClass: "equity",
      entries: [
        { symbol: "AAPL", timeframe: "1m", sourceName, bars: [makeBar(0, 0)] },
        { symbol: "MSFT", timeframe: "1m", sourceName, bars: [makeBar(50, 0)] },
      ],
    });
    dispatched.length = 0;

    await persistMarketDataBarsMixed({
      assetClass: "equity",
      entries: [
        { symbol: "AAPL", timeframe: "1m", sourceName, bars: [makeBar(0, 1)] },
        {
          symbol: "MSFT",
          timeframe: "1m",
          sourceName,
          bars: [{ ...makeBar(50, 0), close: 999 }, makeBar(50, 1)],
        },
      ],
    });

    const aapl = dispatched.flat().filter((change) => change.symbol === "AAPL");
    const msft = dispatched.flat().filter((change) => change.symbol === "MSFT");
    assert.equal(aapl.length, 1);
    assert.equal(aapl[0]!.kind, "append");
    assert.equal(aapl[0]!.maxStartsAtMs, base + 60_000);
    assert.equal(msft.length, 2);
    assert.ok(msft.every((change) => change.kind === "historical"));
    assert.ok(
      msft.every((change) => change.maxStartsAtMs === base + 60_000),
    );
  } finally {
    unsubscribe();
  }
});
