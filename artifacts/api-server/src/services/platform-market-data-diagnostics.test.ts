import assert from "node:assert/strict";
import test from "node:test";

import { toFiniteNumber } from "./platform-market-data-diagnostics";

test("missing market-data diagnostic values stay missing instead of becoming zero", () => {
  assert.equal(toFiniteNumber(null), null);
  assert.equal(toFiniteNumber(undefined), null);
  assert.equal(toFiniteNumber(""), null);
  assert.equal(toFiniteNumber("   "), null);
  assert.equal(toFiniteNumber(false), null);
  assert.equal(toFiniteNumber(0), 0);
  assert.equal(toFiniteNumber("12.5"), 12.5);
});
