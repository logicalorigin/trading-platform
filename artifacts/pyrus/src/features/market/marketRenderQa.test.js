import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarketRenderDiagnostics,
  resolveMarketPanelColumns,
  resolveMarketRenderQaConfig,
} from "./marketRenderQa.js";

test("Market render QA query controls expose deterministic fixture settings", () => {
  const config = resolveMarketRenderQaConfig({
    safeQaMode: false,
    search:
      "?pyrusMarketQa=render&pyrusMarketFixture=dense&pyrusMarketCharts=shell&pyrusMarketDensity=stress",
  });

  assert.deepEqual(config, {
    enabled: true,
    source: "query",
    fixture: "dense",
    chartMode: "shell",
    density: "stress",
  });
});

test("Market safe QA mode forces the deterministic chart shell", () => {
  const config = resolveMarketRenderQaConfig({
    safeQaMode: true,
    search: "?pyrusMarketQa=off&pyrusMarketCharts=live",
  });

  assert.equal(config.enabled, true);
  assert.equal(config.source, "safe");
  assert.equal(config.fixture, "safe");
  assert.equal(config.chartMode, "shell");
});

test("Market panel column helper collapses known dense panels on narrow widths", () => {
  assert.equal(resolveMarketPanelColumns(390, { desktop: 4, tablet: 2, phone: 1 }), 1);
  assert.equal(resolveMarketPanelColumns(820, { desktop: 4, tablet: 2, phone: 1 }), 2);
  assert.equal(resolveMarketPanelColumns(1280, { desktop: 4, tablet: 2, phone: 1 }), 4);
});

test("Market render diagnostics are stable data attributes for QA artifacts", () => {
  const diagnostics = buildMarketRenderDiagnostics({
    qaConfig: resolveMarketRenderQaConfig({
      safeQaMode: true,
      search: "?pyrusMarketFixture=dense",
    }),
    chartMode: "shell",
    workspaceWidth: 390,
    pulseColumns: 1,
    sectorFlowColumns: 1,
    leadershipColumns: 1,
    dataCounts: {
      news: 0,
      sectorFlow: 0,
      leaders: 5,
      laggards: 5,
    },
  });

  assert.equal(diagnostics["data-market-qa-enabled"], "true");
  assert.equal(diagnostics["data-market-qa-source"], "safe");
  assert.equal(diagnostics["data-market-fixture"], "safe");
  assert.equal(diagnostics["data-market-chart-mode"], "shell");
  assert.equal(diagnostics["data-market-viewport"], "phone");
  assert.equal(diagnostics["data-market-pulse-columns"], "1");
  assert.equal(diagnostics["data-market-sector-flow-columns"], "1");
  assert.equal(diagnostics["data-market-leadership-columns"], "1");
  assert.equal(diagnostics["data-market-news-count"], "0");
});
