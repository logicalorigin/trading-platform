import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  __resetApiResourcePressureForTests,
  getApiResourcePressureSnapshot,
  isApiResourcePressureHardBlock,
  resolveApiRssHardBlockMb,
  resolveApiRssPressureThresholds,
  updateApiResourcePressure,
} from "./resource-pressure";

afterEach(() => {
  __resetApiResourcePressureForTests();
});

test("resource pressure escalates from API RSS", () => {
  const thresholds = resolveApiRssPressureThresholds();

  assert.equal(updateApiResourcePressure({ rssMb: thresholds.watch + 1 }).level, "watch");
  assert.equal(updateApiResourcePressure({ rssMb: thresholds.high + 1 }).level, "high");
  assert.equal(
    updateApiResourcePressure({ rssMb: thresholds.critical + 1 }).level,
    "critical",
  );
});

test("RSS pressure scales with the container memory limit", () => {
  assert.deepEqual(resolveApiRssPressureThresholds(16_384), {
    watch: 4_096,
    high: 5_734,
    critical: 8_192,
  });
  assert.equal(resolveApiRssHardBlockMb(16_384), 11_469);
});

test("resource pressure escalates from API heap pressure", () => {
  assert.equal(updateApiResourcePressure({ apiHeapUsedPercent: 72 }).level, "watch");
  assert.equal(updateApiResourcePressure({ apiHeapUsedPercent: 82 }).level, "high");
  assert.equal(updateApiResourcePressure({ apiHeapUsedPercent: 91 }).level, "critical");
});

test("high resource pressure keeps signal-options work running", () => {
  updateApiResourcePressure({
    rssMb: resolveApiRssPressureThresholds().high + 1,
  });

  const snapshot = getApiResourcePressureSnapshot();

  assert.equal(snapshot.level, "high");
  assert.equal(snapshot.caps.signalOptions.actionScansAllowed, true);
  assert.equal(snapshot.caps.signalOptions.positionMarksAllowed, true);
  assert.equal(snapshot.caps.signalOptions.watchlistPrewarmAllowed, true);
  assert.equal(snapshot.caps.signalOptions.skipDeploymentScans, false);
  assert.equal(snapshot.caps.signalOptions.maintenanceOnly, false);
  assert.equal("optionsFlow" in snapshot.caps, false);
});

test("client-only critical pressure is advisory for API gating", () => {
  updateApiResourcePressure({ clientLevel: "critical" });

  const snapshot = getApiResourcePressureSnapshot();

  assert.equal(snapshot.level, "watch");
  assert.equal(snapshot.drivers[0]?.kind, "client-pressure");
  assert.equal(snapshot.drivers[0]?.level, "watch");
  assert.equal(snapshot.drivers[0]?.detail, "critical capped at watch");
  assert.equal(snapshot.caps.signalOptions.actionScansAllowed, true);
  assert.equal(snapshot.caps.signalOptions.positionMarksAllowed, true);
});

test("cache pressure cannot force API critical without server pressure", () => {
  updateApiResourcePressure({ cacheLevel: "critical" });

  const snapshot = getApiResourcePressureSnapshot();

  assert.equal(snapshot.level, "watch");
  assert.equal(snapshot.drivers[0]?.kind, "cache-pressure");
  assert.equal(snapshot.drivers[0]?.detail, "critical capped at watch");
});

test("automation long scans are scanner pressure, not global API pressure", () => {
  const snapshot = updateApiResourcePressure({
    automationActiveLongScanCount: 1,
  });

  assert.equal(snapshot.level, "normal");
  assert.equal(snapshot.drivers.some((driver) => driver.kind === "automation"), false);
  assert.equal(snapshot.scannerPressure.level, "high");
  assert.equal(snapshot.scannerPressure.activeLongScanCount, 1);
  assert.equal(snapshot.scannerPressure.drivers[0]?.kind, "automation");
  assert.equal(snapshot.caps.signalOptions.actionScansAllowed, true);
});

test("route latency pressure is capped below critical", () => {
  assert.equal(
    updateApiResourcePressure({ dominantSlowRouteP95Ms: 1_200 }).level,
    "watch",
  );
  __resetApiResourcePressureForTests();

  updateApiResourcePressure({ dominantSlowRouteP95Ms: 12_000 });

  const snapshot = getApiResourcePressureSnapshot();

  assert.equal(snapshot.level, "high");
  assert.equal(snapshot.drivers[0]?.kind, "api-latency");
  assert.equal(snapshot.drivers[0]?.level, "high");
  assert.equal("optionsFlow" in snapshot.caps, false);
  assert.equal(snapshot.caps.signalOptions.skipDeploymentScans, false);
  assert.equal(snapshot.caps.signalOptions.maintenanceOnly, false);

  __resetApiResourcePressureForTests();
  assert.equal(
    updateApiResourcePressure({ dominantSlowRouteP95Ms: 70_000 }).level,
    "high",
  );
});

test("critical RSS pressure records diagnostics without pausing signal scans", () => {
  const snapshot = updateApiResourcePressure({
    rssMb: resolveApiRssPressureThresholds().critical + 1,
  });

  assert.equal(snapshot.level, "critical");
  assert.equal(isApiResourcePressureHardBlock(snapshot), false);
  assert.equal("optionsFlow" in snapshot.caps, false);
  assert.equal(snapshot.caps.signalOptions.skipDeploymentScans, false);
  assert.equal(snapshot.caps.signalOptions.maintenanceOnly, false);
});

test("hard pressure blocks background scanner gates", () => {
  assert.equal(
    isApiResourcePressureHardBlock(
      updateApiResourcePressure({ rssMb: resolveApiRssHardBlockMb() + 1 }),
    ),
    true,
  );

  __resetApiResourcePressureForTests();

  assert.equal(
    isApiResourcePressureHardBlock(
      updateApiResourcePressure({ apiHeapUsedPercent: 91 }),
    ),
    true,
  );
});
