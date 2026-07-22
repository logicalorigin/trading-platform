import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./MarketDemoScreen.jsx", import.meta.url),
  "utf8",
);
const gridSource = readFileSync(
  new URL("../features/market/MultiChartGrid.jsx", import.meta.url),
  "utf8",
);
const chartCellSource = readFileSync(
  new URL("../features/market/MarketChartCell.jsx", import.meta.url),
  "utf8",
);

test("production Market owns shared reference data without loading the legacy activity panel", () => {
  assert.match(
    source,
    /UNUSUAL_THRESHOLD_OPTIONS,[\s\S]*?from "\.\.\/features\/market\/marketReferenceData\.js";/,
  );
  assert.doesNotMatch(source, /MarketActivityPanel\.jsx/);
});

test("the retained market screen stops its clock while hidden", () => {
  assert.match(
    source,
    /<RegimeTopBar[\s\S]{0,320}live=\{isVisible && !safeQaMode\}[\s\S]{0,40}\/>/,
  );
  assert.match(
    source,
    /if \(!live\) return undefined;\s+setNow\(new Date\(\)\);\s+const id = setInterval/,
  );
});

test("Market uses its content width and keeps the chart first only on the stacked touch layout", () => {
  const wideThreshold = Number(
    source.match(/const MARKET_WIDE_LAYOUT_MIN_WIDTH = (\d+);/)?.[1],
  );
  assert.ok(
    wideThreshold - 24 - 272 - 328 - 24 - 12 >= 768,
    "the wide rails, gaps, and inner insets must leave enough room for MultiChartGrid's non-phone mode",
  );
  assert.match(source, /const MARKET_SPLIT_LAYOUT_MIN_WIDTH = 960;/);
  assert.match(
    source,
    /const \[marketRootRef, marketRootSize\] = useElementSize\(\);/,
  );
  assert.match(
    source,
    /const wideLayout = marketRootSize\.width >= MARKET_WIDE_LAYOUT_MIN_WIDTH;/,
  );
  assert.match(source, /ref=\{marketRootRef\}/);
  assert.doesNotMatch(source, /useViewport/);
  assert.match(source, /gridTemplateAreas: '"scanner chart context"'/);
  assert.match(source, /gridTemplateAreas: '"scanner context" "chart chart"'/);

  const chartIndex = source.indexOf("{chartSlot}");
  const scannerIndex = source.indexOf("<MarketUniverseScanner", chartIndex);
  const contextIndex = source.indexOf("{rightColumn}", scannerIndex);
  assert.ok(chartIndex >= 0 && chartIndex < scannerIndex);
  assert.ok(scannerIndex < contextIndex);
});

test("Market reserves content-sized tracks so the scanner and context cannot overlap the chart", () => {
  const focusThreshold = Number(
    source.match(/const MARKET_FOCUS_LAYOUT_MIN_WIDTH = (\d+);/)?.[1],
  );
  assert.ok(
    focusThreshold - 24 - 272 - 12 - 12 >= 768,
    "the scanner-plus-chart tier must preserve MultiChartGrid's non-phone floor after real insets",
  );
  assert.match(
    source,
    /const focusLayout =\s*!wideLayout && marketRootSize\.width >= MARKET_FOCUS_LAYOUT_MIN_WIDTH;/,
  );
  assert.match(source, /gridTemplateAreas: '"context context" "scanner chart"'/);
  assert.ok(
    source.match(/gridTemplateRows: "max-content max-content"/g)?.length >= 2,
    "both non-wide two-row grids must reserve the chart's full rendered height",
  );
  assert.match(
    source,
    /gridArea: "chart",\s*overflowY: wideLayout \? "auto" : "visible",\s*flexShrink: 0/,
  );
  assert.match(source, /const \[chartSlotRef, chartSlotSize\] = useElementSize\(\);/);
  assert.match(source, /ref=\{chartSlotRef\}/);
  assert.match(
    source,
    /const focusScannerHeight = chartSlotSize\.height > 0[\s\S]{0,100}"min\(60vh, 520px\)";/,
  );
  assert.match(
    source,
    /height: wideLayout \? "100%" : focusLayout \? focusScannerHeight : "min\(60vh, 520px\)"/,
  );
});

test("stacked Market sections keep their intended height and scroll instead of collapsing", () => {
  assert.match(
    source,
    /data-testid="market-demo-context-rail"[\s\S]{0,520}flexShrink: 0/,
  );
  assert.match(
    source,
    /data-testid="market-demo-scanner"[\s\S]{0,420}flexShrink: 0/,
  );
});

test("Market releases background work only after its primary chart is ready", () => {
  assert.match(source, /onReadinessChange,/);
  assert.match(
    source,
    /const handleMarketReady = useCallback\([\s\S]{0,520}backgroundAllowed: Boolean\(isVisible && !safeQaMode\)/,
  );
  assert.match(source, /onReady=\{handleMarketReady\}/);
});

test("Market regime inputs react to runtime ticker updates and distinguish flow readiness", () => {
  assert.match(
    source,
    /const EMPTY_MARKET_SNAPSHOT_SYMBOLS = \[\];/,
  );
  assert.match(source, /\.\.\.WATCHLIST\.map\(\(item\) => item\.sym\)/);
  assert.match(
    source,
    /const marketSnapshots = useRuntimeTickerSnapshots\(\s*isVisible \? MARKET_REGIME_SYMBOLS : EMPTY_MARKET_SNAPSHOT_SYMBOLS,?\s*\);/,
  );
  assert.match(
    source,
    /const breadth = useMemo\(\(\) => buildTrackedBreadthSummary\(\), \[marketSnapshots\]\);/,
  );
  assert.match(source, /const volPct = marketSnapshots\.VIXY\?\.pct/);
  assert.match(source, /flowStatus=\{flowStatus\}/);
  assert.match(source, /const flowStatus = flowQuery\.data != null\s*\? "ready"/);
  assert.match(source, /flowStatus === "pending"/);
  assert.match(source, /flowStatus === "error"/);
});

test("Market labels the volatility proxy honestly and preserves touch-safe context actions", () => {
  assert.match(source, /label="VIXY Δ"/);
  assert.doesNotMatch(source, /label="VIX"/);
  assert.ok(
    source.match(/className="ra-interactive ra-touch-target-y"/g)?.length >= 2,
    "news links and catalyst buttons should retain the shared touch-height floor",
  );
});

test("Market single-chart mode hides multi-chart counts and layout controls", () => {
  assert.match(
    gridSource,
    /phoneGrid\s*\? `\$\{renderedSlotEntries\[0\]\?\.slot\?\.ticker \|\| activeSym\} focused`\s*:/,
  );
  assert.doesNotMatch(gridSource, /focused · \$\{cfg\.count\} charts/);
  assert.match(gridSource, /\{phoneGrid \? "CHART" : "CHARTS"\}/);
  assert.match(
    gridSource,
    /\{!phoneGrid \? \(\s*<div[\s\S]{0,700}Object\.keys\(MULTI_CHART_LAYOUTS\)/,
  );
  assert.doesNotMatch(
    gridSource,
    /\{phoneGrid \? MULTI_CHART_LAYOUTS\[key\]\.count : key\}/,
  );
  assert.match(
    gridSource,
    /data-testid="market-chart-reset-views"[\s\S]{0,120}className="ra-touch-target-y"/,
  );
});

test("Market highlights one focused chart slot even when several slots share a ticker", () => {
  assert.match(gridSource, /isActive=\{index === soloSlotIndex\}/);
  assert.match(
    gridSource,
    /onFocus=\{\(ticker\) => \{\s*setSoloSlotIndex\(index\);\s*onSymClick\?\.\(ticker\);\s*\}\}/,
  );
  assert.doesNotMatch(
    gridSource,
    /isActive=\{\s*normalizeTickerSymbol\(slot\.ticker\) === normalizeTickerSymbol\(activeSym\)\s*\}/,
  );
  assert.match(
    chartCellSource,
    /className="market-chart-cell"\s+data-active=\{isActive \? "true" : "false"\}/,
  );
});
