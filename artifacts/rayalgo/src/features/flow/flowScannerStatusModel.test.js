import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildRecentScannerSymbols,
  resolveFlowScannerProgress,
  resolveFlowScannerSourceLabel,
} from "./flowScannerStatusModel.js";

test("resolveFlowScannerSourceLabel handles current and planned source modes", () => {
  assert.equal(
    resolveFlowScannerSourceLabel({ coverageMode: "market" }),
    "Market-wide",
  );
  assert.equal(
    resolveFlowScannerSourceLabel({ coverageMode: "all_watchlists" }),
    "All watchlists",
  );
  assert.equal(
    resolveFlowScannerSourceLabel({
      coverageMode: "all_watchlists_plus_universe",
    }),
    "Watchlists + universe",
  );
});

test("resolveFlowScannerProgress exposes scanned, queued, source, scope, and cap", () => {
  const progress = resolveFlowScannerProgress({
    coverage: {
      mode: "market",
      scope: "unusual",
      currentBatch: ["SPY", "QQQ"],
      lastScannedAt: { AAPL: 1_000, MSFT: 2_000 },
    },
    scannerConfig: { maxSymbols: 500, batchSize: 30, concurrency: 2 },
    scannedCoverageSymbols: 4,
    totalCoverageSymbols: 10,
  });

  assert.equal(progress.sourceModeLabel, "Market-wide");
  assert.equal(progress.scopeLabel, "Unusual flow");
  assert.equal(progress.cycleLabel, "4/10");
  assert.equal(progress.queueLabel, "6 queued");
  assert.equal(progress.capLabel, "cap 500");
  assert.equal(progress.batchLabel, "30 batch / 2 conc");
  assert.equal(
    progress.progressText,
    "Market-wide · Unusual flow · 4/10 scanned · 6 queued · cap 500",
  );
});

test("resolveFlowScannerProgress reports selected shortfall and clear queue", () => {
  const progress = resolveFlowScannerProgress({
    coverage: {
      mode: "watchlist",
      scope: "all",
      isFetching: false,
      lastScannedAt: { SPY: 2_000, QQQ: 1_000 },
    },
    scannerConfig: { maxSymbols: 12, batchSize: 6 },
    scannedCoverageSymbols: 2,
    totalCoverageSymbols: 2,
    intendedCoverageSymbols: 8,
    selectedCoverageSymbols: 2,
  });

  assert.equal(progress.selectedDetail, "selected 2/8");
  assert.equal(progress.queueLabel, "queue clear");
  assert.equal(progress.progressText, "Watchlist · All flow · 2/2 scanned · queue clear · cap 12");
});

test("buildRecentScannerSymbols excludes active batch and sorts newest first", () => {
  assert.deepEqual(
    buildRecentScannerSymbols(
      { SPY: 1_000, QQQ: 3_000, AAPL: 2_000 },
      ["QQQ"],
      2,
    ),
    [
      { symbol: "AAPL", scannedAt: 2_000 },
      { symbol: "SPY", scannedAt: 1_000 },
    ],
  );
});

const readPanelSource = () =>
  readFileSync(new URL("./FlowScannerStatusPanel.jsx", import.meta.url), "utf8");

test("flow scanner status panel renders one latest scan label", () => {
  const source = readPanelSource();
  const latestLabelReferences = source.match(/\{latestLabel\}/g) || [];

  assert.equal(latestLabelReferences.length, 1);
});

test("flow scanner status panel keeps active and recent scanner tickers visible", () => {
  const source = readPanelSource();

  assert.match(source, /data-testid="flow-scanner-live-tickers"/);
  assert.match(source, /currentBatch\.slice\(0,\s*12\)\.map/);
  assert.match(source, /recentSymbols\.slice\(0,\s*10\)\.map/);
});
