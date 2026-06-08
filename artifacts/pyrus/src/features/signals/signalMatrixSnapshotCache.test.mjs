import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_MATRIX_SNAPSHOT_CACHE_KEY,
  readSignalMatrixSnapshotCache,
  writeSignalMatrixSnapshotCache,
} from "./signalMatrixSnapshotCache.js";

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
};

const matrixState = (overrides = {}) => ({
  id: "state-aapl-5m",
  symbol: "aapl",
  timeframe: "5m",
  currentSignalDirection: "buy",
  currentSignalAt: "2026-06-05T14:30:00.000Z",
  currentSignalPrice: 200.25,
  latestBarAt: "2026-06-05T14:35:00.000Z",
  barsSinceSignal: 1,
  fresh: true,
  status: "ok",
  active: true,
  lastEvaluatedAt: "2026-06-05T14:35:00.000Z",
  lastError: null,
  ...overrides,
});

test("signal matrix snapshot cache preserves fresh warm-start states inside the fresh window", () => {
  const storage = createStorage();
  const nowMs = Date.parse("2026-06-05T14:40:00.000Z");

  assert.equal(
    writeSignalMatrixSnapshotCache(
      {
        states: [matrixState()],
        evaluatedAt: "2026-06-05T14:35:00.000Z",
        timeframes: ["5m"],
      },
      { storage, nowMs, timeframes: ["5m"] },
    ),
    true,
  );

  const cached = readSignalMatrixSnapshotCache({
    storage,
    nowMs: nowMs + 5 * 60_000,
    timeframes: ["5m"],
  });

  assert.equal(cached.cacheStatus, "warm-start");
  assert.equal(cached.states.length, 1);
  assert.equal(cached.states[0].symbol, "AAPL");
  assert.equal(cached.states[0].status, "ok");
  assert.equal(cached.states[0].fresh, true);
});

test("signal matrix snapshot cache marks retained warm-start states aged after the fresh window", () => {
  const storage = createStorage();
  const nowMs = Date.parse("2026-06-05T14:40:00.000Z");

  writeSignalMatrixSnapshotCache(
    {
      states: [matrixState()],
      evaluatedAt: "2026-06-05T14:35:00.000Z",
      timeframes: ["5m"],
    },
    { storage, nowMs, timeframes: ["5m"] },
  );

  const cached = readSignalMatrixSnapshotCache({
    storage,
    nowMs: nowMs + 20 * 60_000,
    timeframes: ["5m"],
  });

  assert.equal(cached.cacheStatus, "warm-start-stale");
  assert.equal(cached.states.length, 1);
  assert.equal(cached.states[0].status, "ok");
  assert.equal(cached.states[0].fresh, false);
  assert.equal(cached.states[0].currentSignalDirection, "buy");
});

test("signal matrix snapshot cache ignores states without signal or bar timestamps", () => {
  const storage = createStorage();
  const nowMs = Date.parse("2026-06-05T14:40:00.000Z");

  assert.equal(
    writeSignalMatrixSnapshotCache(
      {
        states: [
          matrixState({
            currentSignalAt: null,
            latestBarAt: null,
            status: "pending",
          }),
        ],
        timeframes: ["5m"],
      },
      { storage, nowMs, timeframes: ["5m"] },
    ),
    false,
  );
  assert.equal(storage.getItem(SIGNAL_MATRIX_SNAPSHOT_CACHE_KEY), null);
});
