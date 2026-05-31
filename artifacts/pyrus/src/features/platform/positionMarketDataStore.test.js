import assert from "node:assert/strict";
import test from "node:test";
import {
  __positionMarketDataStoreTestHooks,
  getPositionMarketDataSymbolsSnapshot,
  normalizePositionMarketDataSymbols,
  registerPositionMarketDataSymbols,
} from "./positionMarketDataStore.js";

test.afterEach(() => {
  __positionMarketDataStoreTestHooks.clear();
});

test("position market data registry normalizes and dedupes symbols by owner", () => {
  assert.deepEqual(normalizePositionMarketDataSymbols([" spy ", "SPY", "", null, "qqq"]), [
    "SPY",
    "QQQ",
  ]);

  const unregisterAccount = registerPositionMarketDataSymbols("account", [
    "spy",
    "aapl",
  ]);
  const unregisterTrade = registerPositionMarketDataSymbols("trade", [
    "AAPL",
    "msft",
  ]);

  assert.deepEqual(getPositionMarketDataSymbolsSnapshot(), [
    "SPY",
    "AAPL",
    "MSFT",
  ]);

  unregisterAccount();
  assert.deepEqual(getPositionMarketDataSymbolsSnapshot(), ["AAPL", "MSFT"]);

  unregisterTrade();
  assert.deepEqual(getPositionMarketDataSymbolsSnapshot(), []);
});
