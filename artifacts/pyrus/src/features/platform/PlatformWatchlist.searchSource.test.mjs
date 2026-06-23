import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./PlatformWatchlist.jsx", import.meta.url),
  "utf8",
);

test("watchlist add search lazy-loads the shared ticker search panel", () => {
  assert.match(
    source,
    /from "\.\/tickerSearch\/chartTickerSearchLoader\.js";/,
  );
  assert.match(source, /preloadWatchlistTickerSearch\(\)/);
  assert.match(source, /onPointerEnter=\{preloadWatchlistTickerSearch\}/);
  assert.match(source, /data-testid="watchlist-ticker-search-loading"/);
  assert.match(source, /<LazyWatchlistTickerSearch/);
  assert.doesNotMatch(source, /persistMarketFilter/);
  assert.doesNotMatch(source, /initialMarketFilter/);
  assert.doesNotMatch(source, /useSearchUniverseTickers/);
  assert.doesNotMatch(source, /WatchlistAddSymbolInput/);
  assert.doesNotMatch(source, /WatchlistSearchSourceChip/);
  assert.doesNotMatch(source, /import\("\.\/tickerSearch\/ChartTickerSearch\.jsx"\)/);
  assert.doesNotMatch(source, /import\("\.\/tickerSearch\/TickerSearch\.jsx"\)/);
});
