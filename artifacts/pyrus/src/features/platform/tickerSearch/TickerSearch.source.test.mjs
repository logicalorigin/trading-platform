import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./TickerSearch.jsx", import.meta.url),
  "utf8",
);

test("ticker search lab copy identifies chart search as Massive-backed", () => {
  assert.match(source, /Massive-backed chart ticker search/);
  assert.doesNotMatch(source, /Real IBKR-backed ticker search/);
});

test("shared ticker search labels Massive-backed rows consistently", () => {
  assert.match(source, /const isTickerSearchMassiveBacked = \(result\) => \{/);
  assert.match(source, /providers\.includes\("massive"\)/);
  assert.match(source, /\? "Massive"/);
  assert.doesNotMatch(source, /Massive-backed[\s\S]*Data only[\s\S]*providerLabel/);
});
