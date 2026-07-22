import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./PlatformWatchlist.jsx", import.meta.url),
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
