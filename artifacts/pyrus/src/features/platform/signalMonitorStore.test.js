import assert from "node:assert/strict";
import test from "node:test";
import {
  getSignalMonitorSnapshotForTests,
  getSignalMonitorSnapshotVersionForTests,
  publishSignalMonitorSnapshot,
  resetSignalMonitorStoreForTests,
  selectPreferredSignalMonitorState,
  subscribeToSignalMonitorSnapshotForTests,
} from "./signalMonitorStore.js";

test("signal monitor store prefers the profile timeframe over stale duplicate rows", () => {
  const staleOneMinute = {
    symbol: "SPY",
    timeframe: "1m",
    currentSignalDirection: "sell",
    fresh: true,
    lastEvaluatedAt: "2026-05-19T19:13:01.149Z",
  };
  const currentFiveMinute = {
    symbol: "SPY",
    timeframe: "5m",
    currentSignalDirection: "buy",
    fresh: false,
    lastEvaluatedAt: "2026-05-21T14:20:13.244Z",
  };

  const selected = [staleOneMinute, currentFiveMinute].reduce(
    (current, state) =>
      selectPreferredSignalMonitorState(current, state, "5m"),
    null,
  );

  assert.equal(selected, currentFiveMinute);
});

test("signal monitor store keeps the freshest state when timeframe is unchanged", () => {
  const oldState = {
    symbol: "QQQ",
    timeframe: "5m",
    fresh: false,
    lastEvaluatedAt: "2026-05-21T14:00:00.000Z",
  };
  const newState = {
    symbol: "QQQ",
    timeframe: "5m",
    fresh: false,
    lastEvaluatedAt: "2026-05-21T14:20:00.000Z",
  };

  assert.equal(
    selectPreferredSignalMonitorState(oldState, newState, "5m"),
    newState,
  );
});

test("signal monitor store does not notify global subscribers for identical snapshots", () => {
  resetSignalMonitorStoreForTests();
  let notifications = 0;
  const unsubscribe = subscribeToSignalMonitorSnapshotForTests(() => {
    notifications += 1;
  });
  const baseSnapshot = {
    profile: { timeframe: "5m", maxSymbols: 500 },
    states: [
      {
        symbol: "SPY",
        timeframe: "5m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-04T15:00:00.000Z",
        currentSignalPrice: 532.12,
        latestBarAt: "2026-06-04T15:05:00.000Z",
        barsSinceSignal: 1,
        fresh: true,
        status: "ready",
        lastEvaluatedAt: "2026-06-04T15:05:01.000Z",
      },
    ],
    events: [{ id: "evt-1", symbol: "SPY", type: "signal" }],
    universe: { size: 500, source: "high-beta" },
    pending: false,
    degraded: false,
  };

  publishSignalMonitorSnapshot(baseSnapshot);
  assert.equal(notifications, 1);
  const versionAfterFirstPublish = getSignalMonitorSnapshotVersionForTests();

  publishSignalMonitorSnapshot({
    profile: { timeframe: "5m", maxSymbols: 500 },
    states: baseSnapshot.states.map((state) => ({ ...state })),
    events: baseSnapshot.events.map((event) => ({ ...event })),
    universe: { size: 500, source: "high-beta" },
    pending: false,
    degraded: false,
  });

  assert.equal(getSignalMonitorSnapshotVersionForTests(), versionAfterFirstPublish);
  assert.equal(notifications, 1);
  assert.equal(getSignalMonitorSnapshotForTests().states.length, 1);
  unsubscribe();
});

test("signal monitor store notifies when normalized signal state changes", () => {
  resetSignalMonitorStoreForTests();
  let notifications = 0;
  const unsubscribe = subscribeToSignalMonitorSnapshotForTests(() => {
    notifications += 1;
  });

  publishSignalMonitorSnapshot({
    profile: { timeframe: "5m" },
    states: [
      {
        symbol: "QQQ",
        timeframe: "5m",
        currentSignalDirection: "sell",
        latestBarAt: "2026-06-04T15:05:00.000Z",
        lastEvaluatedAt: "2026-06-04T15:05:01.000Z",
      },
    ],
  });
  const firstVersion = getSignalMonitorSnapshotVersionForTests();

  publishSignalMonitorSnapshot({
    profile: { timeframe: "5m" },
    states: [
      {
        symbol: "QQQ",
        timeframe: "5m",
        currentSignalDirection: "buy",
        latestBarAt: "2026-06-04T15:10:00.000Z",
        lastEvaluatedAt: "2026-06-04T15:10:01.000Z",
      },
    ],
  });

  assert.equal(getSignalMonitorSnapshotVersionForTests(), firstVersion + 1);
  assert.equal(notifications, 2);
  unsubscribe();
});

test("signal monitor store preserves degraded state data without republishing identical degraded snapshots", () => {
  resetSignalMonitorStoreForTests();
  let notifications = 0;
  const unsubscribe = subscribeToSignalMonitorSnapshotForTests(() => {
    notifications += 1;
  });

  publishSignalMonitorSnapshot({
    profile: { timeframe: "5m" },
    states: [
      {
        symbol: "IWM",
        timeframe: "5m",
        currentSignalDirection: "buy",
        latestBarAt: "2026-06-04T15:05:00.000Z",
        lastEvaluatedAt: "2026-06-04T15:05:01.000Z",
      },
    ],
    events: [{ id: "evt-iwm" }],
  });

  publishSignalMonitorSnapshot({
    profile: { timeframe: "5m" },
    states: [],
    events: [],
    degraded: true,
  });
  const degradedVersion = getSignalMonitorSnapshotVersionForTests();

  assert.equal(getSignalMonitorSnapshotForTests().degraded, true);
  assert.equal(getSignalMonitorSnapshotForTests().states.length, 1);
  assert.equal(getSignalMonitorSnapshotForTests().events.length, 1);
  assert.equal(notifications, 2);

  publishSignalMonitorSnapshot({
    profile: { timeframe: "5m" },
    states: [],
    events: [],
    degraded: true,
  });

  assert.equal(getSignalMonitorSnapshotVersionForTests(), degradedVersion);
  assert.equal(notifications, 2);
  unsubscribe();
});
