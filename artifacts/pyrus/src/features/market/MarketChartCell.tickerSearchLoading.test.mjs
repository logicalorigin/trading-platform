import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./MarketChartCell.jsx", import.meta.url),
  "utf8",
);

test("market chart ticker search stays lazy-loaded and does not render a blank fallback", () => {
  assert.match(
    source,
    /from "\.\.\/platform\/tickerSearch\/chartTickerSearchLoader\.js";/,
  );
  assert.match(
    source,
    /scheduleChartTickerSearchPreload\(preloadMarketChartTickerSearch\)/,
  );
  assert.match(source, /<LazyMarketChartTickerSearch/);
  assert.match(source, /data-testid="ticker-search-popover-loading"/);
  assert.match(source, /Loading search/);
  assert.match(
    source,
    /import \{ Skeleton \} from "\.\.\/\.\.\/components\/platform\/primitives\.jsx";/,
  );
  assert.match(source, /<Skeleton/);
  assert.match(source, /onSearchIntent=\{preloadMarketChartTickerSearch\}/);
  assert.doesNotMatch(source, /import\("\.\.\/platform\/tickerSearch\/ChartTickerSearch\.jsx"\)/);
  assert.doesNotMatch(source, /import\("\.\.\/platform\/tickerSearch\/TickerSearch\.jsx"\)/);
});
