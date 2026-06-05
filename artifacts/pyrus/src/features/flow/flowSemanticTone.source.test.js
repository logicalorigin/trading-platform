import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const flowSource = () =>
  readFileSync(new URL("../../screens/FlowScreen.jsx", import.meta.url), "utf8");

test("Flow screen imports shared semantic tone helpers", () => {
  const source = flowSource();

  assert.match(source, /features\/platform\/semanticToneModel\.js/);
  assert.match(source, /toneForDirectionalIntent/);
  assert.match(source, /toneForOptionSide/);
});

test("Flow directional call, buy, and bullish visuals do not use green", () => {
  const source = flowSource();
  const forbiddenPatterns = [
    /event\.cp === "C" \? CSS_COLOR\.green/g,
    /contract\.cp === "C" \? CSS_COLOR\.green/g,
    /selectedEvt\.cp === "C" \? CSS_COLOR\.green/g,
    /strike\.event\.cp === "C" \? CSS_COLOR\.green/g,
    /sentiment === "bull" \? CSS_COLOR\.green/g,
    /event\.side === "BUY" \? CSS_COLOR\.green/g,
    /buy >= sell \? CSS_COLOR\.green/g,
    /background: CSS_COLOR\.green/g,
    /"BULLISH"[\s\S]{0,120}CSS_COLOR\.green/g,
  ];

  forbiddenPatterns.forEach((pattern) => {
    assert.doesNotMatch(source, pattern);
  });
});
