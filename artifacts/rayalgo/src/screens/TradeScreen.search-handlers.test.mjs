import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TradeScreen.jsx", import.meta.url), "utf8");
const platformSource = readFileSync(
  new URL("../RayAlgoPlatform.jsx", import.meta.url),
  "utf8",
);

test("TradeScreen search handlers use the current ticker-search anchor names", () => {
  assert.doesNotMatch(source, /\b(toggleUniverseSearch|openUniverseSearch)\b/);
  assert.match(source, /const toggleTabSearch = useCallback/);
  assert.match(source, /const openEquitySearch = useCallback/);
  assert.match(source, /onAddNew=\{toggleTabSearch\}/);
  assert.match(source, /onOpenSearch=\{openEquitySearch\}/);
});

test("TradeScreen chart ticker search selects market search results directly", () => {
  assert.doesNotMatch(source, /strictTradeResolution/);
  assert.doesNotMatch(source, /mode:\s*"trade-resolve"/);
  assert.doesNotMatch(source, /strictTrade:\s*true/);
  assert.doesNotMatch(source, /findExactIbkrTradeResolutionRow/);
  assert.match(source, /onSelectTicker=\{handleSelectUniverseTicker\}/);
  assert.match(source, /focusTicker\(nextTicker,\s*result\?\.name \|\| nextTicker\)/);
});

test("TradeScreen lets pending symbol handoffs beat persisted trade state", () => {
  assert.match(source, /export const resolveInitialTradeTicker/);
  assert.match(source, /Number\(symPing\.n\) > 0/);
  assert.match(
    source,
    /pingSymbol\s*\|\|\s*\n\s*normalizeTradeTickerSymbol\(sym\)\s*\|\|\s*\n\s*normalizeTradeTickerSymbol\(persistedActive\)/,
  );
});

test("TradeScreen applies watchlist handoffs before painting stale ticker content", () => {
  assert.match(source, /useLayoutEffect\(\(\) => \{\n\s*if \(!symPing \|\| symPing\.n === 0\) return;/);
  assert.match(source, /const normalizedSym = normalizeTradeTickerSymbol\(symPing\.sym\)/);
  assert.match(source, /focusTicker\(normalizedSym\)/);
});

test("TradeScreen keeps more than eight recent ticker tabs", () => {
  assert.match(source, /export const TRADE_RECENT_TICKER_LIMIT = 16/);
  assert.match(source, /slice\(-TRADE_RECENT_TICKER_LIMIT\)/);
  assert.doesNotMatch(source, /slice\(-8\)/);
});

test("Platform does not passively reset Trade to the first active watchlist item", () => {
  assert.doesNotMatch(platformSource, /activeWatchlist\.items\.some\(\(item\) => item\.symbol === sym\)/);
  assert.doesNotMatch(platformSource, /activeWatchlist\.items\[0\]\?\.symbol/);
});
