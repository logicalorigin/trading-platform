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

test("resolveIbkrWorkPressure ignores stale lane errors after strict readiness recovers", () => {
  assert.equal(
    resolveIbkrWorkPressure({
      configured: true,
      authenticated: true,
      healthFresh: true,
      streamFresh: true,
      strictReady: true,
      streamState: "live",
      lastError: "Lane is backed off.",
    }),
    WORK_PRESSURE_STATE.normal,
  );
});

test("resolveIbkrWorkPressure reflects scheduler lane pressure", () => {
  assert.equal(
    resolveIbkrWorkPressure({
      configured: true,
      authenticated: true,
      healthFresh: true,
      streamFresh: true,
      strictReady: true,
      bridgeDiagnostics: {
        scheduler: {
          historical: { pressure: "degraded" },
        },
      },
    }),
    WORK_PRESSURE_STATE.degraded,
  );
});

test("resolveIbkrWorkPressure still reflects active scheduler backoff on ready bridges", () => {
  assert.equal(
    resolveIbkrWorkPressure({
      configured: true,
      authenticated: true,
      healthFresh: true,
      streamFresh: true,
      strictReady: true,
      lastError: "Lane is backed off.",
      bridgeDiagnostics: {
        scheduler: {
          control: { pressure: "backoff" },
        },
      },
    }),
    WORK_PRESSURE_STATE.backoff,
  );
});

test("work pressure helpers keep foreground work ahead of background work", () => {
  assert.equal(isForegroundWorkAllowed(WORK_PRESSURE_STATE.degraded), true);
  assert.equal(isBackgroundWorkAllowed(WORK_PRESSURE_STATE.degraded), false);
  assert.equal(isForegroundWorkAllowed(WORK_PRESSURE_STATE.backoff), false);
  assert.equal(toHydrationPressureState(WORK_PRESSURE_STATE.backoff), "backoff");
});
