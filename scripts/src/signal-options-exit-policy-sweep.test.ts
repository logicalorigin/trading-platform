import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRayReplicaSettingsPatch,
  buildVariants,
} from "./signal-options-exit-policy-sweep";

test("exit-policy sweep carries the tuned RayReplica h8 structure patch", () => {
  assert.deepEqual(buildRayReplicaSettingsPatch({ timeHorizon: 8 }), {
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
      overnightExitEnabled: true,
      overnightMinGainPct: 10,
      overnightRunnerGivebackPct: 15,
      earlyExitBars: 6,
      earlyExitLossPct: 20,
    },
  });
});
