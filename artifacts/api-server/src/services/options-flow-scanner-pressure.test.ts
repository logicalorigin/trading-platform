import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  __resetOptionChainCachesForTests,
  getOptionsFlowScannerDiagnostics,
  resetOptionsFlowRuntimeOverrides,
} from "./platform";
import {
  __resetApiResourcePressureForTests,
  updateApiResourcePressure,
} from "./resource-pressure";

afterEach(() => {
  resetOptionsFlowRuntimeOverrides();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();
});

test("options flow scanner pauses background work under high API pressure", () => {
  resetOptionsFlowRuntimeOverrides();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();
  // Two sustained samples above the event-loop high threshold (400ms) enter "high"
  // server saturation via the 2-sample hysteresis, which pauses background scans.
  updateApiResourcePressure({ eventLoopDelayP95Ms: 500 });
  updateApiResourcePressure({ eventLoopDelayP95Ms: 500 });

  const diagnostics = getOptionsFlowScannerDiagnostics();

  assert.equal(diagnostics.backgroundBlockedReason, "resource-pressure");
  assert.equal(diagnostics.limitingReason, "api-pressure-gate");
  assert.equal(diagnostics.lineUtilization.effectiveConcurrency, 0);
  assert.equal(diagnostics.lineUtilization.maxDeepScanLines, 0);
});

test("options flow scanner is NOT paused by broker-latency-only high pressure", () => {
  resetOptionsFlowRuntimeOverrides();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();
  // A slow external/broker route drives api-latency to "high" (overall level=high)
  // without saturating the server. The scanner cannot relieve broker latency by
  // stopping deep scans, so the gate excludes latency and must NOT block scans.
  updateApiResourcePressure({
    apiP95LatencyMs: 2_000,
    dominantSlowRouteP95Ms: 12_000,
  });

  const diagnostics = getOptionsFlowScannerDiagnostics();

  assert.equal(diagnostics.backgroundBlockedReason, null);
  assert.notEqual(diagnostics.limitingReason, "api-pressure-gate");
});
