import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./MultiChartGrid.jsx", import.meta.url),
  "utf8",
);

test("market grid uses lightweight ticker row helpers without loading ticker search", () => {
  assert.match(source, /from "\.\.\/platform\/tickerUniverseRows";/);
  assert.doesNotMatch(source, /from "\.\.\/platform\/tickerSearch\/model";/);
  assert.doesNotMatch(source, /from "\.\.\/platform\/tickerSearch\/TickerSearch\.jsx";/);
});
