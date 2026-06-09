import assert from "node:assert/strict";
import test from "node:test";

import {
  __signalMonitorStoreTestHooks,
  publishSignalMonitorSnapshot,
  resetSignalMonitorStoreForTests,
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
