import assert from "node:assert/strict";
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

test("at activation: peak +40% activates the trail; floor branch wins the max()", () => {
  // trailStopPrice = max(entry*(1+10%), peak*(1-25%)) = max(110, 140*0.75=105) = 110.
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 140,
    markPrice: 100,
    profile: baseProfile,
  });
  assert.equal(stop.returnPct, 40);
  assert.equal(stop.trailActive, true);
  assert.equal(stop.trailStopPrice, 110);
  assert.equal(stop.trailHasTakenOver, true);
  assert.equal(stop.activeStopKind, "trailing_stop");
  assert.equal(stop.stopPrice, 110);
});

test("minLockedGainPct floor binds when giveback would fall below it (peak barely over activation)", () => {
  // peak +40.5%: giveback branch = 140.5*0.75 = 105.375 < floor 110, so the 10% locked-gain
  // floor is what actually sets the stop, not the 25% giveback.
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 140.5,
    markPrice: 100,
    profile: baseProfile,
  });
  assert.equal(stop.returnPct, 40.5);
  assert.equal(stop.trailStopPrice, 110);
});

test("giveback branch binds at a high peak", () => {
  // peak +100%: giveback branch = 200*0.75 = 150 > floor 110, so giveback determines the stop.
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 200,
    markPrice: 150,
    profile: baseProfile,
  });
  assert.equal(stop.returnPct, 100);
  assert.equal(stop.trailStopPrice, 150);
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
  assert.deepEqual(stops, [110, 120, 150]);
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
  assert.equal(first.stopPrice, 120);

  const next = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 130,
    markPrice: 125,
    profile,
    priorStopPrice: first.stopPrice,
  });

  assert.equal(next.stopPrice, first.stopPrice);
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

  // peak +25%: highest activationPct <= 25 is 20. max(100*1.00, 125*0.70=87.5) = 100.
  const low = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 125,
    markPrice: 100,
    profile: progressiveProfile,
  });
  assert.equal(low.progressiveTrailStep?.activationPct, 20);
  assert.equal(low.trailStopPrice, 100);

  // peak +50%: highest activationPct <= 50 is 45. max(100*1.25=125, 150*0.80=120) = 125.
  const mid = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 150,
    markPrice: 100,
    profile: progressiveProfile,
  });
  assert.equal(mid.progressiveTrailStep?.activationPct, 45);
  assert.equal(mid.trailStopPrice, 125);

  // peak +80%: highest activationPct <= 80 is 65. max(100*1.40=140, 180*0.80=144) = 144.
  const high = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 180,
    markPrice: 100,
    profile: progressiveProfile,
  });
  assert.equal(high.progressiveTrailStep?.activationPct, 65);
  assert.equal(high.trailStopPrice, 144);
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
  assert.equal(exceeded.trailStopPrice, 110);
  assert.equal(exceeded.hardStopPrice, 60);
  assert.equal(exceeded.trailHasTakenOver, true);
  assert.equal(exceeded.activeStopKind, "trailing_stop");
});

test("runner_trail_stop fires exactly at the trail stop, not just above it", () => {
  // peak +40% -> trailStopPrice 110 (from the floor branch, as pinned above).
  const atStop = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 140,
    markPrice: 110,
    profile: baseProfile,
  });
  assert.equal(atStop.premiumExitReason, "runner_trail_stop");

  const justAbove = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 140,
    markPrice: 110.01,
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
