import assert from "node:assert/strict";
import test from "node:test";

import { tunedSignalOptionsExecutionProfile } from "@workspace/backtest-core";

import { __shadowWatchlistBacktestInternalsForTests as internals } from "./shadow-account";

const optionContract = {
  underlying: "CRM",
  expirationDate: "2026-06-19",
  strike: 250,
  right: "call",
  multiplier: 100,
};

const actionableOptionQuotePricing = {
  valuationMark: 0.06,
  valuationEligible: true,
  valuationSource: "option_quote",
  valuationReason: "option_quote",
  quoteMark: 0.06,
  quoteBid: 0.05,
  quoteAsk: 0.07,
  quoteMid: 0.06,
  quoteSource: "option_quote",
  quoteFreshness: "live",
  marketDataMode: "live",
  quoteAsOf: new Date("2026-06-12T17:00:00.000Z"),
};

test("Signal Options shadow mark enforcement treats hard stops as actionable", () => {
  const decision = internals.computeSignalOptionsShadowMarkExitDecision({
    contract: optionContract as never,
    entryPrice: 1.86,
    peakPrice: 1.86,
    markPrice: 0.06,
    profile: tunedSignalOptionsExecutionProfile,
    pricing: actionableOptionQuotePricing,
    markAt: new Date("2026-06-12T17:00:00.000Z"),
  });

  assert.equal(decision.stop?.activeStopKind, "hard_stop");
  assert.equal(decision.stop?.exitReason, "hard_stop");
  assert.equal(decision.exitReason, "hard_stop");
  assert.equal(decision.exitPrice, 0.05);
});

test("Signal Options shadow mark enforcement still treats runner trails as actionable", () => {
  const decision = internals.computeSignalOptionsShadowMarkExitDecision({
    contract: optionContract as never,
    entryPrice: 2,
    peakPrice: 4,
    markPrice: 3.1,
    profile: tunedSignalOptionsExecutionProfile,
    pricing: {
      ...actionableOptionQuotePricing,
      valuationMark: 3.1,
      quoteMark: 3.1,
      quoteBid: 3,
      quoteAsk: 3.2,
      quoteMid: 3.1,
    },
    markAt: new Date("2026-06-12T17:00:00.000Z"),
  });

  assert.equal(decision.stop?.activeStopKind, "trailing_stop");
  assert.equal(decision.stop?.exitReason, "runner_trail_stop");
  assert.equal(decision.exitReason, "runner_trail_stop");
  assert.equal(decision.exitPrice, 3.01);
});
