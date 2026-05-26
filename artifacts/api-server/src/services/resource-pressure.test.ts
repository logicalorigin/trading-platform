import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  __resetApiResourcePressureForTests,
  getApiResourcePressureSnapshot,
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

test("high resource pressure keeps deployment scans running", () => {
  updateApiResourcePressure({ rssMb: 1_250 });

  const snapshot = getApiResourcePressureSnapshot();

  assert.equal(snapshot.level, "high");
  assert.equal(snapshot.caps.signalOptions.skipDeploymentScans, false);
  assert.equal(snapshot.caps.signalOptions.maintenanceOnly, false);
  assert.equal("optionsFlow" in snapshot.caps, false);
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
  updateApiResourcePressure({ rssMb: 1_650 });

  const snapshot = getApiResourcePressureSnapshot();

  assert.equal(snapshot.level, "critical");
  assert.equal("optionsFlow" in snapshot.caps, false);
  assert.equal(snapshot.caps.signalOptions.skipDeploymentScans, false);
  assert.equal(snapshot.caps.signalOptions.maintenanceOnly, false);
});
