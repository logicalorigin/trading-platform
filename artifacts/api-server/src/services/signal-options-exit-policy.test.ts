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
