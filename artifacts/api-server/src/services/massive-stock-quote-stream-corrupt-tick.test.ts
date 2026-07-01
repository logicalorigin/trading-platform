import assert from "node:assert/strict";
import test from "node:test";

import { __resetProviderRuntimeConfigCacheForTests } from "../lib/runtime";
import {
  getCurrentMassiveStockQuoteSnapshots,
  __massiveStockQuoteStreamInternalsForTests as internals,
} from "./massive-stock-quote-stream";

function enableMassive() {
  process.env["MASSIVE_API_KEY"] = "test-key";
  __resetProviderRuntimeConfigCacheForTests();
  internals.reset();
}

test("a zero/negative trade tick does not drop a symbol with a valid two-sided market", () => {
  enableMassive();

  // Valid two-sided market -> midpoint 100.
  internals.handleWebSocketMessage({ ev: "Q", sym: "AAPL", bp: 99, ap: 101 });
  assert.equal(getCurrentMassiveStockQuoteSnapshots(["AAPL"])[0]?.price, 100);

  // A single corrupt zero trade tick must not clobber the price or drop the symbol.
  internals.handleWebSocketMessage({ ev: "T", sym: "AAPL", p: 0 });
  const afterZero = getCurrentMassiveStockQuoteSnapshots(["AAPL"]);
  assert.equal(afterZero.length, 1, "symbol stays present after a zero trade tick");
  assert.equal(afterZero[0]?.price, 100, "price falls back to the live midpoint");

  // A negative trade tick is likewise rejected.
  internals.handleWebSocketMessage({ ev: "T", sym: "AAPL", p: -3.2 });
  assert.equal(getCurrentMassiveStockQuoteSnapshots(["AAPL"])[0]?.price, 100);

  internals.reset();
});

test("a corrupt trade tick does not overwrite a prior good last trade price", () => {
  enableMassive();

  internals.handleWebSocketMessage({ ev: "Q", sym: "MSFT", bp: 399, ap: 401 });
  internals.handleWebSocketMessage({ ev: "T", sym: "MSFT", p: 405 });
  assert.equal(
    getCurrentMassiveStockQuoteSnapshots(["MSFT"])[0]?.price,
    405,
    "valid trade sets the last price",
  );

  // Corrupt tick is ignored; the last good trade price is preserved.
  internals.handleWebSocketMessage({ ev: "T", sym: "MSFT", p: 0 });
  assert.equal(getCurrentMassiveStockQuoteSnapshots(["MSFT"])[0]?.price, 405);

  internals.reset();
});
