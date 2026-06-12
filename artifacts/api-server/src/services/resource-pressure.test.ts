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

test("request latency raises overall level but does not freeze trading", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    apiP95LatencyMs: 2_000,
    dominantSlowRouteP95Ms: 10_000,
  });

  // Request latency still raises the overall level (general shedding/display)...
  assert.equal(snapshot.level, "high");
  assert.equal(snapshot.drivers.find((driver) => driver.kind === "api-latency")?.level, "high");
  // ...but it is external I/O, not server saturation, so trading is not frozen.
  assert.equal(snapshot.resourceLevel, "normal");
  assert.equal(snapshot.caps.signalOptions.skipDeploymentScans, false);
  assert.equal(snapshot.caps.signalOptions.actionScansAllowed, true);
  assert.equal(isApiResourcePressureHardBlock(snapshot), false);

  __resetApiResourcePressureForTests();
});

test("rss pressure can still force high pressure without blocking signal refresh", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    rssMb: 9_000,
    apiP95LatencyMs: 2_000,
    dominantSlowRouteP95Ms: 6_000,
  });

  assert.equal(snapshot.level, "high");
  assert.equal(snapshot.drivers.find((driver) => driver.kind === "api-rss")?.level, "high");
  assert.equal(snapshot.caps.signalOptions.skipDeploymentScans, false);
  assert.equal(snapshot.caps.signalOptions.signalRefreshAllowed, true);
  assert.equal(snapshot.caps.signalOptions.actionScansAllowed, true);
  assert.equal(snapshot.caps.signalOptions.positionMarksAllowed, true);
  assert.equal(isApiResourcePressureHardBlock(snapshot), true);

  __resetApiResourcePressureForTests();
});

test("request latency watch does not defer signal-options action work", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    apiP95LatencyMs: 2_000,
    dominantSlowRouteP95Ms: 6_000,
  });

  // A slow external/broker route inflates latency but does not saturate the
  // server, so signal/action work keeps running.
  assert.equal(snapshot.level, "watch");
  assert.equal(snapshot.resourceLevel, "normal");
  assert.equal(snapshot.caps.signalOptions.actionScansAllowed, true);
  assert.equal(snapshot.caps.signalOptions.signalRefreshAllowed, true);
  assert.equal(isApiResourcePressureHardBlock(snapshot), false);

  __resetApiResourcePressureForTests();
});

test("event-loop saturation does not suppress signal-options work", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    eventLoopDelayP95Ms: 300,
  });

  assert.equal(snapshot.resourceLevel, "high");
  assert.equal(
    snapshot.drivers.find((driver) => driver.kind === "api-event-loop")?.level,
    "high",
  );
  assert.equal(snapshot.caps.signalOptions.actionScansAllowed, true);
  assert.equal(snapshot.caps.signalOptions.positionMarksAllowed, true);
  assert.equal(snapshot.caps.signalOptions.skipDeploymentScans, false);
  assert.equal(snapshot.caps.signalOptions.signalRefreshAllowed, true);
  assert.equal(isApiResourcePressureHardBlock(snapshot), true);

  __resetApiResourcePressureForTests();
});

test("event-loop watch does not defer signal-options action work", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    eventLoopDelayP95Ms: 100,
  });

  assert.equal(snapshot.resourceLevel, "watch");
  assert.equal(snapshot.caps.signalOptions.actionScansAllowed, true);
  assert.equal(snapshot.caps.signalOptions.positionMarksAllowed, true);
  assert.equal(snapshot.caps.signalOptions.signalRefreshAllowed, true);

  __resetApiResourcePressureForTests();
});
