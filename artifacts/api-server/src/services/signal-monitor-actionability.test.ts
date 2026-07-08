import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_MONITOR_BLOCK_PRIOR_SESSION_ENTRIES,
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
  // Window widened to 8 bars to survive signal emission latency (~2.7-bar median).
  assert.equal(signalMonitorSignalAgeBlocker(8), null);
  assert.equal(signalMonitorSignalAgeBlocker(9), "signal_too_old");
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
    buildSignalMonitorActionability({
      ...base,
      stale: true,
      staleBlocker: "market_idle",
    }).actionBlocker,
    "market_idle",
  );
  assert.equal(
    buildSignalMonitorActionability({ ...base, barsSinceSignal: 9 })
      .actionBlocker,
    "signal_too_old",
  );
  assert.equal(
    buildSignalMonitorActionability({ ...base, barsSinceSignal: null })
      .actionBlocker,
    "signal_age_unavailable",
  );
});

test("marketClosed outranks stale and age blockers, but not no_signal", () => {
  const base = {
    direction: "buy",
    signalAt: new Date("2026-06-12T16:25:00.000Z"),
    barsSinceSignal: 1,
    stale: false,
    freshWindowBars: 3,
  };
  assert.equal(
    buildSignalMonitorActionability({ ...base, marketClosed: true })
      .actionBlocker,
    "market_closed",
  );
  assert.equal(
    buildSignalMonitorActionability({ ...base, marketClosed: true })
      .actionEligible,
    false,
  );
  assert.equal(
    buildSignalMonitorActionability({
      ...base,
      marketClosed: true,
      barsSinceSignal: 9,
    }).actionBlocker,
    "market_closed",
  );
  assert.equal(
    buildSignalMonitorActionability({
      ...base,
      marketClosed: true,
      stale: true,
    }).actionBlocker,
    "market_closed",
  );
  assert.equal(
    buildSignalMonitorActionability({
      ...base,
      marketClosed: true,
      direction: null,
    }).actionBlocker,
    "no_signal",
  );
  assert.deepEqual(buildSignalMonitorActionability(base), {
    fresh: true,
    actionEligible: true,
    actionBlocker: null,
  });
});

test("marketClosed labels expired live-session entries separately", () => {
  const base = {
    direction: "buy",
    signalAt: new Date("2026-06-12T16:25:00.000Z"),
    barsSinceSignal: 1,
    stale: false,
    freshWindowBars: 3,
    marketClosed: true,
  };
  assert.deepEqual(
    buildSignalMonitorActionability({
      ...base,
      signalFiredWhileMarketClosed: false,
    }),
    {
      fresh: true,
      actionEligible: false,
      actionBlocker: "entry_window_expired",
    },
  );
  assert.equal(
    buildSignalMonitorActionability(base).actionBlocker,
    "market_closed",
  );
  assert.equal(
    buildSignalMonitorActionability({
      ...base,
      signalFiredWhileMarketClosed: true,
    }).actionBlocker,
    "market_closed",
  );
});

test("prior-session signal is blocked intra-session; same-session signal stays eligible", () => {
  // 2026-06-12 is EDT (UTC-4), so the 9:30 ET regular open is 13:30 UTC.
  const sessionOpenAt = new Date("2026-06-12T13:30:00.000Z");
  const base = {
    direction: "buy",
    signalAt: new Date("2026-06-12T16:25:00.000Z"), // after today's open
    barsSinceSignal: 1,
    stale: false,
    freshWindowBars: 3,
    sessionOpenAt,
  };
  // Same-session crossover (after the open) is unaffected by the block.
  assert.equal(buildSignalMonitorActionability(base).actionBlocker, null);
  // A crossover from before today's open is a prior-session entry.
  const priorSession = { ...base, signalAt: new Date("2026-06-11T18:00:00.000Z") };
  assert.equal(
    buildSignalMonitorActionability(priorSession).actionBlocker,
    "prior_session_signal",
  );
  // Precedence: prior-session outranks both stale and age (fires after
  // market_closed, before stale/age).
  assert.equal(
    buildSignalMonitorActionability({ ...priorSession, stale: true })
      .actionBlocker,
    "prior_session_signal",
  );
  assert.equal(
    buildSignalMonitorActionability({ ...priorSession, barsSinceSignal: 99 })
      .actionBlocker,
    "prior_session_signal",
  );
});

test("market_closed and no_signal outrank the prior-session block", () => {
  const sessionOpenAt = new Date("2026-06-12T13:30:00.000Z");
  const priorSession = {
    direction: "buy",
    signalAt: new Date("2026-06-11T18:00:00.000Z"),
    barsSinceSignal: 1,
    stale: false,
    freshWindowBars: 3,
    sessionOpenAt,
  };
  assert.equal(
    buildSignalMonitorActionability({ ...priorSession, marketClosed: true })
      .actionBlocker,
    "market_closed",
  );
  assert.equal(
    buildSignalMonitorActionability({ ...priorSession, direction: null })
      .actionBlocker,
    "no_signal",
  );
});

test("prior-session block is gated by the constant and off when no session is open", () => {
  // The block's only trigger is `SIGNAL_MONITOR_BLOCK_PRIOR_SESSION_ENTRIES && …`,
  // so flipping this constant to false removes the behavior in one line. It
  // ships true (provisional 2026-07-07). A const can't be reassigned at
  // runtime, so the disabled (false) path is the same short-circuit as the
  // null-sessionOpenAt case below: no block.
  assert.equal(SIGNAL_MONITOR_BLOCK_PRIOR_SESSION_ENTRIES, true);
  const base = {
    direction: "buy",
    signalAt: new Date("2026-06-11T18:00:00.000Z"),
    barsSinceSignal: 1,
    stale: false,
    freshWindowBars: 3,
  };
  // Callers pass null when the market is closed/idle — no session open known,
  // so an old crossover is not treated as a prior-session entry here.
  assert.equal(
    buildSignalMonitorActionability({ ...base, sessionOpenAt: null })
      .actionBlocker,
    null,
  );
  // Omitting sessionOpenAt entirely is likewise unchanged behavior.
  assert.equal(buildSignalMonitorActionability(base).actionBlocker, null);
});
