import assert from "node:assert/strict";
import test from "node:test";

import {
  BOOT_INFRA_TASK_IDS,
  SCREEN_BOOT_DATA_DEPS,
  normalizeBootScreenId,
  resolveBootBlockingTaskIds,
  resolveScreenBootDataDeps,
} from "./bootPolicy.js";

test("boot policy keeps Market independent from watchlist hydration", () => {
  assert.deepEqual(resolveScreenBootDataDeps("market"), ["session"]);
  assert.deepEqual(resolveBootBlockingTaskIds("market"), [
    ...BOOT_INFRA_TASK_IDS,
    "session",
  ]);
});

test("boot policy restores account and algo data blockers only for those screens", () => {
  assert.deepEqual(resolveScreenBootDataDeps("account"), ["session", "accounts"]);
  assert.deepEqual(resolveScreenBootDataDeps("algo"), [
    "session",
    "accounts",
    "signal-profile",
  ]);
  assert.equal(resolveScreenBootDataDeps("account").includes("signal-profile"), false);
  assert.equal(resolveScreenBootDataDeps("algo").includes("watchlists"), false);
});

test("boot policy keeps watchlists scoped to flow-style screens", () => {
  for (const screenId of ["flow", "gex", "trade"]) {
    assert.deepEqual(resolveScreenBootDataDeps(screenId), [
      "session",
      "watchlists",
    ]);
  }
});

test("boot policy normalizes legacy unusual screen to flow", () => {
  assert.equal(normalizeBootScreenId("unusual"), "flow");
  assert.deepEqual(resolveScreenBootDataDeps("unusual"), SCREEN_BOOT_DATA_DEPS.flow);
});

test("unknown boot screens fall back to the market policy", () => {
  assert.deepEqual(resolveScreenBootDataDeps("unknown-screen"), [
    "session",
  ]);
});
