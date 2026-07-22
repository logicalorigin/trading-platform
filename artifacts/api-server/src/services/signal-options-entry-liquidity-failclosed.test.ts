import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalOptionsShadowOrderPlan,
  buildSignalOptionsShadowFallbackOrderPlan,
  signalOptionsShadowBuyFillPrice,
  SIGNAL_OPTIONS_SHADOW_ENTRY_QUOTE_MAX_AGE_MS,
} from "./signal-options-automation";
import { buildShadowOptionPricingPolicy } from "./shadow-account";

// Owner ruling 2026-07-09 (docs/plans/phantom-fills-audit-2026-07-09.md): entry
// liquidity gates must FAIL CLOSED. The ASTN incident: a bid-0, 62-minute-stale
// quote nulled the fields every gate checks, all gates silently passed, the entry
// filled at 2.57 (mark 0.50) and hard-stopped 18 seconds later at 0.05 (-$1,263).

const profile = (overrides: Record<string, unknown> = {}) =>
  ({
    liquidityGate: {
      minBid: 0.5,
      maxSpreadPctOfMid: 15,
      requireBidAsk: true,
      requireFreshQuote: true,
    },
    liquidityHaltControls: {},
    fillPolicy: { chaseSteps: [0.35, 0.6, 0.9] },
    riskHaltControls: {},
    riskCaps: { maxContracts: 10, maxPremiumPerEntry: 1000 },
    ...overrides,
  }) as unknown as Parameters<typeof buildSignalOptionsShadowFallbackOrderPlan>[1];

const ASTN_QUOTE = {
  bid: 0,
  ask: 2.8,
  last: 0.5,
  mark: 0.5,
  ageMs: 3_706_290,
  quoteFreshness: "mark",
  marketDataMode: "live",
};

test("ASTN replica: bid-0 stale quote is rejected with every violated gate named", () => {
  const plan = buildSignalOptionsShadowFallbackOrderPlan(ASTN_QUOTE, profile());
  assert.equal(plan.ok, false);
  const reasons = plan.liquidity.reasons;
  assert.ok(reasons.includes("missing_bid_ask"), `missing_bid_ask in ${reasons}`);
  assert.ok(reasons.includes("bid_below_minimum"), `bid_below_minimum in ${reasons}`);
  assert.ok(reasons.includes("quote_not_fresh"), `quote_not_fresh in ${reasons}`);
});

test("healthy two-sided fresh quote still enters, chased fill capped at ask", () => {
  const plan = buildSignalOptionsShadowFallbackOrderPlan(
    { bid: 1.0, ask: 1.1, mark: 1.05, ageMs: 5_000 },
    profile(),
  );
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.equal(plan.simulatedFillPrice, 1.1);
    assert.equal(plan.quantity, 9);
  }
});

test("wide-but-not-degenerate spread over the profile cap is rejected", () => {
  // bid 1.00 / ask 1.30: mid 1.15, spread 26% of mid > 15% cap (gap 0.13 < 0.4).
  const plan = buildSignalOptionsShadowFallbackOrderPlan(
    { bid: 1.0, ask: 1.3, mark: 1.15, ageMs: 5_000 },
    profile(),
  );
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "spread_too_wide");
});

test("stale two-sided quote past the hard age cap is rejected", () => {
  const plan = buildSignalOptionsShadowFallbackOrderPlan(
    {
      bid: 1.0,
      ask: 1.1,
      mark: 1.05,
      ageMs: SIGNAL_OPTIONS_SHADOW_ENTRY_QUOTE_MAX_AGE_MS + 1,
    },
    profile(),
  );
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "quote_not_fresh");
});

test("live-tagged entry quote past the hard age cap is still rejected", () => {
  const plan = buildSignalOptionsShadowOrderPlan(
    {
      bid: 1.0,
      ask: 1.1,
      mark: 1.05,
      quoteFreshness: "live",
      marketDataMode: "live",
      ageMs: SIGNAL_OPTIONS_SHADOW_ENTRY_QUOTE_MAX_AGE_MS + 1,
    },
    profile(),
  );

  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "quote_not_fresh");
});

test("entry rejects a quote once it is too old for open-position valuation", () => {
  const ageMs = 6 * 60_000;
  const quote = {
    bid: 1,
    ask: 1.1,
    mark: 1.05,
    quoteFreshness: "live",
    marketDataMode: "live",
    ageMs,
  };

  const pricing = buildShadowOptionPricingPolicy({
    quote,
    fallbackMark: 1,
  });
  const entryPlan = buildSignalOptionsShadowOrderPlan(quote, profile());

  assert.equal(pricing.valuationEligible, false);
  assert.equal(pricing.valuationReason, "quote_stale_age");
  assert.equal(entryPlan.ok, false);
  assert.equal(entryPlan.reason, "quote_not_fresh");
});

test("live-tagged entry quote with no provable timestamp fails closed", () => {
  const plan = buildSignalOptionsShadowOrderPlan(
    {
      bid: 1.0,
      ask: 1.1,
      mark: 1.05,
      quoteFreshness: "live",
      marketDataMode: "live",
    },
    profile(),
  );

  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "quote_not_fresh");
});

test("two-sided fallback quote with no provable timestamp fails closed", () => {
  const plan = buildSignalOptionsShadowFallbackOrderPlan(
    { bid: 1.0, ask: 1.1, mark: 1.05 },
    profile(),
  );

  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "quote_not_fresh");
});

test("explicitly disabled toggles are honored (owner override still wins)", () => {
  const plan = buildSignalOptionsShadowFallbackOrderPlan(
    ASTN_QUOTE,
    profile({
      liquidityHaltControls: {
        bidAskRequiredEnabled: false,
        minBidGateEnabled: false,
        spreadGateEnabled: false,
        freshQuoteRequiredEnabled: false,
      },
    }),
  );
  assert.equal(plan.ok, true);
});

test("buy fill: degenerate ask gap fills at mid, normal gap chases toward ask", () => {
  // ASTN shape: mid 0.5, ask 2.8 => gap 4.6 > 0.4 => mid, not 2.57.
  assert.equal(signalOptionsShadowBuyFillPrice(0.5, 2.8, 0.9), 0.5);
  // Normal: mid 1.05, ask 1.10 => 1.05 + 0.045 = 1.10 (capped at ask).
  assert.equal(signalOptionsShadowBuyFillPrice(1.05, 1.1, 0.9), 1.1);
  // No usable ask => mid.
  assert.equal(signalOptionsShadowBuyFillPrice(1.05, null, 0.9), 1.05);
});
