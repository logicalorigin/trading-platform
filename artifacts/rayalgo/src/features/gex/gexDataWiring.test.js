import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screenSource = () =>
  readFileSync(new URL("../../screens/GexScreen.jsx", import.meta.url), "utf8");

test("GEX screen hydrates from the dedicated Massive-backed app API", () => {
  const source = screenSource();

  assert.match(source, /getGexDashboard as getGexDashboardRequest/);
  assert.match(source, /return getGexDashboardRequest\(encodeURIComponent\(ticker\),\s*\{ signal \}\)/);
  assert.match(source, /queryKey:\s*\["gex-dashboard",\s*ticker\]/);
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

test("GEX screen has phone filter sheet and expiration chips", () => {
  const source = screenSource();

  assert.match(source, /data-layout=\{isPhone \? "phone"/);
  assert.match(source, /data-testid="gex-mobile-filter-trigger"/);
  assert.match(source, /data-testid="gex-mobile-expiration-chips"/);
  assert.match(source, /testId="gex-mobile-filter-sheet"/);
  assert.match(source, /responsiveFlags\(gexRootSize\.width\)/);
});
