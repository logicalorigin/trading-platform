import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./PlatformWatchlist.jsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("./PlatformShell.jsx", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("./PlatformApp.jsx", import.meta.url),
  "utf8",
);

test("watchlist cards prioritize quotes and omit empty trend rails", () => {
  assert.match(source, /const renderQuoteStack = \(\) => \(/);
  assert.equal(source.match(/\{renderQuoteStack\(\)\}/g)?.length, 2);
  assert.equal(source.match(/data-testid="watchlist-row-context"/g)?.length, 2);
  assert.match(
    source,
    /if \(mobileDense\)[\s\S]*?watchlist-row-primary[\s\S]*?renderQuoteStack\(\)[\s\S]*?sparklinePoints\.length >= 2[\s\S]*?watchlist-row-context/,
  );
  assert.match(
    source,
    /watchlist-row-primary[\s\S]*?renderQuoteStack\(\)[\s\S]*?watchlist-row-context[\s\S]*?watchlist-row-sparkline/,
  );
  assert.equal(
    source.match(/boxShadow: `inset 0 -1px 0 \$\{CSS_COLOR\.border\}`/g)
      ?.length,
    2,
  );
});

test("watchlist card actions remain native and density-safe", () => {
  assert.equal(source.match(/data-testid="watchlist-row-primary"/g)?.length, 2);
  assert.equal(source.match(/onClick=\{handlePrimaryActionClick\}/g)?.length, 2);
  assert.match(source, /minHeight: mobileDense \? 52 : undefined/);
});

test("watchlist card internals fit every supported sidebar width", () => {
  assert.doesNotMatch(source, /watchlist-signal-pill|renderSignalPill/);
  assert.match(
    source,
    /const WATCHLIST_SIGNAL_DOTS_STYLE = \{ minWidth: dim\(52\), gap: 0 \};/,
  );
  assert.equal(source.match(/selectionMode \? null : renderSignalCluster/g)?.length, 1);
  assert.match(source, /selectionMode\s*\? null\s*:\s*renderSignalCluster\(\{ marginLeft: "auto", flexShrink: 0 \}\)/);
  assert.equal(source.match(/width: dim\(TABLE_SPARKLINE_COMPACT_WIDTH\)/g)?.length, 2);
  assert.equal(source.match(/height: dim\(TABLE_SPARKLINE_COMPACT_HEIGHT\)/g)?.length, 2);
  assert.match(shellSource, /const WATCHLIST_SIDEBAR_WIDTH_DEFAULT = 220;/);
  assert.match(shellSource, /const WATCHLIST_SIDEBAR_WIDTH_MIN = 220;/);
  assert.match(appSource, /const WATCHLIST_SIDEBAR_WIDTH_DEFAULT = 220;/);
  assert.match(appSource, /const WATCHLIST_SIDEBAR_WIDTH_MIN = 220;/);
});
