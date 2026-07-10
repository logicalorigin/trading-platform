import assert from "node:assert/strict";
import test from "node:test";

import { buildShadowOptionPricingPolicy } from "./shadow-account";

// 2026-07-09 09:33 ET forensics: the first post-open mark refresh swallowed wide
// opening-auction quotes whole — (bid+ask)/2 passed every gate (two-sided, fresh,
// live) and six stops fired in one refresh batch; most underlyings recovered by the
// close (~$2.7K whipsaw). A quote whose bid sits >40% below its mid (the same gap
// threshold as the fill-side ruling) must not be valuation-eligible: last good mark
// is kept and stop evaluation defers instead of firing on a fantasy midpoint.

const quote = (bid: number | null, ask: number | null) => ({
  bid,
  ask,
  freshness: "live",
  marketDataMode: "live",
  updatedAt: new Date(),
});

test("BRKR-shaped opening quote (bid 2.05 / ask 5.80) is not valuation-eligible", () => {
  const policy = buildShadowOptionPricingPolicy({
    quote: quote(2.05, 5.8),
    fallbackMark: 3.65,
  });
  assert.equal(policy.valuationEligible, false);
  assert.equal(policy.valuationReason, "quote_spread_degenerate");
  assert.equal(policy.valuationMark, 3.65);
  assert.equal(policy.valuationSource, "shadow_ledger");
});

test("tight quote stays eligible and marks at the mid", () => {
  const policy = buildShadowOptionPricingPolicy({
    quote: quote(1.3, 1.55),
    fallbackMark: 1.2,
  });
  assert.equal(policy.valuationEligible, true);
  assert.equal(policy.valuationReason, "quote_eligible");
});

test("ordinary illiquid spread below the 40% gap keeps marking (stops still work)", () => {
  // bid 0.85 / ask 1.60: mid 1.225, gap (1.225-0.85)/1.225 = 30.6% < 40%.
  const policy = buildShadowOptionPricingPolicy({
    quote: quote(0.85, 1.6),
    fallbackMark: 1.1,
  });
  assert.equal(policy.valuationEligible, true);
});

test("one-sided quote still blocks via the pre-existing mark-unavailable path", () => {
  const policy = buildShadowOptionPricingPolicy({
    quote: quote(null, 2.8),
    fallbackMark: 0.5,
  });
  assert.equal(policy.valuationEligible, false);
  assert.equal(policy.valuationReason, "quote_mark_unavailable");
});
