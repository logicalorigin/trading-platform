import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSignalOptionsExecutionProfile,
  type SignalOptionsExecutionProfile,
} from "@workspace/backtest-core";

import { __signalOptionsAutomationInternalsForTests } from "./signal-options-automation";

const mergeProfilePatch =
  __signalOptionsAutomationInternalsForTests.mergeProfilePatchForTests as (
    current: SignalOptionsExecutionProfile,
    patch: Record<string, unknown>,
  ) => SignalOptionsExecutionProfile;

const percentProfile = () =>
  resolveSignalOptionsExecutionProfile({
    riskCaps: {
      tradingAllowance: 10_000,
      maxPremiumPerEntrySetting: { unit: "percent", value: 10 },
      maxDailyLossSetting: { unit: "percent", value: 5 },
    },
  });

test("legacy numeric premium patches reset only premium to USD", () => {
  const profile = mergeProfilePatch(percentProfile(), {
    riskCaps: { maxPremiumPerEntry: 750 },
  });

  assert.deepEqual(profile.riskCaps.maxPremiumPerEntrySetting, {
    unit: "usd",
    value: 750,
  });
  assert.equal(profile.riskCaps.maxPremiumPerEntry, 750);
  assert.deepEqual(profile.riskCaps.maxDailyLossSetting, {
    unit: "percent",
    value: 5,
  });
  assert.equal(profile.riskCaps.maxDailyLoss, 500);
});

test("legacy numeric daily-loss patches reset only daily loss to USD", () => {
  const profile = mergeProfilePatch(percentProfile(), {
    riskCaps: { maxDailyLoss: 1_250 },
  });

  assert.deepEqual(profile.riskCaps.maxPremiumPerEntrySetting, {
    unit: "percent",
    value: 10,
  });
  assert.equal(profile.riskCaps.maxPremiumPerEntry, 1_000);
  assert.deepEqual(profile.riskCaps.maxDailyLossSetting, {
    unit: "usd",
    value: 1_250,
  });
  assert.equal(profile.riskCaps.maxDailyLoss, 1_250);
});

test("an explicit amount setting remains authoritative over compatibility dollars", () => {
  const profile = mergeProfilePatch(percentProfile(), {
    riskCaps: {
      maxPremiumPerEntrySetting: { unit: "percent", value: 12.5 },
      maxPremiumPerEntry: 1,
    },
  });

  assert.deepEqual(profile.riskCaps.maxPremiumPerEntrySetting, {
    unit: "percent",
    value: 12.5,
  });
  assert.equal(profile.riskCaps.maxPremiumPerEntry, 1_250);
});
