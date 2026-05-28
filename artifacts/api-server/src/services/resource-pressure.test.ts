import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  __resetApiResourcePressureForTests,
  getApiResourcePressureSnapshot,
  isApiResourcePressureHardBlock,
  updateApiResourcePressure,
} from "./resource-pressure";

afterEach(() => {
  __resetApiResourcePressureForTests();
});

test("resource pressure escalates from API RSS", () => {
  assert.equal(updateApiResourcePressure({ rssMb: 950 }).level, "watch");
  assert.equal(updateApiResourcePressure({ rssMb: 1_250 }).level, "high");
  assert.equal(updateApiResourcePressure({ rssMb: 1_650 }).level, "critical");
});

test("resource pressure escalates from API heap pressure", () => {
  assert.equal(updateApiResourcePressure({ apiHeapUsedPercent: 72 }).level, "watch");
  assert.equal(updateApiResourcePressure({ apiHeapUsedPercent: 82 }).level, "high");
  assert.equal(updateApiResourcePressure({ apiHeapUsedPercent: 91 }).level, "critical");
});

test("high resource pressure keeps deployment scans running", () => {
  updateApiResourcePressure({ rssMb: 1_250 });

  const snapshot = getApiResourcePressureSnapshot();

  assert.equal(snapshot.level, "high");
  assert.equal(snapshot.caps.signalOptions.actionScansAllowed, true);
  assert.equal(snapshot.caps.signalOptions.positionMarksAllowed, true);
  assert.equal(snapshot.caps.signalOptions.watchlistPrewarmAllowed, false);
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

test("watch pressure records latency without pausing signal scans", () => {
  updateApiResourcePressure({ dominantSlowRouteP95Ms: 12_000 });

  const snapshot = getApiResourcePressureSnapshot();

  assert.equal(snapshot.level, "watch");
  assert.equal(snapshot.drivers[0]?.kind, "api-latency");
  assert.equal(snapshot.drivers[0]?.level, "watch");
  assert.equal("optionsFlow" in snapshot.caps, false);
  assert.equal(snapshot.caps.signalOptions.skipDeploymentScans, false);
  assert.equal(snapshot.caps.signalOptions.maintenanceOnly, false);
});

test("critical RSS pressure records diagnostics without pausing signal scans", () => {
  const snapshot = updateApiResourcePressure({ rssMb: 1_650 });

  assert.equal(snapshot.level, "critical");
  assert.equal(isApiResourcePressureHardBlock(snapshot), false);
  assert.equal("optionsFlow" in snapshot.caps, false);
  assert.equal(snapshot.caps.signalOptions.skipDeploymentScans, false);
  assert.equal(snapshot.caps.signalOptions.maintenanceOnly, false);
});

test("hard pressure blocks background scanner gates", () => {
  assert.equal(
    isApiResourcePressureHardBlock(updateApiResourcePressure({ rssMb: 3_000 })),
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
