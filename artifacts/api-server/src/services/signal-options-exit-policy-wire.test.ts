import assert from "node:assert/strict";
import test from "node:test";

import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";

import { computeSignalOptionsPositionStop } from "./signal-options-exit-policy";

// Structural guarantee behind the wire-trail shadow-first integration:
// wire_structure_break can ONLY arise from a selected wire, which requires a
// wireContext. In the default runtime (WIRE_TRAIL_LIVE off => loader returns null =>
// no wireContext) a wire exit is therefore impossible, and legacy stop/trail exits are
// produced exactly as before. These tests pin that so a future change can't silently
// make the wire trail fire without a wireContext.

const profile = resolveSignalOptionsExecutionProfile({});
// The base profile keeps the wire-greek trail OFF by default, so an explicit profile is
// needed to exercise the "configured-on but inert without a wireContext" telemetry state.
const wireEnabledProfile = resolveSignalOptionsExecutionProfile({
  exitPolicy: { wireGreekTrail: { enabled: true } },
});

test("no wireContext: a breached hard stop yields hard_stop, never wire_structure_break", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.0,
    markPrice: 0.1, // ~-90%: below any default hard stop
    profile,
  });
  assert.equal(stop.exitReason, "hard_stop");
  assert.notEqual(stop.exitReason, "wire_structure_break");
});

test("no wireContext: a flat position has no exit and no wire activity", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.0,
    markPrice: 1.0,
    profile,
  });
  assert.notEqual(stop.exitReason, "wire_structure_break");
  assert.equal(stop.wireTrail.active, false);
  assert.equal(stop.wireTrail.structureBreak, false);
});

test("explicit wireContext: null leaves the wire trail inert even when configured on", () => {
  // A wire-ENABLED profile with no context must still stay inert
  // (active:false, structureBreak:false) and never produce a wire exit.
  assert.equal(wireEnabledProfile.exitPolicy.wireGreekTrail.enabled, true);
  for (const markPrice of [0.1, 0.5, 0.9, 1.2, 2.5]) {
    const stop = computeSignalOptionsPositionStop({
      entryPrice: 1.0,
      peakPrice: 2.0,
      markPrice,
      profile: wireEnabledProfile,
      wireContext: null,
    });
    assert.notEqual(
      stop.exitReason,
      "wire_structure_break",
      `mark ${markPrice} must not produce a wire exit without a wireContext`,
    );
    assert.equal(stop.wireTrail.active, false);
    assert.equal(stop.wireTrail.structureBreak, false);
  }
});

test("telemetry reports the configured enabled flag honestly (lit-but-inert is escapable)", () => {
  // Default profile: wire trail off => telemetry honestly reports enabled:false.
  const offStop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.0,
    markPrice: 1.0,
    profile,
    wireContext: null,
  });
  assert.equal(offStop.wireTrail.enabled, false);
  assert.equal(offStop.wireTrail.active, false);
  // Configured-on profile: enabled mirrors config (true), but active stays false without
  // a wireContext — exactly the "enabled:true / active:false" state the integration makes
  // escapable (lit-but-inert is now distinguishable from genuinely active).
  const onStop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.0,
    markPrice: 1.0,
    profile: wireEnabledProfile,
    wireContext: null,
  });
  assert.equal(onStop.wireTrail.enabled, true);
  assert.equal(onStop.wireTrail.active, false);
});

// The wireLevels ladder + distanceToBreakPct are passthrough telemetry (no zod
// schema), so these assertions are the ONLY type-safety net keeping a field-name
// typo from silently reaching the frontend as undefined.
test("wireContext present (long): emits the full ladder + positive room to break", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 2.0, // +100% peak -> a rung (wire1) is selected
    markPrice: 1.6,
    profile: wireEnabledProfile,
    wireContext: {
      symbol: "SPY",
      timeframe: "5m",
      latestBarAt: new Date(),
      latestClose: 100,
      regimeDirection: 1,
      previousRegimeDirection: 1,
      trendLine: 90,
      bullWires: [98, 95, 92],
      bearWires: [102, 105, 108],
    },
  });
  assert.deepEqual(stop.wireTrail.wireLevels, {
    trendLine: 90,
    wire1: 98,
    wire2: 95,
    wire3: 92,
  });
  // Underlying 100 sits 2% above the active wire (98) -> 2% room before a break.
  assert.equal(typeof stop.wireTrail.distanceToBreakPct, "number");
  assert.ok(
    Math.abs((stop.wireTrail.distanceToBreakPct as number) - 2) < 1e-9,
    `distanceToBreakPct ${stop.wireTrail.distanceToBreakPct} should be ~2`,
  );
});

test("wireContext present (short): ladder uses bearWires and distance sign is direction-correct", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 2.0,
    markPrice: 1.6,
    direction: "short",
    profile: wireEnabledProfile,
    wireContext: {
      symbol: "SPY",
      timeframe: "5m",
      latestBarAt: new Date(),
      latestClose: 100,
      regimeDirection: -1,
      previousRegimeDirection: -1,
      trendLine: 110,
      bullWires: [98, 95, 92],
      bearWires: [102, 105, 108],
    },
  });
  assert.deepEqual(stop.wireTrail.wireLevels, {
    trendLine: 110,
    wire1: 102,
    wire2: 105,
    wire3: 108,
  });
  // Short: underlying 100 sits 2% below the active wire (102) -> 2% room.
  assert.equal(typeof stop.wireTrail.distanceToBreakPct, "number");
  assert.ok(
    Math.abs((stop.wireTrail.distanceToBreakPct as number) - 2) < 1e-9,
    `short distanceToBreakPct ${stop.wireTrail.distanceToBreakPct} should be ~2`,
  );
});

test("no wireContext: wireLevels and distanceToBreakPct are null (not undefined)", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 2.0,
    markPrice: 1.5,
    profile: wireEnabledProfile,
    wireContext: null,
  });
  assert.equal(stop.wireTrail.wireLevels, null);
  assert.equal(stop.wireTrail.distanceToBreakPct, null);
});
