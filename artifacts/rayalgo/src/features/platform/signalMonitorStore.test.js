import assert from "node:assert/strict";
import test from "node:test";
import { selectPreferredSignalMonitorState } from "./signalMonitorStore.js";

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
