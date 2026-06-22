import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./PlatformApp.jsx", import.meta.url),
  "utf8",
);

test("screen readiness gates do not use fixed display delays", () => {
  for (const removedDelay of [
    "LAUNCH_AUXILIARY_SURFACE_DELAY_MS",
    "STARTUP_PROTECTION_COOLDOWN_MS",
    "SIGNAL_MONITOR_BACKGROUND_RESUME_DELAY_MS",
    "SIGNAL_MATRIX_BACKGROUND_RESUME_DELAY_MS",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(removedDelay),
      `${removedDelay} must not reintroduce an artificial screen-display wait`,
    );
  }

  assert.match(
    source,
    /const scheduleReadinessWork = \(callback\) => \{/,
    "readiness work should be scheduled through the bounded next-frame helper",
  );
  assert.match(
    source,
    /requestAnimationFrame\(callback\)/,
    "readiness work should yield at most one animation frame",
  );
});

test("background screen preloads stay delay-free after the first screen is ready", () => {
  assert.match(
    source,
    /const PRIORITY_SCREEN_MODULE_PRELOAD_DELAY_MS = 0;/,
    "priority screen code preload should not wait behind a timer",
  );
  assert.match(
    source,
    /const OPERATIONAL_SCREEN_PRELOAD_IDLE_DELAY_MS = 0;/,
    "operational preload first turn should not wait behind a timer",
  );
  assert.match(
    source,
    /const OPERATIONAL_SCREEN_PRELOAD_IDLE_STAGGER_MS = 0;/,
    "operational preload subsequent turns should not be staggered by a timer",
  );
});
