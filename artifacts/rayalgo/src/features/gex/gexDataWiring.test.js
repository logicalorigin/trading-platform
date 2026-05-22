import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screenSource = () =>
  readFileSync(new URL("../../screens/GexScreen.jsx", import.meta.url), "utf8");

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

  assert.match(source, /contractGex\(row,\s*spot\)/);
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
  assert.match(source, /testId="gex-mobile-filter-sheet"/);
  assert.match(source, /responsiveFlags\(gexRootSize\.width\)/);
});

test("GEX strike profile table uses client-side pagination", () => {
  const source = screenSource();

  assert.match(source, /GEX_HEATMAP_PAGE_SIZE = 40/);
  assert.match(source, /paginateRows\(model\.strikes,\s*page,\s*GEX_HEATMAP_PAGE_SIZE\)/);
  assert.match(source, /paginatedStrikes\.pageRows/);
  assert.match(source, /dataTestId="gex-heatmap-pagination"/);
  assert.match(source, /GEX_PROFILE_PAGE_SIZE = 40/);
  assert.match(source, /paginateRows\(profile,\s*page,\s*GEX_PROFILE_PAGE_SIZE\)/);
  assert.match(source, /paginatedProfile\.pageRows\.map/);
  assert.match(source, /dataTestId="gex-profile-pagination"/);
});
