import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWatchlistQuoteRotationBatch,
  buildWatchlistQuoteRotationDiagnostics,
} from "./watchlistQuoteRotation.js";

test("watchlist quote rotation keeps pins and rotates the remainder inside the cap", () => {
  const first = buildWatchlistQuoteRotationBatch({
    watchlistSymbols: ["AAPL", "MSFT", "NVDA", "TSLA", "SPY", "QQQ"],
    pinnedSymbols: ["spy", "AAPL", "SPY"],
    batchSize: 4,
    cursor: 0,
  });

  assert.deepEqual(first.symbols, ["SPY", "AAPL", "MSFT", "NVDA"]);
  assert.deepEqual(first.pinnedSymbols, ["SPY", "AAPL"]);
  assert.deepEqual(first.rotatingSymbols, ["MSFT", "NVDA"]);
  assert.equal(first.nextCursor, 2);

  const second = buildWatchlistQuoteRotationBatch({
    watchlistSymbols: ["AAPL", "MSFT", "NVDA", "TSLA", "SPY", "QQQ"],
    pinnedSymbols: ["SPY", "AAPL"],
    batchSize: 4,
    cursor: first.nextCursor,
  });

  assert.deepEqual(second.symbols, ["SPY", "AAPL", "TSLA", "QQQ"]);
});

test("watchlist quote rotation is uncapped by default for Massive quote fanout", () => {
  const batch = buildWatchlistQuoteRotationBatch({
    watchlistSymbols: ["AAPL", "MSFT", "NVDA", "TSLA", "SPY", "QQQ"],
    rotationSymbols: ["AAPL", "MSFT", "NVDA", "TSLA", "SPY", "QQQ", "AVGO"],
    pinnedSymbols: ["spy", "AAPL", "GOOGL"],
    cursor: 2,
  });

  assert.deepEqual(batch.symbols, [
    "SPY",
    "AAPL",
    "GOOGL",
    "TSLA",
    "QQQ",
    "AVGO",
    "MSFT",
    "NVDA",
  ]);
  assert.equal(batch.batchSize, 8);
  assert.equal(batch.batchCap, null);
  assert.equal(batch.capped, false);
  assert.deepEqual(batch.pinOverflowSymbols, []);
});

test("watchlist quote rotation reports pin overflow instead of exceeding cap", () => {
  const batch = buildWatchlistQuoteRotationBatch({
    watchlistSymbols: ["AAPL", "MSFT", "NVDA"],
    pinnedSymbols: ["AAPL", "MSFT", "NVDA", "SPY"],
    batchSize: 2,
  });

  assert.deepEqual(batch.symbols, ["AAPL", "MSFT"]);
  assert.deepEqual(batch.pinOverflowSymbols, ["NVDA", "SPY"]);
  assert.equal(batch.batchSize, 2);
  assert.equal(batch.batchCap, 2);
});

test("watchlist quote rotation can hydrate a broader signal universe", () => {
  const first = buildWatchlistQuoteRotationBatch({
    watchlistSymbols: ["AAPL", "MSFT"],
    rotationSymbols: ["AAPL", "MSFT", "TSLA", "NVDA", "AMD"],
    pinnedSymbols: ["AAPL"],
    batchSize: 3,
    cursor: 0,
  });

  assert.deepEqual(first.symbols, ["AAPL", "MSFT", "TSLA"]);
  assert.equal(first.universeSize, 5);
  assert.equal(first.rotatingUniverseSize, 4);

  const second = buildWatchlistQuoteRotationBatch({
    watchlistSymbols: ["AAPL", "MSFT"],
    rotationSymbols: ["AAPL", "MSFT", "TSLA", "NVDA", "AMD"],
    pinnedSymbols: ["AAPL"],
    batchSize: 3,
    cursor: first.nextCursor,
  });

  assert.deepEqual(second.symbols, ["AAPL", "NVDA", "AMD"]);
});

test("watchlist quote rotation diagnostics count recent full-universe coverage", () => {
  const diagnostics = buildWatchlistQuoteRotationDiagnostics({
    batch: { symbols: ["AAPL"], batchSize: 1, batchCap: 2 },
    watchlistSymbols: ["AAPL", "MSFT", "NVDA"],
    lastTouchedAtBySymbol: {
      AAPL: "2026-05-26T17:50:00.000Z",
      MSFT: "2026-05-26T17:49:45.000Z",
      NVDA: "2026-05-26T17:48:00.000Z",
    },
    nowMs: Date.parse("2026-05-26T17:50:15.000Z"),
    cycleWindowMs: 60_000,
  });

  assert.equal(diagnostics.cycleCoverageCount, 2);
  assert.equal(diagnostics.cycleCoveragePct, 66.7);
});

test("watchlist quote rotation diagnostics count the broader rotation universe", () => {
  const diagnostics = buildWatchlistQuoteRotationDiagnostics({
    batch: { symbols: ["AAPL", "TSLA"], batchSize: 2, batchCap: 3 },
    watchlistSymbols: ["AAPL"],
    rotationSymbols: ["AAPL", "TSLA", "NVDA", "AMD"],
    lastTouchedAtBySymbol: {
      AAPL: "2026-05-26T17:50:00.000Z",
      TSLA: "2026-05-26T17:49:55.000Z",
      NVDA: "2026-05-26T17:47:00.000Z",
    },
    nowMs: Date.parse("2026-05-26T17:50:15.000Z"),
    cycleWindowMs: 60_000,
  });

  assert.equal(diagnostics.universeSize, 4);
  assert.equal(diagnostics.cycleCoverageCount, 2);
  assert.equal(diagnostics.cycleCoveragePct, 50);
});
