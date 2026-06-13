import assert from "node:assert/strict";
import test from "node:test";

import {
  SCREEN_BOOT_DATA_DEPS,
  normalizeBootScreenId,
  resolveScreenBootDataDeps,
} from "./bootPolicy.js";

test("boot policy normalizes legacy unusual screen to flow", () => {
  assert.equal(normalizeBootScreenId("unusual"), "flow");
  assert.deepEqual(resolveScreenBootDataDeps("unusual"), SCREEN_BOOT_DATA_DEPS.flow);
});

test("unknown boot screens fall back to the market policy", () => {
  assert.deepEqual(resolveScreenBootDataDeps("unknown-screen"), []);
});
