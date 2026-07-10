import assert from "node:assert/strict";
import test from "node:test";

import {
  __signalMonitorStoreTestHooks,
  getSignalMonitorSnapshotForTests,
  publishSignalMonitorSnapshot,
  resetSignalMonitorStoreForTests,
  selectPreferredSignalMonitorState,
} from "./signalMonitorStore.js";

const makeSignalState = (symbol, overrides = {}) => ({
  symbol,
  timeframe: "5m",
  currentSignalDirection: "bullish",
  currentSignalAt: "2026-06-09T14:00:00.000Z",
  currentSignalPrice: 100,
  latestBarAt: "2026-06-09T14:05:00.000Z",
  barsSinceSignal: 1,
  fresh: true,
  status: "ok",
  lastEvaluatedAt: "2026-06-09T14:05:10.000Z",
  ...overrides,
});

const publishStates = (states) => {
  publishSignalMonitorSnapshot({
    profile: { timeframe: "5m" },
    states,
    events: [],
    universe: null,
    pending: false,
  });
};

test("preferred symbol state uses backend actionability, not the fresh flag", () => {
  // Same symbol, no preferred-timeframe match: the backend-actionable state
  // wins even when the other copy claims fresh and newer activity.
  const eligible = makeSignalState("AAPL", {
    timeframe: "15m",
    fresh: false,
    actionEligible: true,
    lastEvaluatedAt: "2026-06-09T14:05:10.000Z",
  });
  const freshButIneligible = makeSignalState("AAPL", {
    timeframe: "1h",
    fresh: true,
    actionEligible: false,
    lastEvaluatedAt: "2026-06-09T14:06:10.000Z",
  });

  assert.equal(
    selectPreferredSignalMonitorState(freshButIneligible, eligible, ""),
    eligible,
  );
  assert.equal(
    selectPreferredSignalMonitorState(eligible, freshButIneligible, ""),
    eligible,
  );
});

test("degraded snapshots replace prior states and events", () => {
  resetSignalMonitorStoreForTests();
  try {
    publishStates([makeSignalState("AAPL")]);
    assert.equal(getSignalMonitorSnapshotForTests().states.length, 1);

    // Outages stay explicit; prior data must not remain as a fallback screen.
    publishSignalMonitorSnapshot({
      profile: { timeframe: "5m" },
      states: [],
      events: [],
      universe: null,
      pending: false,
      degraded: true,
    });
    const degraded = getSignalMonitorSnapshotForTests();
    assert.equal(degraded.degraded, true);
    assert.deepEqual(degraded.states, []);
    assert.deepEqual(degraded.events, []);

    // Recovery with real data replaces the outage snapshot.
    publishStates([makeSignalState("MSFT")]);
    const recovered = getSignalMonitorSnapshotForTests();
    assert.equal(recovered.degraded, false);
    assert.equal(recovered.states[0].symbol, "MSFT");
  } finally {
    resetSignalMonitorStoreForTests();
  }
});

test("signal monitor symbol versions are pruned after a symbol leaves the snapshot", () => {
  resetSignalMonitorStoreForTests();

  publishStates([makeSignalState("AAPL")]);

  assert.equal(__signalMonitorStoreTestHooks.symbolVersionCount(), 1);
  assert.equal(__signalMonitorStoreTestHooks.symbolVersion("aapl"), 1);

  publishStates([]);

  assert.equal(__signalMonitorStoreTestHooks.symbolVersion("AAPL"), 0);
  assert.equal(__signalMonitorStoreTestHooks.symbolVersionCount(), 0);
});

test("signal monitor symbol listeners still observe removal and re-entry after pruning", () => {
  resetSignalMonitorStoreForTests();
  let calls = 0;
  const unsubscribe = __signalMonitorStoreTestHooks.subscribeSymbol("msft", () => {
    calls += 1;
  });

  try {
    publishStates([makeSignalState("MSFT")]);
    assert.equal(calls, 1);
    assert.equal(__signalMonitorStoreTestHooks.symbolVersion("MSFT"), 1);

    publishStates([]);
    assert.equal(calls, 2);
    assert.equal(__signalMonitorStoreTestHooks.symbolVersion("MSFT"), 0);
    assert.equal(__signalMonitorStoreTestHooks.symbolVersionCount(), 0);

    publishStates([
      makeSignalState("MSFT", {
        currentSignalAt: "2026-06-09T14:10:00.000Z",
        latestBarAt: "2026-06-09T14:15:00.000Z",
        lastEvaluatedAt: "2026-06-09T14:15:10.000Z",
      }),
    ]);
    assert.equal(calls, 3);
    assert.equal(__signalMonitorStoreTestHooks.symbolVersion("MSFT"), 1);
  } finally {
    unsubscribe();
    resetSignalMonitorStoreForTests();
  }
});
