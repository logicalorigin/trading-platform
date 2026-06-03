import assert from "node:assert/strict";
import test from "node:test";
import {
  aggressiveSignalOptionsProgressiveTrailSteps,
  resolveSignalOptionsExecutionProfile,
  signalOptionsDefaultWireTrailRungs,
  signalOptionsStrikeSlotsForRight,
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
    optionSelection: {
      greekSelector: {
        enabled: true,
        mode: "all",
        fallbackToLegacy: true,
        maxCandidates: 24,
        minScore: 0,
        requireLiveGreeks: true,
      },
    },
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
      wireGreekTrail: {
        enabled: true,
        requireFreshGreeks: true,
        greekMaxAgeMs: 15000,
        deltaSizingEnabled: false,
        runnerPollIntervalSeconds: 20,
        rungByProfit: signalOptionsDefaultWireTrailRungs,
        deltaLoosenThreshold: 0.05,
        deltaTightenThreshold: -0.1,
        thetaBurdenTightenPct: 8,
        strongGammaMin: 0.05,
        spreadWideningMultiplier: 1.5,
      },
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
  assert.equal(
    tunedSignalOptionsExecutionProfile.exitPolicy.wireGreekTrail.enabled,
    true,
  );
  assert.deepEqual(
    tunedSignalOptionsExecutionProfile.exitPolicy.wireGreekTrail.rungByProfit,
    signalOptionsDefaultWireTrailRungs,
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

test("signal-options profile normalization allows five-frame MTF requirements", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    signalOptions: {
      entryGate: {
        mtfAlignment: {
          requiredCount: 5,
        },
      },
    },
  });
  const cappedProfile = resolveSignalOptionsExecutionProfile({
    signalOptions: {
      entryGate: {
        mtfAlignment: {
          requiredCount: 9,
        },
      },
    },
  });

  assert.equal(profile.entryGate.mtfAlignment.requiredCount, 5);
  assert.equal(cappedProfile.entryGate.mtfAlignment.requiredCount, 5);
});

test("signal-options profile normalization resolves MTF timeframe selection", () => {
  const customProfile = resolveSignalOptionsExecutionProfile({
    signalOptions: {
      entryGate: {
        mtfAlignment: {
          preset: "higher_timeframe",
          timeframes: ["5m", "1h", "1d", "1h", "4h", "30m"],
          requiredCount: 9,
        },
      },
    },
  });
  const legacyProfile = resolveSignalOptionsExecutionProfile({});

  assert.deepEqual(customProfile.entryGate.mtfAlignment.timeframes, [
    "5m",
    "1h",
    "1d",
  ]);
  assert.equal(customProfile.entryGate.mtfAlignment.requiredCount, 3);
  assert.equal(customProfile.entryGate.mtfAlignment.preset, "higher_timeframe");
  assert.deepEqual(legacyProfile.entryGate.mtfAlignment.timeframes, [
    "1m",
    "2m",
    "5m",
    "15m",
    "1h",
  ]);
  assert.equal(legacyProfile.entryGate.mtfAlignment.preset, "custom");
});

test("signal-options profile normalization resolves Greek selector settings", () => {
  const defaultProfile = resolveSignalOptionsExecutionProfile({});

  assert.deepEqual(defaultProfile.optionSelection.greekSelector, {
    enabled: false,
    mode: "off",
    fallbackToLegacy: true,
    maxCandidates: 24,
    minScore: 0,
    requireLiveGreeks: true,
  });

  const liveProfile = resolveSignalOptionsExecutionProfile({
    optionSelection: {
      greekSelector: {
        enabled: true,
        mode: "all",
        fallbackToLegacy: false,
        maxCandidates: 48,
        minScore: 55,
        requireLiveGreeks: false,
      },
    },
  });

  assert.deepEqual(liveProfile.optionSelection.greekSelector, {
    enabled: true,
    mode: "all",
    fallbackToLegacy: false,
    maxCandidates: 48,
    minScore: 55,
    requireLiveGreeks: false,
  });
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

test("signal-options profile normalization resolves wire-greek trail settings", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      wireGreekTrail: {
        enabled: true,
        greekMaxAgeMs: 500,
        runnerPollIntervalSeconds: 5,
        rungByProfit: [
          { activationPct: 100, rung: "wire1" },
          { activationPct: 35, rung: "wire3" },
          { activationPct: "bad", rung: "wire2" },
        ],
      },
    },
  });

  assert.equal(profile.exitPolicy.wireGreekTrail.enabled, true);
  assert.equal(profile.exitPolicy.wireGreekTrail.greekMaxAgeMs, 1000);
  assert.equal(profile.exitPolicy.wireGreekTrail.runnerPollIntervalSeconds, 15);
  assert.deepEqual(profile.exitPolicy.wireGreekTrail.rungByProfit, [
    { activationPct: 35, rung: "wire3" },
    { activationPct: 100, rung: "wire1" },
  ]);
});

test("signal-options profile normalization resolves greek position management settings", () => {
  const defaultProfile = resolveSignalOptionsExecutionProfile({});
  const diagnosticProfile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      greekPositionManagement: {
        enabled: true,
      },
      wireGreekTrail: {
        enabled: false,
      },
    },
  });
  const legacyProfile = resolveSignalOptionsExecutionProfile({
    greekPositionManagementEnabled: true,
  });

  assert.deepEqual(defaultProfile.exitPolicy.greekPositionManagement, {
    enabled: false,
  });
  assert.deepEqual(diagnosticProfile.exitPolicy.greekPositionManagement, {
    enabled: true,
  });
  assert.equal(diagnosticProfile.exitPolicy.wireGreekTrail.enabled, false);
  assert.equal(legacyProfile.exitPolicy.greekPositionManagement.enabled, true);
});

test("signal-options profile normalization supports ordered strike slot lists", () => {
  const scalarProfile = resolveSignalOptionsExecutionProfile({
    optionSelection: {
      callStrikeSlot: 4,
      putStrikeSlot: 1,
    },
  });

  assert.deepEqual(scalarProfile.optionSelection.callStrikeSlots, [4]);
  assert.deepEqual(scalarProfile.optionSelection.putStrikeSlots, [1]);
  assert.equal(scalarProfile.optionSelection.callStrikeSlot, 4);
  assert.equal(scalarProfile.optionSelection.putStrikeSlot, 1);

  const listProfile = resolveSignalOptionsExecutionProfile({
    optionSelection: {
      callStrikeSlots: [3, "4", 4, 9, "bad"],
      putStrikeSlots: [2, 1, 0, 5],
      callStrikeSlot: 1,
      putStrikeSlot: 4,
    },
  });

  assert.deepEqual(listProfile.optionSelection.callStrikeSlots, [3, 4, 5]);
  assert.deepEqual(listProfile.optionSelection.putStrikeSlots, [2, 1, 0]);
  assert.equal(listProfile.optionSelection.callStrikeSlot, 3);
  assert.equal(listProfile.optionSelection.putStrikeSlot, 2);
  assert.deepEqual(signalOptionsStrikeSlotsForRight(listProfile, "call"), [3, 4, 5]);
  assert.deepEqual(signalOptionsStrikeSlotsForRight(listProfile, "put"), [2, 1, 0]);
});
