import assert from "node:assert/strict";
import test from "node:test";

import { tunedSignalOptionsExecutionProfile } from "@workspace/backtest-core";

import { __shadowWatchlistBacktestInternalsForTests as shadowInternals } from "./shadow-account";
import {
  __signalOptionsAutomationInternalsForTests as automationInternals,
  type SignalOptionsOptionQuote,
  type SignalOptionsPosition,
} from "./signal-options-automation";

// REAL-MONEY SCENARIO: gap-through-stop pricing and quote-unavailable exit
// gating.
//
// shadow-account-signal-options-stops.test.ts already pins the base contract
// of computeSignalOptionsShadowMarkExitDecision (hard stop and runner-trail
// exits are actionable, exit fills at a bid-derived price for a modest gap).
// This file extends that WITHOUT duplicating it:
//   (a) a much deeper gap-through-stop, to make unambiguous that the fill
//       price is neither the stop price nor a naive mid/last, but the
//       90%-toward-bid formula in computeSignalOptionsShadowMarkExitDecision;
//   (b) the branch neither existing test exercises: no bid available, where
//       the function must fall back to raw markPrice rather than fabricate a
//       bid-derived price from mid alone;
//   (c)/(d) the skip branches (session closed, mark not actionable);
//   (e) isSignalOptionsLiveExitQuoteEligible — the live-exit-quote gate;
//   (f) isSignalOptionsShadowMarkFallbackExitEligible — the shadow-mark
//       fallback gate, including its 60s recency and live-session-at-mark
//       requirements.

const { computeSignalOptionsShadowMarkExitDecision } = shadowInternals;
const {
  isSignalOptionsLiveExitQuoteEligible,
  isSignalOptionsShadowMarkFallbackExitEligible,
} = automationInternals;

const optionContract = {
  underlying: "CRM",
  expirationDate: "2026-06-19",
  strike: 250,
  right: "call",
  multiplier: 100,
};

// Friday 13:00 ET (17:00Z, June is EDT/UTC-4) — matches the convention used
// by shadow-account-signal-options-stops.test.ts for a live option session.
const LIVE_SESSION_AT = new Date("2026-06-12T17:00:00.000Z");
// Saturday, same wall-clock time — outside any trading session.
const WEEKEND_AT = new Date("2026-06-13T17:00:00.000Z");

test("(a) deep gap-through hard stop: exit fills at the bid-weighted price, not the stop price and not a naive bid/mid", () => {
  // hardStopPct is -30 on the tuned profile, so with entry=peak=3.00 the hard
  // stop sits at 2.10. The mark craters to 0.10 — an extreme gap-through,
  // far past both the stop AND the modest-gap case already pinned elsewhere
  // (entry 1.86 -> mark 0.06 in the base stops test).
  const decision = computeSignalOptionsShadowMarkExitDecision({
    contract: optionContract as never,
    entryPrice: 3.0,
    peakPrice: 3.0,
    markPrice: 0.1,
    profile: tunedSignalOptionsExecutionProfile,
    pricing: {
      valuationMark: 0.15,
      valuationEligible: true,
      valuationSource: "option_quote",
      valuationReason: "option_quote",
      quoteMark: 0.15,
      quoteBid: 0.05,
      quoteAsk: 0.25,
      quoteMid: 0.15,
      quoteSource: "option_quote",
      quoteFreshness: "live",
      marketDataMode: "live",
      quoteAsOf: LIVE_SESSION_AT,
    },
    markAt: LIVE_SESSION_AT,
  });

  assert.equal(decision.stop?.activeStopKind, "hard_stop");
  assert.equal(decision.stop?.activeStopPrice, 2.1);
  assert.equal(decision.exitReason, "hard_stop");
  // quoteMid - (quoteMid - quoteBid) * 0.9 = 0.15 - 0.10*0.9 = 0.06.
  assert.equal(decision.exitPrice, 0.06);
  // The pin: the fill is nowhere near the stop price the gap blew through,
  // and it is not simply the raw mark or the raw bid either — it is the
  // weighted price the formula produces.
  assert.notEqual(decision.exitPrice, decision.stop?.activeStopPrice);
  assert.notEqual(decision.exitPrice, 0.1 /* markPrice */);
  assert.notEqual(decision.exitPrice, 0.05 /* raw bid */);
});

test("(b) exit price provenance: with no bid available, the fill falls back to raw mark price rather than fabricating a bid-derived number from mid alone", () => {
  const decision = computeSignalOptionsShadowMarkExitDecision({
    contract: optionContract as never,
    entryPrice: 2.0,
    peakPrice: 2.0,
    markPrice: 0.15,
    profile: tunedSignalOptionsExecutionProfile,
    pricing: {
      valuationMark: 0.15,
      valuationEligible: true,
      valuationSource: "option_quote",
      valuationReason: "option_quote",
      quoteMark: 0.15,
      // No bid on this quote (e.g. a one-sided/ask-only book after the gap).
      quoteBid: null,
      quoteAsk: 0.3,
      quoteMid: 0.2,
      quoteSource: "option_quote",
      quoteFreshness: "live",
      marketDataMode: "live",
      quoteAsOf: LIVE_SESSION_AT,
    },
    markAt: LIVE_SESSION_AT,
  });

  assert.equal(decision.stop?.activeStopKind, "hard_stop");
  assert.equal(decision.exitReason, "hard_stop");
  // Falls back to markPrice.toFixed(2), NOT a mid-only derivation (which
  // would have produced something near 0.20, not 0.15).
  assert.equal(decision.exitPrice, 0.15);
});

test("(c) off-session mark: no exit is placed even through a breached stop; skipReason is option_session_closed", () => {
  const decision = computeSignalOptionsShadowMarkExitDecision({
    contract: optionContract as never,
    entryPrice: 3.0,
    peakPrice: 3.0,
    markPrice: 0.1,
    profile: tunedSignalOptionsExecutionProfile,
    pricing: {
      valuationMark: 0.15,
      valuationEligible: true,
      valuationSource: "option_quote",
      valuationReason: "option_quote",
      quoteMark: 0.15,
      quoteBid: 0.05,
      quoteAsk: 0.25,
      quoteMid: 0.15,
      quoteSource: "option_quote",
      quoteFreshness: "live",
      marketDataMode: "live",
      quoteAsOf: WEEKEND_AT,
    },
    markAt: WEEKEND_AT,
  });

  assert.equal(decision.exitReason, null);
  assert.equal(decision.exitPrice, null);
  assert.equal(decision.skipReason, "option_session_closed");
});

test("(d) non-live valuation source (fallback mark): a breached stop is not actionable, skipReason is mark_not_actionable", () => {
  const decision = computeSignalOptionsShadowMarkExitDecision({
    contract: optionContract as never,
    entryPrice: 3.0,
    peakPrice: 3.0,
    markPrice: 0.1,
    profile: tunedSignalOptionsExecutionProfile,
    pricing: {
      valuationMark: 0.1,
      // Eligible for VALUATION (marking/P&L), but sourced from the shadow
      // ledger fallback rather than a live option quote — must not drive an
      // actual EXIT.
      valuationEligible: true,
      valuationSource: "shadow_ledger",
      valuationReason: "fallback_mark",
      quoteMark: null,
      quoteBid: null,
      quoteAsk: null,
      quoteMid: null,
      quoteSource: "shadow_ledger",
      quoteFreshness: "stale",
      marketDataMode: "delayed",
      quoteAsOf: LIVE_SESSION_AT,
    },
    markAt: LIVE_SESSION_AT,
  });

  assert.equal(decision.exitReason, null);
  assert.equal(decision.exitPrice, null);
  assert.equal(decision.skipReason, "mark_not_actionable");
});

test("(e) isSignalOptionsLiveExitQuoteEligible: accepts a fresh, two-sided, live-mode quote not sourced from a shadow-mark fallback", () => {
  const freshLiveQuote: SignalOptionsOptionQuote = {
    bid: 1.0,
    ask: 1.1,
    marketDataMode: "live",
    quoteFreshness: "live",
  };

  assert.equal(
    isSignalOptionsLiveExitQuoteEligible({
      quote: freshLiveQuote,
      markSource: "option_chain",
      usedShadowMarkFallback: false,
    }),
    true,
  );
});

test("(e) isSignalOptionsLiveExitQuoteEligible: rejects when the mark actually came from the shadow fallback, even with a live-looking quote object", () => {
  const freshLiveQuote: SignalOptionsOptionQuote = {
    bid: 1.0,
    ask: 1.1,
    marketDataMode: "live",
    quoteFreshness: "live",
  };

  assert.equal(
    isSignalOptionsLiveExitQuoteEligible({
      quote: freshLiveQuote,
      markSource: "option_chain",
      usedShadowMarkFallback: true,
    }),
    false,
  );
  assert.equal(
    isSignalOptionsLiveExitQuoteEligible({
      quote: freshLiveQuote,
      markSource: "shadow_position_mark",
      usedShadowMarkFallback: false,
    }),
    false,
  );
});

test("(e) isSignalOptionsLiveExitQuoteEligible: rejects a missing quote, and delayed/frozen/stale/pending/unavailable quotes", () => {
  const baseArgs = { markSource: "option_chain", usedShadowMarkFallback: false };

  assert.equal(
    isSignalOptionsLiveExitQuoteEligible({ ...baseArgs, quote: null }),
    false,
  );
  assert.equal(
    isSignalOptionsLiveExitQuoteEligible({
      ...baseArgs,
      quote: { bid: 1, ask: 1.1, marketDataMode: "delayed" },
    }),
    false,
  );
  assert.equal(
    isSignalOptionsLiveExitQuoteEligible({
      ...baseArgs,
      quote: { bid: 1, ask: 1.1, marketDataMode: "frozen" },
    }),
    false,
  );
  for (const quoteFreshness of ["pending", "stale", "unavailable"] as const) {
    assert.equal(
      isSignalOptionsLiveExitQuoteEligible({
        ...baseArgs,
        quote: { bid: 1, ask: 1.1, marketDataMode: "live", quoteFreshness },
      }),
      false,
      `quoteFreshness=${quoteFreshness} must not be exit-eligible`,
    );
  }
});

test("(f) isSignalOptionsShadowMarkFallbackExitEligible: accepts a recent, option-quote-sourced fallback during a live session on a shadow deployment", () => {
  const position: Pick<SignalOptionsPosition, "selectedContract"> = {
    selectedContract: optionContract,
  };
  const now = new Date(LIVE_SESSION_AT.getTime() + 30_000);

  assert.equal(
    isSignalOptionsShadowMarkFallbackExitEligible({
      deployment: { mode: "shadow" },
      fallback: {
        positionId: "position-1",
        latestMarkPrice: 0.1,
        latestAsOf: LIVE_SESSION_AT,
        peakMarkPrice: 0.1,
        peakAsOf: LIVE_SESSION_AT,
        source: "option_quote",
      },
      markSource: "shadow_position_mark",
      now,
      position: position as SignalOptionsPosition,
      usedShadowMarkFallback: true,
    }),
    true,
  );
});

test("(f) isSignalOptionsShadowMarkFallbackExitEligible: rejects a non-shadow deployment, a mark not actually sourced from the fallback, or a missing fallback", () => {
  const position: Pick<SignalOptionsPosition, "selectedContract"> = {
    selectedContract: optionContract,
  };
  const fallback = {
    positionId: "position-1",
    latestMarkPrice: 0.1,
    latestAsOf: LIVE_SESSION_AT,
    peakMarkPrice: 0.1,
    peakAsOf: LIVE_SESSION_AT,
    source: "option_quote",
  };
  const now = new Date(LIVE_SESSION_AT.getTime() + 30_000);

  assert.equal(
    isSignalOptionsShadowMarkFallbackExitEligible({
      deployment: { mode: "live" },
      fallback,
      markSource: "shadow_position_mark",
      now,
      position: position as SignalOptionsPosition,
      usedShadowMarkFallback: true,
    }),
    false,
  );
  assert.equal(
    isSignalOptionsShadowMarkFallbackExitEligible({
      deployment: { mode: "shadow" },
      fallback,
      markSource: "option_chain",
      now,
      position: position as SignalOptionsPosition,
      usedShadowMarkFallback: true,
    }),
    false,
  );
  assert.equal(
    isSignalOptionsShadowMarkFallbackExitEligible({
      deployment: { mode: "shadow" },
      fallback: null,
      markSource: "shadow_position_mark",
      now,
      position: position as SignalOptionsPosition,
      usedShadowMarkFallback: true,
    }),
    false,
  );
});

test("(f) isSignalOptionsShadowMarkFallbackExitEligible: 60s recency is a hard boundary — eligible at exactly 60s, rejected at 60s+1ms", () => {
  const position: Pick<SignalOptionsPosition, "selectedContract"> = {
    selectedContract: optionContract,
  };
  const fallback = {
    positionId: "position-1",
    latestMarkPrice: 0.1,
    latestAsOf: LIVE_SESSION_AT,
    peakMarkPrice: 0.1,
    peakAsOf: LIVE_SESSION_AT,
    source: "option_quote",
  };

  assert.equal(
    isSignalOptionsShadowMarkFallbackExitEligible({
      deployment: { mode: "shadow" },
      fallback,
      markSource: "shadow_position_mark",
      now: new Date(LIVE_SESSION_AT.getTime() + 60_000),
      position: position as SignalOptionsPosition,
      usedShadowMarkFallback: true,
    }),
    true,
  );
  assert.equal(
    isSignalOptionsShadowMarkFallbackExitEligible({
      deployment: { mode: "shadow" },
      fallback,
      markSource: "shadow_position_mark",
      now: new Date(LIVE_SESSION_AT.getTime() + 60_001),
      position: position as SignalOptionsPosition,
      usedShadowMarkFallback: true,
    }),
    false,
  );
});

test("(f) isSignalOptionsShadowMarkFallbackExitEligible: rejects a fallback whose source is not option_quote, and one whose own timestamp falls outside a live session even if recent", () => {
  const position: Pick<SignalOptionsPosition, "selectedContract"> = {
    selectedContract: optionContract,
  };
  const now = new Date(LIVE_SESSION_AT.getTime() + 30_000);

  assert.equal(
    isSignalOptionsShadowMarkFallbackExitEligible({
      deployment: { mode: "shadow" },
      fallback: {
        positionId: "position-1",
        latestMarkPrice: 0.1,
        latestAsOf: LIVE_SESSION_AT,
        peakMarkPrice: 0.1,
        peakAsOf: LIVE_SESSION_AT,
        // Delayed/mark-sourced fallback, not a genuine (if non-live-tagged)
        // option quote — must not be treated as exit-eligible.
        source: "mark",
      },
      markSource: "shadow_position_mark",
      now,
      position: position as SignalOptionsPosition,
      usedShadowMarkFallback: true,
    }),
    false,
  );

  // The fallback's OWN timestamp is on a weekend even though "now" is
  // recent relative to it — the fallback data point itself was never
  // captured during a live session, so it cannot be trusted to drive a
  // real exit.
  const weekendFallbackAt = WEEKEND_AT;
  assert.equal(
    isSignalOptionsShadowMarkFallbackExitEligible({
      deployment: { mode: "shadow" },
      fallback: {
        positionId: "position-1",
        latestMarkPrice: 0.1,
        latestAsOf: weekendFallbackAt,
        peakMarkPrice: 0.1,
        peakAsOf: weekendFallbackAt,
        source: "option_quote",
      },
      markSource: "shadow_position_mark",
      now: new Date(weekendFallbackAt.getTime() + 30_000),
      position: position as SignalOptionsPosition,
      usedShadowMarkFallback: true,
    }),
    false,
  );
});

// UNTESTABLE WITHOUT A DB HARNESS / WITHOUT A PRODUCT-CODE EXPORT (documented,
// not forced):
//
// (g) "fallback fills never claim live provenance" — the two eligibility
// gates above ((e) and (f)) are what SELECT between the live-exit path and
// the shadow-fallback-exit path inside refreshActivePosition
// (signal-options-automation.ts, ~line 13110-13170). The function that
// actually stamps the fallback fill's provenance,
// resolveSignalOptionsShadowFallbackLiquidity (signal-options-automation.ts,
// ~line 4393), is a pure function — its returned `fillQuoteSource` is typed
// "delayed" | "mark" | null and its `quoteFreshness` is hardcoded to mirror
// that (comment in source: "Tag the resulting fill with its TRUE
// provenance — never 'live'"). It would be directly pinnable exactly like
// the functions above, but it is NOT exported via
// __signalOptionsAutomationInternalsForTests, and this task's constraints
// disallow editing signal-options-automation.ts to add that export. The
// assignment that actually uses it —
// `exitFillQuoteSource = shadowExitFallback.fillQuoteSource` at
// signal-options-automation.ts:13168 — lives inside refreshActivePosition,
// which calls insertSignalOptionsEvent and is only reachable end-to-end
// through a DB-backed integration test. So this specific pin is out of
// reach here; the closest verifiable proxy is (e)/(f) above, which is what
// this file provides.
