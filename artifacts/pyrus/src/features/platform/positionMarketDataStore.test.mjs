import assert from "node:assert/strict";
import test from "node:test";

import {
  __positionMarketDataStoreTestHooks,
  applyPositionQuoteSnapshots,
  getPositionQuoteSnapshot,
  registerPositionMarketDataSymbols,
} from "./positionMarketDataStore.js";

test("position quote snapshots are stored separately for position rows", () => {
  __positionMarketDataStoreTestHooks.clear();
  const unregister = registerPositionMarketDataSymbols("positions:test", ["fcel"]);

  const changed = applyPositionQuoteSnapshots([
    {
      symbol: "fcel",
      bid: 15.81,
      ask: 15.84,
      price: 15.83,
      source: "ibkr",
      transport: "tws",
      dataUpdatedAt: "2026-06-08T17:04:04.911Z",
    },
  ]);

  assert.equal(changed, 1);
  assert.equal(__positionMarketDataStoreTestHooks.quoteCount(), 1);
  assert.deepEqual(getPositionQuoteSnapshot("FCEL"), {
    symbol: "FCEL",
    bid: 15.81,
    ask: 15.84,
    price: 15.83,
    source: "ibkr",
    transport: "tws",
    dataUpdatedAt: "2026-06-08T17:04:04.911Z",
  });
  unregister();
});

test("position quote snapshots ignore unowned symbols", () => {
  __positionMarketDataStoreTestHooks.clear();

  const changed = applyPositionQuoteSnapshots([
    {
      symbol: "fcel",
      bid: 15.81,
      ask: 15.84,
    },
  ]);

  assert.equal(changed, 0);
  assert.equal(__positionMarketDataStoreTestHooks.quoteCount(), 0);
  assert.equal(getPositionQuoteSnapshot("FCEL"), null);
});

test("position quote snapshots prune unowned symbols and retain shared owners", () => {
  __positionMarketDataStoreTestHooks.clear();
  const unregisterPositions = registerPositionMarketDataSymbols("positions", [
    "FCEL",
    "AAPL",
  ]);
  const unregisterTrade = registerPositionMarketDataSymbols("trade", ["AAPL"]);

  assert.equal(
    applyPositionQuoteSnapshots([
      { symbol: "FCEL", price: 15.83 },
      { symbol: "AAPL", price: 195.12 },
    ]),
    2,
  );
  assert.equal(__positionMarketDataStoreTestHooks.quoteCount(), 2);

  unregisterPositions();

  assert.equal(getPositionQuoteSnapshot("FCEL"), null);
  assert.deepEqual(getPositionQuoteSnapshot("AAPL"), {
    symbol: "AAPL",
    price: 195.12,
  });
  assert.equal(__positionMarketDataStoreTestHooks.quoteCount(), 1);

  unregisterTrade();

  assert.equal(getPositionQuoteSnapshot("AAPL"), null);
  assert.equal(__positionMarketDataStoreTestHooks.quoteCount(), 0);
});
