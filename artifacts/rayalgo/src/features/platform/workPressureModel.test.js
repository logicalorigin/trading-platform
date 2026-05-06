import assert from "node:assert/strict";
import test from "node:test";
import {
  WORK_PRESSURE_STATE,
  isBackgroundWorkAllowed,
  isForegroundWorkAllowed,
  resolveIbkrWorkPressure,
  toHydrationPressureState,
} from "./workPressureModel.js";

test("resolveIbkrWorkPressure treats healthy bridges as normal", () => {
  assert.equal(
    resolveIbkrWorkPressure({
      configured: true,
      authenticated: true,
      healthFresh: true,
      streamFresh: true,
      strictReady: true,
      lastError: null,
    }),
    WORK_PRESSURE_STATE.normal,
  );
});

test("resolveIbkrWorkPressure promotes lane backoff and stalls", () => {
  assert.equal(
    resolveIbkrWorkPressure({
      configured: true,
      authenticated: true,
      lastError: "Lane is backed off.",
    }),
    WORK_PRESSURE_STATE.backoff,
  );
  assert.equal(
    resolveIbkrWorkPressure({
      configured: true,
      authenticated: true,
      lastError: "historical lane stalled after request timed out",
    }),
    WORK_PRESSURE_STATE.stalled,
  );
});

test("work pressure helpers keep foreground work ahead of background work", () => {
  assert.equal(isForegroundWorkAllowed(WORK_PRESSURE_STATE.degraded), true);
  assert.equal(isBackgroundWorkAllowed(WORK_PRESSURE_STATE.degraded), false);
  assert.equal(isForegroundWorkAllowed(WORK_PRESSURE_STATE.backoff), false);
  assert.equal(toHydrationPressureState(WORK_PRESSURE_STATE.backoff), "backoff");
});
