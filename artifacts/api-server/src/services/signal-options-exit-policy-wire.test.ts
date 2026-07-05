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
