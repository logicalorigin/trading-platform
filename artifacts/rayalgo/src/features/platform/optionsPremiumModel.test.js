import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateOptionTradePremium,
  classifyOptionMoneyness,
  inferFlowBias,
  summarizePremiumByMoneyness,
} from "./optionsPremiumModel.js";

test("calculateOptionTradePremium prefers execution price over mark and midpoint", () => {
  const result = calculateOptionTradePremium({
    executionPrice: 2.5,
    mark: 2.4,
    bid: 2.35,
    ask: 2.45,
    size: 10,
    multiplier: 100,
  });

  assert.equal(result.premium, 2500);
  assert.equal(result.premiumPrice, 2.5);
  assert.equal(result.premiumPriceSource, "execution");
});

test("calculateOptionTradePremium falls back to mark and midpoint", () => {
  assert.deepEqual(
    calculateOptionTradePremium({ mark: 1.2, size: 5 }).premium,
    600,
  );
  assert.deepEqual(
    calculateOptionTradePremium({ bid: 1, ask: 1.2, size: 5 }).premium,
    550,
  );
});

test("classifyOptionMoneyness uses a dynamic ATM band", () => {
  assert.equal(
    classifyOptionMoneyness({
      spot: 101,
      strike: 100,
      right: "call",
      strikeSpacing: 5,
    }),
    "ATM",
  );
  assert.equal(
    classifyOptionMoneyness({ spot: 110, strike: 100, right: "call", strikeSpacing: 5 }),
    "ITM",
  );
  assert.equal(
    classifyOptionMoneyness({ spot: 90, strike: 100, right: "put", strikeSpacing: 5 }),
    "ITM",
  );
});

test("inferFlowBias keeps ambiguous side neutral", () => {
  assert.equal(inferFlowBias({ cp: "C", side: "buy" }), "bullish");
  assert.equal(inferFlowBias({ cp: "P", side: "sell" }), "bullish");
  assert.equal(inferFlowBias({ cp: "C", side: "mid" }), "neutral");
});

test("summarizePremiumByMoneyness splits calls puts and neutral premium", () => {
  const summary = summarizePremiumByMoneyness([
    { cp: "C", side: "buy", moneyness: "OTM", premium: 1000 },
    { cp: "P", side: "mid", moneyness: "OTM", premium: 700 },
  ]);

  assert.equal(summary.OTM.calls, 1000);
  assert.equal(summary.OTM.puts, 700);
  assert.equal(summary.OTM.bullish, 1000);
  assert.equal(summary.OTM.neutral, 700);
});
