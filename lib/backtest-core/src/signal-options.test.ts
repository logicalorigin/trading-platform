import assert from "node:assert/strict";
import test from "node:test";

import { resolveSignalOptionsExecutionProfile } from "./signal-options";

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

test("unset mtf requiredCount resolves to the confirmation default, not unanimity", () => {
  const profile = resolveSignalOptionsExecutionProfile({});
  // 5 default timeframes; requiredCount must NOT fall back to all 5.
  assert.equal(profile.entryGate.mtfAlignment.timeframes.length, 5);
  assert.equal(profile.entryGate.mtfAlignment.requiredCount, 2);
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
