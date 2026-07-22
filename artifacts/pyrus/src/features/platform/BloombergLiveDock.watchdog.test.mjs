import assert from "node:assert/strict";
import test from "node:test";

import {
  createBloombergWatchdogState,
  stepBloombergWatchdog,
} from "./BloombergLiveDock.jsx";

class FakeHls {
  startLoadCalls = [];
  recoverMediaErrorCalls = 0;

  startLoad(position) {
    this.startLoadCalls.push(position);
  }

  recoverMediaError() {
    this.recoverMediaErrorCalls += 1;
  }
}

test("a silent post-playable stall escalates through reload to failover while loading", () => {
  const state = createBloombergWatchdogState();
  Object.assign(state, {
    playbackStarted: true,
    lastCurrentTime: 12,
    lastAdvancedAt: 1_000,
  });
  const hls = new FakeHls();
  const sample = {
    state,
    currentTime: 12,
    hasBuffer: true,
    paused: false,
    seeking: false,
    transportRate: 1,
    hls,
    stallMs: 10_000,
    emptyBufferMs: 8_000,
    reloadLimit: 1,
  };

  const startLoad = stepBloombergWatchdog({
    ...sample,
    nowMs: 11_000,
    playerStatus: "live",
  });
  assert.equal(startLoad?.type, "start-load");
  assert.equal(state.recoveryPending, true);

  const recoverMedia = stepBloombergWatchdog({
    ...sample,
    nowMs: 21_000,
    playerStatus: "loading",
  });
  assert.equal(recoverMedia?.type, "recover-media");

  const reload = stepBloombergWatchdog({
    ...sample,
    nowMs: 31_000,
    playerStatus: "loading",
  });
  assert.equal(reload?.type, "reload");
  assert.equal(reload?.preserveWatchdog, true);
  assert.equal(state.reloadAttempts, 1);

  const failover = stepBloombergWatchdog({
    ...sample,
    nowMs: 41_000,
    playerStatus: "loading",
  });
  assert.equal(failover?.type, "failover");
  assert.deepEqual(hls.startLoadCalls, [-1]);
  assert.equal(hls.recoverMediaErrorCalls, 1);
});

test("loading after a playable stream waits long enough to start recovery", () => {
  const state = createBloombergWatchdogState();
  Object.assign(state, {
    playbackStarted: true,
    lastCurrentTime: 48,
    lastAdvancedAt: 1_000,
  });
  const hls = new FakeHls();

  const action = stepBloombergWatchdog({
    state,
    nowMs: 11_000,
    playerStatus: "loading",
    currentTime: 48,
    hasBuffer: true,
    paused: false,
    seeking: false,
    transportRate: 1,
    hls,
    stallMs: 10_000,
    emptyBufferMs: 8_000,
    reloadLimit: 1,
  });

  assert.equal(action?.type, "start-load");
  assert.deepEqual(hls.startLoadCalls, [-1]);
  assert.equal(state.recoveryPending, true);
});
