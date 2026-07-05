import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { __resetProviderRuntimeConfigCacheForTests } from "../lib/runtime";
import {
  __refreshOptionsFlowSessionBlockReasonForTests,
  __resetOptionChainCachesForTests,
  getOptionsFlowScannerDiagnostics,
  resolveOptionsFlowScannerEffectiveConcurrency,
  resetOptionsFlowRuntimeOverrides,
} from "./platform";
import {
  __resetApiResourcePressureForTests,
  updateApiResourcePressure,
} from "./resource-pressure";
import {
  __resetMarketDataAdmissionForTests,
  setMarketDataAdmissionRuntimeDefaults,
} from "./market-data-admission";

const ORIGINAL_MASSIVE_API_KEY = process.env["MASSIVE_API_KEY"];

afterEach(() => {
  if (ORIGINAL_MASSIVE_API_KEY === undefined) {
    delete process.env["MASSIVE_API_KEY"];
  } else {
    process.env["MASSIVE_API_KEY"] = ORIGINAL_MASSIVE_API_KEY;
  }
  __resetProviderRuntimeConfigCacheForTests();
  resetOptionsFlowRuntimeOverrides();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetMarketDataAdmissionForTests();
  __resetApiResourcePressureForTests();
});

test("options flow scanner throttles but stays schedulable under high event-loop delay", () => {
  resetOptionsFlowRuntimeOverrides();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();
  // Two sustained samples above the event-loop high threshold (400ms) enter
  // "high" server saturation. The scanner should surface that pressure but keep
  // scheduling Massive-backed background scans.
  updateApiResourcePressure({ eventLoopDelayP95Ms: 500 });
  updateApiResourcePressure({ eventLoopDelayP95Ms: 500 });

  const diagnostics = getOptionsFlowScannerDiagnostics();

  assert.equal(diagnostics.scannerPressure.level, "high");
  assert.equal(diagnostics.scannerPressure.throttled, true);
  assert.equal(
    diagnostics.resourcePressure.drivers.find(
      (driver) => driver.kind === "api-event-loop",
    )?.level,
    "high",
  );
  assert.equal(diagnostics.backgroundBlockedReason, null);
  assert.equal(diagnostics.limitingReason, null);
  assert.equal(diagnostics.lineUtilization.effectiveConcurrency, 1);
  assert.equal(diagnostics.lineUtilization.scannerTargetLineBudget, 32);
  assert.equal(diagnostics.lineUtilization.maxDeepScanLines, 32);
});

test("options flow scanner throttles on high API event-loop utilization", () => {
  resetOptionsFlowRuntimeOverrides();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();

  updateApiResourcePressure({ eventLoopUtilization: 0.95 });

  const diagnostics = getOptionsFlowScannerDiagnostics();

  assert.equal(diagnostics.scannerPressure.level, "high");
  assert.equal(diagnostics.scannerPressure.throttled, true);
  assert.equal(
    diagnostics.resourcePressure.drivers.find(
      (driver) => driver.kind === "api-event-loop-utilization",
    )?.level,
    "high",
  );
  assert.equal(diagnostics.backgroundBlockedReason, null);
  assert.equal(diagnostics.limitingReason, null);
  assert.equal(diagnostics.lineUtilization.effectiveConcurrency, 1);
  assert.equal(diagnostics.lineUtilization.scannerTargetLineBudget, 32);
  assert.equal(diagnostics.lineUtilization.maxDeepScanLines, 32);
});

test("options flow scanner throttles on watch API event-loop utilization", () => {
  resetOptionsFlowRuntimeOverrides();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();

  updateApiResourcePressure({ eventLoopUtilization: 0.8 });

  const diagnostics = getOptionsFlowScannerDiagnostics();

  assert.equal(diagnostics.scannerPressure.level, "watch");
  assert.equal(diagnostics.scannerPressure.throttled, true);
  assert.equal(
    diagnostics.resourcePressure.drivers.find(
      (driver) => driver.kind === "api-event-loop-utilization",
    )?.level,
    "watch",
  );
  assert.equal(diagnostics.backgroundBlockedReason, null);
  assert.equal(diagnostics.limitingReason, null);
  assert.equal(diagnostics.lineUtilization.effectiveConcurrency, 1);
  assert.equal(diagnostics.lineUtilization.scannerTargetLineBudget, 32);
  assert.equal(diagnostics.lineUtilization.maxDeepScanLines, 32);
});

test("Massive scanner scheduling ignores stale admission line cap", () => {
  resetOptionsFlowRuntimeOverrides();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();
  __resetMarketDataAdmissionForTests();
  setMarketDataAdmissionRuntimeDefaults({
    flowScannerLineBudget: 0,
    flowScannerConcurrency: 0,
  });

  assert.ok(resolveOptionsFlowScannerEffectiveConcurrency() > 0);
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

  assert.equal(diagnostics.scannerPressure.throttled, false);
  assert.equal(diagnostics.backgroundBlockedReason, null);
  assert.equal(diagnostics.limitingReason, null);
});

test("Massive-backed options flow scanner is not blocked by missing IBKR bridge", async () => {
  process.env["MASSIVE_API_KEY"] = "massive-options-test-key";
  __resetProviderRuntimeConfigCacheForTests();
  resetOptionsFlowRuntimeOverrides();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();

  const reason = await __refreshOptionsFlowSessionBlockReasonForTests();
  const diagnostics = getOptionsFlowScannerDiagnostics();

  assert.equal(reason, null);
  assert.equal(diagnostics.backgroundBlockedReason, null);
  assert.notEqual(diagnostics.limitingReason, "transport-unavailable");
  assert.ok(diagnostics.lineUtilization.effectiveConcurrency > 0);
});
