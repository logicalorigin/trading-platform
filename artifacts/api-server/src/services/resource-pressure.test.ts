import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetApiResourcePressureForTests,
  isApiResourcePressureHardBlock,
  updateApiResourcePressure,
} from "./resource-pressure";

test("route latency between one and ten seconds is watch pressure", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    apiP95LatencyMs: 2_000,
    dominantSlowRouteP95Ms: 6_000,
  });

  assert.equal(snapshot.level, "watch");
  assert.equal(snapshot.drivers.find((driver) => driver.kind === "api-latency")?.level, "watch");
});

test("route latency at ten seconds or higher is high pressure", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    apiP95LatencyMs: 2_000,
    dominantSlowRouteP95Ms: 10_000,
  });

  assert.equal(snapshot.level, "high");
  assert.equal(snapshot.drivers.find((driver) => driver.kind === "api-latency")?.level, "high");
  assert.equal(snapshot.caps.signalOptions.skipDeploymentScans, true);
  assert.equal(snapshot.caps.signalOptions.actionScansAllowed, false);
  assert.equal(isApiResourcePressureHardBlock(snapshot), true);
});

test("rss pressure can still force high pressure", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    rssMb: 9_000,
    apiP95LatencyMs: 2_000,
    dominantSlowRouteP95Ms: 6_000,
  });

  assert.equal(snapshot.level, "high");
  assert.equal(snapshot.drivers.find((driver) => driver.kind === "api-rss")?.level, "high");
  assert.equal(snapshot.caps.signalOptions.skipDeploymentScans, true);
  assert.equal(isApiResourcePressureHardBlock(snapshot), true);

  __resetApiResourcePressureForTests();
});

test("watch pressure defers signal-options action work without blocking signal refresh", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    apiP95LatencyMs: 2_000,
    dominantSlowRouteP95Ms: 6_000,
  });

  assert.equal(snapshot.level, "watch");
  assert.equal(snapshot.caps.signalOptions.skipDeploymentScans, false);
  assert.equal(snapshot.caps.signalOptions.signalRefreshAllowed, true);
  assert.equal(snapshot.caps.signalOptions.actionScansAllowed, false);
  assert.equal(snapshot.caps.signalOptions.positionMarksAllowed, false);
  assert.equal(isApiResourcePressureHardBlock(snapshot), false);

  __resetApiResourcePressureForTests();
});
