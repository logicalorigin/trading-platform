import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gexSource = () =>
  readFileSync(new URL("../../screens/GexScreen.jsx", import.meta.url), "utf8");

test("GEX screen imports shared semantic tone helpers", () => {
  const source = gexSource();

  assert.match(source, /features\/platform\/semanticToneModel\.js/);
  assert.match(source, /toneForDirectionalIntent/);
  assert.match(source, /toneForOptionSide/);
  assert.match(source, /toneForFinancialDelta/);
});

test("GEX directional call, bullish, and positive net-gamma visuals do not use green", () => {
  const source = gexSource();
  const forbiddenPatterns = [
    /row\.netGex >= 0 \? CSS_COLOR\.green/g,
    /metrics\.netGex >= 0 \? CSS_COLOR\.green/g,
    /point\?\.netGex >= 0 \? CSS_COLOR\.green/g,
    /fill=\{CSS_COLOR\.green\}/g,
    /color=\{CSS_COLOR\.green\}/g,
    /Call \{fmtCurrency\(row\.callGex\)\}[\s\S]{0,80}CSS_COLOR\.green/g,
    /Call OI \{fmtNumber\(row\.callOi\)\}[\s\S]{0,80}CSS_COLOR\.green/g,
    /squeeze\.bias === "BULLISH" \? CSS_COLOR\.green/g,
  ];

  forbiddenPatterns.forEach((pattern) => {
    assert.doesNotMatch(source, pattern);
  });
});
