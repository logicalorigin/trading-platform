import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tradeSource = () =>
  readFileSync(new URL("../../screens/TradeScreen.jsx", import.meta.url), "utf8");
const tradeFeatureSource = (fileName) =>
  readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");

test("Trade screen imports shared semantic tone helpers", () => {
  const source = tradeSource();

  assert.match(source, /features\/platform\/semanticToneModel\.js/);
  assert.match(source, /toneForDirectionalIntent/);
  assert.match(source, /toneForOptionSide/);
});

test("Trade chart-flow direction and option side labels do not use green", () => {
  const source = tradeSource();

  assert.doesNotMatch(source, /bias === "bullish" \? CSS_COLOR\.green/);
  assert.doesNotMatch(source, /event\.cp === "P" \? CSS_COLOR\.red : CSS_COLOR\.green/);
});

test("Trade lazy panels use semantic buy/call tones instead of green", () => {
  const orderTicket = tradeFeatureSource("TradeOrderTicket.jsx");
  const l2Panel = tradeFeatureSource("TradeL2Panel.jsx");
  const chainPanel = tradeFeatureSource("TradeChainPanel.jsx");
  const positionsPanel = tradeFeatureSource("TradePositionsPanel.jsx");

  assert.match(orderTicket, /toneForDirectionalIntent/);
  assert.match(orderTicket, /toneForOptionSide/);
  assert.match(orderTicket, /const contractColor = toneForOptionSide\(slot\.cp/);
  assert.match(orderTicket, /confirmTone: selectedSideColor/);
  assert.match(orderTicket, /background: isLong \? TRADE_BUY_TONE/);
  assert.match(orderTicket, /primarySubmitColor[\s\S]*selectedSideColor/);
  assert.doesNotMatch(orderTicket, /value === "BUY"\s*\?\s*CSS_COLOR\.green/);
  assert.doesNotMatch(orderTicket, /confirmTone: isLong \? CSS_COLOR\.green/);
  assert.doesNotMatch(orderTicket, /background: isLong \? CSS_COLOR\.green/);

  assert.match(l2Panel, /toneForOptionSide/);
  assert.match(l2Panel, /const contractColor = toneForOptionSide\(slot\.cp/);
  assert.match(l2Panel, /execution\.side === "buy" \? TRADE_BUY_TONE : TRADE_SELL_TONE/);
  assert.doesNotMatch(l2Panel, /execution\.side === "buy" \? CSS_COLOR\.green/);

  assert.match(chainPanel, /const sideColor = toneForOptionSide\(side/);
  assert.doesNotMatch(chainPanel, /side === "C" \? CSS_COLOR\.green/);

  assert.match(positionsPanel, /toneForDirectionalIntent/);
  assert.doesNotMatch(positionsPanel, /execution\.side === "BUY" \? CSS_COLOR\.green/);
  assert.doesNotMatch(positionsPanel, /order\.side === "buy" \? CSS_COLOR\.green/);
});
