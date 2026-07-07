import assert from "node:assert/strict";
import test from "node:test";

import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";

import {
  computeSignalOptionsPositionStop,
  type SignalOptionsWireContext,
} from "./signal-options-exit-policy";

// Contract under test (see signal-options-wire-trail-gate.test.ts): the wire trail must
// stay INERT until the enforce flag is deliberately flipped — enforced exit behavior is
// byte-for-byte identical to a wire-disabled profile. The first default wire rung
// activates at 35% profit while the legacy trail activates at 40%, so a 38%-peak
// position is exactly where an un-gated wire trail changes real behavior.

const wireProfile = resolveSignalOptionsExecutionProfile({
  exitPolicy: { wireGreekTrail: { enabled: true } },
});
const legacyProfile = resolveSignalOptionsExecutionProfile({});

const bullWireContext: SignalOptionsWireContext = {
  latestBarAt: new Date("2026-07-07T15:00:00Z"),
  latestClose: 100,
  regimeDirection: 1,
  previousRegimeDirection: 1,
  bullWires: [102, 101, 97],
  bearWires: null,
  trendLine: 96,
};

test("enforce off: wire trail must not activate the trail early (byte-for-byte legacy stops)", () => {
  // Peak +38%: wire rung (35%) eligible, legacy trail (40%) NOT active.
  const input = {
    entryPrice: 1.0,
    peakPrice: 1.38,
    markPrice: 1.05,
    wireContext: bullWireContext,
  };
  const legacy = computeSignalOptionsPositionStop({
    ...input,
    profile: legacyProfile,
  });
  const gated = computeSignalOptionsPositionStop({
    ...input,
    profile: wireProfile,
  });
  // Legacy baseline: no trail yet, hard stop only, no exit at mark 1.05.
  assert.equal(legacy.trailActive, false);
  assert.equal(legacy.premiumExitReason, null);
  // Enforce off (param omitted): every enforced field matches the legacy baseline.
  assert.equal(gated.trailActive, legacy.trailActive);
  assert.equal(gated.trailStopPrice, legacy.trailStopPrice);
  assert.equal(gated.stopPrice, legacy.stopPrice);
  assert.equal(gated.activeStopKind, legacy.activeStopKind);
  assert.equal(gated.premiumExitReason, legacy.premiumExitReason);
  // Telemetry still records that the wire trail WOULD have engaged (shadow visibility).
  assert.equal(gated.wireTrail.active, true);
  assert.equal(gated.wireTrail.enforced, false);
  assert.equal(gated.greekManagement.enforcing, false);
});

test("enforce on: the same scenario engages the wire trail and can exit runner_trail_stop", () => {
  const enforced = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.38,
    markPrice: 1.05,
    profile: wireProfile,
    wireContext: bullWireContext,
    wireTrailEnforceEnabled: true,
  });
  assert.equal(enforced.trailActive, true);
  assert.equal(enforced.wireTrail.enforced, true);
  assert.equal(enforced.greekManagement.enforcing, true);
  // Trail floor: max(entry*(1+10%), peak*(1-25%)) = max(1.10, 1.035) = 1.10.
  assert.equal(enforced.trailStopPrice, 1.1);
  // Mark 1.05 <= 1.10 → the wire-activated trail exits.
  assert.equal(enforced.premiumExitReason, "runner_trail_stop");
});

test("deltaSizedGiveback is per-share premium (delta × underlying distance), not ×100 contract dollars", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    exitPolicy: { wireGreekTrail: { enabled: true, deltaSizingEnabled: true } },
  });
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.5, // +50%: wire rung 35% active
    markPrice: 1.4,
    profile,
    wireContext: {
      ...bullWireContext,
      bullWires: [102, 101, 99.5], // wire3 at 99.5, spot 100 → distance 0.5
    },
    currentGreeks: { delta: 0.5, ageMs: 1_000 },
    entryGreeks: { delta: 0.5, ageMs: 1_000 },
    wireTrailEnforceEnabled: true,
  });
  // 0.5 delta × $0.50 underlying distance = $0.25 per-share premium giveback.
  assert.equal(stop.wireTrail.deltaSizedGiveback, 0.25);
  // Trail: max(minLocked 1.10, peak 1.50 − 0.25 = 1.25) = 1.25. The ×100 bug floors
  // the trail at 1.10 instead (1.50 − 25 < 0), silently discarding delta sizing.
  assert.equal(stop.trailStopPrice, 1.25);
});

test("enforce off: delta sizing candidate is telemetry-only and never shifts the stop", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    exitPolicy: { wireGreekTrail: { enabled: true, deltaSizingEnabled: true } },
  });
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.5,
    markPrice: 1.4,
    profile,
    wireContext: {
      ...bullWireContext,
      bullWires: [102, 101, 99.5],
    },
    currentGreeks: { delta: 0.5, ageMs: 1_000 },
    entryGreeks: { delta: 0.5, ageMs: 1_000 },
  });
  // Candidate still visible for shadow diagnostics…
  assert.equal(stop.wireTrail.deltaSizedGiveback, 0.25);
  // …but enforced behavior matches the wire-disabled profile: legacy trail at +50%
  // peak is active (>=40%) with giveback 25% → max(1.10, 1.125) = 1.13 (rounded).
  const legacy = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.5,
    markPrice: 1.4,
    profile: legacyProfile,
  });
  assert.equal(stop.trailStopPrice, legacy.trailStopPrice);
  assert.equal(stop.stopPrice, legacy.stopPrice);
});

test("wire structure break is suppressed when the completed bar is older than two wire intervals", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.38,
    markPrice: 1.2,
    profile: wireProfile,
    now: new Date("2026-07-07T15:03:01Z"),
    wireContext: {
      ...bullWireContext,
      timeframe: "1m",
      latestBarAt: new Date("2026-07-07T15:00:00Z"),
      latestClose: 96,
    },
  });

  assert.equal(stop.exitReason, null);
  assert.equal(stop.wireTrail.structureBreak, false);
  assert.equal(stop.wireTrail.structureBreakSuppressed, "stale_bar");
});

test("wire structure break still fires when the completed bar is fresh", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.38,
    markPrice: 1.2,
    profile: wireProfile,
    now: new Date("2026-07-07T15:01:30Z"),
    wireContext: {
      ...bullWireContext,
      timeframe: "1m",
      latestBarAt: new Date("2026-07-07T15:00:00Z"),
      latestClose: 96,
    },
  });

  assert.equal(stop.exitReason, "wire_structure_break");
  assert.equal(stop.wireTrail.structureBreak, true);
  assert.equal(stop.wireTrail.structureBreakSuppressed, null);
});

test("wire structure break fails open when timeframe and bar spacing are unavailable", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 1.0,
    peakPrice: 1.38,
    markPrice: 1.2,
    profile: wireProfile,
    now: new Date("2026-07-10T15:00:00Z"),
    wireContext: {
      ...bullWireContext,
      timeframe: null,
      latestBarAt: new Date("2026-07-07T15:00:00Z"),
      previousBarAt: null,
      latestClose: 96,
    },
  });

  assert.equal(stop.exitReason, "wire_structure_break");
  assert.equal(stop.wireTrail.structureBreak, true);
  assert.equal(stop.wireTrail.structureBreakSuppressed, null);
});
