import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceWaveMotion,
  initWaveMotionState,
  normalizeWaveMotion,
  WAVE_MOTION_DWELL_MS,
} from "./ibkrWaveMotionModel.js";

const FAST = { animated: true, duration: "0.9s" };
const MED = { animated: true, duration: "1.45s" };
const SLOW = { animated: true, duration: "2.15s" };

test("transient ping flip back within the dwell never reaches the committed motion", () => {
  let state = initWaveMotionState(FAST);
  // ping jitters into the next bucket...
  state = advanceWaveMotion(state, MED, 0);
  assert.deepEqual(state.committed, FAST, "committed must not change immediately");
  assert.ok(state.pending, "a pending change is tracked");
  // ...and snaps back before the dwell elapses
  state = advanceWaveMotion(state, FAST, 300);
  assert.equal(state.pending, null, "pending change is cancelled on return to baseline");
  // long after, still the original — no restart ever happened
  state = advanceWaveMotion(state, FAST, 5000);
  assert.deepEqual(state.committed, FAST);
});

test("a sustained change commits exactly once after the dwell", () => {
  let state = initWaveMotionState(FAST);
  state = advanceWaveMotion(state, SLOW, 0);
  state = advanceWaveMotion(state, SLOW, WAVE_MOTION_DWELL_MS - 1);
  assert.deepEqual(state.committed, FAST, "not yet committed before the dwell");
  state = advanceWaveMotion(state, SLOW, WAVE_MOTION_DWELL_MS);
  assert.deepEqual(state.committed, SLOW, "committed once the dwell is met");
  assert.equal(state.pending, null);
});

test("a new target before the dwell resets the timer (latest target wins)", () => {
  let state = initWaveMotionState(FAST);
  state = advanceWaveMotion(state, MED, 0); // pending MED @0
  state = advanceWaveMotion(state, SLOW, 400); // retarget -> pending SLOW @400
  state = advanceWaveMotion(state, SLOW, 400 + WAVE_MOTION_DWELL_MS - 1);
  assert.deepEqual(state.committed, FAST, "MED's elapsed time does not count toward SLOW");
  state = advanceWaveMotion(state, SLOW, 400 + WAVE_MOTION_DWELL_MS);
  assert.deepEqual(state.committed, SLOW);
});

test("duration jitter while flat is ignored (normalized to null)", () => {
  assert.deepEqual(normalizeWaveMotion({ animated: false, duration: "0.9s" }), {
    animated: false,
    duration: null,
  });
  let state = initWaveMotionState({ animated: false, duration: "0.9s" });
  state = advanceWaveMotion(state, { animated: false, duration: "2.15s" }, 0);
  assert.equal(state.pending, null, "flat wave with a stale duration is not a change");
  assert.deepEqual(state.committed, { animated: false, duration: null });
});

test("active toggling off is also debounced", () => {
  let state = initWaveMotionState(FAST);
  state = advanceWaveMotion(state, { animated: false }, 0);
  assert.deepEqual(state.committed, FAST, "stays animated through a momentary inactive blip");
  state = advanceWaveMotion(state, FAST, 200);
  assert.equal(state.pending, null, "returning to active before the dwell cancels the flip");
  // a genuine sustained inactive period does commit
  state = advanceWaveMotion(state, { animated: false }, 1000);
  state = advanceWaveMotion(state, { animated: false }, 1000 + WAVE_MOTION_DWELL_MS);
  assert.deepEqual(state.committed, { animated: false, duration: null });
});

test("re-asserting the committed motion is a no-op (stable identity)", () => {
  const state = initWaveMotionState(FAST);
  assert.equal(advanceWaveMotion(state, FAST, 123), state, "same object returned, no churn");
});
