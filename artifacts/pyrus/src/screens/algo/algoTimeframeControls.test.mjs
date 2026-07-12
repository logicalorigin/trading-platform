import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAlgoAlignedMtfTimeframes,
  buildAlgoExecutionTimeframePatch,
  buildAlgoMtfTimeframeTogglePatch,
  normalizeAlgoMtfRequiredCount,
} from "./algoTimeframeControls.js";
import { getSettingFieldByPath } from "./algoSettingsFields.js";

test("algo rail MTF normalization includes the execution frame", () => {
  assert.deepEqual(
    normalizeAlgoAlignedMtfTimeframes(["1m"], "5m"),
    ["1m", "5m"],
  );
  assert.deepEqual(
    normalizeAlgoAlignedMtfTimeframes(["5m"], "1m"),
    ["1m", "5m"],
  );
});

test("algo rail execution timeframe patch accepts 2m when MTF is already aligned", () => {
  assert.deepEqual(buildAlgoExecutionTimeframePatch("2m", undefined, ["1m", "2m", "5m"]), {
    signalTimeframe: "2m",
  });
});

test("algo rail execution timeframe patch adds the execution frame to MTF", () => {
  assert.deepEqual(
    buildAlgoExecutionTimeframePatch("15m", "5m", ["1m", "5m"], 2),
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

test("algo rail MTF toggle cannot remove the execution frame from MTF selection", () => {
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

test("algo rail MTF toggle can leave a 1:1 execution selection", () => {
  assert.deepEqual(
    buildAlgoMtfTimeframeTogglePatch({
      selectedTimeframes: ["1m", "5m"],
      timeframe: "5m",
      executionTimeframe: "1m",
    }),
    {
      timeframes: ["1m"],
      preset: "custom",
      requiredCount: 1,
    },
  );
});

test("algo rail MTF adding a frame raises required count to full alignment", () => {
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

test("algo rail MTF required count always follows the selection", () => {
  assert.equal(normalizeAlgoMtfRequiredCount(1, ["2m"]), 1);
  assert.equal(normalizeAlgoMtfRequiredCount(1, ["2m", "5m"]), 2);
  assert.equal(normalizeAlgoMtfRequiredCount(2, ["2m", "5m", "15m"]), 3);
  assert.equal(normalizeAlgoMtfRequiredCount(1, ["1m", "2m", "5m", "15m"]), 4);
  assert.equal(normalizeAlgoMtfRequiredCount(2, ["1m", "2m", "5m", "15m", "1h"]), 5);
  assert.equal(normalizeAlgoMtfRequiredCount(9, ["2m", "5m"]), 2);
  assert.equal(normalizeAlgoMtfRequiredCount(null, ["2m", "5m", "15m"]), 3);
});

test("algo settings do not expose an independent MTF required-count control", () => {
  assert.equal(getSettingFieldByPath("entryGate.mtfAlignment.requiredCount"), null);
});

test("algo settings MTF presets default to full alignment across the preset's frames", () => {
  // The STA gate and entry gate require unanimity over the selected frames,
  // matching the backend's selected-frame count. Picking a preset derives the
  // same count from that preset's frames.
  const field = getSettingFieldByPath("entryGate.mtfAlignment.preset");
  assert.deepEqual(field.patchFromValue("balanced"), {
    "entryGate.mtfAlignment.preset": "balanced",
    "entryGate.mtfAlignment.timeframes": ["5m", "15m", "1h"],
    "entryGate.mtfAlignment.requiredCount": 3,
  });
});
