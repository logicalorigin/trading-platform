import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";

import {
  computeSignalOptionsPositionStop,
  type SignalOptionsEntryQuality,
} from "./signal-options-exit-policy";

// Trailing-stop ratchet math for real-money options positions. Base profile defaults
// (resolveSignalOptionsExecutionProfile({})): hardStopPct -40, trailActivationPct 40,
// minLockedGainPct 10, trailGivebackPct 25, progressiveTrailEnabled false.
// entry=100 is used throughout instead of entry=1.0 because (1.4 - 1.0) / 1.0 * 100
// is 39.99999999999999 in IEEE-754 double precision — entry=100 keeps every return-pct
// boundary (40, 60, 100, ...) exact so the >= activation checks land where intended.

const baseProfile = resolveSignalOptionsExecutionProfile({});

const lowQualitySignal: SignalOptionsEntryQuality = {
  tier: "low",
  liquidityTier: "standard",
  score: 0,
  reasons: [],
  adx: null,
  mtfMatches: 0,
  mtfDirections: [],
  spreadPctOfMid: null,
  bullishRegime: false,
};

const highQualitySignal: SignalOptionsEntryQuality = {
  ...lowQualitySignal,
  tier: "high",
  bullishRegime: true,
};

test("below activation: peak +39% keeps the hard stop only", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 139,
    markPrice: 100,
    profile: baseProfile,
  });
  assert.equal(stop.returnPct, 39);
  assert.equal(stop.trailActive, false);
  assert.equal(stop.trailStopPrice, null);
  assert.equal(stop.hardStopPrice, 60);
  assert.equal(stop.activeStopKind, "hard_stop");
  assert.equal(stop.stopPrice, 60);
});

test("at activation: the trail retains the configured share of accrued profit", () => {
  // A 25% retracement retains 75% of the +40 gain: 100 + 40*0.75 = 130.
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 140,
    markPrice: 100,
    profile: baseProfile,
  });
  assert.equal(stop.returnPct, 40);
  assert.equal(stop.trailActive, true);
  assert.equal(stop.trailStopPrice, 130);
  assert.equal(stop.trailHasTakenOver, true);
  assert.equal(stop.activeStopKind, "trailing_stop");
  assert.equal(stop.stopPrice, 130);
});

test("minLockedGainPct remains a lower bound on the profit-retracement trail", () => {
  const floorProfile = resolveSignalOptionsExecutionProfile({
    exitPolicy: { minLockedGainPct: 35 },
  });
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 140.5,
    markPrice: 100,
    profile: floorProfile,
  });
  assert.equal(stop.trailStopPrice, 135);
});

test("profit-retracement branch binds at a high peak", () => {
  // Peak +100% with a 25% retracement retains +75%.
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 200,
    markPrice: 150,
    profile: baseProfile,
  });
  assert.equal(stop.returnPct, 100);
  assert.equal(stop.trailStopPrice, 175);
});

test("ratchet monotonicity: stopPrice is non-decreasing as the peak rises", () => {
  const stops = [140, 160, 200].map((peakPrice) =>
    computeSignalOptionsPositionStop({
      entryPrice: 100,
      peakPrice,
      markPrice: 100,
      profile: baseProfile,
    }).stopPrice,
  );
  assert.deepEqual(stops, [130, 145, 175]);
  assert.ok(stops[1]! >= stops[0]!);
  assert.ok(stops[2]! >= stops[1]!);
});

test("progressive step changes cannot loosen below the persisted prior stop", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      progressiveTrailEnabled: true,
      progressiveTrailSteps: [
        { activationPct: 20, minLockedGainPct: 20, givebackPct: 10 },
        { activationPct: 30, minLockedGainPct: 0, givebackPct: 30 },
      ],
    },
  });
  const first = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 129,
    markPrice: 125,
    profile,
  });
  assert.equal(first.stopPrice, 126.1);

  const next = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 130,
    markPrice: 125,
    profile,
    priorStopPrice: first.stopPrice,
  });

  assert.equal(next.stopPrice, first.stopPrice);
});

test("historical backfill forwards its persisted stop into the ratchet calculator", () => {
  const source = readFileSync(
    new URL("./signal-options-automation.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async function markBackfillPositionsThrough(");
  const end = source.indexOf("function buildBackfillSignalSnapshot(", start);
  const backfill = source.slice(start, end);

  assert.match(
    backfill,
    /computePositionStop\(\{[\s\S]*?priorStopPrice:\s*position\.stopPrice/,
  );
});

test("progressive trail: peak in each step band selects that step's numbers", () => {
  const progressiveProfile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      progressiveTrailEnabled: true,
      progressiveTrailSteps: [
        { activationPct: 20, minLockedGainPct: 0, givebackPct: 30 },
        { activationPct: 30, minLockedGainPct: 15, givebackPct: 25 },
        { activationPct: 45, minLockedGainPct: 25, givebackPct: 20 },
        { activationPct: 65, minLockedGainPct: 40, givebackPct: 20 },
        { activationPct: 100, minLockedGainPct: 60, givebackPct: 15 },
      ],
    },
  });

  // peak +25%: retain 70% of the accrued gain = +17.5%.
  const low = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 125,
    markPrice: 100,
    profile: progressiveProfile,
  });
  assert.equal(low.progressiveTrailStep?.activationPct, 20);
  assert.equal(low.trailStopPrice, 117.5);

  // peak +50%: retain 80% of the accrued gain = +40%.
  const mid = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 150,
    markPrice: 100,
    profile: progressiveProfile,
  });
  assert.equal(mid.progressiveTrailStep?.activationPct, 45);
  assert.equal(mid.trailStopPrice, 140);

  // peak +80%: retain 80% of the accrued gain = +64%.
  const high = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 180,
    markPrice: 100,
    profile: progressiveProfile,
  });
  assert.equal(high.progressiveTrailStep?.activationPct, 65);
  assert.equal(high.trailStopPrice, 164);
});

test("ABT-shaped first rung protects accrued profit instead of pinning to zero", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      progressiveTrailEnabled: true,
      progressiveTrailSteps: [
        { activationPct: 20, minLockedGainPct: 0, givebackPct: 30 },
        { activationPct: 30, minLockedGainPct: 15, givebackPct: 25 },
      ],
    },
  });
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 2.34,
    peakPrice: 2.85,
    markPrice: 2.75,
    profile,
  });

  assert.equal(stop.progressiveTrailStep?.activationPct, 20);
  assert.equal(stop.trailStopPrice, 2.7);
});

test("takeover crossover: trailStopPrice <= hardStopPrice keeps activeStopKind hard_stop", () => {
  // Degenerate profile (hardStopPct 0, minLockedGainPct 0, trailGivebackPct 100) makes the
  // trail floor tie the hard stop exactly: hardStop = 100*(1+0%) = 100; trailStop =
  // max(100*(1+0%)=100, 115*(1-100%)=0) = 100. 100 is not > 100, so trailHasTakenOver stays
  // false even though the trail is active.
  const tieProfile = resolveSignalOptionsExecutionProfile({
    exitPolicy: { hardStopPct: 0, minLockedGainPct: 0, trailActivationPct: 10, trailGivebackPct: 100 },
  });
  const tied = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 115,
    markPrice: 100,
    profile: tieProfile,
  });
  assert.equal(tied.trailActive, true);
  assert.equal(tied.trailStopPrice, 100);
  assert.equal(tied.hardStopPrice, 100);
  assert.equal(tied.trailHasTakenOver, false);
  assert.equal(tied.activeStopKind, "hard_stop");
});

test("takeover crossover: trailStopPrice exceeding hardStopPrice flips activeStopKind to trailing_stop", () => {
  const exceeded = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 140,
    markPrice: 100,
    profile: baseProfile,
  });
  assert.equal(exceeded.trailStopPrice, 130);
  assert.equal(exceeded.hardStopPrice, 60);
  assert.equal(exceeded.trailHasTakenOver, true);
  assert.equal(exceeded.activeStopKind, "trailing_stop");
});

test("runner_trail_stop compatibility reason fires exactly at the trailing stop", () => {
  // The persisted reason remains backward-compatible while the product semantics
  // are a configurable trailing stop.
  const atStop = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 140,
    markPrice: 130,
    profile: baseProfile,
  });
  assert.equal(atStop.premiumExitReason, "runner_trail_stop");

  const justAbove = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 140,
    markPrice: 130.01,
    profile: baseProfile,
  });
  assert.equal(justAbove.premiumExitReason, null);
});

test("early_invalidation fires only pre-trail once bars/loss thresholds are met, and is suppressed once the trail is active", () => {
  const earlyProfile = resolveSignalOptionsExecutionProfile({
    exitPolicy: { earlyExitBars: 5, earlyExitLossPct: 15 },
  });

  // Pre-trail (peak +2%, well under the 40% activation): a -20% mark at bar 5 meets both
  // thresholds (barsSinceEntry >= 5, markReturnPct <= -15) -> early_invalidation.
  const preTrail = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 102,
    markPrice: 80,
    profile: earlyProfile,
    barsSinceEntry: 5,
  });
  assert.equal(preTrail.trailActive, false);
  assert.equal(preTrail.premiumExitReason, "early_invalidation");

  // Same bars/loss inputs, but peak +45% activates the trail first. The early-invalidation
  // branch requires !trailActive, so it never fires — the trail's own stop check (mark 80
  // <= trailStopPrice 110) governs instead.
  const trailActive = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 145,
    markPrice: 80,
    profile: earlyProfile,
    barsSinceEntry: 5,
  });
  assert.equal(trailActive.trailActive, true);
  assert.notEqual(trailActive.premiumExitReason, "early_invalidation");
  assert.equal(trailActive.premiumExitReason, "runner_trail_stop");

  // Bars threshold not yet met (4 < 5): no early_invalidation even though the loss and
  // trail-inactive conditions are both satisfied.
  const barsNotMet = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 102,
    markPrice: 80,
    profile: earlyProfile,
    barsSinceEntry: 4,
  });
  assert.equal(barsNotMet.premiumExitReason, null);
});

test("conditional quality exits activate low/high early-invalidation tiers", () => {
  const conditionalProfile = resolveSignalOptionsExecutionProfile({
    exitPolicy: { conditionalQualityExitsEnabled: true },
  });

  const lowQuality = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 102,
    markPrice: 85,
    profile: conditionalProfile,
    barsSinceEntry: 4,
    signalQuality: lowQualitySignal,
  });
  assert.equal(lowQuality.conditionalExitPolicy.earlyExitBars, 4);
  assert.equal(lowQuality.conditionalExitPolicy.earlyExitLossPct, 15);
  assert.equal(lowQuality.premiumExitReason, "early_invalidation");

  const highQuality = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 102,
    markPrice: 75,
    profile: conditionalProfile,
    barsSinceEntry: 8,
    signalQuality: highQualitySignal,
  });
  assert.equal(highQuality.conditionalExitPolicy.earlyExitBars, 8);
  assert.equal(highQuality.conditionalExitPolicy.earlyExitLossPct, 25);
  assert.equal(highQuality.premiumExitReason, "early_invalidation");
});

test("gate off ignores quality early-invalidation tiers", () => {
  const withoutQuality = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 102,
    markPrice: 75,
    profile: baseProfile,
    barsSinceEntry: 8,
    signalQuality: highQualitySignal,
  });

  assert.equal(withoutQuality.conditionalExitPolicy.earlyExitBars, 0);
  assert.equal(withoutQuality.conditionalExitPolicy.earlyExitLossPct, 0);
  assert.equal(withoutQuality.premiumExitReason, null);
});
