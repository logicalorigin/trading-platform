import assert from "node:assert/strict";
import test from "node:test";
import {
  aggressiveSignalOptionsProgressiveTrailSteps,
  resolveSignalOptionsExecutionProfile,
  tunedSignalOptionsExecutionProfile,
  tunedSignalOptionsExecutionProfilePatch,
  tunedSignalOptionsStrategySettings,
} from "./signal-options";

test("tuned signal-options preset captures the recovered h8 profile", () => {
  assert.deepEqual(tunedSignalOptionsStrategySettings, {
    signalTimeframe: "5m",
    pyrusSignalsSettings: {
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
      tightenAtFiveXGivebackPct: 30,
      tightenAtTenXGivebackPct: 15,
      progressiveTrailEnabled: true,
      progressiveTrailSteps: aggressiveSignalOptionsProgressiveTrailSteps,
      overnightExitEnabled: true,
      overnightMinGainPct: 10,
      overnightRunnerGivebackPct: 15,
      earlyExitBars: 8,
      earlyExitLossPct: 25,
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
  assert.equal(tunedSignalOptionsExecutionProfile.exitPolicy.earlyExitBars, 8);
  assert.equal(
    tunedSignalOptionsExecutionProfile.exitPolicy.earlyExitLossPct,
    25,
  );
  assert.equal(
    tunedSignalOptionsExecutionProfile.exitPolicy.tightenAtFiveXGivebackPct,
    30,
  );
  assert.equal(
    tunedSignalOptionsExecutionProfile.exitPolicy.tightenAtTenXGivebackPct,
    15,
  );
  assert.equal(
    tunedSignalOptionsExecutionProfile.exitPolicy.progressiveTrailEnabled,
    true,
  );
  assert.deepEqual(
    tunedSignalOptionsExecutionProfile.exitPolicy.progressiveTrailSteps,
    aggressiveSignalOptionsProgressiveTrailSteps,
  );
  assert.deepEqual(tunedSignalOptionsExecutionProfile.riskHaltControls, {
    dailyLossHaltEnabled: true,
    openSymbolCapEnabled: true,
    premiumBudgetEnabled: true,
  });
});

test("signal-options profile normalization fills halt control defaults", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    signalOptions: {
      riskHaltControls: {
        dailyLossHaltEnabled: false,
      },
      infrastructureHaltControls: {
        gatewayReadinessBlockEnabled: false,
      },
    },
  });

  assert.equal(profile.riskHaltControls.dailyLossHaltEnabled, false);
  assert.equal(profile.riskHaltControls.openSymbolCapEnabled, true);
  assert.equal(profile.entryHaltControls.mtfAlignmentEnabled, true);
  assert.equal(profile.liquidityHaltControls.spreadGateEnabled, true);
  assert.equal(profile.positionHaltControls.sameDirectionPositionBlockEnabled, true);
  assert.equal(profile.positionHaltControls.positionMarkFeedHaltEnabled, true);
  assert.equal(
    profile.infrastructureHaltControls.gatewayReadinessBlockEnabled,
    false,
  );
  assert.equal(
    profile.infrastructureHaltControls.resourcePressureScanBlockEnabled,
    true,
  );
});

test("signal-options profile normalization sorts progressive trail steps", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      progressiveTrailEnabled: true,
      progressiveTrailSteps: [
        { activationPct: 50, minLockedGainPct: 25, givebackPct: 25 },
        { activationPct: 25, minLockedGainPct: 0, givebackPct: 35 },
        { activationPct: "bad", minLockedGainPct: 10, givebackPct: 20 },
      ],
    },
  });

  assert.equal(profile.exitPolicy.progressiveTrailEnabled, true);
  assert.deepEqual(profile.exitPolicy.progressiveTrailSteps, [
    { activationPct: 25, minLockedGainPct: 0, givebackPct: 35 },
    { activationPct: 50, minLockedGainPct: 25, givebackPct: 25 },
  ]);
});
