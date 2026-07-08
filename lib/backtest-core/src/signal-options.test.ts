import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSignalOptionsExecutionProfile,
  tunedSignalOptionsExecutionProfile,
  tunedSignalOptionsExecutionProfilePatch,
} from "./signal-options";

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
  // 5 default timeframes; an unset requiredCount defaults to full alignment (all 5)
  // per the 2026-07-08 owner decision. The panel dial can lower it to n-of-N.
  assert.equal(profile.entryGate.mtfAlignment.timeframes.length, 5);
  assert.equal(profile.entryGate.mtfAlignment.requiredCount, 5);
});

test("stored mtf requiredCount is preserved and clamped to the timeframe count", () => {
  const stored = resolveSignalOptionsExecutionProfile({
    entryGate: {
      mtfAlignment: { requiredCount: 3, timeframes: ["5m", "15m", "1h"] },
    },
  });
  assert.equal(stored.entryGate.mtfAlignment.requiredCount, 3);

  const clamped = resolveSignalOptionsExecutionProfile({
    entryGate: {
      mtfAlignment: { requiredCount: 9, timeframes: ["5m", "15m"] },
    },
  });
  assert.equal(clamped.entryGate.mtfAlignment.requiredCount, 2);
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
