import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";

import {
  setDbAdmissionDiagnosticsSource,
  type DbAdmissionDiagnostics,
} from "../../../../lib/db/src/admission";
import { __resetProviderRuntimeConfigCacheForTests } from "../lib/runtime";
import {
  __clearOptionsFlowScannerBackgroundHoldForTests,
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
  setDbAdmissionDiagnosticsSource(null);
});

test("options flow scanner does not throttle on a single unrelated loop-delay spike", () => {
  resetOptionsFlowRuntimeOverrides();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();

  const pressure = updateApiResourcePressure({ eventLoopDelayP95Ms: 500 });

  const diagnostics = getOptionsFlowScannerDiagnostics();
  assert.equal(pressure.resourceLevel, "watch");
  assert.equal(diagnostics.scannerPressure.level, "normal");
  assert.equal(diagnostics.scannerPressure.throttled, false);
  assert.equal(
    diagnostics.scannerPressure.ignoredDrivers.find(
      (driver) => driver.kind === "api-event-loop",
    )?.level,
    "high",
  );
});

test("options flow scanner keeps configured capacity under sustained event-loop delay", () => {
  resetOptionsFlowRuntimeOverrides();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();
  // Two sustained samples above the event-loop high threshold (400ms) enter
  // "high" server saturation. The scanner should surface that pressure but keep
  // scheduling Massive-backed background scans.
  updateApiResourcePressure({ eventLoopDelayP95Ms: 500 });
  updateApiResourcePressure({ eventLoopDelayP95Ms: 500 });

  const diagnostics = getOptionsFlowScannerDiagnostics();

  assert.equal(diagnostics.scannerPressure.level, "normal");
  assert.equal(diagnostics.scannerPressure.throttled, false);
  assert.equal(
    diagnostics.resourcePressure.drivers.find(
      (driver) => driver.kind === "api-event-loop",
    )?.level,
    "high",
  );
  assert.equal(diagnostics.backgroundBlockedReason, null);
  assert.equal(diagnostics.limitingReason, null);
  assert.equal(diagnostics.lineUtilization.effectiveConcurrency, 2);
  assert.equal(diagnostics.lineUtilization.scannerTargetLineBudget, 100);
  assert.equal(diagnostics.lineUtilization.maxDeepScanLines, 100);
});

test("options flow scanner still throttles for sustained finite memory pressure", () => {
  resetOptionsFlowRuntimeOverrides();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();

  updateApiResourcePressure({ apiHeapUsedPercent: 85 });
  updateApiResourcePressure({ apiHeapUsedPercent: 85 });

  const diagnostics = getOptionsFlowScannerDiagnostics();
  assert.equal(diagnostics.scannerPressure.level, "high");
  assert.equal(diagnostics.scannerPressure.throttled, true);
  assert.equal(diagnostics.lineUtilization.effectiveConcurrency, 1);
  assert.equal(diagnostics.lineUtilization.scannerTargetLineBudget, 32);
});

test("options flow scanner stops adding work behind an existing background DB queue", () => {
  resetOptionsFlowRuntimeOverrides();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();
  __clearOptionsFlowScannerBackgroundHoldForTests();
  const lane = (queued: number) => ({
    queued,
    inFlight: 0,
    admittedTotal: 0,
    maxWaitMs: 0,
    recentWaitMsP95: 0,
  });
  const admission: DbAdmissionDiagnostics = {
    interactive: lane(0),
    bulk: lane(0),
    background: lane(1),
  };
  setDbAdmissionDiagnosticsSource(() => admission);

  const diagnostics = getOptionsFlowScannerDiagnostics();

  assert.equal(diagnostics.backgroundBlockedReason, "db-background-queued");
  assert.equal(diagnostics.limitingReason, "db-background-queued");
  assert.equal(diagnostics.lineUtilization.effectiveConcurrency, 0);
});

test("options flow scanner does not throttle on high API event-loop utilization", () => {
  resetOptionsFlowRuntimeOverrides();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();

  updateApiResourcePressure({ eventLoopUtilization: 0.95 });

  const diagnostics = getOptionsFlowScannerDiagnostics();

  assert.equal(diagnostics.scannerPressure.globalLevel, "high");
  assert.equal(diagnostics.scannerPressure.level, "normal");
  assert.equal(diagnostics.scannerPressure.throttled, false);
  assert.equal(
    diagnostics.resourcePressure.drivers.find(
      (driver) => driver.kind === "api-event-loop-utilization",
    )?.level,
    "high",
  );
  assert.equal(
    diagnostics.scannerPressure.ignoredDrivers.find(
      (driver) => driver.kind === "api-event-loop-utilization",
    )?.level,
    "high",
  );
  assert.equal(diagnostics.backgroundBlockedReason, null);
  assert.equal(diagnostics.limitingReason, null);
  assert.equal(diagnostics.lineUtilization.effectiveConcurrency, 2);
  assert.equal(diagnostics.lineUtilization.scannerTargetLineBudget, 100);
  assert.equal(diagnostics.lineUtilization.maxDeepScanLines, 100);
});

test("options flow scanner does not throttle on watch API event-loop utilization", () => {
  resetOptionsFlowRuntimeOverrides();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();

  updateApiResourcePressure({ eventLoopUtilization: 0.8 });

  const diagnostics = getOptionsFlowScannerDiagnostics();

  assert.equal(diagnostics.scannerPressure.globalLevel, "watch");
  assert.equal(diagnostics.scannerPressure.level, "normal");
  assert.equal(diagnostics.scannerPressure.throttled, false);
  assert.equal(
    diagnostics.resourcePressure.drivers.find(
      (driver) => driver.kind === "api-event-loop-utilization",
    )?.level,
    "watch",
  );
  assert.equal(
    diagnostics.scannerPressure.ignoredDrivers.find(
      (driver) => driver.kind === "api-event-loop-utilization",
    )?.level,
    "watch",
  );
  assert.equal(diagnostics.backgroundBlockedReason, null);
  assert.equal(diagnostics.limitingReason, null);
  assert.equal(diagnostics.lineUtilization.effectiveConcurrency, 2);
  assert.equal(diagnostics.lineUtilization.scannerTargetLineBudget, 100);
  assert.equal(diagnostics.lineUtilization.maxDeepScanLines, 100);
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

test("flow-universe catalog refreshes delegate pressure to DB admission", () => {
  const managerSource = readFileSync(
    new URL("./flow-universe.ts", import.meta.url),
    "utf8",
  );
  const plannerSource = readFileSync(
    new URL("./flow-universe-planner.ts", import.meta.url),
    "utf8",
  );
  const managerRefresh = managerSource.indexOf("async function refresh(");
  const managerLoad = managerSource.indexOf("await loadCandidates()", managerRefresh);
  const plannerRefresh = plannerSource.indexOf("async function refresh()");
  const plannerLoad = plannerSource.indexOf("loadPlannerCandidates", plannerRefresh);

  assert.notEqual(managerRefresh, -1);
  assert.notEqual(managerLoad, -1);
  assert.notEqual(plannerRefresh, -1);
  assert.notEqual(plannerLoad, -1);
  assert.doesNotMatch(
    managerSource.slice(managerRefresh, managerLoad),
    /resourcePressure|ResourcePressure|pressure/i,
  );
  assert.doesNotMatch(
    plannerSource.slice(plannerRefresh, plannerLoad),
    /resourcePressure|ResourcePressure|pressure/i,
  );
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
