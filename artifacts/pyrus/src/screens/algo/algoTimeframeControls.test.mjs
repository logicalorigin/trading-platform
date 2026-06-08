import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAlgoExecutionTimeframePatch,
  buildAlgoMtfTimeframeTogglePatch,
} from "./algoTimeframeControls.js";

test("algo rail execution timeframe patch accepts 2m", () => {
  assert.deepEqual(buildAlgoExecutionTimeframePatch("2m"), {
    signalTimeframe: "2m",
  });
});

test("algo rail MTF timeframe toggle marks custom and clamps required count", () => {
  assert.deepEqual(
    buildAlgoMtfTimeframeTogglePatch({
      selectedTimeframes: ["1m", "2m", "5m"],
      timeframe: "5m",
      requiredCount: 3,
    }),
    {
      timeframes: ["1m", "2m"],
      preset: "custom",
      requiredCount: 2,
    },
  );
});

test("algo rail MTF timeframe toggle keeps one selected frame", () => {
  assert.deepEqual(
    buildAlgoMtfTimeframeTogglePatch({
      selectedTimeframes: ["15m"],
      timeframe: "15m",
      requiredCount: 1,
    }),
    {
      timeframes: ["15m"],
      preset: "custom",
      requiredCount: 1,
    },
  );
});
