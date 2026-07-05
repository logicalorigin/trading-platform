import { test } from "node:test";
import assert from "node:assert/strict";
import {
  publishAlgoStaExecutionTimeframe,
  publishAlgoStaMtfAlignmentConfig,
  publishAlgoStaMtfTimeframes,
  getAlgoStaExecutionTimeframeForTests,
  getAlgoStaMtfAlignmentConfigForTests,
  getAlgoStaMtfTimeframesForTests,
  resetAlgoStaExecutionTimeframeForTests,
} from "./algoStaExecutionTimeframeStore.js";

test("MTF set: publish + read", () => {
  resetAlgoStaExecutionTimeframeForTests();
  publishAlgoStaMtfTimeframes(["1m", "5m", "1h"]);
  assert.deepEqual(getAlgoStaMtfTimeframesForTests(), ["1m", "5m", "1h"]);
});

test("MTF set: a value-equal publish keeps the SAME array reference (useSyncExternalStore loop-safety)", () => {
  resetAlgoStaExecutionTimeframeForTests();
  publishAlgoStaMtfTimeframes(["1m", "5m"]);
  const first = getAlgoStaMtfTimeframesForTests();
  publishAlgoStaMtfTimeframes(["1m", "5m"]); // same values, new input array
  const second = getAlgoStaMtfTimeframesForTests();
  assert.equal(first, second); // identity preserved -> no spurious re-render/loop
});

test("MTF set: a value change swaps the reference", () => {
  resetAlgoStaExecutionTimeframeForTests();
  publishAlgoStaMtfTimeframes(["1m", "5m"]);
  const first = getAlgoStaMtfTimeframesForTests();
  publishAlgoStaMtfTimeframes(["1m", "5m", "15m"]);
  const second = getAlgoStaMtfTimeframesForTests();
  assert.notEqual(first, second);
  assert.deepEqual(second, ["1m", "5m", "15m"]);
});

test("MTF set: normalizes (trims, drops empty/nullish)", () => {
  resetAlgoStaExecutionTimeframeForTests();
  publishAlgoStaMtfTimeframes([" 1m ", "", "5m", null, undefined]);
  assert.deepEqual(getAlgoStaMtfTimeframesForTests(), ["1m", "5m"]);
});

test("reset clears BOTH the execution TF and the MTF set", () => {
  publishAlgoStaExecutionTimeframe("5m");
  publishAlgoStaMtfTimeframes(["1m", "5m"]);
  publishAlgoStaMtfAlignmentConfig({
    enabled: false,
    preset: "custom",
    timeframes: ["1m", "5m"],
    requiredCount: 2,
  });
  resetAlgoStaExecutionTimeframeForTests();
  assert.equal(getAlgoStaExecutionTimeframeForTests(), "");
  assert.deepEqual(getAlgoStaMtfTimeframesForTests(), []);
  assert.equal(getAlgoStaMtfAlignmentConfigForTests(), null);
});

test("empty MTF set returns a stable empty array reference", () => {
  resetAlgoStaExecutionTimeframeForTests();
  const a = getAlgoStaMtfTimeframesForTests();
  resetAlgoStaExecutionTimeframeForTests();
  const b = getAlgoStaMtfTimeframesForTests();
  assert.equal(a, b);
  assert.deepEqual(a, []);
});

test("MTF config: publish normalizes and preserves value-equal identity", () => {
  resetAlgoStaExecutionTimeframeForTests();
  publishAlgoStaMtfAlignmentConfig({
    enabled: false,
    preset: " custom ",
    timeframes: [" 1m ", "", "5m", null],
    requiredCount: 2.8,
  });
  const first = getAlgoStaMtfAlignmentConfigForTests();
  assert.deepEqual(first, {
    enabled: false,
    preset: "custom",
    timeframes: ["1m", "5m"],
    requiredCount: 2,
  });

  publishAlgoStaMtfAlignmentConfig({
    enabled: false,
    preset: "custom",
    timeframes: ["1m", "5m"],
    requiredCount: 2,
  });
  assert.equal(getAlgoStaMtfAlignmentConfigForTests(), first);
});
