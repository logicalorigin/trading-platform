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

test("Market chart panning expands history for inactive charts too", () => {
  const source = readLocalSource("./MiniChartCell.jsx");
  const handler = source.match(
    /const handleVisibleLogicalRangeChange = useCallback\([\s\S]*?\n  \);/,
  )?.[0];

  assert.ok(handler, "Mini chart must handle visible logical range changes");
  assert.match(handler, /scheduleVisibleRangeExpansion\(range\)/);
  assert.doesNotMatch(
    handler,
    /isActive/,
    "visible-range expansion must not be gated to the active chart",
  );
});

test("Market slot metadata updates clear viewports only after identity changes", () => {
  const source = readLocalSource("./MultiChartGrid.jsx");
  const updateSlot = source.match(
    /const updateSlot = \(slotIndex, patch\) => \{[\s\S]*?\n  \};\n  const updateSlotTimeframe/,
  )?.[0];

  assert.ok(updateSlot, "MultiChartGrid must define updateSlot");
  assert.match(updateSlot, /previousViewportIdentity/);
  assert.match(updateSlot, /nextViewportIdentity/);
  assert.match(
    updateSlot,
    /previousViewportIdentity !== nextViewportIdentity/,
  );
  assert.doesNotMatch(
    updateSlot,
    /patch\?\.providerContractId[\s\S]*clearViewportSnapshot/,
    "provider-only stock metadata patches should not force viewport resets",
  );
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

test("Market mini chart data path does not leak raw stock provider contracts", () => {
  const source = readLocalSource("./MiniChartCell.jsx");

  assert.match(source, /resolveMarketGridChartProviderContractId/);
  assert.match(source, /const chartProviderContractId =/);
  assert.doesNotMatch(
    source,
    /slot\?\.providerContractId/,
    "MiniChartCell should route provider contracts through market-aware normalization",
  );
});
