import assert from "node:assert/strict";
import test from "node:test";

import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";

import {
  computeSignalOptionsOvernightPositionExit,
  type SignalOptionsEntryQuality,
} from "./signal-options-exit-policy";

// Overnight policy is only an explicit session-boundary risk floor. Trailing-stop
// behavior belongs to computeSignalOptionsPositionStop and its user-configured ladder.
// Legacy overnight runner fields remain readable for stored-profile compatibility,
// but must not create a second, conflicting trailing stop.
// All prices below use entryPrice=100 so return-pct math stays on clean integers.

const disabledProfile = resolveSignalOptionsExecutionProfile({});
const enabledProfile = resolveSignalOptionsExecutionProfile({
  exitPolicy: {
    overnightExitEnabled: true,
    overnightMinGainExitEnabled: true,
  },
});
const runnerOnlyProfile = resolveSignalOptionsExecutionProfile({
  exitPolicy: {
    overnightExitEnabled: true,
    overnightMinGainExitEnabled: false,
  },
});
const conditionalHighQualityProfile = resolveSignalOptionsExecutionProfile({
  exitPolicy: {
    overnightExitEnabled: true,
    overnightMinGainExitEnabled: true,
    conditionalQualityExitsEnabled: true,
  },
});

const highQualityBullishSignal: SignalOptionsEntryQuality = {
  tier: "high",
  liquidityTier: "standard",
  score: 0,
  reasons: [],
  adx: null,
  mtfMatches: 0,
  mtfDirections: [],
  spreadPctOfMid: null,
  bullishRegime: true,
};

const standardQualityBullishSignal: SignalOptionsEntryQuality = {
  ...highQualityBullishSignal,
  tier: "standard",
};

test("overnightExitEnabled=false: no exit even at -50% mark return, markReturnPct still computed", () => {
  const result = computeSignalOptionsOvernightPositionExit({
    entryPrice: 100,
    peakPrice: 100,
    markPrice: 50,
    profile: disabledProfile,
  });
  assert.equal(result.exitReason, null);
  assert.equal(result.overnightTrailStopPrice, null);
  assert.equal(result.markReturnPct, -50);
});

test("risk exit: mark return below overnightMinGainPct (20%) triggers overnight_risk_exit", () => {
  const result = computeSignalOptionsOvernightPositionExit({
    entryPrice: 100,
    peakPrice: 100, // peak return 0% < trailActivationPct(40) -> trail not active
    markPrice: 110, // mark return 10% < 20%
    profile: enabledProfile,
  });
  assert.equal(result.exitReason, "overnight_risk_exit");
  assert.equal(result.overnightTrailStopPrice, null);
  assert.equal(result.markReturnPct, 10);
});

test("overnightMinGainExitEnabled=false disables overnight exits without creating a legacy runner stop", () => {
  const riskFloor = computeSignalOptionsOvernightPositionExit({
    entryPrice: 100,
    peakPrice: 100,
    markPrice: 110,
    profile: runnerOnlyProfile,
  });
  const runner = computeSignalOptionsOvernightPositionExit({
    entryPrice: 100,
    peakPrice: 150,
    markPrice: 125,
    profile: runnerOnlyProfile,
  });

  assert.equal(riskFloor.exitReason, null);
  assert.equal(runner.overnightTrailStopPrice, null);
  assert.equal(runner.exitReason, null);
});

test("overnight does not override the configurable trailing-stop policy", () => {
  const result = computeSignalOptionsOvernightPositionExit({
    entryPrice: 100,
    peakPrice: 150,
    markPrice: 125,
    profile: enabledProfile,
  });
  assert.equal(result.overnightTrailStopPrice, null);
  assert.equal(result.exitReason, null);
});

test("no exit when mark is above the overnight min-gain floor", () => {
  const result = computeSignalOptionsOvernightPositionExit({
    entryPrice: 100,
    peakPrice: 150,
    markPrice: 140, // mark return 40% > trail stop 127.5 and > min gain 20%
    profile: enabledProfile,
  });
  assert.equal(result.overnightTrailStopPrice, null);
  assert.equal(result.exitReason, null);
});

test("risk floor still exits independently of the position trail", () => {
  const result = computeSignalOptionsOvernightPositionExit({
    entryPrice: 100,
    peakPrice: 150,
    markPrice: 115,
    profile: enabledProfile,
  });
  assert.equal(result.overnightTrailStopPrice, null);
  assert.equal(result.exitReason, "overnight_risk_exit");
});

test("peak does not affect the overnight min-gain rule", () => {
  const result = computeSignalOptionsOvernightPositionExit({
    entryPrice: 100,
    peakPrice: 120, // peak return 20% < trailActivationPct(40) -> trail not active
    markPrice: 105, // mark return 5% < 20% -> min-gain rule alone decides
    profile: enabledProfile,
  });
  assert.equal(result.overnightTrailStopPrice, null);
  assert.equal(result.exitReason, "overnight_risk_exit");
});

test("conditional high-quality bullish signal lowers the min-gain bar to highQualityOvernightMinGainPct (-100), holding at -50% mark", () => {
  const result = computeSignalOptionsOvernightPositionExit({
    entryPrice: 100,
    peakPrice: 100, // trail not active
    markPrice: 50, // mark return -50%, above the -100 conditional floor
    profile: conditionalHighQualityProfile,
    signalQuality: highQualityBullishSignal,
  });
  assert.equal(result.conditionalExitPolicy?.overnightMinGainPct, -100);
  assert.equal(result.overnightTrailStopPrice, null);
  assert.equal(result.exitReason, null);
});

test("legacy high-quality overnight runner fields do not create a second trail", () => {
  const result = computeSignalOptionsOvernightPositionExit({
    entryPrice: 100,
    peakPrice: 200,
    markPrice: 152,
    profile: conditionalHighQualityProfile,
    signalQuality: highQualityBullishSignal,
  });
  assert.equal(result.conditionalExitPolicy?.overnightRunnerGivebackPct, 25);
  assert.equal(result.overnightTrailStopPrice, null);
  assert.equal(result.exitReason, null);
});

test("legacy standard-quality overnight runner fields do not create a second trail", () => {
  const result = computeSignalOptionsOvernightPositionExit({
    entryPrice: 100,
    peakPrice: 200,
    markPrice: 152,
    profile: conditionalHighQualityProfile,
    signalQuality: standardQualityBullishSignal,
  });
  assert.equal(result.conditionalExitPolicy?.overnightRunnerGivebackPct, 15);
  assert.equal(result.overnightTrailStopPrice, null);
  assert.equal(result.exitReason, null);
});

test("conditional gate does not revive the legacy overnight runner", () => {
  const gateOffProfile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      overnightExitEnabled: true,
      conditionalQualityExitsEnabled: false,
      highQualityOvernightRunnerGivebackPct: 25,
    },
  });

  const result = computeSignalOptionsOvernightPositionExit({
    entryPrice: 100,
    peakPrice: 200,
    markPrice: 152,
    profile: gateOffProfile,
    signalQuality: highQualityBullishSignal,
  });
  assert.equal(result.conditionalExitPolicy?.overnightMinGainPct, 20);
  assert.equal(result.conditionalExitPolicy?.overnightRunnerGivebackPct, 15);
  assert.equal(result.overnightTrailStopPrice, null);
  assert.equal(result.exitReason, null);
});
