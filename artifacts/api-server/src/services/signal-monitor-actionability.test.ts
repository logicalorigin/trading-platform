import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalMonitorActionability,
  normalizedBarsSinceSignal,
  signalMonitorFresh,
  signalMonitorSignalAgeBlocker,
} from "./signal-monitor-actionability";

test("bars since signal normalizes to a non-negative integer or null", () => {
  assert.equal(normalizedBarsSinceSignal(null), null);
  assert.equal(normalizedBarsSinceSignal(undefined), null);
  assert.equal(normalizedBarsSinceSignal(Number.NaN), null);
  assert.equal(normalizedBarsSinceSignal(-2), 0);
  assert.equal(normalizedBarsSinceSignal(1.4), 1);
  assert.equal(normalizedBarsSinceSignal("3"), 3);
});

test("signal age blocker matches the signal-options execution window", () => {
  assert.equal(signalMonitorSignalAgeBlocker(null), "signal_age_unavailable");
  assert.equal(signalMonitorSignalAgeBlocker(0), null);
  assert.equal(signalMonitorSignalAgeBlocker(1), null);
  assert.equal(signalMonitorSignalAgeBlocker(2), "signal_too_old");
});

test("fresh requires a bar age inside the profile window and current data", () => {
  assert.equal(
    signalMonitorFresh({ barsSinceSignal: 2, freshWindowBars: 3, stale: false }),
    true,
  );
  assert.equal(
    signalMonitorFresh({ barsSinceSignal: 4, freshWindowBars: 3, stale: false }),
    false,
  );
  assert.equal(
    signalMonitorFresh({ barsSinceSignal: 2, freshWindowBars: 3, stale: true }),
    false,
  );
  assert.equal(
    signalMonitorFresh({
      barsSinceSignal: null,
      freshWindowBars: 3,
      stale: false,
    }),
    false,
  );
});

test("actionability requires a directional signal, current data, and young age", () => {
  const base = {
    direction: "buy",
    signalAt: new Date("2026-06-12T16:25:00.000Z"),
    barsSinceSignal: 1,
    stale: false,
    freshWindowBars: 3,
  };
  assert.deepEqual(buildSignalMonitorActionability(base), {
    fresh: true,
    actionEligible: true,
    actionBlocker: null,
  });
  assert.equal(
    buildSignalMonitorActionability({ ...base, direction: null }).actionBlocker,
    "no_signal",
  );
  assert.equal(
    buildSignalMonitorActionability({ ...base, stale: true }).actionBlocker,
    "data_stale",
  );
  assert.equal(
    buildSignalMonitorActionability({ ...base, barsSinceSignal: 5 })
      .actionBlocker,
    "signal_too_old",
  );
  assert.equal(
    buildSignalMonitorActionability({ ...base, barsSinceSignal: null })
      .actionBlocker,
    "signal_age_unavailable",
  );
});
