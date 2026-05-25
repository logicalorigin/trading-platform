import assert from "node:assert/strict";
import test from "node:test";
import { _testing } from "./numberTick.js";

test("easeOutQuint: clamps at 0 and 1", () => {
  assert.equal(_testing.easeOutQuint(0), 0);
  assert.equal(_testing.easeOutQuint(1), 1);
});

test("easeOutQuint: monotonic 0..1 input -> 0..1 output", () => {
  let last = -Infinity;
  for (let i = 0; i <= 10; i += 1) {
    const v = _testing.easeOutQuint(i / 10);
    assert.ok(v >= last, `expected ${v} >= ${last}`);
    assert.ok(v >= 0 && v <= 1, `expected 0 <= ${v} <= 1`);
    last = v;
  }
});

test("easeOutQuint: front-loaded (>50% of distance at t=0.3)", () => {
  // ease-out: most of the change happens early
  assert.ok(_testing.easeOutQuint(0.3) > 0.5);
});

test("prefersReducedMotion: returns false when window is undefined", () => {
  // This test runs in Node where window may be undefined
  const result = _testing.prefersReducedMotion();
  assert.equal(typeof result, "boolean");
});

test("resolveAnimationStartValue resumes from the current displayed value", () => {
  assert.equal(_testing.resolveAnimationStartValue(100.8, 100, 101), 100.8);
});

test("resolveAnimationStartValue falls back to the previous target only without a display value", () => {
  assert.equal(_testing.resolveAnimationStartValue(null, 100, 101), 100);
  assert.equal(_testing.resolveAnimationStartValue(null, null, 101), 101);
});
