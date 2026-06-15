import { test } from "node:test";
import assert from "node:assert/strict";
import { finiteNumber } from "./numeric.ts";

test("finiteNumber: numeric inputs pass through when finite", () => {
  assert.equal(finiteNumber(0), 0);
  assert.equal(finiteNumber(-12.5), -12.5);
  assert.equal(finiteNumber(1234.56), 1234.56);
});

test("finiteNumber: non-finite numbers become null", () => {
  assert.equal(finiteNumber(Number.NaN), null);
  assert.equal(finiteNumber(Number.POSITIVE_INFINITY), null);
  assert.equal(finiteNumber(Number.NEGATIVE_INFINITY), null);
});

test("finiteNumber: plain numeric strings parse", () => {
  assert.equal(finiteNumber("42"), 42);
  assert.equal(finiteNumber("3.14"), 3.14);
  assert.equal(finiteNumber("-7"), -7);
});

test("finiteNumber: strips currency/percent/whitespace separators", () => {
  assert.equal(finiteNumber("$1,234.50"), 1234.5);
  assert.equal(finiteNumber("12%"), 12);
  assert.equal(finiteNumber(" 5 "), 5);
  assert.equal(finiteNumber("1,000"), 1000);
});

test("finiteNumber: non-coercible values become null", () => {
  assert.equal(finiteNumber("abc"), null);
  assert.equal(finiteNumber(null), null);
  assert.equal(finiteNumber(undefined), null);
  assert.equal(finiteNumber({}), null);
  assert.equal(finiteNumber([]), null);
});

// Documented existing contract (preserved across all 4 prior copies): an empty
// or whitespace-only string coerces to 0 because Number("") === 0 is finite.
test("finiteNumber: empty/whitespace string coerces to 0 (existing behavior)", () => {
  assert.equal(finiteNumber(""), 0);
  assert.equal(finiteNumber(" "), 0);
});
