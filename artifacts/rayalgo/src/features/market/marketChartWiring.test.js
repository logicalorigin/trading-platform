import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMarketGridViewportIdentity,
  resolveMarketGridChartProviderContractId,
} from "./marketGridChartState.js";

const readLocalSource = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("Market chart flow markers use the unusual-flow scanner contract", () => {
  const source = readLocalSource("./MultiChartGrid.jsx");
  const scannerCall = source.match(
    /useLiveMarketFlow\(streamedSymbols,\s*\{[\s\S]*?\n  \}\);/,
  )?.[0];

  assert.ok(scannerCall, "Market chart grid must wire a live flow scanner");
  assert.match(source, /import \{ FLOW_SCANNER_SCOPE \}/);
  assert.match(source, /const MARKET_CHART_FLOW_LIMIT = 80;/);
  assert.match(scannerCall, /limit:\s*MARKET_CHART_FLOW_LIMIT/);
  assert.match(scannerCall, /scope:\s*FLOW_SCANNER_SCOPE\.unusual/);
  assert.match(scannerCall, /concurrency:\s*2/);
  assert.match(scannerCall, /lineBudget:\s*20/);
  assert.match(scannerCall, /unusualThreshold/);
  assert.doesNotMatch(scannerCall, /limit:\s*16/);
});

test("Market chart flow snapshot is promoted for activity-panel agreement", () => {
  const source = readLocalSource("./MultiChartGrid.jsx");

  assert.match(source, /onChartFlowSnapshotChange/);
  assert.match(source, /chartFlowSnapshotSignature/);
  assert.match(source, /snapshot:\s*chartFlowSnapshot/);
  assert.match(source, /symbols:\s*streamedSymbols/);
});

test("Market chart cells delegate rendering to the Trade spot chart path", () => {
  const source = readLocalSource("./MiniChartCell.jsx");

  assert.match(source, /import \{ TradeEquityPanel \}/);
  assert.match(source, /<TradeEquityPanel/);
  assert.match(source, /surfaceUiStateKey="market-spot-chart"/);
  assert.match(source, /workspaceChart=\{\{ timeframe \}\}/);
  assert.match(source, /onWorkspaceChartChange=\{handleWorkspaceChartChange\}/);
  assert.doesNotMatch(source, /getBarsRequest/);
  assert.doesNotMatch(source, /ResearchChartFrame/);
  assert.doesNotMatch(source, /useHistoricalBarStream/);
  assert.doesNotMatch(source, /useBrokerStreamedBars/);
  assert.doesNotMatch(source, /useProgressiveChartBarLimit/);
  assert.doesNotMatch(source, /useUnderfilledChartBackfill/);
});

test("Market chart flow events are passed raw into the Trade spot chart path", () => {
  const gridSource = readLocalSource("./MultiChartGrid.jsx");
  const cellSource = readLocalSource("./MiniChartCell.jsx");

  assert.match(gridSource, /const flowEventsBySymbol = useMemo/);
  assert.match(gridSource, /flowEvents=\{flowEventsBySymbol/);
  assert.match(cellSource, /flowEvents=\{flowEvents\}/);
  assert.doesNotMatch(gridSource, /flowEventsToChartEvents/);
});

test("Market chart frames leave viewport ownership inside the Trade spot chart", () => {
  const gridSource = readLocalSource("./MultiChartGrid.jsx");
  const cellSource = readLocalSource("./MiniChartCell.jsx");

  assert.match(gridSource, /chartViewportResetRevision/);
  assert.doesNotMatch(gridSource, /buildMarketGridViewportRevisionIdentity/);
  assert.doesNotMatch(cellSource, /rangeIdentityKey/);
  assert.doesNotMatch(cellSource, /persistScalePrefs/);
  assert.doesNotMatch(gridSource, /chartViewportSnapshots/);
  assert.doesNotMatch(gridSource, /rememberViewportSnapshot/);
  assert.doesNotMatch(gridSource, /clearViewportSnapshot/);
  assert.doesNotMatch(cellSource, /viewportSnapshot/);
  assert.doesNotMatch(cellSource, /onViewportSnapshotChange/);
  assert.doesNotMatch(cellSource, /viewportUserTouched/);
});

test("Market stock chart identity ignores provider metadata that can hydrate later", () => {
  const stockSlot = {
    ticker: "QQQ",
    tf: "15m",
    market: "stocks",
    provider: "polygon",
    tradeProvider: "ibkr",
    dataProviderPreference: "polygon",
    providerContractId: "320227571",
  };
  const plainStockSlot = {
    ticker: "QQQ",
    tf: "15m",
    market: "stocks",
  };

  assert.equal(resolveMarketGridChartProviderContractId(stockSlot), null);
  assert.equal(
    buildMarketGridViewportIdentity(1, stockSlot),
    buildMarketGridViewportIdentity(1, plainStockSlot),
  );
  assert.equal(
    resolveMarketGridChartProviderContractId({
      ticker: "SPX",
      market: "indices",
      providerContractId: "416904",
    }),
    null,
  );
});

test("Market non-equity chart identity preserves provider contracts", () => {
  const futuresSlot = {
    ticker: "ES",
    tf: "15m",
    market: "futures",
    provider: "ibkr",
    providerContractId: "ESM6",
  };

  assert.equal(
    resolveMarketGridChartProviderContractId(futuresSlot),
    "ESM6",
  );
  assert.notEqual(
    buildMarketGridViewportIdentity(2, futuresSlot),
    buildMarketGridViewportIdentity(2, {
      ...futuresSlot,
      providerContractId: null,
    }),
  );
});

test("Market mini chart no longer owns a provider-contract chart data path", () => {
  const source = readLocalSource("./MiniChartCell.jsx");

  assert.match(source, /TradeEquityPanel/);
  assert.doesNotMatch(source, /resolveMarketGridChartProviderContractId/);
  assert.doesNotMatch(source, /chartProviderContractId/);
  assert.doesNotMatch(
    source,
    /slot\?\.providerContractId/,
    "MiniChartCell should not pass raw provider contracts into chart requests",
  );
});
