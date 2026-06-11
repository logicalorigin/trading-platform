import assert from "node:assert/strict";
import test from "node:test";

import {
  WORK_PRESSURE_STATE,
  isBackgroundWorkAllowed,
  isForegroundWorkAllowed,
  resolveIbkrWorkPressure,
} from "./workPressureModel.js";

const strictReadyBridge = (scheduler = null, overrides = {}) => ({
  configured: true,
  authenticated: true,
  strictReady: true,
  healthFresh: true,
  streamFresh: true,
  stale: false,
  lastError: null,
  bridgeDiagnostics: scheduler ? { scheduler } : {},
  ...overrides,
});

test("a stalled account lane does not blackout realtime work on a strict-ready bridge", () => {
  // Live scenario: bridge core is strict-ready and the realtime quote lanes are
  // healthy, but the account lane is stalled (and option-metadata/historical are
  // lagging). This must degrade, not stall — foreground/realtime stays allowed.
  const bridge = strictReadyBridge({
    account: { pressure: "stalled" },
    control: { pressure: "degraded" },
    historical: { pressure: "degraded" },
    "options-meta": { pressure: "backoff" },
    "option-quotes": { pressure: "normal" },
    "market-subscriptions": { pressure: "normal" },
  });
  const pressure = resolveIbkrWorkPressure(bridge);
  assert.equal(pressure, WORK_PRESSURE_STATE.degraded);
  assert.equal(isForegroundWorkAllowed(pressure), true);
  // Background is intentionally held while a lane is struggling.
  assert.equal(isBackgroundWorkAllowed(pressure), false);
});

test("a strict-ready bridge with all lanes healthy is normal", () => {
  const bridge = strictReadyBridge({
    "option-quotes": { pressure: "normal" },
    "market-subscriptions": { pressure: "normal" },
  });
  assert.equal(resolveIbkrWorkPressure(bridge), WORK_PRESSURE_STATE.normal);
  assert.equal(resolveIbkrWorkPressure(strictReadyBridge()), WORK_PRESSURE_STATE.normal);
});

test("a NON-strict-ready bridge still escalates to stalled from a stalled lane", () => {
  const bridge = strictReadyBridge(
    { account: { pressure: "stalled" } },
    { strictReady: false, healthFresh: false },
  );
  assert.equal(resolveIbkrWorkPressure(bridge), WORK_PRESSURE_STATE.stalled);
  assert.equal(isForegroundWorkAllowed(WORK_PRESSURE_STATE.stalled), false);
});

test("a NON-strict-ready bridge escalates from error-text keywords", () => {
  const bridge = strictReadyBridge(null, {
    strictReady: false,
    streamFresh: false,
    streamStateReason: "quote stream timed out",
  });
  assert.equal(resolveIbkrWorkPressure(bridge), WORK_PRESSURE_STATE.stalled);
});

test("an unconfigured / unauthenticated bridge is normal", () => {
  assert.equal(
    resolveIbkrWorkPressure({ configured: false, authenticated: false }),
    WORK_PRESSURE_STATE.normal,
  );
});
