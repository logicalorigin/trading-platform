import assert from "node:assert/strict";
import { test } from "node:test";
import { hasPineRuntimeAdapter } from "./pineScripts.ts";

test("prototype properties are not Pine runtime adapters", () => {
  assert.equal(hasPineRuntimeAdapter("toString"), false);
  assert.equal(hasPineRuntimeAdapter("constructor"), false);
});
