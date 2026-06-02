import assert from "node:assert/strict";
import test from "node:test";
import {
  getCurrentSignalDirection,
  hasCurrentSignalDirection,
  isCurrentFreshSignalState,
  isSignalStateCurrent,
} from "./signalStateFreshness.js";

test("signal freshness helpers suppress stale directional state", () => {
  const staleState = {
    status: "stale",
    currentSignalDirection: "buy",
    fresh: true,
    active: true,
  };

  assert.equal(isSignalStateCurrent(staleState), false);
  assert.equal(getCurrentSignalDirection(staleState), "");
  assert.equal(hasCurrentSignalDirection(staleState), false);
  assert.equal(isCurrentFreshSignalState(staleState), false);
});

test("signal freshness helpers allow non-fresh but current directions", () => {
  const currentState = {
    status: "ok",
    currentSignalDirection: "sell",
    fresh: false,
    active: true,
  };

  assert.equal(isSignalStateCurrent(currentState), true);
  assert.equal(getCurrentSignalDirection(currentState), "sell");
  assert.equal(hasCurrentSignalDirection(currentState), true);
  assert.equal(isCurrentFreshSignalState(currentState), false);
});
