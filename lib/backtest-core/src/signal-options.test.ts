import assert from "node:assert/strict";
import test from "node:test";
import {
  tunedSignalOptionsExecutionProfile,
  tunedSignalOptionsExecutionProfilePatch,
  tunedSignalOptionsStrategySettings,
} from "./signal-options";

test("tuned signal-options preset captures the recovered h8 profile", () => {
  assert.deepEqual(tunedSignalOptionsStrategySettings, {
    signalTimeframe: "5m",
    rayReplicaSettings: {
      timeHorizon: 8,
      bosConfirmation: "wicks",
      chochAtrBuffer: 0,
      chochBodyExpansionAtr: 0,
      chochVolumeGate: 0,
    },
  });
  assert.deepEqual(tunedSignalOptionsExecutionProfilePatch, {
    riskCaps: {
      maxOpenSymbols: 10,
      maxPremiumPerEntry: 1500,
    },
    exitPolicy: {
      hardStopPct: -30,
      trailActivationPct: 35,
      minLockedGainPct: 15,
      trailGivebackPct: 20,
      overnightExitEnabled: true,
      overnightMinGainPct: 10,
      overnightRunnerGivebackPct: 15,
      earlyExitBars: 6,
      earlyExitLossPct: 20,
    },
  });
  assert.equal(tunedSignalOptionsExecutionProfile.riskCaps.maxOpenSymbols, 10);
  assert.equal(
    tunedSignalOptionsExecutionProfile.riskCaps.maxPremiumPerEntry,
    1500,
  );
  assert.equal(tunedSignalOptionsExecutionProfile.exitPolicy.hardStopPct, -30);
  assert.equal(
    tunedSignalOptionsExecutionProfile.exitPolicy.overnightExitEnabled,
    true,
  );
  assert.equal(tunedSignalOptionsExecutionProfile.exitPolicy.earlyExitBars, 6);
});
