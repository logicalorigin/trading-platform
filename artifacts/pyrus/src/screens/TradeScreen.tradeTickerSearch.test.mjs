import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

const tradeScreenSource = readLocalSource("./TradeScreen.jsx");

test("trade equity ticker search content is memoized by open state", () => {
  assert.match(
    tradeScreenSource,
    /const equityTickerSearchOpen =\s*tradeTickerSearchAnchor === "equity";/,
  );
  assert.match(
    tradeScreenSource,
    /const equityTickerSearchContent = useMemo\(\s*\(\) =>\s*renderTradeTickerSearch\(equityTickerSearchOpen\),/s,
  );
  assert.match(
    tradeScreenSource,
    /searchOpen=\{equityTickerSearchOpen\}/,
  );
  assert.match(
    tradeScreenSource,
    /searchContent=\{equityTickerSearchContent\}/,
  );
});

test("trade ticker search module is not preloaded with the screen", () => {
  const preloadScreenModulesBlock =
    /export const preloadScreenModules = \(\) =>[\s\S]*?\]\)\.then\(\(\) => undefined\);/.exec(
      tradeScreenSource,
    )?.[0] ?? "";

  assert.match(
    tradeScreenSource,
    /from "\.\.\/features\/platform\/tickerSearch\/chartTickerSearchLoader\.js";/,
  );
  assert.match(
    tradeScreenSource,
    /scheduleChartTickerSearchPreload\(preloadMiniChartTickerSearch\)/,
  );
  assert.match(
    tradeScreenSource,
    /<LazyMiniChartTickerSearch/,
  );
  assert.match(
    tradeScreenSource,
    /onSearchIntent=\{preloadMiniChartTickerSearch\}/,
  );
  assert.doesNotMatch(
    preloadScreenModulesBlock,
    /preloadMiniChartTickerSearch/,
  );
  assert.doesNotMatch(
    tradeScreenSource,
    /import\("\.\.\/features\/platform\/tickerSearch\/ChartTickerSearch\.jsx"\)/,
  );
  assert.doesNotMatch(
    tradeScreenSource,
    /import\("\.\.\/features\/platform\/tickerSearch\/TickerSearch\.jsx"\)/,
  );
});
