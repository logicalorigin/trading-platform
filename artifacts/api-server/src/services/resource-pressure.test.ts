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

test("single event-loop spike does not enter high resource pressure", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    eventLoopDelayP95Ms: 300,
  });

  assert.equal(snapshot.resourceLevel, "watch");
  assert.equal(
    snapshot.drivers.find((driver) => driver.kind === "api-event-loop")?.level,
    "high",
  );
  assert.equal(snapshot.caps.signalOptions.actionScansAllowed, true);
  assert.equal(snapshot.caps.signalOptions.positionMarksAllowed, true);
  assert.equal(snapshot.caps.signalOptions.skipDeploymentScans, false);
  assert.equal(snapshot.caps.signalOptions.signalRefreshAllowed, true);
  assert.equal(isApiResourcePressureHardBlock(snapshot), false);

  __resetApiResourcePressureForTests();
});

test("sustained event-loop saturation enters and exits high resource pressure with hysteresis", () => {
  __resetApiResourcePressureForTests();

  updateApiResourcePressure({
    eventLoopDelayP95Ms: 300,
  });
  const sustained = updateApiResourcePressure({
    eventLoopDelayP95Ms: 300,
  });

  assert.equal(sustained.resourceLevel, "high");
  assert.equal(isApiResourcePressureHardBlock(sustained), true);

  const firstClear = updateApiResourcePressure({
    eventLoopDelayP95Ms: 20,
  });
  assert.equal(firstClear.resourceLevel, "high");
  assert.equal(isApiResourcePressureHardBlock(firstClear), true);

  const secondClear = updateApiResourcePressure({
    eventLoopDelayP95Ms: 20,
  });
  assert.equal(secondClear.resourceLevel, "normal");
  assert.equal(isApiResourcePressureHardBlock(secondClear), false);

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

test("non-saturated db pool waiters are watch pressure, not a hard block", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    dbPoolActive: 8,
    dbPoolWaiting: 4,
    dbPoolMax: 12,
  });

  const driver = snapshot.drivers.find((entry) => entry.kind === "db-pool");
  assert.equal(snapshot.level, "watch");
  assert.equal(snapshot.resourceLevel, "watch");
  assert.equal(driver?.level, "watch");
  assert.equal(driver?.detail, "8/12 active, 4 waiting");
  assert.equal(driver?.score, 4);
  assert.equal(isApiResourcePressureHardBlock(snapshot), false);

  __resetApiResourcePressureForTests();
});

test("saturated db pool waiters drive high resource pressure immediately", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 4,
    dbPoolMax: 12,
  });

  const driver = snapshot.drivers.find((entry) => entry.kind === "db-pool");
  assert.equal(snapshot.level, "high");
  assert.equal(snapshot.resourceLevel, "high");
  assert.equal(driver?.level, "high");
  assert.equal(driver?.detail, "12/12 active, 4 waiting");
  assert.equal(driver?.score, 4);
  assert.equal(isApiResourcePressureHardBlock(snapshot), true);

  __resetApiResourcePressureForTests();
});

test("large db pool queues drive high pressure immediately", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 12,
    dbPoolMax: 12,
  });

  const driver = snapshot.drivers.find((entry) => entry.kind === "db-pool");
  assert.equal(snapshot.level, "high");
  assert.equal(snapshot.resourceLevel, "high");
  assert.equal(driver?.level, "high");
  assert.equal(driver?.detail, "12/12 active, 12 waiting");
  assert.equal(driver?.score, 12);
  assert.equal(isApiResourcePressureHardBlock(snapshot), true);

  __resetApiResourcePressureForTests();
});

test("fully occupied db pool without waiters is watch pressure", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 0,
    dbPoolMax: 12,
  });

  const driver = snapshot.drivers.find((entry) => entry.kind === "db-pool");
  assert.equal(snapshot.level, "watch");
  assert.equal(snapshot.resourceLevel, "watch");
  assert.equal(driver?.level, "watch");
  assert.equal(driver?.detail, "12/12 active, 0 waiting");
  assert.equal(isApiResourcePressureHardBlock(snapshot), false);

  __resetApiResourcePressureForTests();
});

test("a single waiter against a full pool is watch, not high (de-flap)", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 1,
    dbPoolMax: 12,
  });

  const driver = snapshot.drivers.find((entry) => entry.kind === "db-pool");
  // One transient waiter at a full pool is a momentary blip, not sustained
  // saturation - it must not fire the high-pressure back-pressure gates.
  assert.equal(snapshot.resourceLevel, "watch");
  assert.equal(driver?.level, "watch");
  assert.equal(driver?.detail, "12/12 active, 1 waiting");
  assert.equal(isApiResourcePressureHardBlock(snapshot), false);

  __resetApiResourcePressureForTests();
});

test("a real queue (>=2 waiters) against a full pool still enters high", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 2,
    dbPoolMax: 12,
  });

  const driver = snapshot.drivers.find((entry) => entry.kind === "db-pool");
  // A genuine queue is real saturation - the gates should still engage.
  assert.equal(snapshot.resourceLevel, "high");
  assert.equal(driver?.level, "high");
  assert.equal(isApiResourcePressureHardBlock(snapshot), true);

  __resetApiResourcePressureForTests();
});
