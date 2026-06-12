import assert from "node:assert/strict";
import test from "node:test";

import {
  BOOT_INFRA_TASK_IDS,
  SCREEN_BOOT_DATA_DEPS,
  normalizeBootScreenId,
  resolveBootBlockingTaskIds,
  resolveScreenBootDataDeps,
} from "./bootPolicy.js";

test("boot overlay blocks only on the frame chunks, never on data", () => {
  assert.deepEqual(BOOT_INFRA_TASK_IDS, [
    "static-html",
    "react-root",
    "app-content-chunk",
    "workspace-route-chunk",
  ]);
  assert.equal(BOOT_INFRA_TASK_IDS.includes("first-screen"), false);
});

test("no screen gates the boot overlay on data", () => {
  for (const screenId of [
    "market",
    "signals",
    "flow",
    "gex",
    "trade",
    "account",
    "algo",
    "research",
    "backtest",
    "diagnostics",
    "settings",
  ]) {
    assert.deepEqual(resolveScreenBootDataDeps(screenId), []);
    assert.deepEqual(resolveBootBlockingTaskIds(screenId), [...BOOT_INFRA_TASK_IDS]);
  }
});

test("boot policy normalizes legacy unusual screen to flow", () => {
  assert.equal(normalizeBootScreenId("unusual"), "flow");
  assert.deepEqual(resolveScreenBootDataDeps("unusual"), SCREEN_BOOT_DATA_DEPS.flow);
});

test("unknown boot screens fall back to the market policy", () => {
  assert.deepEqual(resolveScreenBootDataDeps("unknown-screen"), []);
});
