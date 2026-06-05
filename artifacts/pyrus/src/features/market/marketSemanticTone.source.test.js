import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const marketSource = () =>
  readFileSync(new URL("../../screens/MarketScreen.jsx", import.meta.url), "utf8");

test("Market screen imports shared directional tone helpers", () => {
  const source = marketSource();

  assert.match(source, /features\/platform\/semanticToneModel\.js/);
  assert.match(source, /toneForDirectionalIntent/);
  assert.match(source, /toneForMarketPressure/);
});

test("Market put-call and sector option pressure do not use green", () => {
  const source = marketSource();

  assert.doesNotMatch(source, /putCallBullish \? CSS_COLOR\.green/);
  assert.doesNotMatch(source, /strongestSectorFlow\.net >= 0 \? CSS_COLOR\.green/);
  assert.doesNotMatch(source, /sector\.net >= 0 \? CSS_COLOR\.green/);
});
