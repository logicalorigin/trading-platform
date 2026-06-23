import assert from "node:assert/strict";
import test from "node:test";

import {
  IBKR_BRIDGE_FEEDBACK_PAINT_MAX_WAIT_MS,
  waitForBridgeLaunchFeedbackPaint,
} from "./ibkrBridgeLaunchFeedback.js";

const createFakeWindow = () => {
  const animationFrames = [];
  const clearedTimers = [];
  const timers = [];
  const windowRef = {
    clearTimeout(timerId) {
      clearedTimers.push(timerId);
    },
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
      return animationFrames.length;
    },
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
  };
  return {
    animationFrames,
    clearedTimers,
    timers,
    windowRef,
  };
};

test("bridge launch feedback wait resolves without requestAnimationFrame when the page is hidden", async () => {
  const fake = createFakeWindow();
  let resolved = false;

  const wait = waitForBridgeLaunchFeedbackPaint({
    documentRef: { visibilityState: "hidden" },
    windowRef: fake.windowRef,
  }).then(() => {
    resolved = true;
  });
  await wait;

  assert.equal(resolved, true);
  assert.equal(fake.animationFrames.length, 0);
  assert.equal(fake.timers.length, 0);
});

test("bridge launch feedback wait has a timeout fallback when animation frames stall", async () => {
  const fake = createFakeWindow();
  let resolved = false;

  const wait = waitForBridgeLaunchFeedbackPaint({
    documentRef: { visibilityState: "visible" },
    windowRef: fake.windowRef,
  }).then(() => {
    resolved = true;
  });

  assert.equal(fake.animationFrames.length, 1);
  assert.equal(fake.timers.length, 1);
  assert.equal(fake.timers[0].delay, IBKR_BRIDGE_FEEDBACK_PAINT_MAX_WAIT_MS);
  fake.timers[0].callback();
  await wait;

  assert.equal(resolved, true);
});

test("bridge launch feedback wait defers until after animation frame when visible", async () => {
  const fake = createFakeWindow();
  let resolved = false;

  const wait = waitForBridgeLaunchFeedbackPaint({
    documentRef: { visibilityState: "visible" },
    windowRef: fake.windowRef,
  }).then(() => {
    resolved = true;
  });

  fake.animationFrames[0]();
  assert.equal(resolved, false);
  assert.deepEqual(fake.clearedTimers, []);
  assert.equal(fake.timers.length, 2);
  assert.equal(fake.timers[1].delay, 0);
  fake.timers[1].callback();
  await wait;

  assert.equal(resolved, true);
  assert.deepEqual(fake.clearedTimers, [1]);
});

test("bridge launch feedback wait keeps timeout live until post-frame callback resolves", async () => {
  const fake = createFakeWindow();
  let resolved = false;

  const wait = waitForBridgeLaunchFeedbackPaint({
    documentRef: { visibilityState: "visible" },
    windowRef: fake.windowRef,
  }).then(() => {
    resolved = true;
  });

  fake.animationFrames[0]();
  assert.equal(resolved, false);
  assert.deepEqual(fake.clearedTimers, []);
  assert.equal(fake.timers.length, 2);
  fake.timers[0].callback();
  await wait;

  assert.equal(resolved, true);
  assert.deepEqual(fake.clearedTimers, [1]);
});
