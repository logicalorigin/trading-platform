import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSignalOptionsExecutionProfile,
  tunedSignalOptionsExecutionProfile,
  tunedSignalOptionsExecutionProfilePatch,
} from "./signal-options";

test("entry cutoff defaults to the final 15 minutes and remains configurable", () => {
  assert.equal(
    resolveSignalOptionsExecutionProfile({}).entryGate
      .entryCutoffMinutesBeforeClose,
    15,
  );
  assert.equal(
    resolveSignalOptionsExecutionProfile({
      entryGate: { entryCutoffMinutesBeforeClose: 30 },
    }).entryGate.entryCutoffMinutesBeforeClose,
    30,
  );
});

test("regular-stop confirmation timing defaults safely and remains configurable", () => {
  const defaults = resolveSignalOptionsExecutionProfile({});
  assert.equal(defaults.exitPolicy.stopConfirmationWindowMs, 10_000);
  assert.equal(defaults.exitPolicy.stopConfirmationMaxQuoteAgeMs, 10_000);

  const configured = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      stopConfirmationWindowMs: 20_000,
      stopConfirmationMaxQuoteAgeMs: 5_000,
    },
  });
  assert.equal(configured.exitPolicy.stopConfirmationWindowMs, 20_000);
  assert.equal(configured.exitPolicy.stopConfirmationMaxQuoteAgeMs, 5_000);
});

test("honors the panel's MTF gate toggle; liquidity gates stay always-on", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    entryGate: {
      mtfAlignment: {
        enabled: false,
      },
    },
    liquidityGate: {
      requireBidAsk: false,
      requireFreshQuote: false,
    },
  });

  // The control panel exposes entryGate.mtfAlignment.enabled and is
  // authoritative — a stored false is user intent, not stale data.
  assert.equal(profile.entryGate.mtfAlignment.enabled, false);
  assert.equal(profile.liquidityGate.requireBidAsk, true);
  assert.equal(profile.liquidityGate.requireFreshQuote, true);
});

test("mtf enabled defaults on when unset", () => {
  const profile = resolveSignalOptionsExecutionProfile({});
  assert.equal(profile.entryGate.mtfAlignment.enabled, true);
});

test("unset mtf requiredCount defaults to full alignment over the selected frames", () => {
  const profile = resolveSignalOptionsExecutionProfile({});
  // 5 default timeframes; requiredCount is derived as all 5.
  assert.equal(profile.entryGate.mtfAlignment.timeframes.length, 5);
  assert.equal(profile.entryGate.mtfAlignment.requiredCount, 5);
});

test("persisted stale mtf requiredCount normalizes to the selected timeframe count", () => {
  const available = ["1m", "2m", "5m", "15m", "1h"];
  for (let count = 1; count <= available.length; count += 1) {
    const profile = resolveSignalOptionsExecutionProfile({
      entryGate: {
        mtfAlignment: {
          requiredCount: 1,
          timeframes: available.slice(0, count),
        },
      },
    });
    assert.equal(profile.entryGate.mtfAlignment.requiredCount, count);
  }
});

test("does not force unrelated boolean knobs on", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      flipOnOppositeSignal: false,
    },
  });

  assert.equal(profile.exitPolicy.flipOnOppositeSignal, false);
});

test("defaults wire greek freshness above the runner poll cadence", () => {
  const profile = resolveSignalOptionsExecutionProfile({});

  assert.equal(profile.exitPolicy.wireGreekTrail.greekMaxAgeMs, 45_000);
});

test("base profile keeps conditional quality exits off while resolving overnight giveback knobs", () => {
  const profile = resolveSignalOptionsExecutionProfile({});

  assert.equal(profile.exitPolicy.conditionalQualityExitsEnabled, false);
  assert.equal(profile.exitPolicy.overnightRunnerGivebackPct, 15);
  assert.equal(profile.exitPolicy.highQualityOvernightRunnerGivebackPct, 25);
});

test("overnight minimum-gain exits default off and remain an explicit opt-in", () => {
  assert.equal(
    resolveSignalOptionsExecutionProfile({}).exitPolicy
      .overnightMinGainExitEnabled,
    false,
  );
  assert.equal(
    resolveSignalOptionsExecutionProfile({
      exitPolicy: { overnightMinGainExitEnabled: true },
    }).exitPolicy.overnightMinGainExitEnabled,
    true,
  );
});

test("tuned profile enables P3 quality exits and carries the wider overnight runner giveback", () => {
  const resolvedPatch = resolveSignalOptionsExecutionProfile(
    tunedSignalOptionsExecutionProfilePatch,
  );

  assert.equal(resolvedPatch.exitPolicy.conditionalQualityExitsEnabled, true);
  assert.equal(
    tunedSignalOptionsExecutionProfile.exitPolicy.conditionalQualityExitsEnabled,
    true,
  );
  assert.equal(resolvedPatch.exitPolicy.overnightRunnerGivebackPct, 15);
  assert.equal(resolvedPatch.exitPolicy.highQualityOvernightRunnerGivebackPct, 25);
});

test("tuned numeric premium patches reset an existing percent unit to USD", () => {
  const current = resolveSignalOptionsExecutionProfile({
    riskCaps: {
      tradingAllowance: 10_000,
      maxPremiumPerEntrySetting: {
        unit: "percent",
        value: 20,
      },
    },
  });
  const profile = resolveSignalOptionsExecutionProfile({
    riskCaps: {
      ...current.riskCaps,
      ...tunedSignalOptionsExecutionProfilePatch.riskCaps,
    },
  });

  assert.deepEqual(profile.riskCaps.maxPremiumPerEntrySetting, {
    unit: "usd",
    value: 1_500,
  });
  assert.equal(profile.riskCaps.maxPremiumPerEntry, 1_500);
});

test("scaleOut config defaults off and survives deployment-config normalization", () => {
  const defaults = resolveSignalOptionsExecutionProfile({});
  assert.deepEqual(defaults.exitPolicy.scaleOut, {
    enabled: false,
    sellFractionPct: 60,
    runnerGivebackPct: 30,
  });

  const profile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      scaleOut: {
        enabled: true,
        sellFractionPct: 75,
        runnerGivebackPct: 35,
      },
    },
  });

  assert.deepEqual(profile.exitPolicy.scaleOut, {
    enabled: true,
    sellFractionPct: 75,
    runnerGivebackPct: 35,
  });
});

test("non-numeric progressive-trail values cannot become executable zeroes", () => {
  for (const invalid of [null, "", "   ", false, true, [], [0]]) {
    const profile = resolveSignalOptionsExecutionProfile({
      exitPolicy: {
        progressiveTrailEnabled: true,
        progressiveTrailSteps: [
          {
            activationPct: invalid,
            minLockedGainPct: invalid,
            givebackPct: invalid,
          },
        ],
      },
    });

    assert.deepEqual(profile.exitPolicy.progressiveTrailSteps, []);
  }
});

test("non-numeric strike slots fall back instead of selecting slot zero", () => {
  for (const invalid of [null, "", "   ", false, true, [], [0]]) {
    const profile = resolveSignalOptionsExecutionProfile({
      optionSelection: {
        callStrikeSlots: [invalid],
        putStrikeSlots: [invalid],
      },
    });

    assert.deepEqual(profile.optionSelection.callStrikeSlots, [3]);
    assert.deepEqual(profile.optionSelection.putStrikeSlots, [2]);
  }

  const numericStrings = resolveSignalOptionsExecutionProfile({
    optionSelection: {
      callStrikeSlots: ["2"],
      putStrikeSlots: ["1"],
    },
  });
  assert.deepEqual(numericStrings.optionSelection.callStrikeSlots, [2]);
  assert.deepEqual(numericStrings.optionSelection.putStrikeSlots, [1]);
});

test("non-numeric chase steps fall back instead of becoming executable fractions", () => {
  const fallback = resolveSignalOptionsExecutionProfile({}).fillPolicy
    .chaseSteps;

  for (const invalid of [null, "", "   ", false, true, [], [0]]) {
    const profile = resolveSignalOptionsExecutionProfile({
      fillPolicy: { chaseSteps: [invalid] },
    });

    assert.deepEqual(profile.fillPolicy.chaseSteps, fallback);
  }

  assert.deepEqual(
    resolveSignalOptionsExecutionProfile({
      fillPolicy: { chaseSteps: ["0.25", "1"] },
    }).fillPolicy.chaseSteps,
    [0.25, 1],
  );
});

test("oppositeSignalDualConfirm config defaults off and normalizes nested/root keys", () => {
  const defaults = resolveSignalOptionsExecutionProfile({});
  assert.deepEqual(defaults.exitPolicy.oppositeSignalDualConfirm, {
    enabled: false,
    firstBarSellFractionPct: 50,
  });

  const nested = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      oppositeSignalDualConfirm: {
        enabled: true,
        firstBarSellFractionPct: 75,
      },
    },
  });
  assert.deepEqual(nested.exitPolicy.oppositeSignalDualConfirm, {
    enabled: true,
    firstBarSellFractionPct: 75,
  });

  const root = resolveSignalOptionsExecutionProfile({
    oppositeSignalDualConfirmEnabled: true,
    oppositeSignalDualConfirmFirstBarSellFractionPct: 25,
  });
  assert.deepEqual(root.exitPolicy.oppositeSignalDualConfirm, {
    enabled: true,
    firstBarSellFractionPct: 25,
  });
});

test("reEntryWatch config defaults off and normalizes nested/root keys", () => {
  const defaults = resolveSignalOptionsExecutionProfile({});
  assert.deepEqual(defaults.exitPolicy.reEntryWatch, {
    enabled: false,
    watchWindowBars: 6,
    maxReEntriesPerSignal: 1,
  });

  const nested = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      reEntryWatch: {
        enabled: true,
        watchWindowBars: 8,
        maxReEntriesPerSignal: 2,
      },
    },
  });
  assert.deepEqual(nested.exitPolicy.reEntryWatch, {
    enabled: true,
    watchWindowBars: 8,
    maxReEntriesPerSignal: 2,
  });

  const root = resolveSignalOptionsExecutionProfile({
    reEntryWatchEnabled: true,
    reEntryWatchWindowBars: 4,
    reEntryWatchMaxReEntriesPerSignal: 3,
  });
  assert.deepEqual(root.exitPolicy.reEntryWatch, {
    enabled: true,
    watchWindowBars: 4,
    maxReEntriesPerSignal: 3,
  });
});

test("legacy numeric risk caps migrate to authoritative USD settings", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    riskCaps: {
      maxPremiumPerEntry: 725.5,
      maxDailyLoss: 1_250.75,
    },
  });

  assert.deepEqual(profile.riskCaps.maxPremiumPerEntrySetting, {
    unit: "usd",
    value: 725.5,
  });
  assert.equal(profile.riskCaps.maxPremiumPerEntry, 725.5);
  assert.deepEqual(profile.riskCaps.maxDailyLossSetting, {
    unit: "usd",
    value: 1_250.75,
  });
  assert.equal(profile.riskCaps.maxDailyLoss, 1_250.75);
});

test("percent risk caps derive effective USD from the configured trading allowance", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    riskCaps: {
      tradingAllowance: 12_345.67,
      maxPremiumPerEntry: 1,
      maxPremiumPerEntrySetting: {
        unit: "percent",
        value: 12.345,
      },
      maxDailyLoss: 1,
      maxDailyLossSetting: {
        unit: "percent",
        value: 2.5,
      },
    },
  });

  assert.deepEqual(profile.riskCaps.maxPremiumPerEntrySetting, {
    unit: "percent",
    value: 12.345,
  });
  assert.equal(profile.riskCaps.maxPremiumPerEntry, 1_524.07);
  assert.deepEqual(profile.riskCaps.maxDailyLossSetting, {
    unit: "percent",
    value: 2.5,
  });
  assert.equal(profile.riskCaps.maxDailyLoss, 308.64);
});

test("risk amount settings clamp percentages and fall back invalid units to USD", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    riskCaps: {
      tradingAllowance: 1_000,
      maxPremiumPerEntrySetting: {
        unit: "percent",
        value: 125,
      },
      maxDailyLossSetting: {
        unit: "basis_points",
        value: 275.5,
      },
    },
  });

  assert.deepEqual(profile.riskCaps.maxPremiumPerEntrySetting, {
    unit: "percent",
    value: 100,
  });
  assert.equal(profile.riskCaps.maxPremiumPerEntry, 1_000);
  assert.deepEqual(profile.riskCaps.maxDailyLossSetting, {
    unit: "usd",
    value: 275.5,
  });
  assert.equal(profile.riskCaps.maxDailyLoss, 275.5);
});

test("risk amount normalization is idempotent", () => {
  const once = resolveSignalOptionsExecutionProfile({
    riskCaps: {
      tradingAllowance: 3_333.33,
      maxPremiumPerEntrySetting: {
        unit: "percent",
        value: 7.25,
      },
      maxDailyLossSetting: {
        unit: "usd",
        value: 600,
      },
    },
  });

  assert.deepEqual(once.riskCaps.maxPremiumPerEntrySetting, {
    unit: "percent",
    value: 7.25,
  });
  assert.deepEqual(
    resolveSignalOptionsExecutionProfile(once).riskCaps,
    once.riskCaps,
  );
});
