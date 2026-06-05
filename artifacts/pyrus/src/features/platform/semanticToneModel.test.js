import assert from "node:assert/strict";
import test from "node:test";
import {
  SEMANTIC_TONE,
  toneForDirectionalIntent,
  toneForFinancialDelta,
  toneForOperationalState,
  toneForOptionSide,
  toneForRiskState,
} from "./semanticToneModel.js";

test("directional market intent uses blue and red, never green", () => {
  ["buy", "bullish", "call", "calls", "ask-calls", "long"].forEach((value) => {
    assert.equal(toneForDirectionalIntent(value), SEMANTIC_TONE.directionBuy);
    assert.notEqual(toneForDirectionalIntent(value), SEMANTIC_TONE.financialPositive);
  });

  ["sell", "bearish", "put", "puts", "bid-puts", "short"].forEach((value) => {
    assert.equal(toneForDirectionalIntent(value), SEMANTIC_TONE.directionSell);
  });
});

test("option side maps call pressure to blue and put pressure to red", () => {
  assert.equal(toneForOptionSide("C"), SEMANTIC_TONE.directionBuy);
  assert.equal(toneForOptionSide("call"), SEMANTIC_TONE.directionBuy);
  assert.equal(toneForOptionSide("P"), SEMANTIC_TONE.directionSell);
  assert.equal(toneForOptionSide("put"), SEMANTIC_TONE.directionSell);
  assert.equal(toneForOptionSide("unknown"), SEMANTIC_TONE.neutral);
});

test("financial delta preserves green and red outcome semantics", () => {
  assert.equal(toneForFinancialDelta(12.5), SEMANTIC_TONE.financialPositive);
  assert.equal(toneForFinancialDelta(-0.01), SEMANTIC_TONE.financialNegative);
  assert.equal(toneForFinancialDelta(0), SEMANTIC_TONE.neutral);
  assert.equal(toneForFinancialDelta(null), SEMANTIC_TONE.neutral);
});

test("operational state uses health semantics instead of direction semantics", () => {
  ["healthy", "live", "configured", "fresh", "connected"].forEach((value) => {
    assert.equal(toneForOperationalState(value), SEMANTIC_TONE.operationalGood);
  });
  ["stale", "pending", "refreshing", "degraded", "missing"].forEach((value) => {
    assert.equal(toneForOperationalState(value), SEMANTIC_TONE.operationalAttention);
  });
  ["error", "offline", "failed", "unavailable", "blocked"].forEach((value) => {
    assert.equal(toneForOperationalState(value), SEMANTIC_TONE.operationalBad);
  });
});

test("risk tone separates normal, attention, and critical states", () => {
  assert.equal(toneForRiskState("normal"), SEMANTIC_TONE.operationalGood);
  assert.equal(toneForRiskState("watch"), SEMANTIC_TONE.operationalAttention);
  assert.equal(toneForRiskState("critical"), SEMANTIC_TONE.operationalBad);
});
