import assert from "node:assert/strict";
import test from "node:test";

import {
  planAlgoAdjustmentsSaveReconciliation,
  saveAllAlgoAdjustments,
} from "./saveAllAlgoAdjustments.js";

test("saveAllAlgoAdjustments returns successful profile and strategy payloads", async () => {
  const profilePayload = { profile: { liquidityGate: { minBid: 0.03 } } };
  const strategyPayload = {
    deployment: { id: "deployment-1" },
    signalMonitorProfile: { environment: "shadow" },
  };

  const result = await saveAllAlgoAdjustments({
    deploymentId: "deployment-1",
    profileDraft: profilePayload.profile,
    strategySettingsDraft: {
      signalTimeframe: "5m",
      timeHorizon: 8,
      bosConfirmation: "candle-close",
    },
    profileDirty: true,
    strategyDirty: true,
    updateProfileMutation: {
      mutateAsync: async () => profilePayload,
    },
    updateStrategySettingsMutation: {
      mutateAsync: async () => strategyPayload,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.profileResult, profilePayload);
  assert.equal(result.strategyResult, strategyPayload);
});

test("saveAllAlgoAdjustments does not report payloads when a save fails", async () => {
  const failures = [];

  const result = await saveAllAlgoAdjustments({
    deploymentId: "deployment-1",
    profileDraft: { liquidityGate: { minBid: 0.03 } },
    strategySettingsDraft: {},
    profileDirty: true,
    strategyDirty: false,
    updateProfileMutation: {
      mutateAsync: async () => {
        throw new Error("profile failed");
      },
    },
    updateStrategySettingsMutation: {
      mutateAsync: async () => {
        throw new Error("unexpected strategy save");
      },
    },
    onPartialFailure: (payload) => failures.push(payload),
  });

  assert.equal(result.ok, false);
  assert.equal(result.profileResult, undefined);
  assert.equal(result.failures.length, 1);
  assert.equal(failures.length, 1);
});

test("saveAllAlgoAdjustments retries transient fetch failures", async () => {
  let profileAttempts = 0;
  let strategyAttempts = 0;
  const profilePayload = { profile: { liquidityGate: { minBid: 0.03 } } };
  const strategyPayload = {
    deployment: { id: "deployment-1" },
    signalMonitorProfile: { environment: "shadow" },
  };

  const result = await saveAllAlgoAdjustments({
    deploymentId: "deployment-1",
    profileDraft: profilePayload.profile,
    strategySettingsDraft: {
      signalTimeframe: "5m",
      timeHorizon: 8,
      bosConfirmation: "candle-close",
    },
    profileDirty: true,
    strategyDirty: true,
    updateProfileMutation: {
      mutateAsync: async () => {
        profileAttempts += 1;
        if (profileAttempts === 1) {
          throw new TypeError("Failed to fetch");
        }
        return profilePayload;
      },
    },
    updateStrategySettingsMutation: {
      mutateAsync: async () => {
        strategyAttempts += 1;
        if (strategyAttempts === 1) {
          throw new TypeError("Failed to fetch");
        }
        return strategyPayload;
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(profileAttempts, 2);
  assert.equal(strategyAttempts, 2);
  assert.equal(result.profileResult, profilePayload);
  assert.equal(result.strategyResult, strategyPayload);
});

test("saveAllAlgoAdjustments does not retry non-transport failures", async () => {
  let profileAttempts = 0;

  const result = await saveAllAlgoAdjustments({
    deploymentId: "deployment-1",
    profileDraft: { liquidityGate: { minBid: 0.03 } },
    strategySettingsDraft: {},
    profileDirty: true,
    strategyDirty: false,
    updateProfileMutation: {
      mutateAsync: async () => {
        profileAttempts += 1;
        throw new Error("Deployment is not a signal-options deployment.");
      },
    },
    updateStrategySettingsMutation: {
      mutateAsync: async () => {
        throw new Error("unexpected strategy save");
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(profileAttempts, 1);
  assert.match(result.failures[0].error.message, /not a signal-options deployment/);
});

test("reconciliation does not clean or claim a profile whose save was gated off", () => {
  // Reproduces the silent-drop: the Profile section is dirty but the deployment
  // has no signal-options profile, so the Profile PATCH was skipped (profileSaved
  // false). The draft must stay dirty and the save must not claim it persisted.
  const plan = planAlgoAdjustmentsSaveReconciliation({
    profileDirty: true,
    strategyDirty: false,
    profileSaved: false,
  });

  assert.equal(plan.markProfileClean, false);
  assert.equal(plan.savedSections.length, 0);
  assert.deepEqual(plan.savedSections, []);
  assert.equal(plan.profileSkipped, true);
});

test("reconciliation cleans and reports both sections when both were saved", () => {
  const plan = planAlgoAdjustmentsSaveReconciliation({
    profileDirty: true,
    strategyDirty: true,
    profileSaved: true,
  });

  assert.equal(plan.markProfileClean, true);
  assert.equal(plan.markStrategyClean, true);
  assert.deepEqual(plan.savedSections, ["Signal", "Profile"]);
  assert.equal(plan.profileSkipped, false);
});

test("reconciliation reports only Signal when the gated-off profile is also dirty", () => {
  const plan = planAlgoAdjustmentsSaveReconciliation({
    profileDirty: true,
    strategyDirty: true,
    profileSaved: false,
  });

  assert.equal(plan.markProfileClean, false);
  assert.equal(plan.markStrategyClean, true);
  assert.deepEqual(plan.savedSections, ["Signal"]);
  assert.equal(plan.profileSkipped, true);
});
