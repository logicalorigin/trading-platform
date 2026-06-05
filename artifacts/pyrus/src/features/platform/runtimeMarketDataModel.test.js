import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRuntimeQuoteSnapshots,
  syncRuntimeMarketData,
} from "./runtimeMarketDataModel.js";
import { WATCHLIST } from "../market/marketReferenceData.js";
import {
  applyRuntimeTickerInfoPatch,
  ensureTradeTickerInfo,
  getRuntimeTickerSnapshot,
} from "./runtimeTickerStore.js";

const uniqueSymbol = (label) =>
  `ZZ${label}${Math.round(performance.now() * 1000)}`.toUpperCase();

test("streamed quote snapshots update runtime ticker rows immediately", () => {
  const symbol = uniqueSymbol("STREAM");
  ensureTradeTickerInfo(symbol, symbol);

  const changed = applyRuntimeQuoteSnapshots(
    [
      {
        symbol,
        price: 101,
        prevClose: 100,
        updatedAt: "2026-05-21T15:00:00.000Z",
        dataUpdatedAt: "2026-05-21T15:00:00.000Z",
        source: "ibkr",
      },
    ],
    [{ symbol, name: "Stream Test Corp" }],
  );
  const snapshot = getRuntimeTickerSnapshot(symbol);

  assert.equal(changed, 1);
  assert.equal(snapshot.name, "Stream Test Corp");
  assert.equal(snapshot.price, 101);
  assert.equal(snapshot.chg, 1);
  assert.equal(snapshot.pct, 1);
  assert.equal(snapshot.source, "ibkr");
});

test("streamed quote snapshots do not overwrite newer ticker data", () => {
  const symbol = uniqueSymbol("OLDER");
  ensureTradeTickerInfo(symbol, symbol);
  applyRuntimeTickerInfoPatch(symbol, symbol, {
    price: 105,
    updatedAt: "2026-05-21T15:01:00.000Z",
    dataUpdatedAt: "2026-05-21T15:01:00.000Z",
  });

  const changed = applyRuntimeQuoteSnapshots([
    {
      symbol,
      price: 100,
      updatedAt: "2026-05-21T15:00:00.000Z",
      dataUpdatedAt: "2026-05-21T15:00:00.000Z",
    },
  ]);
  const snapshot = getRuntimeTickerSnapshot(symbol);

  assert.equal(changed, 0);
  assert.equal(snapshot.price, 105);
  assert.equal(snapshot.dataUpdatedAt, "2026-05-21T15:01:00.000Z");
});

test("runtime market sync preserves timestamps on compact sparklines", () => {
  const symbol = uniqueSymbol("SPARKTIME");
  ensureTradeTickerInfo(symbol, symbol);

  syncRuntimeMarketData(
    [symbol],
    [{ symbol, name: "Spark Time Corp" }],
    [],
    {
      sparklineBarsBySymbol: {
        [symbol]: [
          { timestamp: "2026-06-01T14:30:00.000Z", close: 100, volume: 10 },
          { timestamp: "2026-06-01T14:31:00.000Z", close: 101, volume: 12 },
        ],
      },
    },
  );
  const snapshot = getRuntimeTickerSnapshot(symbol);

  assert.deepEqual(snapshot.spark, [
    { i: 0, v: 100, timestamp: "2026-06-01T14:30:00.000Z" },
    { i: 1, v: 101, timestamp: "2026-06-01T14:31:00.000Z" },
  ]);
  assert.equal(snapshot.sparkBars[0].timestamp, "2026-06-01T14:30:00.000Z");
});

test("runtime market sync publishes fetched sparkline bars outside quote batch", () => {
  const symbol = uniqueSymbol("SPARKONLY");
  ensureTradeTickerInfo(symbol, symbol);

  syncRuntimeMarketData(
    [],
    [],
    [],
    {
      sparklineBarsBySymbol: {
        [symbol]: [
          { timestamp: "2026-06-01T15:00:00.000Z", close: 200, volume: 20 },
          { timestamp: "2026-06-01T15:01:00.000Z", close: 201, volume: 24 },
        ],
      },
    },
  );
  const snapshot = getRuntimeTickerSnapshot(symbol);

  assert.deepEqual(snapshot.spark, [
    { i: 0, v: 200, timestamp: "2026-06-01T15:00:00.000Z" },
    { i: 1, v: 201, timestamp: "2026-06-01T15:01:00.000Z" },
  ]);
  assert.equal(snapshot.sparkBars.length, 2);
});

test("runtime market sync preserves existing sparkline bars when quote batches omit bars", () => {
  const symbol = uniqueSymbol("SPARKKEEP");
  const sparkBars = [
    { timestamp: "2026-06-01T15:10:00.000Z", close: 300, volume: 30 },
    { timestamp: "2026-06-01T15:11:00.000Z", close: 302, volume: 36 },
  ];
  ensureTradeTickerInfo(symbol, symbol);
  applyRuntimeTickerInfoPatch(symbol, symbol, {
    spark: [
      { i: 0, v: 300, timestamp: "2026-06-01T15:10:00.000Z" },
      { i: 1, v: 302, timestamp: "2026-06-01T15:11:00.000Z" },
    ],
    sparkBars,
  });

  syncRuntimeMarketData(
    [symbol],
    [{ symbol, name: "Spark Keep Corp" }],
    [
      {
        symbol,
        price: 306,
        prevClose: 300,
        updatedAt: "2026-06-01T15:12:00.000Z",
        dataUpdatedAt: "2026-06-01T15:12:00.000Z",
      },
    ],
    { sparklineBarsBySymbol: {} },
  );
  const snapshot = getRuntimeTickerSnapshot(symbol);

  assert.equal(snapshot.price, 306);
  assert.equal(snapshot.sparkBars.length, 2);
  assert.deepEqual(snapshot.sparkBars, sparkBars);
  assert.deepEqual(snapshot.spark, [
    { i: 0, v: 300, timestamp: "2026-06-01T15:10:00.000Z" },
    { i: 1, v: 302, timestamp: "2026-06-01T15:11:00.000Z" },
  ]);
});

test("runtime market sync does not replace watchlist rows when computed data is unchanged", () => {
  const symbol = uniqueSymbol("WATCHNOOP");
  const previousWatchlist = WATCHLIST.slice();
  const buildSparkBars = () => [
    { timestamp: "2026-06-01T15:20:00.000Z", close: 410, volume: 40 },
    { timestamp: "2026-06-01T15:21:00.000Z", close: 411, volume: 44 },
  ];

  try {
    ensureTradeTickerInfo(symbol, symbol);
    syncRuntimeMarketData(
      [symbol],
      [{ symbol, name: "Watch Noop Corp" }],
      [],
      { sparklineBarsBySymbol: { [symbol]: buildSparkBars() } },
    );
    const firstRow = WATCHLIST[0];

    const changed = syncRuntimeMarketData(
      [symbol],
      [{ symbol, name: "Watch Noop Corp" }],
      [],
      { sparklineBarsBySymbol: { [symbol]: buildSparkBars() } },
    );

    assert.equal(changed, 0);
    assert.equal(WATCHLIST[0], firstRow);
    assert.equal(WATCHLIST.length, 1);
  } finally {
    WATCHLIST.splice(0, WATCHLIST.length, ...previousWatchlist);
  }
});
