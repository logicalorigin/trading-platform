import assert from "node:assert/strict";
import test from "node:test";

import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";

import {
  computeSignalOptionsOvernightPositionExit,
  type SignalOptionsEntryQuality,
} from "./signal-options-exit-policy";

// Defaults (base profile): overnightExitEnabled=false, overnightMinGainPct=20,
// overnightRunnerGivebackPct=15, trailActivationPct=40, minLockedGainPct=10,
// highQualityOvernightMinGainPct=-100. All prices below use entryPrice=100 so
// return-pct math stays on clean integers.

const disabledProfile = resolveSignalOptionsExecutionProfile({});
const enabledProfile = resolveSignalOptionsExecutionProfile({
  exitPolicy: { overnightExitEnabled: true },
});
const conditionalHighQualityProfile = resolveSignalOptionsExecutionProfile({
  exitPolicy: { overnightExitEnabled: true, conditionalQualityExitsEnabled: true },
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

test("runner stop: peak +50% activates trail, mark above min gain but <= trail floor", () => {
  const result = computeSignalOptionsOvernightPositionExit({
    entryPrice: 100,
    peakPrice: 150, // peak return 50% >= trailActivationPct(40) -> trail active
    markPrice: 125, // mark return 25% >= overnightMinGainPct(20), so risk exit does not win
    profile: enabledProfile,
  });
  // max(entry*(1+10/100), peak*(1-15/100)) = max(110, 127.5) = 127.5
  assert.equal(result.overnightTrailStopPrice, 127.5);
  assert.equal(result.exitReason, "overnight_runner_stop");
});

test("no exit: mark above both the min-gain floor and the trail stop", () => {
  const result = computeSignalOptionsOvernightPositionExit({
    entryPrice: 100,
    peakPrice: 150,
    markPrice: 140, // mark return 40% > trail stop 127.5 and > min gain 20%
    profile: enabledProfile,
  });
  assert.equal(result.overnightTrailStopPrice, 127.5);
  assert.equal(result.exitReason, null);
});

test("precedence: risk exit wins when both risk and runner conditions are satisfied", () => {
  const result = computeSignalOptionsOvernightPositionExit({
    entryPrice: 100,
    peakPrice: 150, // trail floor = 127.5
    markPrice: 115, // mark return 15% < 20% (risk) AND 115 <= 127.5 (runner)
    profile: enabledProfile,
  });
  assert.equal(result.overnightTrailStopPrice, 127.5);
  assert.equal(result.exitReason, "overnight_risk_exit");
});

test("trail not active below activation: overnightTrailStopPrice stays null, only min-gain rule applies", () => {
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
