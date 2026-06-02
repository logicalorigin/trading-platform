import assert from "node:assert/strict";
import test from "node:test";
import {
  SIGNAL_MATRIX_SNAPSHOT_CACHE_KEY,
  readSignalMatrixSnapshotCache,
  writeSignalMatrixSnapshotCache,
} from "./signalMatrixSnapshotCache.js";

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
};

const state = (patch = {}) => ({
  symbol: "spy",
  timeframe: "5m",
  currentSignalDirection: "buy",
  currentSignalAt: "2026-06-01T21:25:00.000Z",
  currentSignalPrice: 540.12,
  latestBarAt: "2026-06-01T21:25:00.000Z",
  lastEvaluatedAt: "2026-06-01T21:26:00.000Z",
  barsSinceSignal: 0,
  fresh: true,
  status: "ok",
  ...patch,
});

test("signal matrix snapshot cache round-trips sanitized recent states", () => {
  const storage = memoryStorage();
  assert.equal(
    writeSignalMatrixSnapshotCache(
      {
        states: [state(), state({ symbol: "qqq", timeframe: "1h", currentSignalDirection: "sell" })],
        timeframes: ["1m", "5m", "1h"],
        evaluatedAt: "2026-06-01T21:26:00.000Z",
      },
      { storage, nowMs: 1000 },
    ),
    true,
  );

  const snapshot = readSignalMatrixSnapshotCache({ storage, nowMs: 1000 });
  assert.equal(snapshot.cacheStatus, "warm-start");
  assert.equal(snapshot.evaluatedAt, "2026-06-01T21:26:00.000Z");
  assert.deepEqual(snapshot.timeframes, ["1m", "5m", "1h"]);
  assert.deepEqual(
    snapshot.states.map((entry) => `${entry.symbol}:${entry.timeframe}:${entry.currentSignalDirection}`),
    ["QQQ:1h:sell", "SPY:5m:buy"],
  );
});

test("signal matrix snapshot cache drops expired snapshots", () => {
  const storage = memoryStorage();
  storage.setItem(
    SIGNAL_MATRIX_SNAPSHOT_CACHE_KEY,
    JSON.stringify({
      version: 1,
      savedAt: 1000,
      timeframes: ["5m"],
      states: [state()],
    }),
  );

  assert.equal(
    readSignalMatrixSnapshotCache({
      storage,
      nowMs: 20_000,
      maxAgeMs: 5_000,
    }),
    null,
  );
  assert.equal(storage.getItem(SIGNAL_MATRIX_SNAPSHOT_CACHE_KEY), null);
});

test("signal matrix snapshot cache filters invalid states and keeps the latest key once", () => {
  const storage = memoryStorage();
  writeSignalMatrixSnapshotCache(
    {
      states: [
        state({ symbol: "", timeframe: "5m" }),
        state({ symbol: "SPY", timeframe: "4h" }),
        state({ symbol: "SPY", timeframe: "5m", currentSignalDirection: "buy" }),
        state({ symbol: "SPY", timeframe: "5m", currentSignalDirection: "sell" }),
      ],
      timeframes: ["5m"],
    },
    { storage, nowMs: 1000 },
  );

  const snapshot = readSignalMatrixSnapshotCache({ storage, nowMs: 1000 });
  assert.equal(snapshot.states.length, 1);
  assert.equal(snapshot.states[0].symbol, "SPY");
  assert.equal(snapshot.states[0].timeframe, "5m");
  assert.equal(snapshot.states[0].currentSignalDirection, "sell");
});
