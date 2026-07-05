import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveMarketChartGexProjectionEnabled } from "./gexProjectionCoverage.js";

const marketChartCellSource = readFileSync(
  new URL("../market/MarketChartCell.jsx", import.meta.url),
  "utf8",
);
const tradeEquityPanelSource = readFileSync(
  new URL("../trade/TradeEquityPanel.jsx", import.meta.url),
  "utf8",
);
const tradeScreenSource = readFileSync(
  new URL("../../screens/TradeScreen.jsx", import.meta.url),
  "utf8",
);
const useGexProjectionSource = readFileSync(
  new URL("./useGexProjection.js", import.meta.url),
  "utf8",
);
const useGexZeroGammaSource = readFileSync(
  new URL("./useGexZeroGamma.js", import.meta.url),
  "utf8",
);

test("market chart GEX projection is enabled for every hydrated ticker cell", () => {
  assert.equal(
    resolveMarketChartGexProjectionEnabled({
      ticker: "QQQ",
      historicalDataEnabled: true,
    }),
    true,
  );
  assert.equal(
    resolveMarketChartGexProjectionEnabled({
      ticker: " spy ",
      historicalDataEnabled: true,
    }),
    true,
  );
});

test("market chart GEX projection stays disabled without a hydrated ticker", () => {
  assert.equal(
    resolveMarketChartGexProjectionEnabled({
      ticker: "AAPL",
      historicalDataEnabled: false,
    }),
    false,
  );
  assert.equal(
    resolveMarketChartGexProjectionEnabled({
      ticker: "",
      historicalDataEnabled: true,
    }),
    false,
  );
});

test("chart GEX overlays use passive snapshot mode", () => {
  assert.match(marketChartCellSource, /GEX_PROJECTION_MODE_SNAPSHOT/);
  assert.match(marketChartCellSource, /GEX_ZERO_GAMMA_MODE_SNAPSHOT/);
  assert.match(
    marketChartCellSource,
    /gexProjectionMode=\{GEX_PROJECTION_MODE_SNAPSHOT\}/,
  );
  assert.match(marketChartCellSource, /mode:\s*GEX_ZERO_GAMMA_MODE_SNAPSHOT/);
  assert.match(tradeEquityPanelSource, /GEX_PROJECTION_MODE_SNAPSHOT/);
  assert.match(
    tradeEquityPanelSource,
    /gexProjectionMode = GEX_PROJECTION_MODE_SNAPSHOT/,
  );
  assert.match(tradeEquityPanelSource, /mode: gexProjectionMode/);
  assert.match(tradeScreenSource, /GEX_PROJECTION_MODE_SNAPSHOT/);
  assert.match(tradeScreenSource, /GEX_ZERO_GAMMA_MODE_SNAPSHOT/);
  assert.match(
    tradeScreenSource,
    /gexProjectionMode=\{GEX_PROJECTION_MODE_SNAPSHOT\}/,
  );
  assert.match(tradeScreenSource, /mode:\s*GEX_ZERO_GAMMA_MODE_SNAPSHOT/);
});

test("snapshot GEX overlay queries do not poll or retain stale placeholders", () => {
  assert.match(useGexProjectionSource, /mode", GEX_PROJECTION_MODE_SNAPSHOT/);
  assert.match(
    useGexProjectionSource,
    /normalizedMode !== GEX_PROJECTION_MODE_SNAPSHOT/,
  );
  assert.match(
    useGexProjectionSource,
    /normalizedMode === GEX_PROJECTION_MODE_SNAPSHOT\s*\?\s*\{\}/,
  );
  assert.match(useGexZeroGammaSource, /mode", GEX_ZERO_GAMMA_MODE_SNAPSHOT/);
  assert.match(
    useGexZeroGammaSource,
    /mode !== GEX_ZERO_GAMMA_MODE_SNAPSHOT/,
  );
  assert.match(
    useGexZeroGammaSource,
    /mode === GEX_ZERO_GAMMA_MODE_SNAPSHOT\s*\?\s*\{\}/,
  );
});
