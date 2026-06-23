import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./MarketDataSubscriptionProvider.jsx", import.meta.url),
  "utf8",
);

test("market data streams pause during critical API mutations", () => {
  assert.match(source, /useCriticalApiMutationPause\(\)/);
  assert.match(source, /criticalApiMutationPaused[\s\S]*"critical-api-mutation"/);
  assert.match(source, /const restQuoteSymbols = criticalApiMutationPaused[\s\S]*\? \[\][\s\S]*: restQuoteSplit\.restQuoteSymbols;/);
  assert.match(source, /!criticalApiMutationPaused[\s\S]*marketStockAggregateStreamingEnabled/);
  assert.match(source, /!criticalApiMutationPaused[\s\S]*sparklineHistoryRuntimeEnabled/);
});
