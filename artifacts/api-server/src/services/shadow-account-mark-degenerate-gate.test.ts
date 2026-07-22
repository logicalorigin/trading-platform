import assert from "node:assert/strict";
import test from "node:test";

import { buildShadowOptionPricingPolicy } from "./shadow-account";

// Long-option P&L is liquidation value, not midpoint accounting. A widening ask
// cannot manufacture profit: the live bid is the executable mark, while the stop
// election still requires its independent ask/trade confirmation.

const quote = (bid: number | null, ask: number | null) => ({
  bid,
  ask,
  freshness: "live",
  marketDataMode: "live",
  updatedAt: new Date(),
});

test("BRKR-shaped opening quote values the long option at its executable bid", () => {
  const policy = buildShadowOptionPricingPolicy({
    quote: quote(2.05, 5.8),
    fallbackMark: 3.65,
  });
  assert.equal(policy.valuationEligible, true);
  assert.equal(policy.valuationReason, "quote_executable_bid");
  assert.equal(policy.valuationMark, 2.05);
  assert.equal(policy.valuationSource, "option_quote");
});

test("tight quote stays eligible and marks at the executable bid", () => {
  const policy = buildShadowOptionPricingPolicy({
    quote: quote(1.3, 1.55),
    fallbackMark: 1.2,
  });
  assert.equal(policy.valuationEligible, true);
  assert.equal(policy.valuationReason, "quote_executable_bid");
  assert.equal(policy.valuationMark, 1.3);
});

test("ordinary illiquid spread cannot inflate P&L above the executable bid", () => {
  const policy = buildShadowOptionPricingPolicy({
    quote: quote(0.85, 1.6),
    fallbackMark: 1.1,
  });
  assert.equal(policy.valuationEligible, true);
  assert.equal(policy.valuationMark, 0.85);
});

test("ABT-shaped ask widening cannot manufacture a +40% mark", () => {
  const policy = buildShadowOptionPricingPolicy({
    quote: quote(2.75, 3.8),
    fallbackMark: 2.34,
  });

  assert.equal(policy.quoteMark, 3.275);
  assert.equal(policy.valuationMark, 2.75);
  assert.equal(policy.valuationReason, "quote_executable_bid");
});

test("an old quote labeled live is rejected by its real timestamp", () => {
  const policy = buildShadowOptionPricingPolicy({
    quote: {
      ...quote(2.75, 4.2),
      updatedAt: new Date(Date.now() - 9 * 60 * 60_000),
      ageMs: 9 * 60 * 60_000,
      latency: { apiServerReceivedAt: new Date() },
    },
    fallbackMark: 2.75,
  });

  assert.equal(policy.valuationEligible, false);
  assert.equal(policy.valuationReason, "quote_stale_age");
  assert.equal(policy.valuationMark, 2.75);
  assert.equal(policy.valuationSource, "shadow_ledger");
});

test("one-sided quote still blocks via the pre-existing mark-unavailable path", () => {
  const policy = buildShadowOptionPricingPolicy({
    quote: quote(null, 2.8),
    fallbackMark: 0.5,
  });
  assert.equal(policy.valuationEligible, false);
  assert.equal(policy.valuationReason, "quote_mark_unavailable");
});

test("AAP-shaped live quote keeps intrinsic value separate from executable P&L", () => {
  const policy = buildShadowOptionPricingPolicy({
    quote: {
      ...quote(3, 4.8),
      underlyingPrice: 55.48,
    },
    fallbackMark: 3.9,
    contract: {
      strike: 51,
      right: "call",
    },
  } as never);

  assert.equal(policy.valuationEligible, true);
  assert.ok(Math.abs((policy.quoteMark ?? 0) - 3.9) < 1e-9);
  assert.ok(Math.abs((policy.intrinsicFloor ?? 0) - 4.48) < 1e-9);
  assert.equal(policy.valuationMark, 3);
  assert.equal(policy.valuationReason, "quote_executable_bid");
  assert.equal(policy.valuationSource, "option_quote");
});
