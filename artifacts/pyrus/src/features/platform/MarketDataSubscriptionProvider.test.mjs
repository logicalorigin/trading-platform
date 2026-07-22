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
  assert.match(source, /reconcileRealtimeQuoteCoverage\(\{/);
  assert.match(source, /deliveredAtBySymbol: deliveredRealtimeQuoteAtRef\.current/);
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

test("mounted position symbols join generic Massive quote coverage", () => {
  assert.match(
    source,
    /import \{\s*usePositionMarketDataSymbols\s*\} from "\.\/positionMarketDataStore";/,
  );
  assert.match(
    source,
    /const positionMarketDataSymbols = usePositionMarketDataSymbols\(\);/,
  );
  assert.match(
    source,
    /const positionAwareStreamedQuoteSymbols = useMemo\([\s\S]*streamedQuoteSymbols[\s\S]*positionMarketDataSymbols/,
  );
  assert.match(
    source,
    /const positionAwareQuoteSymbols = useMemo\([\s\S]*?\[\.\.\.\(quoteSymbols \|\| \[\]\), \.\.\.positionMarketDataSymbols\]/,
  );
  assert.match(
    source,
    /const positionAwareVisibleQuoteSymbols = useMemo\([\s\S]*?\[\.\.\.\(activeVisibleQuoteSymbols \|\| \[\]\), \.\.\.positionMarketDataSymbols\]/,
  );
  assert.match(
    source,
    /splitRealtimeAwareRestQuoteSymbols\(\{\s*quoteSymbols: positionAwareQuoteSymbols,\s*streamCoveredSymbols: deliveredRealtimeQuoteSymbols,\s*activeVisibleSymbols: positionAwareVisibleQuoteSymbols,/,
  );
  assert.match(
    source,
    /useIbkrQuoteSnapshotStream\(\{\s*symbols: positionAwareStreamedQuoteSymbols,/,
  );
  assert.match(
    source,
    /const aggregateRuntimePriceSymbols = useMemo\([\s\S]*positionAwareStreamedQuoteSymbols/,
  );
  assert.match(
    source,
    /const quotesQuery = useGetQuoteSnapshots\(\s*\{ symbols: restQuoteSymbolsKey \}/,
  );
  assert.match(
    source,
    /syncRuntimeMarketData\(\s*watchlistSymbols,\s*activeWatchlistItems,\s*quotesQuery\.data\?\.quotes,/,
  );
  assert.doesNotMatch(source, /streams\/position-quotes|applyPositionQuoteSnapshots/);
});

test("signal sparkline retries only the symbols still warming", () => {
  assert.match(
    source,
    /\.map\(\(\{ pendingSymbols, index, retryAfterMs \}\) => \{[\s\S]*return \{ chunk: pendingSymbols, index \};/,
  );
});

test("delivered realtime quote coverage expires and clears on stream loss", () => {
  assert.match(source, /reconcileRealtimeQuoteCoverage/);
  assert.match(source, /const deliveredRealtimeQuoteAtRef = useRef\(new Map\(\)\)/);
  assert.match(
    source,
    /setInterval\([\s\S]*WATCHLIST_QUOTE_STREAM_CYCLE_WINDOW_MS/,
  );
  assert.match(
    source,
    /useIbkrQuoteSnapshotStream\(\{[\s\S]*onUnavailable: clearDeliveredRealtimeQuoteCoverage/,
  );
});

test("market data diagnostics use one stable global owner", () => {
  assert.match(source, /const marketDataDiagnosticsRef = useRef\(\{\}\)/);
  assert.match(source, /const diagnostics = marketDataDiagnosticsRef\.current/);
  assert.doesNotMatch(
    source,
    /window\[QUOTE_STREAM_DIAGNOSTICS_GLOBAL\] = \{\s*\.\.\.\(window\[QUOTE_STREAM_DIAGNOSTICS_GLOBAL\]/,
  );
});
