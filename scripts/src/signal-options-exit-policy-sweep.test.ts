import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVariantBackfillInput,
  buildEarlyInvalidationGridVariants,
  buildProgressiveTrailVariants,
  buildPyrusSignalsSettingsPatch,
  buildVariants,
  selectReplayVariant,
  type SweepResult,
} from "./signal-options-exit-policy-sweep";

test("exit-policy sweep carries the tuned Pyrus Signals h8 structure patch", () => {
  assert.deepEqual(buildPyrusSignalsSettingsPatch({ timeHorizon: 8 }), {
    timeHorizon: 8,
    bosConfirmation: "wicks",
    chochAtrBuffer: 0,
    chochBodyExpansionAtr: 0,
    chochVolumeGate: 0,
  });
});

test("exit-policy sweep retains the recovered h8 winner variant", () => {
  const winner = buildVariants().find(
    (variant) => variant.id === "combo-hard30-trail35-overnight10-early6",
  );

  assert.ok(winner);
  assert.deepEqual(winner.profilePatch, {
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
      overnightExitEnabled: true,
      overnightMinGainPct: 10,
      overnightRunnerGivebackPct: 15,
      earlyExitBars: 6,
      earlyExitLossPct: 20,
    },
  });
});

test("exit-policy sweep can generate the early invalidation grid", () => {
  const variants = buildEarlyInvalidationGridVariants();
  const current = variants.find(
    (variant) => variant.id === "early-grid-b6-loss20",
  );

  assert.equal(variants.length, 57);
  assert.ok(current);
  assert.deepEqual(current.profilePatch, {
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
      overnightExitEnabled: true,
      overnightMinGainPct: 10,
      overnightRunnerGivebackPct: 15,
      earlyExitBars: 6,
      earlyExitLossPct: 20,
    },
  });
});

test("exit-policy sweep includes opt-in progressive trail ladders", () => {
  const variants = buildProgressiveTrailVariants();
  const balanced = variants.find(
    (variant) => variant.id === "trail-ladder-balanced",
  );
  const balancedEarly8 = variants.find(
    (variant) => variant.id === "trail-ladder-balanced-early8-loss25",
  );

  assert.ok(balanced);
  assert.deepEqual(
    (balanced.profilePatch.exitPolicy as Record<string, unknown>)
      .progressiveTrailSteps,
    [
      { activationPct: 25, minLockedGainPct: 0, givebackPct: 35 },
      { activationPct: 35, minLockedGainPct: 15, givebackPct: 25 },
      { activationPct: 50, minLockedGainPct: 25, givebackPct: 25 },
      { activationPct: 75, minLockedGainPct: 35, givebackPct: 20 },
      { activationPct: 100, minLockedGainPct: 50, givebackPct: 20 },
    ],
  );
  assert.ok(balancedEarly8);
  assert.equal(
    (balancedEarly8.profilePatch.exitPolicy as Record<string, unknown>)
      .earlyExitBars,
    8,
  );
  assert.equal(
    (balancedEarly8.profilePatch.exitPolicy as Record<string, unknown>)
      .earlyExitLossPct,
    25,
  );
});

test("exit-policy replay defaults to the top eligible ranked variant", () => {
  const ranked = [
    {
      variant: { id: "winner", description: "", profilePatch: {} },
    },
    {
      variant: { id: "runner-up", description: "", profilePatch: {} },
    },
  ] as SweepResult[];

  assert.equal(selectReplayVariant(ranked, null)?.variant.id, "winner");
  assert.equal(
    selectReplayVariant(ranked, "runner-up")?.variant.id,
    "runner-up",
  );
  assert.throws(
    () => selectReplayVariant(ranked, "missing"),
    /not an eligible ranked result/,
  );
});

test("exit-policy replay builds a committed shadow-ledger backfill input", () => {
  const variant = {
    id: "trail-ladder-aggressive",
    description: "Aggressive replay candidate.",
    profilePatch: {
      exitPolicy: {
        progressiveTrailEnabled: true,
        earlyExitBars: 6,
        earlyExitLossPct: 20,
      },
    },
  };
  const input = buildVariantBackfillInput({
    deployment: {
      id: "deployment-1",
      name: "Pyrus Signals Options Shadow Paper",
      symbolUniverse: ["spy", "NvDa"],
    },
    variant,
    config: {
      start: "2026-05-04",
      end: "2026-05-21",
      session: "regular",
      signalTimeframe: "5m",
      timeHorizon: 8,
    },
    commit: true,
    replay: true,
    replayRunSlug: "test-run",
  });

  assert.deepEqual(input, {
    deploymentId: "deployment-1",
    start: "2026-05-04",
    end: "2026-05-21",
    session: "regular",
    commit: true,
    replay: {
      runId: "signal-options-exit-sweep-test-run-trail-ladder-aggressive",
      marketDate: "2026-05-04",
      deploymentId: "deployment-1",
      deploymentName: "Pyrus Signals Options Shadow Paper",
    },
    replaceReplayRows: true,
    forceDeploymentUniverse: true,
    symbolUniverseOverride: ["SPY", "NVDA"],
    signalTimeframe: "5m",
    pyrusSignalsSettingsPatch: {
      timeHorizon: 8,
      bosConfirmation: "wicks",
      chochAtrBuffer: 0,
      chochBodyExpansionAtr: 0,
      chochVolumeGate: 0,
    },
    profilePatch: variant.profilePatch,
    progress: true,
  });
});

test("exit-policy dry runs do not commit or replace replay rows", () => {
  const input = buildVariantBackfillInput({
    deployment: {
      id: "deployment-1",
      name: "Pyrus Signals Options Shadow Paper",
      symbolUniverse: ["SPY"],
    },
    variant: {
      id: "baseline-current-exits",
      description: "Dry candidate.",
      profilePatch: {},
    },
    config: {
      start: "2026-05-04",
      session: "regular",
      signalTimeframe: "5m",
      timeHorizon: 8,
    },
  });

  assert.equal(input.commit, false);
  assert.equal(input.replay, null);
  assert.equal(input.replaceReplayRows, false);
});
