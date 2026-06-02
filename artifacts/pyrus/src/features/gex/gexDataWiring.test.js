import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screenSource = () =>
  readFileSync(new URL("../../screens/GexScreen.jsx", import.meta.url), "utf8");
const heatmapSource = () =>
  readFileSync(new URL("./gexHeatmapModel.js", import.meta.url), "utf8");

test("GEX screen hydrates from the dedicated IBKR-backed GEX API", () => {
  const source = screenSource();

  assert.match(source, /getGexDashboard as getGexDashboardRequest/);
  assert.match(source, /return getGexDashboardRequest\(encodeURIComponent\(ticker\),\s*\{ signal \}\)/);
  assert.match(source, /queryKey:\s*\["gex-dashboard",\s*ticker\]/);
  assert.match(source, /GEX_DASHBOARD_QUERY_REFETCH_MS/);
  assert.match(source, /normalizeGexResponseOptions\(gexData\?\.options \|\| \[\]\)/);
});

test("GEX screen no longer stitches data through Trade option-chain or scanner paths", () => {
  const source = screenSource();

  assert.doesNotMatch(source, /useGetQuoteSnapshots/);
  assert.doesNotMatch(source, /useGetOptionExpirations/);
  assert.doesNotMatch(source, /getOptionChainRequest/);
  assert.doesNotMatch(source, /batchOptionChainsRequest/);
  assert.doesNotMatch(source, /useMarketFlowSnapshotForStoreKey/);
  assert.doesNotMatch(source, /BROAD_MARKET_FLOW_STORE_KEY/);
  assert.doesNotMatch(source, /buildFlowContextFromEvents/);
});

test("GEX heatmap uses the same contract GEX convention as KPI charts", () => {
  const source = screenSource();
  const heatmap = heatmapSource();

  assert.match(source, /buildGexHeatmapModel\(rows,\s*spot\)/);
  assert.match(heatmap, /contractGex\(row,\s*spot\)/);
  assert.doesNotMatch(source, /row\.gamma \* row\.openInterest/);
});

test("GEX IV scenario is wired only to provider-IV gamma price projection", () => {
  const source = screenSource();

  assert.match(source, /const ivScenarioRows = useMemo/);
  assert.match(source, /impliedVol:\s*isFiniteNumber\(row\.impliedVol\)/);
  assert.match(source, /aggregateMetrics\(filteredRows,\s*spot\)/);
  assert.match(source, /expConcentration\(filteredRows,\s*spot\)/);
  assert.match(source, /Provider IV \{providerIvCount\}\/\{filteredRows\.length\}/);
  assert.match(source, /<GammaPriceChart[\s\S]*rows=\{ivScenarioRows\}/);
  assert.doesNotMatch(source, /gamma:\s*row\.gamma \* scale/);
});

test("GEX screen has phone filter sheet and expiration chips", () => {
  const source = screenSource();

  assert.match(source, /data-layout=\{isPhone \? "phone"/);
  assert.match(source, /dataTestId="gex-mobile-filter-trigger"/);
  assert.match(source, /data-testid="gex-mobile-expiration-chips"/);
  assert.match(source, /data-testid="gex-mobile-expiration-more"/);
  assert.match(source, /testId="gex-mobile-filter-sheet"/);
  assert.match(source, /responsiveFlags\(gexRootSize\.width\)/);
});

test("GEX screen surfaces source coverage and complete expiration labels", () => {
  const source = screenSource();

  assert.match(source, /data-testid="gex-source-coverage-banner"/);
  assert.match(source, /data-testid="gex-source-last-updated"/);
  assert.match(source, /expirationCoverage\?\.complete === true/);
  assert.match(source, /"All expirations"/);
  assert.match(source, /"All loaded expirations"/);
});

test("GEX heatmap and strike profile table match InsiderFinance table semantics", () => {
  const source = screenSource();
  const heatmap = heatmapSource();

  assert.match(source, /\.sort\(\(left,\s*right\)\s*=>\s*right - left\)/);
  assert.match(source, /const visibleStrikes = expanded \? displayStrikes : focusedStrikes/);
  assert.match(source, /hasGexHeatmapCellValue\(/);
  assert.match(source, /const valueLabel = hasValue \? formatHeatmapCellValue\(value\) : ""/);
  assert.match(source, /background: hasValue \? cellColor\(value\) : CSS_COLOR\.bg0/);
  assert.doesNotMatch(source, /getGexHeatmapRowColorValue/);
  assert.match(heatmap, /marketDayDistanceFromExpirationKey/);
  assert.match(heatmap, /cellStatsMap/);
  assert.match(source, /Strike Profile/);
  assert.match(source, /Put Γ/);
  assert.match(source, /Call Γ/);
  assert.match(source, /Total OI/);
  assert.match(source, /Spot \{fmtPercent\(\(row\.strike - spot\) \/ spot\)\}/);
  assert.doesNotMatch(source, /gex-heatmap-pagination/);
  assert.doesNotMatch(source, /gex-profile-pagination/);
});
