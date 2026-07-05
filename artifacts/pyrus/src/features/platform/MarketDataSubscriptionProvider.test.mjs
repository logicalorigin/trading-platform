import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./MarketDataSubscriptionProvider.jsx", import.meta.url),
  "utf8",
);

test("market data streams pause during blocking API mutations", () => {
  assert.match(source, /useCriticalApiMutationPause\(\)/);
  assert.match(source, /criticalApiMutationPaused[\s\S]*"foreground-api-mutation"/);
  assert.match(source, /const quoteSnapshotFallbackBlocked = Boolean\(\s*criticalApiMutationPaused \|\| !marketDataProviderConfigurationReady,?\s*\);/);
  assert.match(source, /const restQuoteSymbols = quoteSnapshotFallbackBlocked[\s\S]*\? \[\][\s\S]*: restQuoteSplit\.restQuoteSymbols;/);
  assert.doesNotMatch(source, /massive-websocket-only/);
  assert.match(source, /!criticalApiMutationPaused[\s\S]*marketStockAggregateStreamingEnabled/);
  assert.match(source, /!criticalApiMutationPaused[\s\S]*sparklineHistoryRuntimeEnabled/);
});

test("Massive realtime quote coverage is based on delivered websocket quotes", () => {
  assert.match(source, /quoteLooksLive/);
  assert.match(source, /recordDeliveredRealtimeQuoteSymbols\(quotes, setDeliveredRealtimeQuoteSymbols\)/);
  assert.match(source, /splitRealtimeAwareRestQuoteSymbols\(\{[\s\S]*streamCoveredSymbols: deliveredRealtimeQuoteSymbols/s);
  assert.match(source, /streamCoveredSymbols: deliveredRealtimeQuoteSymbols/);
  assert.match(source, /missingRealtimeVisibleSymbols:\s*[\s\S]*restQuoteSplit\.missingRealtimeVisibleSymbols/);
  assert.doesNotMatch(source, /restBlockedVisibleSymbols/);
  assert.match(source, /fallbackDisabledReason: quoteFallbackDisabledReason/);
  assert.doesNotMatch(source, /restDisabledReason/);
});

test("quote snapshot fallback waits for provider configuration", () => {
  assert.match(source, /marketDataProviderConfigurationReady = false/);
  assert.match(source, /!marketDataProviderConfigurationReady[\s\S]*\? "market-data-config-loading"/);
});
