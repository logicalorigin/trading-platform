import assert from "node:assert/strict";
import test from "node:test";

import { readPositiveEnvNumber } from "./runtime";

test("positive numeric environment settings reject unsafe values", () => {
  for (const value of [undefined, "", "0", "-1", "NaN", "Infinity"]) {
    assert.equal(readPositiveEnvNumber("LIMIT", 42, { LIMIT: value }), 42);
  }
  assert.equal(readPositiveEnvNumber("LIMIT", 42, { LIMIT: "12.5" }), 12.5);
});
