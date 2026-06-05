import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("TradeEquityPanel wires the combined GEX overlay into the shared chart frame", () => {
  const source = readFileSync(
    new URL("../trade/TradeEquityPanel.jsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /useGexProjectionConeOverlay/);
  assert.match(source, /const gexProjection = useGexProjectionConeOverlay/);
  assert.match(source, /const chartGexOverlay = useMemo/);
  assert.match(source, /zeroGammaLine:\s*gexOverlay\?\.zeroGammaLine \|\| null/);
  assert.match(source, /projectionCone:\s*gexProjection\.overlay \|\| null/);
  assert.match(source, /gexOverlay=\{chartGexOverlay\}/);
  assert.doesNotMatch(source, /gexProjectionCone=\{gexProjection\.overlay\}/);
});

test("MarketChartCell bounds GEX projection fetches to active hydrated chart cells", () => {
  const source = readFileSync(
    new URL("../market/MarketChartCell.jsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const chartGexOverlayEnabled = Boolean\(ticker && historicalDataEnabled\)/);
  assert.match(source, /const chartGexProjectionEnabled = Boolean\(/);
  assert.match(source, /ticker && historicalDataEnabled && \(isActive \|\| fullFrame\)/);
  assert.match(source, /gexProjectionEnabled=\{chartGexProjectionEnabled\}/);
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

test("Research chart frame forwards the combined GEX overlay to the chart surface", () => {
  const frameSource = readFileSync(
    new URL("../charting/ResearchChartFrame.tsx", import.meta.url),
    "utf8",
  );
  const surfaceSource = readFileSync(
    new URL("../charting/ResearchChartSurface.tsx", import.meta.url),
    "utf8",
  );

  assert.match(surfaceSource, /export type GexChartOverlay =/);
  assert.match(frameSource, /gexOverlay\?: GexChartOverlay \| null/);
  assert.match(frameSource, /gexOverlay=\{gexOverlay\}/);
  assert.match(surfaceSource, /const gexProjectionCone = gexOverlay\?\.projectionCone \?\? null/);
  assert.match(surfaceSource, /const gexZeroGammaLine = gexOverlay\?\.zeroGammaLine \?\? null/);
  assert.match(surfaceSource, /const effectiveReferenceLines = useMemo/);
  assert.match(surfaceSource, /data-chart-gex-projection-cone/);
  assert.match(surfaceSource, /data-chart-gex-projection-future-axis/);
  assert.match(surfaceSource, /formatGexProjectionAxisLabel/);
  assert.match(surfaceSource, /resolveGexProjectionLogicalOffset/);
  assert.match(surfaceSource, /resolveGexProjectionAutoFitLogicalOffset/);
  assert.match(surfaceSource, /resolveGexProjectionVisibleLogicalRange/);
  assert.match(surfaceSource, /chartTimeframe: legend\?\.timeframe \|\| footprintContext\?\.timeframe \|\| null/);
  assert.match(surfaceSource, /lastX \+ logicalOffset \* barSpacing/);
  assert.doesNotMatch(surfaceSource, /GEX_PROJECTION_DISPLAY_MIN_LOGICAL_OFFSET/);
  assert.doesNotMatch(surfaceSource, /GEX_PROJECTION_DISPLAY_MAX_LOGICAL_OFFSET/);
  assert.doesNotMatch(surfaceSource, /shouldCompress/);
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
  assert.match(surfaceSource, /const centerTone = theme\.green \|\| forecastTone/);
  assert.match(surfaceSource, /centerStroke:\s*withAlpha\(centerTone,\s*"f2"\)/);
  assert.match(surfaceSource, /buildGexProjectionFallbackPriceCoordinate/);
  assert.match(surfaceSource, /fallbackPriceToCoordinate/);
  assert.match(surfaceSource, /anchorPrice\?: number \| null/);
  assert.match(surfaceSource, /anchorPrice: latestQuotePrice/);
  assert.match(surfaceSource, /latestQuotePrice,\s*overlayRevision/);
  assert.match(
    surfaceSource,
    /const latestSpotPrice =[\s\S]*isFiniteNumber\(anchorPrice\)[\s\S]*lastBar\.c[\s\S]*overlay\.spot/,
  );
  assert.match(
    surfaceSource,
    /resolvePriceCoordinate\(latestSpotPrice\) \?\?[\s\S]*resolvePriceCoordinate\(overlay\.spot\)/,
  );
  assert.match(surfaceSource, /The GEX cone depends on priceToCoordinate/);
  assert.match(surfaceSource, /activePriceSeriesRef\.current = candleSeries;\s*\/\/ The GEX cone depends on priceToCoordinate; rebuild overlays after series attach\.\s*setOverlayRevision/);
});
