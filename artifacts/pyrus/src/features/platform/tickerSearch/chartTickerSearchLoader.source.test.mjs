import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./chartTickerSearchLoader.js", import.meta.url),
  "utf8",
);

test("chart ticker search loader keeps the picker split and cached", () => {
  assert.match(source, /const loadChartTickerSearchModule = \(\) => import\("\.\/ChartTickerSearch\.jsx"\);/);
  assert.match(source, /let chartTickerSearchPreloadPromise = null;/);
  assert.match(source, /preloadDynamicImport\(\s*loadChartTickerSearchModule,/s);
  assert.match(source, /export const LazyMarketChartTickerSearch = lazyWithRetry/);
  assert.match(source, /export const LazyMiniChartTickerSearch = lazyWithRetry/);
  assert.match(source, /export const LazyWatchlistTickerSearch = lazyWithRetry/);
  assert.doesNotMatch(source, /import\("\.\/TickerSearch\.jsx"\)/);
});
