import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSignalOptionsExecutionProfile,
  tunedSignalOptionsExecutionProfile,
} from "@workspace/backtest-core";

import { __shadowWatchlistBacktestInternalsForTests as internals } from "./shadow-account";
import {
  computeSignalOptionsPositionStop,
  type SignalOptionsEntryQuality,
} from "./signal-options-exit-policy";

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

test("Shadow option economics reject non-positive contract inputs at the trust boundary", () => {
  const valid = {
    ...optionContract,
    ticker: "O:CRM260619C00250000",
  };

  assert.equal(
    internals.asOptionContractForTests({ ...valid, strike: 0 }),
    null,
  );
  assert.equal(
    internals.asOptionContractForTests({ ...valid, multiplier: -100 }),
    null,
  );
  assert.equal(
    internals.asOptionContractForTests({ ...valid, sharesPerContract: 0 }),
    null,
  );
  assert.equal(
    internals.marketMultiplierForTests({
      assetClass: "option",
      optionContract: {
        ...valid,
        multiplier: 0,
        sharesPerContract: -5,
      } as never,
    }),
    100,
  );
});

test("Shadow option economics preserve the shares-per-contract preference", () => {
  assert.equal(
    internals.marketMultiplierForTests({
      assetClass: "option",
      optionContract: {
        ...optionContract,
        multiplier: 50,
        sharesPerContract: 100,
      } as never,
    }),
    100,
  );
});

test("Shadow stop diagnostics retain no credential-shaped error text", async () => {
  internals.resetSignalOptionsTrailingStopEnforcementFailureDiagnosticsForTests();
  const secret = "postgres://redacted.invalid/pyrus";
  const warnings: Array<{ fields: unknown; message: string }> = [];

  const result =
    await internals.enforceSignalOptionsTrailingStopFromShadowMarkSafely(
      {
        position: {
          id: "position-sensitive",
          symbol: "CRM",
        },
        contract: optionContract,
        quote: null,
        pricing: actionableOptionQuotePricing,
        markPrice: 0.06,
        markAt: new Date("2026-06-12T17:00:00.000Z"),
      } as never,
      {
        enforce: async () => {
          throw new Error(secret);
        },
        warn: (fields: unknown, message: string) => {
          warnings.push({ fields, message });
        },
      },
    );

  assert.equal(result.reason, "enforcement_failed");
  const diagnostics =
    internals.getSignalOptionsTrailingStopEnforcementFailureDiagnostics();
  assert.equal(diagnostics.count, 1);
  assert.equal(
    diagnostics.recent[0]?.message,
    "Signal-options stop enforcement failed.",
  );
  assert.equal(JSON.stringify(diagnostics).includes(secret), false);
  assert.equal(warnings.length, 1);
  assert.equal(JSON.stringify(warnings).includes(secret), false);
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

test("Signal Options display stop reuses the enforced wire/conditional stop snapshot", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      conditionalQualityExitsEnabled: true,
      wireGreekTrail: { enabled: true, deltaSizingEnabled: true },
    },
  });
  const signalQuality: SignalOptionsEntryQuality = {
    tier: "low",
    liquidityTier: "weak",
    score: 40,
    reasons: ["test"],
    adx: null,
    mtfMatches: 1,
    mtfDirections: [1],
    spreadPctOfMid: 1,
    bullishRegime: true,
  };
  const enforcedStop = computeSignalOptionsPositionStop({
    entryPrice: 1,
    peakPrice: 1.5,
    markPrice: 1.4,
    profile,
    direction: "buy",
    underlyingSpot: 100,
    wireContext: {
      timeframe: "1m",
      latestBarAt: new Date("2026-07-07T15:00:00Z"),
      previousBarAt: new Date("2026-07-07T14:59:00Z"),
      latestClose: 100,
      regimeDirection: 1,
      previousRegimeDirection: 1,
      bullWires: [102, 101, 99.5],
      bearWires: null,
      trendLine: 96,
    },
    currentGreeks: { delta: 0.5, ageMs: 1_000 },
    entryGreeks: { delta: 0.5, ageMs: 1_000 },
    signalQuality,
    barsSinceEntry: 6,
    wireTrailEnforceEnabled: true,
    now: new Date("2026-07-07T15:01:00Z"),
  });

  const automationContext = internals.buildShadowAutomationContext({
    position: {
      symbol: "CRM",
      positionKey: "CRM:2026-06-19:250:C",
      averageCost: "1",
      mark: "1.4",
    } as never,
    latestEvent: {
      id: "evt-stop",
      occurredAt: new Date("2026-07-07T15:01:00Z"),
      payload: {
        profile,
        position: {
          entryPrice: 1,
          peakPrice: 1.5,
          signalQuality,
        },
        stop: enforcedStop,
      },
    } as never,
    peakMarkPrice: 1.5,
  });

  assert.ok(automationContext);
  assert.equal(automationContext.stopPrice, enforcedStop.stopPrice);
  assert.equal(automationContext.activeStopPrice, enforcedStop.activeStopPrice);
  assert.equal(automationContext.activeStopKind, enforcedStop.activeStopKind);
  assert.equal(
    automationContext.tradeManagement.trailStopPrice,
    enforcedStop.trailStopPrice,
  );
  assert.equal(
    automationContext.tradeManagement.markReturnPct,
    enforcedStop.markReturnPct,
  );
});
