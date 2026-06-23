import assert from "node:assert/strict";
import test from "node:test";

import { saveAllAlgoAdjustments } from "./saveAllAlgoAdjustments.js";

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
