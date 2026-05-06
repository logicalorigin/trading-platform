import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FLOW_SCANNER_CONFIG,
  FLOW_SCANNER_MODE,
  FLOW_SCANNER_SCOPE,
  UNUSUAL_SCANNER_BATCH_SIZE,
  UNUSUAL_SCANNER_INTERVAL_MS,
  buildFlowScannerMarketUniverseSymbols,
  buildFlowScannerSymbols,
  filterFlowScannerEvents,
  normalizeFlowScannerConfig,
  runFlowScannerBatch,
} from "./marketFlowScannerConfig.js";

test("default flow scanner covers 500 symbols inside five minutes", () => {
  assert.equal(DEFAULT_FLOW_SCANNER_CONFIG.maxSymbols, 500);
  assert.equal(DEFAULT_FLOW_SCANNER_CONFIG.scope, FLOW_SCANNER_SCOPE.all);
  assert.equal(DEFAULT_FLOW_SCANNER_CONFIG.batchSize, UNUSUAL_SCANNER_BATCH_SIZE);
  assert.equal(DEFAULT_FLOW_SCANNER_CONFIG.intervalMs, UNUSUAL_SCANNER_INTERVAL_MS);
  assert.equal(DEFAULT_FLOW_SCANNER_CONFIG.concurrency, 1);
  assert.ok(
    Math.ceil(
      DEFAULT_FLOW_SCANNER_CONFIG.maxSymbols / DEFAULT_FLOW_SCANNER_CONFIG.batchSize,
    ) *
      DEFAULT_FLOW_SCANNER_CONFIG.intervalMs <=
      300_000,
  );
});

test("normalizeFlowScannerConfig applies defaults and clamps capacity settings", () => {
  assert.deepEqual(
    normalizeFlowScannerConfig({
      mode: "invalid",
      scope: "invalid",
      maxSymbols: 999_999,
      batchSize: 999_999,
      intervalMs: 1,
      concurrency: 999,
      limit: 999_999,
      unusualThreshold: 0,
      minPremium: -100,
      maxDte: "",
    }),
    {
      mode: FLOW_SCANNER_MODE.allWatchlistsPlusUniverse,
      scope: FLOW_SCANNER_SCOPE.all,
      maxSymbols: 2000,
      batchSize: 250,
      intervalMs: 2500,
      concurrency: 24,
      limit: 1000,
      unusualThreshold: 0.1,
      minPremium: 0,
      maxDte: null,
    },
  );
});

test("normalizeFlowScannerConfig aliases legacy scanner modes", () => {
  assert.equal(
    normalizeFlowScannerConfig({ mode: "hybrid" }).mode,
    FLOW_SCANNER_MODE.allWatchlistsPlusUniverse,
  );
  assert.equal(
    normalizeFlowScannerConfig({ mode: "market" }).mode,
    FLOW_SCANNER_MODE.allWatchlistsPlusUniverse,
  );
  assert.equal(
    normalizeFlowScannerConfig({ mode: "watchlist" }).mode,
    FLOW_SCANNER_MODE.activeWatchlist,
  );
});

test("buildFlowScannerSymbols pins all watchlist symbols before market symbols", () => {
  assert.deepEqual(
    buildFlowScannerSymbols({
      watchlistSymbols: ["msft", "spy", "MSFT"],
      marketSymbols: ["SPY", "NVDA", "AAPL"],
      config: { mode: FLOW_SCANNER_MODE.allWatchlistsPlusUniverse, maxSymbols: 4 },
    }),
    ["MSFT", "SPY", "NVDA", "AAPL"],
  );
});

test("buildFlowScannerSymbols can scan only the active watchlist", () => {
  assert.deepEqual(
    buildFlowScannerSymbols({
      activeWatchlistSymbols: ["spy", "msft"],
      watchlistSymbols: ["msft", "nvda"],
      marketSymbols: ["SPY", "QQQ"],
      config: { mode: FLOW_SCANNER_MODE.activeWatchlist, maxSymbols: 10 },
    }),
    ["SPY", "MSFT"],
  );
});

test("default flow scanner scans all watchlists plus the market universe", () => {
  assert.equal(
    DEFAULT_FLOW_SCANNER_CONFIG.mode,
    FLOW_SCANNER_MODE.allWatchlistsPlusUniverse,
  );
  assert.deepEqual(
    buildFlowScannerSymbols({
      activeWatchlistSymbols: ["SPY"],
      watchlistSymbols: ["SPY", "NVDA", "AAPL"],
      marketSymbols: ["QQQ", "IWM"],
      config: DEFAULT_FLOW_SCANNER_CONFIG,
    }),
    ["SPY", "NVDA", "AAPL", "QQQ", "IWM"],
  );
});

test("default flow scanner keeps routine flow visible for Flow tape filters", () => {
  const events = [
    { id: "routine", isUnusual: false, unusualScore: 0.2, premium: 15_000, dte: 14 },
    { id: "unusual", isUnusual: true, unusualScore: 2, premium: 75_000, dte: 7 },
  ];

  assert.deepEqual(
    filterFlowScannerEvents(events, DEFAULT_FLOW_SCANNER_CONFIG).map(
      (event) => event.id,
    ),
    ["routine", "unusual"],
  );
});

test("buildFlowScannerMarketUniverseSymbols keeps runtime signals from replacing the universe", () => {
  assert.deepEqual(
    buildFlowScannerMarketUniverseSymbols({
      backendSymbols: ["AMD", "NVDA", "SPY"],
      promotedSymbols: ["AMD"],
      currentBatchSymbols: ["QQQ", "NVDA"],
      fallbackSymbols: ["SPY", "AAPL"],
      prioritizeRuntimeSignals: true,
    }),
    ["AMD", "QQQ", "NVDA", "SPY", "AAPL"],
  );
});

test("filterFlowScannerEvents applies unusual, premium, and max-DTE filters", () => {
  const events = [
    { id: "routine", isUnusual: false, unusualScore: 0.4, premium: 90_000, dte: 7 },
    { id: "cheap", isUnusual: true, unusualScore: 1.5, premium: 4_000, dte: 7 },
    { id: "far", isUnusual: true, unusualScore: 2, premium: 50_000, dte: 90 },
    { id: "match", isUnusual: false, unusualScore: 2.5, premium: 75_000, dte: 21 },
  ];

  assert.deepEqual(
    filterFlowScannerEvents(events, {
      scope: FLOW_SCANNER_SCOPE.unusual,
      unusualThreshold: 2,
      minPremium: 10_000,
      maxDte: 30,
    }).map((event) => event.id),
    ["match"],
  );
});

test("filterFlowScannerEvents applies custom unusual thresholds locally", () => {
  const events = [
    { id: "default-unusual", isUnusual: true, unusualScore: 1.2, premium: 10_000, dte: 7 },
    { id: "custom-unusual", isUnusual: true, unusualScore: 2.2, premium: 10_000, dte: 7 },
  ];

  assert.deepEqual(
    filterFlowScannerEvents(events, {
      scope: FLOW_SCANNER_SCOPE.unusual,
      unusualThreshold: 2,
    }).map((event) => event.id),
    ["custom-unusual"],
  );
});

test("runFlowScannerBatch returns all-settled style results", async () => {
  const results = await runFlowScannerBatch([1, 2, 3], 2, async (value) => {
    if (value === 2) throw new Error("failed");
    return value * 10;
  });

  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[0].value, 10);
  assert.equal(results[1].status, "rejected");
  assert.equal(results[1].reason.message, "failed");
  assert.equal(results[2].status, "fulfilled");
  assert.equal(results[2].value, 30);
});
