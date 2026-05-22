import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRuntimeQuoteSnapshots,
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
