import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultConservativeOptionFillPolicy,
  type StudyDefinition,
} from "@workspace/backtest-core";

import { resolveWorkerOptionFillPolicy } from "./option-fill-policy";
import { resolveWorkerSignalOptionsProfile } from "./signal-options-profile";

const study = (
  parameters: Record<string, string | number | boolean>,
): StudyDefinition => ({
  strategyId: "pyrus_signals",
  strategyVersion: "1.0.0",
  symbols: ["SPY"],
  timeframe: "5m",
  from: new Date("2026-01-01T00:00:00.000Z"),
  to: new Date("2026-01-31T23:59:59.000Z"),
  parameters: {
    executionMode: "signal_options",
    ...parameters,
  },
  executionProfile: {
    commissionBps: 0,
    slippageBps: 0,
  },
  portfolioRules: {
    initialCapital: 100_000,
    positionSizePercent: 10,
    maxConcurrentPositions: 3,
    maxGrossExposurePercent: 100,
  },
});

test("uses a linked deployment signal-options profile as the base", () => {
  const profile = resolveWorkerSignalOptionsProfile(study({}), {
    signalOptions: {
      riskCaps: {
        maxPremiumPerEntry: 1_500,
      },
      exitPolicy: {
        hardStopPct: -22,
        trailActivationPct: 35,
        minLockedGainPct: 15,
        trailGivebackPct: 20,
        progressiveTrailEnabled: true,
      },
    },
  });

  assert.ok(profile);
  assert.equal(profile.exitPolicy.hardStopPct, -22);
  assert.equal(profile.exitPolicy.trailActivationPct, 35);
  assert.equal(profile.exitPolicy.trailGivebackPct, 20);
  assert.equal(profile.exitPolicy.progressiveTrailEnabled, true);
  assert.equal(profile.riskCaps.maxPremiumPerEntry, 1_500);
});

test("study signal-options parameters override the deployment profile", () => {
  const profile = resolveWorkerSignalOptionsProfile(
    study({
      signalOptionsMaxPremium: 750,
      signalOptionsMaxOpenSymbols: 4,
    }),
    {
      signalOptions: {
        riskCaps: {
          maxPremiumPerEntry: 1_500,
          maxOpenSymbols: 10,
        },
        exitPolicy: {
          hardStopPct: -30,
        },
      },
    },
  );

  assert.ok(profile);
  assert.equal(profile.riskCaps.maxPremiumPerEntry, 750);
  assert.equal(profile.riskCaps.maxOpenSymbols, 4);
  assert.equal(profile.exitPolicy.hardStopPct, -30);
});

test("falls back to conservative defaults without a linked deployment", () => {
  const profile = resolveWorkerSignalOptionsProfile(study({}));

  assert.ok(profile);
  assert.equal(profile.exitPolicy.hardStopPct, -40);
  assert.equal(profile.exitPolicy.progressiveTrailEnabled, false);
  assert.equal(profile.riskCaps.maxPremiumPerEntry, 500);
});

test("conservative fill limits cannot be disabled by non-positive overrides", () => {
  for (const value of [0, -1]) {
    const policy = resolveWorkerOptionFillPolicy({
      optionFillModel: "conservative_quote",
      optionFillMaxSpreadPct: value,
      optionFillMaxQuoteAgeMs: value,
    });
    assert.equal(
      policy?.maxSpreadPctOfMid,
      defaultConservativeOptionFillPolicy.maxSpreadPctOfMid,
    );
    assert.equal(
      policy?.maxQuoteAgeMs,
      defaultConservativeOptionFillPolicy.maxQuoteAgeMs,
    );
  }
});
