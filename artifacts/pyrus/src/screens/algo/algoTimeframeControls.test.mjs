import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAlgoAlignedMtfTimeframes,
  buildAlgoExecutionTimeframePatch,
  buildAlgoMtfTimeframeTogglePatch,
  normalizeAlgoMtfRequiredCount,
} from "./algoTimeframeControls.js";
import { getSettingFieldByPath } from "./algoSettingsFields.js";

test("algo rail MTF normalization does not inject the execution frame", () => {
  assert.deepEqual(
    normalizeAlgoAlignedMtfTimeframes(["1m"], "5m"),
    ["1m"],
  );
});

test("algo rail execution timeframe patch accepts 2m", () => {
  assert.deepEqual(buildAlgoExecutionTimeframePatch("2m"), {
    signalTimeframe: "2m",
  });
});

test("algo rail execution timeframe patch leaves MTF selection unchanged", () => {
  assert.deepEqual(
    buildAlgoExecutionTimeframePatch("15m", "5m", ["1m", "5m"], 2),
    {
      signalTimeframe: "15m",
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

test("algo rail MTF toggle can remove the execution frame from MTF selection", () => {
  assert.deepEqual(
    buildAlgoMtfTimeframeTogglePatch({
      selectedTimeframes: ["1m", "5m"],
      timeframe: "5m",
      executionTimeframe: "5m",
    }),
    {
      timeframes: ["1m"],
      preset: "custom",
      requiredCount: 1,
    },
  );
});

test("algo rail MTF adding a frame requires the full selected set", () => {
  assert.deepEqual(
    buildAlgoMtfTimeframeTogglePatch({
      selectedTimeframes: ["2m", "5m"],
      timeframe: "15m",
      requiredCount: 2,
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

test("algo rail MTF removal clamps required count to selected frames", () => {
  assert.deepEqual(
    buildAlgoMtfTimeframeTogglePatch({
      selectedTimeframes: ["1m", "2m"],
      timeframe: "2m",
      requiredCount: 2,
    }),
    {
      timeframes: ["1m"],
      preset: "custom",
      requiredCount: 1,
    },
  );
});

test("algo rail MTF required count ignores stale partial saved values", () => {
  assert.equal(normalizeAlgoMtfRequiredCount(2, ["2m", "5m", "15m"]), 3);
});

test("algo settings MTF presets require every selected preset frame", () => {
  const field = getSettingFieldByPath("entryGate.mtfAlignment.preset");
  assert.deepEqual(field.patchFromValue("balanced"), {
    "entryGate.mtfAlignment.preset": "balanced",
    "entryGate.mtfAlignment.timeframes": ["5m", "15m", "1h"],
    "entryGate.mtfAlignment.requiredCount": 3,
  });
});
