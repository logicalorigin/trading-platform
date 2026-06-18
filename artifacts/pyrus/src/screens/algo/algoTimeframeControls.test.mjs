import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAlgoAlignedMtfTimeframes,
  buildAlgoExecutionTimeframePatch,
  buildAlgoMtfTimeframeTogglePatch,
} from "./algoTimeframeControls.js";

test("algo rail MTF normalization includes the execution frame", () => {
  assert.deepEqual(
    normalizeAlgoAlignedMtfTimeframes(["1m"], "5m"),
    ["1m", "5m"],
  );
});

test("algo rail execution timeframe patch accepts 2m", () => {
  assert.deepEqual(buildAlgoExecutionTimeframePatch("2m"), {
    signalTimeframe: "2m",
  });
});

test("algo rail execution timeframe patch adds the execution frame to MTF", () => {
  assert.deepEqual(
    buildAlgoExecutionTimeframePatch("15m", "5m", ["1m", "5m"]),
    {
      signalTimeframe: "15m",
      timeframes: ["1m", "5m", "15m"],
      preset: "custom",
      requiredCount: 3,
    },
  );
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

test("algo rail MTF toggle keeps the execution frame selected", () => {
  assert.deepEqual(
    buildAlgoMtfTimeframeTogglePatch({
      selectedTimeframes: ["1m", "5m"],
      timeframe: "5m",
      executionTimeframe: "5m",
    }),
    {
      timeframes: ["1m", "5m"],
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
