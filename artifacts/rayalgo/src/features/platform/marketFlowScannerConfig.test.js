import assert from "node:assert/strict";
import test from "node:test";

import {
  FLOW_SCANNER_MODE,
  FLOW_SCANNER_SCOPE,
  buildFlowScannerSymbols,
  filterFlowScannerEvents,
  normalizeFlowScannerConfig,
  runFlowScannerBatch,
} from "./marketFlowScannerConfig.js";

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
      mode: FLOW_SCANNER_MODE.market,
      scope: FLOW_SCANNER_SCOPE.unusual,
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

test("normalizeFlowScannerConfig aliases legacy hybrid mode to market mode", () => {
  assert.equal(
    normalizeFlowScannerConfig({ mode: "hybrid" }).mode,
    FLOW_SCANNER_MODE.market,
  );
});

test("buildFlowScannerSymbols pins watchlist symbols before market symbols", () => {
  assert.deepEqual(
    buildFlowScannerSymbols({
      watchlistSymbols: ["msft", "spy", "MSFT"],
      marketSymbols: ["SPY", "NVDA", "AAPL"],
      config: { mode: FLOW_SCANNER_MODE.market, maxSymbols: 4 },
    }),
    ["MSFT", "SPY", "NVDA", "AAPL"],
  );
});

test("buildFlowScannerSymbols can scan only the watchlist", () => {
  assert.deepEqual(
    buildFlowScannerSymbols({
      watchlistSymbols: ["msft", "nvda"],
      marketSymbols: ["SPY", "QQQ"],
      config: { mode: FLOW_SCANNER_MODE.watchlist, maxSymbols: 10 },
    }),
    ["MSFT", "NVDA"],
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
