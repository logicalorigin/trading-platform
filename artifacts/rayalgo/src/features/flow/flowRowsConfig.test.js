import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FLOW_ROWS_OPTIONS } from "./flowRowsConfig.js";

test("Flow row options include high-density virtualized row counts", () => {
  assert.deepEqual(FLOW_ROWS_OPTIONS, [24, 40, 60, 100, 250, 500]);
  assert.equal(Object.isFrozen(FLOW_ROWS_OPTIONS), true);
});

test("Flow and Settings share the same Flow row options source", () => {
  const flowSource = readFileSync(
    new URL("../../screens/FlowScreen.jsx", import.meta.url),
    "utf8",
  );
  const settingsSource = readFileSync(
    new URL("../../screens/SettingsScreen.jsx", import.meta.url),
    "utf8",
  );

  assert.match(flowSource, /features\/flow\/flowRowsConfig\.js/);
  assert.match(settingsSource, /features\/flow\/flowRowsConfig\.js/);
  assert.doesNotMatch(flowSource, /const FLOW_ROWS_OPTIONS\s*=/);
  assert.doesNotMatch(settingsSource, /const FLOW_ROWS_OPTIONS\s*=/);
});
