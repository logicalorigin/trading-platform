import assert from "node:assert/strict";
import test from "node:test";

import { SIGNAL_OPTIONS_DEFAULT_PROFILE } from "./algoHelpers.js";

// Snapshot of tunedSignalOptionsExecutionProfilePatch in
// lib/backtest-core/src/signal-options.ts. Pyrus does not depend on
// @workspace/backtest-core, so keep this guard local and explicit.
const BACKEND_TUNED_EXIT_POLICY = {
  hardStopPct: -30,
  trailActivationPct: 35,
  minLockedGainPct: 15,
  trailGivebackPct: 20,
  progressiveTrailEnabled: true,
  progressiveTrailSteps: [
    { activationPct: 20, minLockedGainPct: 0, givebackPct: 30 },
    { activationPct: 30, minLockedGainPct: 15, givebackPct: 25 },
    { activationPct: 45, minLockedGainPct: 25, givebackPct: 20 },
    { activationPct: 65, minLockedGainPct: 40, givebackPct: 20 },
    { activationPct: 100, minLockedGainPct: 60, givebackPct: 15 },
  ],
  wireGreekTrailEnabled: true,
  wireGreekTrailGreekMaxAgeMs: 45_000,
};

const BACKEND_TUNED_RISK_CAPS = {
  maxPremiumPerEntry: 1_500,
};

test("UI signal-options default matches backend tuned exit-policy values", () => {
  assert.deepEqual(
    {
      hardStopPct: SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.hardStopPct,
      trailActivationPct:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.trailActivationPct,
      minLockedGainPct: SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.minLockedGainPct,
      trailGivebackPct:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.trailGivebackPct,
      progressiveTrailEnabled:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.progressiveTrailEnabled,
      progressiveTrailSteps:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.progressiveTrailSteps,
      wireGreekTrailEnabled:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.wireGreekTrail.enabled,
      wireGreekTrailGreekMaxAgeMs:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.wireGreekTrail.greekMaxAgeMs,
    },
    BACKEND_TUNED_EXIT_POLICY,
  );
  assert.equal(
    SIGNAL_OPTIONS_DEFAULT_PROFILE.riskCaps.maxPremiumPerEntry,
    BACKEND_TUNED_RISK_CAPS.maxPremiumPerEntry,
  );
});
