import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./ChartTickerSearch.jsx", import.meta.url),
  "utf8",
);

test("chart ticker search stays lightweight and Massive-backed", () => {
  assert.match(source, /fetch\(`\/api\/universe\/tickers\?\$\{params\.toString\(\)\}`/);
  assert.match(source, /Searching Massive/);
  assert.match(source, /query: normalizedQuery,/);
  assert.match(source, /searchQuery\.isFetching \|\| searchQuery\.error/);
  assert.match(source, /export const MiniChartTickerSearch = MarketChartTickerSearch;/);
  assert.doesNotMatch(source, /QUICK_SYMBOL_GROUP_LIMIT/);
  assert.doesNotMatch(source, /suggestionsReady/);
  assert.doesNotMatch(source, /DEFAULT_WATCHLIST_BY_SYMBOL/);
  assert.doesNotMatch(source, /_disabled/);
  assert.doesNotMatch(source, /Resolve/);
  assert.doesNotMatch(source, /MARKET_FILTERS/);
  assert.doesNotMatch(source, /ticker-search-filter-/);
  assert.doesNotMatch(source, /params\.set\("markets"/);
  assert.doesNotMatch(source, /@workspace\/api-client-react/);
  assert.doesNotMatch(source, /from "\.\/model"/);
  assert.doesNotMatch(source, /MarketIdentity/);
  assert.doesNotMatch(source, /workspaceState/);
  assert.doesNotMatch(source, /TickerSearchLab/);
  assert.doesNotMatch(source, /TickerUniverseSearchPanel/);
});

test("chart ticker search does not expose rows from an earlier debounced query", () => {
  const rowsDeclaration = source.match(/const rows =[\s\S]*?;/)?.[0] || "";

  assert.match(
    rowsDeclaration,
    /normalizeQuery\(query\)\s*===\s*normalizedQuery|normalizedQuery\s*===\s*normalizeQuery\(query\)/,
  );
  assert.match(rowsDeclaration, /\[\]/);
});
