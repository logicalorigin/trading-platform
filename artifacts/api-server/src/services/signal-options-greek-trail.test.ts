import assert from "node:assert/strict";
import test from "node:test";

import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";

import {
  computeSignalOptionsPositionStop,
  type SignalOptionsWireContext,
} from "./signal-options-exit-policy";

// Rung selection, greek-driven tighten/loosen adjustment, structure-break detection
// (both position sides + regime-flip suppression), and wire-value fallback for the
// wire/greek trail. Enforce gating and delta-sized giveback sizing are pinned in
// signal-options-wire-trail-enforce.test.ts and are not duplicated here.

const wireProfile = resolveSignalOptionsExecutionProfile({
  exitPolicy: { wireGreekTrail: { enabled: true } },
});

const bullWireContext: SignalOptionsWireContext = {
  latestBarAt: new Date("2026-07-07T15:00:00Z"),
  latestClose: 100,
  regimeDirection: 1,
  previousRegimeDirection: 1,
  bullWires: [102, 101, 97],
  bearWires: null,
  trendLine: 96,
};

const bearWireContext: SignalOptionsWireContext = {
  latestBarAt: new Date("2026-07-07T15:00:00Z"),
  latestClose: 100,
  regimeDirection: -1,
  previousRegimeDirection: -1,
  bullWires: null,
  bearWires: [110, 108, 102],
  trendLine: 112,
};

test("baseline rung selection walks the default profit ladder (35/65/100)", () => {
  const at40 = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.4, // +40%
    markPrice: 1.4,
    profile: wireProfile,
  });
  assert.equal(at40.wireTrail.baselineRung, "wire3");

  const at70 = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.7, // +70%
    markPrice: 1.7,
    profile: wireProfile,
  });
  assert.equal(at70.wireTrail.baselineRung, "wire2");

  const at120 = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 2.2, // +120%
    markPrice: 2.2,
    profile: wireProfile,
  });
  assert.equal(at120.wireTrail.baselineRung, "wire1");
});

test("greek tighten: delta decay past threshold pulls the rung one step toward the trend line", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.4, // +40%: baseline rung "wire3"
    markPrice: 1.4,
    profile: wireProfile,
    wireContext: bullWireContext,
    entryGreeks: { delta: 0.5, ageMs: 1_000 },
    currentGreeks: { delta: 0.35, ageMs: 1_000 }, // improvement -0.15 <= -0.1
  });
  assert.equal(stop.wireTrail.baselineRung, "wire3");
  assert.equal(stop.wireTrail.greekAdjustment.adjustment, -1);
  assert.deepEqual(stop.wireTrail.greekAdjustment.reasons, ["delta_decay"]);
  // wire3 -> wire2 (one step toward trendLine).
  assert.equal(stop.wireTrail.selectedRung, "wire2");
});

test("greek tighten: theta burden past threshold tightens the rung", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.4, // +40%: baseline rung "wire3"
    markPrice: 1.4,
    profile: wireProfile,
    wireContext: bullWireContext,
    entryGreeks: { delta: 0.5, ageMs: 1_000 },
    // No delta decay (improvement 0); theta burden = 0.15 / 1.4 * 100 ≈ 10.7% >= 8%.
    currentGreeks: { delta: 0.5, theta: -0.15, ageMs: 1_000 },
  });
  assert.equal(stop.wireTrail.greekAdjustment.adjustment, -1);
  assert.deepEqual(stop.wireTrail.greekAdjustment.reasons, ["theta_burden"]);
  assert.equal(stop.wireTrail.selectedRung, "wire2");
});

test("greek loosen: delta improvement with strong gamma and no tighten trigger loosens the rung", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.7, // +70%: baseline rung "wire2"
    markPrice: 1.7,
    profile: wireProfile,
    wireContext: bullWireContext,
    entryGreeks: { delta: 0.4, ageMs: 1_000 },
    currentGreeks: { delta: 0.46, gamma: 0.06, ageMs: 1_000 }, // improvement +0.06
  });
  assert.equal(stop.wireTrail.baselineRung, "wire2");
  assert.equal(stop.wireTrail.greekAdjustment.adjustment, 1);
  assert.deepEqual(stop.wireTrail.greekAdjustment.reasons, ["delta_gamma_support"]);
  // wire2 -> wire3 (one step away from the trend line).
  assert.equal(stop.wireTrail.selectedRung, "wire3");
});

test("stale greeks zero the adjustment but structure break still evaluates on the baseline rung", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.4, // +40%: baseline rung "wire3" (price 97)
    markPrice: 1.4,
    profile: wireProfile,
    wireContext: { ...bullWireContext, latestClose: 95 }, // through wire3 (97)
    currentGreeks: { delta: 0.35, ageMs: 50_000 }, // stale (> 45000ms)
  });
  assert.equal(stop.wireTrail.greekAdjustment.adjustment, 0);
  assert.deepEqual(stop.wireTrail.greekAdjustment.reasons, ["greeks_unavailable"]);
  assert.equal(stop.wireTrail.greekFallbackReason, "stale_greeks");
  assert.equal(stop.wireTrail.selectedRung, "wire3");
  assert.equal(stop.wireTrail.structureBreak, true);
});

test("missing greek timestamp falls back honestly instead of assuming freshness", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.4,
    markPrice: 1.4,
    profile: wireProfile,
    wireContext: bullWireContext,
    currentGreeks: { delta: 0.35 }, // no ageMs, no updatedAt
  });
  assert.equal(stop.wireTrail.greekAdjustment.adjustment, 0);
  assert.deepEqual(stop.wireTrail.greekAdjustment.reasons, ["greeks_unavailable"]);
  assert.equal(stop.wireTrail.greekFallbackReason, "missing_greek_timestamp");
});

test("short side: structure break fires when close rises to/through the selected wire, not below it", () => {
  const noBreak = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.4, // +40%: baseline rung "wire3" (bear wire3 = 102)
    markPrice: 1.4,
    profile: wireProfile,
    direction: "sell",
    wireContext: bearWireContext, // latestClose 100 < wire3 102
  });
  assert.equal(noBreak.wireTrail.selectedRung, "wire3");
  assert.equal(noBreak.wireTrail.selectedWirePrice, 102);
  assert.equal(noBreak.wireTrail.structureBreak, false);

  const broken = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.4,
    markPrice: 1.4,
    profile: wireProfile,
    direction: "sell",
    wireContext: { ...bearWireContext, latestClose: 105 }, // through wire3 (102)
  });
  assert.equal(broken.wireTrail.structureBreak, true);
});

test("regime flip against the position forces the trend line and suppresses structure break", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.4,
    markPrice: 1.4,
    profile: wireProfile,
    direction: "buy",
    wireContext: {
      ...bullWireContext,
      latestClose: 90, // through every bull wire and the trend line (96)
      previousRegimeDirection: 1,
      regimeDirection: -1,
    },
  });
  assert.equal(stop.wireTrail.regimeFlipAgainstPosition, true);
  assert.equal(stop.wireTrail.selectedRung, "trendLine");
  assert.equal(stop.wireTrail.structureBreak, false);
});

// Regression for a found-and-fixed bug: finiteNumber lacked a null guard, so a null
// wire entry coerced via Number(null) -> 0 and became a phantom $0 wire price —
// silently disabling long structure breaks at that rung and spuriously firing short
// ones. Production bullWires/bearWires legitimately carry null for unavailable rungs,
// so this pins the guarded behavior: null walks down like undefined does.
test("wire fallback: a null value at the selected rung walks down toward the trend line", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.7, // +70%: baseline rung "wire2"
    markPrice: 1.7,
    profile: wireProfile,
    wireContext: {
      ...bullWireContext,
      bullWires: [101, null, 97], // wire2 missing
    },
  });
  assert.equal(stop.wireTrail.baselineRung, "wire2");
  assert.equal(stop.wireTrail.selectedRung, "wire1");
  assert.equal(stop.wireTrail.selectedWirePrice, 101);
});

// Same guard, worst family member: ageMs null used to coerce to 0 = "perfectly
// fresh", inverting staleness handling whenever a quote carried ageMs: null with no
// usable timestamp. Guarded: null ageMs + no timestamp → not fresh.
test("greek freshness: ageMs null with no timestamp is NOT fresh (missing_greek_timestamp)", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.4,
    markPrice: 1.3,
    profile: wireProfile,
    wireContext: bullWireContext,
    currentGreeks: { delta: 0.5, ageMs: null, updatedAt: null },
    entryGreeks: { delta: 0.5, ageMs: 1_000 },
    wireTrailEnforceEnabled: true,
  });
  assert.equal(stop.wireTrail.greekFresh, false);
  assert.equal(stop.wireTrail.greekFallbackReason, "missing_greek_timestamp");
  assert.deepEqual(stop.wireTrail.greekAdjustment.reasons, ["greeks_unavailable"]);
});

test("greek freshness rejects non-numeric coercions", () => {
  for (const ageMs of [false, [], "   "]) {
    const stop = computeSignalOptionsPositionStop({
      entryPrice: 1,
      peakPrice: 1.4,
      markPrice: 1.3,
      profile: wireProfile,
      wireContext: bullWireContext,
      currentGreeks: {
        delta: 0.5,
        ageMs: ageMs as never,
        updatedAt: null,
      },
      entryGreeks: { delta: 0.5, ageMs: 1_000 },
      wireTrailEnforceEnabled: true,
    });

    assert.equal(stop.wireTrail.greekFresh, false);
    assert.equal(stop.wireTrail.greekFallbackReason, "missing_greek_timestamp");
    assert.deepEqual(stop.wireTrail.greekAdjustment.reasons, [
      "greeks_unavailable",
    ]);
  }
});

test("greek freshness rejects negative explicit ages", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1,
    peakPrice: 1.4,
    markPrice: 1.3,
    profile: wireProfile,
    wireContext: bullWireContext,
    currentGreeks: { delta: 0.35, ageMs: -3_600_000 },
    entryGreeks: { delta: 0.5, ageMs: 1_000 },
  });

  assert.equal(stop.wireTrail.greekFresh, false);
  assert.equal(stop.wireTrail.greekFallbackReason, "future_greeks");
  assert.deepEqual(stop.wireTrail.greekAdjustment.reasons, [
    "greeks_unavailable",
  ]);
});

test("greek freshness rejects timestamps in the future", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1,
    peakPrice: 1.4,
    markPrice: 1.3,
    profile: wireProfile,
    now: new Date("2026-07-07T15:00:00Z"),
    wireContext: bullWireContext,
    currentGreeks: {
      delta: 0.35,
      updatedAt: new Date("2026-07-07T15:01:00Z"),
    },
    entryGreeks: { delta: 0.5, ageMs: 1_000 },
  });

  assert.equal(stop.wireTrail.greekFresh, false);
  assert.equal(stop.wireTrail.greekFallbackReason, "future_greeks");
  assert.deepEqual(stop.wireTrail.greekAdjustment.reasons, [
    "greeks_unavailable",
  ]);
});

test("wire fallback rejects non-numeric coercions at the selected rung", () => {
  for (const wire of [false, [], "   "]) {
    const stop = computeSignalOptionsPositionStop({
      entryPrice: 1,
      peakPrice: 1.7,
      markPrice: 1.7,
      profile: wireProfile,
      wireContext: {
        ...bullWireContext,
        bullWires: [101, wire as never, 97],
      },
    });

    assert.equal(stop.wireTrail.baselineRung, "wire2");
    assert.equal(stop.wireTrail.selectedRung, "wire1");
    assert.equal(stop.wireTrail.selectedWirePrice, 101);
  }
});

test("wire fallback: an undefined value at the selected rung walks down toward the trend line", () => {
  // Undefined follows the same selectUsableWireValue walk-down as the guarded
  // null and malformed-value cases above.
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.7, // +70%: baseline rung "wire2"
    markPrice: 1.7,
    profile: wireProfile,
    wireContext: {
      ...bullWireContext,
      bullWires: [101, undefined, 97], // wire2 missing
    },
  });
  assert.equal(stop.wireTrail.baselineRung, "wire2");
  assert.equal(stop.wireTrail.selectedRung, "wire1");
  assert.equal(stop.wireTrail.selectedWirePrice, 101);
});
