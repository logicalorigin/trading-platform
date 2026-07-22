import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as positionMarketDataStore from "./positionMarketDataStore.js";

const {
  __positionMarketDataStoreTestHooks,
  getPositionMarketDataSymbolsSnapshot,
  normalizePositionMarketDataSymbols,
  registerPositionMarketDataSymbols,
} = positionMarketDataStore;

const positionsPanelSource = readFileSync(
  new URL("../../screens/account/PositionsPanel.jsx", import.meta.url),
  "utf8",
);

test("position rows use the canonical runtime ticker store", () => {
  assert.doesNotMatch(positionsPanelSource, /usePositionQuoteSnapshots/);
});

test("position market-data symbols are normalized and deduplicated", () => {
  assert.deepEqual(
    normalizePositionMarketDataSymbols([" fcel ", "AAPL", "FCEL", null]),
    ["FCEL", "AAPL"],
  );
});

test("position market-data symbols combine active owners and unregister cleanly", () => {
  __positionMarketDataStoreTestHooks.clear();
  const unregisterPositions = registerPositionMarketDataSymbols("positions", [
    "FCEL",
    "AAPL",
  ]);
  const unregisterTrade = registerPositionMarketDataSymbols("trade", [
    "AAPL",
    "MSFT",
  ]);

  assert.equal(__positionMarketDataStoreTestHooks.ownerCount(), 2);
  assert.deepEqual(getPositionMarketDataSymbolsSnapshot(), [
    "FCEL",
    "AAPL",
    "MSFT",
  ]);

  unregisterPositions();
  assert.equal(__positionMarketDataStoreTestHooks.ownerCount(), 1);
  assert.deepEqual(getPositionMarketDataSymbolsSnapshot(), ["AAPL", "MSFT"]);

  unregisterTrade();
  assert.equal(__positionMarketDataStoreTestHooks.ownerCount(), 0);
  assert.deepEqual(getPositionMarketDataSymbolsSnapshot(), []);
});

test("position market-data store exposes no duplicate quote cache", () => {
  for (const retiredExport of [
    "applyPositionQuoteSnapshots",
    "getPositionQuoteSnapshot",
    "usePositionQuoteSnapshots",
  ]) {
    assert.equal(retiredExport in positionMarketDataStore, false, retiredExport);
  }
});
