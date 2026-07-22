import assert from "node:assert/strict";
import test from "node:test";

import {
  WATCHLIST_QUOTE_STREAM_BATCH_SIZE,
  WATCHLIST_QUOTE_STREAM_CYCLE_WINDOW_MS,
  buildWatchlistQuoteRotationBatch,
  buildVisibleRealtimeCoverageDiagnostics,
  reconcileRealtimeQuoteCoverage,
  resolveWatchlistQuoteStreamBatchSize,
  splitRealtimeAwareRestQuoteSymbols,
} from "./watchlistQuoteRotation.js";

const makeSymbols = (count) =>
  Array.from({ length: count }, (_value, index) => `T${index + 1}`);

test("watchlist quote rotation defaults to uncapped (Massive: 1 shared stocks socket, unlimited stock subscriptions per connection)", () => {
  // Grounded in Massive's documented limits: the WebSocket constraint is connection
  // count per asset class, not symbols-per-connection (stocks are effectively unlimited).
  assert.equal(WATCHLIST_QUOTE_STREAM_BATCH_SIZE, null);

  const batch = buildWatchlistQuoteRotationBatch({
    rotationSymbols: makeSymbols(120),
    pinnedSymbols: ["spy", "qqq"],
  });

  assert.equal(batch.capped, false);
  assert.equal(batch.symbols.length, 122); // 2 pinned + all 120 rotating; nothing starved
  assert.deepEqual(batch.symbols.slice(0, 2), ["SPY", "QQQ"]);
});

test("watchlist quote stream batch size preserves uncapped Massive streaming", () => {
  assert.equal(
    resolveWatchlistQuoteStreamBatchSize({
      defaultBatchSize: WATCHLIST_QUOTE_STREAM_BATCH_SIZE,
      activeVisibleSymbolCount: 40,
    }),
    null,
  );
});

test("watchlist quote stream batch size raises explicit caps to cover active visible symbols", () => {
  assert.equal(
    resolveWatchlistQuoteStreamBatchSize({
      defaultBatchSize: 64,
      activeVisibleSymbolCount: 80,
    }),
    80,
  );
});

test("watchlist quote rotation applies a bounded stream batch when an explicit cap is provided", () => {
  const cap = 64;
  const batch = buildWatchlistQuoteRotationBatch({
    rotationSymbols: makeSymbols(120),
    pinnedSymbols: ["spy", "qqq"],
    batchSize: cap,
  });

  assert.equal(batch.capped, true);
  assert.equal(batch.batchCap, cap);
  assert.equal(batch.symbols.length, cap);
  assert.deepEqual(batch.symbols.slice(0, 2), ["SPY", "QQQ"]);
  assert.equal(batch.rotatingSymbols.length, cap - 2);
});

test("watchlist quote rotation reports pinned overflow instead of expanding the stream", () => {
  const cap = 64;
  const pinnedSymbols = makeSymbols(cap + 10);
  const batch = buildWatchlistQuoteRotationBatch({
    rotationSymbols: makeSymbols(200),
    pinnedSymbols,
    batchSize: cap,
  });

  assert.equal(batch.symbols.length, cap);
  assert.equal(batch.pinOverflowSymbols.length, 10);
  assert.equal(batch.rotatingSymbols.length, 0);
});

test("active visible quote symbols get snapshot bootstrap while realtime coverage is still missing", () => {
  const split = splitRealtimeAwareRestQuoteSymbols({
    quoteSymbols: ["SPY", "AAPL", "MSFT", "NVDA"],
    streamCoveredSymbols: ["SPY", "AAPL"],
    activeVisibleSymbols: ["SPY", "MSFT"],
    realtimeRequired: true,
  });

  assert.deepEqual(split.restQuoteSymbols, ["MSFT", "NVDA"]);
  assert.deepEqual(split.missingRealtimeVisibleSymbols, ["MSFT"]);
});

test("active visible quote coverage reports missing realtime stream symbols", () => {
  const diagnostics = buildVisibleRealtimeCoverageDiagnostics({
    activeVisibleSymbols: ["spy", "aapl", "msft"],
    streamCoveredSymbols: ["SPY", "AAPL"],
    realtimeRequired: true,
  });

  assert.equal(diagnostics.required, true);
  assert.equal(diagnostics.complete, false);
  assert.deepEqual(diagnostics.missingSymbols, ["MSFT"]);
});

test("realtime quote coverage removes explicit non-live frames", () => {
  const coverage = reconcileRealtimeQuoteCoverage({
    deliveredAtBySymbol: new Map([
      ["AAPL", 1_000],
      ["MSFT", 1_000],
    ]),
    quotes: [
      { symbol: "aapl", freshness: "delayed" },
      { symbol: "nvda", freshness: "live" },
    ],
    nowMs: 30_000,
  });

  assert.deepEqual(Array.from(coverage), [
    ["MSFT", 1_000],
    ["NVDA", 30_000],
  ]);
});

test("realtime quote coverage expires symbols that stop delivering", () => {
  const coverage = reconcileRealtimeQuoteCoverage({
    deliveredAtBySymbol: new Map([
      ["AAPL", 1_000],
      ["MSFT", 2_000],
    ]),
    nowMs: 1_000 + WATCHLIST_QUOTE_STREAM_CYCLE_WINDOW_MS,
  });

  assert.deepEqual(Array.from(coverage), [["MSFT", 2_000]]);
});
