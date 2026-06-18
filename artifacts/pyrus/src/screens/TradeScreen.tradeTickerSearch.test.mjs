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
