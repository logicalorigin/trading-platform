import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("TradeEquityPanel wires the GEX projection cone into the shared chart frame", () => {
  const source = readFileSync(
    new URL("../trade/TradeEquityPanel.jsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /useGexProjectionConeOverlay/);
  assert.match(source, /const gexProjection = useGexProjectionConeOverlay/);
  assert.match(source, /gexProjectionCone=\{gexProjection\.overlay\}/);
});

test("MarketChartCell only enables GEX projection fetches for active chart cells", () => {
  const source = readFileSync(
    new URL("../market/MarketChartCell.jsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /gexProjectionEnabled=\{Boolean\(isActive \|\| fullFrame\)\}/);
});

test("Trade screen keeps the spot chart drawable in narrow layouts", () => {
  const source = readFileSync(
    new URL("../../screens/TradeScreen.jsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const tradeNarrowChartFrameStyle = \{/);
  assert.match(source, /minHeight: dim\(320\)/);
  assert.match(source, /tradeIsNarrow\s*\?\s*tradeNarrowChartFrameStyle/);
});

test("Research chart frame forwards the GEX projection cone to the chart surface", () => {
  const frameSource = readFileSync(
    new URL("../charting/ResearchChartFrame.tsx", import.meta.url),
    "utf8",
  );
  const surfaceSource = readFileSync(
    new URL("../charting/ResearchChartSurface.tsx", import.meta.url),
    "utf8",
  );

  assert.match(frameSource, /gexProjectionCone\?: GexProjectionConeOverlay \| null/);
  assert.match(frameSource, /gexProjectionCone=\{gexProjectionCone\}/);
  assert.match(surfaceSource, /data-chart-gex-projection-cone/);
  assert.match(surfaceSource, /data-chart-gex-projection-future-axis/);
  assert.match(surfaceSource, /formatGexProjectionAxisLabel/);
  assert.match(surfaceSource, /resolveGexProjectionLogicalOffset/);
  assert.match(surfaceSource, /resolveGexProjectionAutoFitLogicalOffset/);
  assert.match(surfaceSource, /resolveGexProjectionVisibleLogicalRange/);
  assert.match(surfaceSource, /chartTimeframe: legend\?\.timeframe \|\| footprintContext\?\.timeframe \|\| null/);
  assert.match(surfaceSource, /lastX \+ logicalOffset \* barSpacing/);
  assert.doesNotMatch(surfaceSource, /resolveGexProjectionRightOffset/);
  assert.doesNotMatch(surfaceSource, /minimumProjectionOffset/);
  assert.doesNotMatch(surfaceSource, /minimumFutureWidth/);
  assert.doesNotMatch(surfaceSource, /\(index \+ 1\) \/ visiblePoints\.length/);
  assert.match(surfaceSource, /lastLogicalIndex \+[\s\S]*normalizedProjectionOffset \+[\s\S]*GEX_PROJECTION_AUTO_FIT_PADDING_BARS/);
  assert.match(surfaceSource, /chartTimeScaleHeight/);
  assert.match(surfaceSource, /axisLabelFill:\s*withAlpha\(theme\.textMuted/);
  assert.doesNotMatch(surfaceSource, /axisLabelBg/);
  assert.doesNotMatch(surfaceSource, /strokeDasharray="2 3"/);
  assert.match(surfaceSource, /buildGexProjectionConeSvgOverlay/);
  assert.match(surfaceSource, /centerDots/);
  assert.match(surfaceSource, /data-chart-gex-projection-center-dot/);
  assert.match(surfaceSource, /buildGexProjectionFallbackPriceCoordinate/);
  assert.match(surfaceSource, /fallbackPriceToCoordinate/);
  assert.match(surfaceSource, /The GEX cone depends on priceToCoordinate/);
  assert.match(surfaceSource, /activePriceSeriesRef\.current = candleSeries;\s*\/\/ The GEX cone depends on priceToCoordinate; rebuild overlays after series attach\.\s*setOverlayRevision/);
});
