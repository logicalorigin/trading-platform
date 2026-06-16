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

test("algo rail MTF removing a frame lowers required count to the selection", () => {
  assert.deepEqual(
    buildAlgoMtfTimeframeTogglePatch({
      selectedTimeframes: ["1m", "2m", "5m"],
      timeframe: "5m",
    }),
    {
      timeframes: ["1m", "2m"],
      preset: "custom",
      requiredCount: 2,
    },
  );
});

test("algo rail MTF adding a frame raises required count (all selected must align)", () => {
  assert.deepEqual(
    buildAlgoMtfTimeframeTogglePatch({
      selectedTimeframes: ["2m", "5m"],
      timeframe: "15m",
    }),
    {
      timeframes: ["2m", "5m", "15m"],
      preset: "custom",
      requiredCount: 3,
    },
  );
});

test("algo rail MTF toggle keeps one selected frame", () => {
  assert.deepEqual(
    buildAlgoMtfTimeframeTogglePatch({
      selectedTimeframes: ["15m"],
      timeframe: "15m",
    }),
    {
      timeframes: ["15m"],
      preset: "custom",
      requiredCount: 1,
    },
  );
});
