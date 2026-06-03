import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRuntimeQuoteSnapshots,
  syncRuntimeMarketData,
} from "./runtimeMarketDataModel.js";
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
