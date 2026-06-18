import { test } from "node:test";
import assert from "node:assert/strict";
import {
  publishAlgoStaExecutionTimeframe,
  publishAlgoStaMtfTimeframes,
  getAlgoStaExecutionTimeframeForTests,
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
  resetAlgoStaExecutionTimeframeForTests();
  assert.equal(getAlgoStaExecutionTimeframeForTests(), "");
  assert.deepEqual(getAlgoStaMtfTimeframesForTests(), []);
});

test("empty MTF set returns a stable empty array reference", () => {
  resetAlgoStaExecutionTimeframeForTests();
  const a = getAlgoStaMtfTimeframesForTests();
  resetAlgoStaExecutionTimeframeForTests();
  const b = getAlgoStaMtfTimeframesForTests();
  assert.equal(a, b);
  assert.deepEqual(a, []);
});
