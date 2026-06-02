import assert from "node:assert/strict";
import test from "node:test";
import { defaultSignalOptionsExecutionProfile } from "@workspace/backtest-core";
import { computeSignalOptionsPositionStop } from "./signal-options-exit-policy";

test("computeSignalOptionsPositionStop keeps hard stop active until trail improves it", () => {
  const profile = {
    ...defaultSignalOptionsExecutionProfile,
    exitPolicy: {
      ...defaultSignalOptionsExecutionProfile.exitPolicy,
      hardStopPct: -5,
      trailActivationPct: 0,
      minLockedGainPct: -50,
      trailGivebackPct: 80,
      progressiveTrailEnabled: false,
      progressiveTrailSteps: [],
    },
  };

  const stop = computeSignalOptionsPositionStop({
    entryPrice: 10,
    peakPrice: 11,
    markPrice: 4.9,
    profile,
  });

  assert.equal(stop.hardStopPrice, 9.5);
  assert.equal(stop.trailActive, true);
  assert.equal(stop.trailStopPrice, 5);
  assert.equal(stop.stopPrice, 9.5);
  assert.equal(stop.activeStopPrice, 9.5);
  assert.equal(stop.activeStopKind, "hard_stop");
  assert.equal(stop.trailHasTakenOver, false);
  assert.equal(stop.exitReason, "hard_stop");
});

test("computeSignalOptionsPositionStop reports Greek tightening diagnostics without enforcing exits", () => {
  const profile = {
    ...defaultSignalOptionsExecutionProfile,
    exitPolicy: {
      ...defaultSignalOptionsExecutionProfile.exitPolicy,
      trailActivationPct: 100,
      progressiveTrailEnabled: false,
      progressiveTrailSteps: [],
      wireGreekTrail: {
        ...defaultSignalOptionsExecutionProfile.exitPolicy.wireGreekTrail,
        enabled: false,
        requireFreshGreeks: true,
        greekMaxAgeMs: 15_000,
        deltaTightenThreshold: -0.1,
        thetaBurdenTightenPct: 8,
      },
    },
  };

  const stop = computeSignalOptionsPositionStop({
    entryPrice: 4,
    peakPrice: 5,
    markPrice: 4.8,
    profile,
    currentGreeks: {
      delta: 0.45,
      gamma: 0.02,
      theta: -0.5,
      updatedAt: new Date("2026-05-28T14:30:00.000Z"),
    },
    entryGreeks: { delta: 0.6 },
    now: new Date("2026-05-28T14:30:05.000Z"),
  });

  assert.equal(stop.exitReason, null);
  assert.equal(stop.wireTrail.enabled, false);
  assert.equal(stop.greekManagement.available, true);
  assert.equal(stop.greekManagement.enforcing, false);
  assert.equal(stop.greekManagement.recommendation, "tighten");
  assert.deepEqual(stop.greekManagement.reasons, [
    "delta_decay",
    "theta_burden",
  ]);
  assert.equal(stop.greekManagement.deltaImprovement, -0.15);
  assert.equal(stop.greekManagement.thetaBurdenPct, 10.416667);
});

test("computeSignalOptionsPositionStop reports Greek support without loosening disabled exits", () => {
  const profile = {
    ...defaultSignalOptionsExecutionProfile,
    exitPolicy: {
      ...defaultSignalOptionsExecutionProfile.exitPolicy,
      trailActivationPct: 100,
      progressiveTrailEnabled: false,
      progressiveTrailSteps: [],
      wireGreekTrail: {
        ...defaultSignalOptionsExecutionProfile.exitPolicy.wireGreekTrail,
        enabled: false,
        requireFreshGreeks: true,
        greekMaxAgeMs: 15_000,
        deltaLoosenThreshold: 0.05,
        strongGammaMin: 0.05,
      },
    },
  };

  const stop = computeSignalOptionsPositionStop({
    entryPrice: 4,
    peakPrice: 5,
    markPrice: 4.8,
    profile,
    currentGreeks: {
      delta: 0.72,
      gamma: 0.07,
      theta: -0.05,
      updatedAt: new Date("2026-05-28T14:30:00.000Z"),
    },
    entryGreeks: { delta: 0.6 },
    now: new Date("2026-05-28T14:30:05.000Z"),
  });

  assert.equal(stop.exitReason, null);
  assert.equal(stop.wireTrail.enabled, false);
  assert.equal(stop.greekManagement.available, true);
  assert.equal(stop.greekManagement.enforcing, false);
  assert.equal(stop.greekManagement.recommendation, "loosen");
  assert.deepEqual(stop.greekManagement.reasons, ["delta_gamma_support"]);
  assert.equal(stop.greekManagement.deltaImprovement, 0.12);
});
