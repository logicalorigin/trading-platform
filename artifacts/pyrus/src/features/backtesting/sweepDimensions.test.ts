import assert from "node:assert/strict";
import test from "node:test";

import type { BacktestStrategyCatalogItem } from "@workspace/api-client-react";

import { deriveSweepDimensions } from "./sweepDimensions";

const pyrusSignalsStrategy: BacktestStrategyCatalogItem = {
  strategyId: "pyrus_signals",
  version: "v1",
  label: "Pyrus Signals",
  description: "test fixture",
  status: "runnable",
  directionMode: "long_only",
  supportedTimeframes: ["1d"],
  compatibilityNotes: [],
  unsupportedFeatures: [],
  parameterDefinitions: [],
  defaultParameters: {},
};

const targetDteValues = (minDte: number, maxDte: number) =>
  deriveSweepDimensions(pyrusSignalsStrategy, {
    executionMode: "signal_options",
    signalOptionsMinDte: minDte,
    signalOptionsMaxDte: maxDte,
  }).find((dimension) => dimension.key === "signalOptionsTargetDte")?.values;

test("signal-options target-DTE sweep values stay inside the selected window", () => {
  assert.deepEqual(targetDteValues(1, 3), [1, 2, 3]);
  assert.deepEqual(targetDteValues(5, 7), [5, 7]);
});

test("signal-options target-DTE sweep values deduplicate collapsed windows", () => {
  assert.deepEqual(targetDteValues(2, 2), [2]);
  assert.deepEqual(targetDteValues(5, 3), [5]);
});

test("signal-options target-DTE sweep respects the execution 0DTE floor", () => {
  assert.deepEqual(targetDteValues(0, 0), [1]);
});
