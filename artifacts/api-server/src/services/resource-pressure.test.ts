import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetApiResourcePressureForTests,
  isApiResourcePressureHardBlock,
  updateApiResourcePressure,
} from "./resource-pressure";

test("route latency surfaces an api-latency driver but does not raise the saturation level", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    apiP95LatencyMs: 2_000,
    dominantSlowRouteP95Ms: 6_000,
  });

  // Request latency is external I/O, not server saturation: it no longer drives
  // the headline level, but it stays visible as the api-latency driver.
  assert.equal(snapshot.level, "normal");
  assert.equal(snapshot.drivers.find((driver) => driver.kind === "api-latency")?.level, "watch");
});

test("request latency does not raise overall level and does not freeze trading", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    apiP95LatencyMs: 2_000,
    dominantSlowRouteP95Ms: 10_000,
  });

  // Request latency no longer raises the headline level (it is external I/O, not
  // server saturation); it is surfaced as the api-latency driver instead...
  assert.equal(snapshot.level, "normal");
  assert.equal(snapshot.drivers.find((driver) => driver.kind === "api-latency")?.level, "high");
  // ...and it never saturates the server, so trading is not frozen.
  assert.equal(snapshot.resourceLevel, "normal");
  assert.equal(snapshot.caps.signalOptions.skipDeploymentScans, false);
  assert.equal(snapshot.caps.signalOptions.actionScansAllowed, true);
  assert.equal(isApiResourcePressureHardBlock(snapshot), false);

  __resetApiResourcePressureForTests();
});

test("event-loop utilization saturation raises the headline level but leaves gating untouched", () => {
  __resetApiResourcePressureForTests();

  // A loop pegged at ~95% CPU with only modest delay — the freeze signature the
  // delay metric under-reports. Utilization must surface honestly on the headline.
  const snapshot = updateApiResourcePressure({
    eventLoopUtilization: 0.95,
    // Below the 150ms delay watch line: isolates utilization as the only saturation
    // signal, so resourceLevel staying "normal" proves ELU did not leak into gating.
    eventLoopDelayP95Ms: 120,
  });

  assert.equal(snapshot.level, "high");
  const eluDriver = snapshot.drivers.find(
    (driver) => driver.kind === "api-event-loop-utilization",
  );
  assert.equal(eluDriver?.level, "high");
  assert.equal(eluDriver?.detail, "95%");
  // Gating is explicitly NOT affected: utilization feeds the display level only.
  assert.equal(snapshot.resourceLevel, "normal");
  assert.equal(snapshot.hardResourceLevel, "normal");
  assert.equal(snapshot.caps.signalOptions.actionScansAllowed, true);
  assert.equal(snapshot.caps.signalOptions.skipDeploymentScans, false);
  assert.equal(isApiResourcePressureHardBlock(snapshot), false);

  __resetApiResourcePressureForTests();
});

test("event-loop utilization watch band reads watch on the headline, normal stays clear", () => {
  __resetApiResourcePressureForTests();

  const watch = updateApiResourcePressure({ eventLoopUtilization: 0.8 });
  assert.equal(watch.level, "watch");
  assert.equal(
    watch.drivers.find((driver) => driver.kind === "api-event-loop-utilization")
      ?.level,
    "watch",
  );
  assert.equal(watch.resourceLevel, "normal");

  __resetApiResourcePressureForTests();

  const normal = updateApiResourcePressure({ eventLoopUtilization: 0.5 });
  assert.equal(normal.level, "normal");
  // driver() drops normal-level drivers, so there is nothing to surface.
  assert.equal(
    normal.drivers.find(
      (driver) => driver.kind === "api-event-loop-utilization",
    ),
    undefined,
  );

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

test("request latency does not defer signal-options action work", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    apiP95LatencyMs: 2_000,
    dominantSlowRouteP95Ms: 6_000,
  });

  // A slow external/broker route inflates latency but does not saturate the
  // server, so signal/action work keeps running.
  assert.equal(snapshot.level, "normal");
  assert.equal(snapshot.resourceLevel, "normal");
  assert.equal(snapshot.caps.signalOptions.actionScansAllowed, true);
  assert.equal(snapshot.caps.signalOptions.signalRefreshAllowed, true);
  assert.equal(isApiResourcePressureHardBlock(snapshot), false);

  __resetApiResourcePressureForTests();
});

test("single event-loop spike does not enter high resource pressure", () => {
  __resetApiResourcePressureForTests();

  const snapshot = updateApiResourcePressure({
    eventLoopDelayP95Ms: 500,
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
    eventLoopDelayP95Ms: 500,
  });
  const sustained = updateApiResourcePressure({
    eventLoopDelayP95Ms: 500,
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
    eventLoopDelayP95Ms: 200,
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

test("saturated db pool waiters drive high resource pressure after two samples (hysteresis)", () => {
  __resetApiResourcePressureForTests();

  // A single saturated-pool sample (12/12 + queue) is a transient blip: the
  // db-pool DRIVER reads "high", but the trading gate (resourceLevel) caps at
  // "watch" until the saturation persists across a second sample. The overall
  // `level` (display/general shedding) still reflects the high driver at once.
  const first = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 4,
    dbPoolMax: 12,
  });

  const driver = first.drivers.find((entry) => entry.kind === "db-pool");
  assert.equal(first.level, "high");
  assert.equal(driver?.level, "high");
  assert.equal(driver?.detail, "12/12 active, 4 waiting");
  assert.equal(driver?.score, 4);
  assert.equal(first.resourceLevel, "watch");
  assert.equal(isApiResourcePressureHardBlock(first), false);

  // Sustained saturation across a second sample reaches "high" and hard-blocks.
  const second = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 4,
    dbPoolMax: 12,
  });
  assert.equal(second.resourceLevel, "high");
  assert.equal(isApiResourcePressureHardBlock(second), true);

  __resetApiResourcePressureForTests();
});

test("large db pool queues drive high pressure after two samples (hysteresis)", () => {
  __resetApiResourcePressureForTests();

  const first = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 12,
    dbPoolMax: 12,
  });

  const driver = first.drivers.find((entry) => entry.kind === "db-pool");
  assert.equal(first.level, "high");
  assert.equal(driver?.level, "high");
  assert.equal(driver?.detail, "12/12 active, 12 waiting");
  assert.equal(driver?.score, 12);
  assert.equal(first.resourceLevel, "watch");
  assert.equal(isApiResourcePressureHardBlock(first), false);

  const second = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 12,
    dbPoolMax: 12,
  });
  assert.equal(second.resourceLevel, "high");
  assert.equal(isApiResourcePressureHardBlock(second), true);

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

test("a real queue (>=2 waiters) against a full pool enters high after two samples", () => {
  __resetApiResourcePressureForTests();

  const first = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 2,
    dbPoolMax: 12,
  });

  const driver = first.drivers.find((entry) => entry.kind === "db-pool");
  // A genuine queue is real saturation - the driver reads high immediately, but
  // the trading gate waits one more sample so a momentary 2-deep queue that
  // drains in milliseconds does not instantly freeze trading.
  assert.equal(driver?.level, "high");
  assert.equal(first.resourceLevel, "watch");
  assert.equal(isApiResourcePressureHardBlock(first), false);

  // Sustained across a second sample, the genuine queue engages the gates.
  const second = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 2,
    dbPoolMax: 12,
  });
  assert.equal(second.resourceLevel, "high");
  assert.equal(isApiResourcePressureHardBlock(second), true);

  __resetApiResourcePressureForTests();
});

test("sustained event-loop saturation raises resourceLevel but NOT hardResourceLevel", () => {
  __resetApiResourcePressureForTests();

  // Two sustained event-loop spikes with rss/heap/pool normal: resourceLevel
  // enters "high" (telemetry/display + scan gate), but hardResourceLevel — the
  // level the price/quote route-admission shed gates on — stays "normal", so
  // prices and sparklines are NOT 429-shed on an event-loop symptom.
  updateApiResourcePressure({ eventLoopDelayP95Ms: 1_500 });
  const sustained = updateApiResourcePressure({ eventLoopDelayP95Ms: 1_500 });

  assert.equal(sustained.resourceLevel, "high");
  assert.equal(sustained.hardResourceLevel, "normal");

  __resetApiResourcePressureForTests();
});

test("rss saturation trips hardResourceLevel (real exhaustion still sheds prices)", () => {
  __resetApiResourcePressureForTests();

  // RSS is a finite resource and an instant hard-block, so it trips BOTH levels
  // immediately: real memory exhaustion still sheds cheap price reads.
  const snapshot = updateApiResourcePressure({ rssMb: 9_000 });

  assert.equal(snapshot.resourceLevel, "high");
  assert.equal(snapshot.hardResourceLevel, "high");

  __resetApiResourcePressureForTests();
});

test("saturated db pool trips hardResourceLevel after two samples (finite resource)", () => {
  __resetApiResourcePressureForTests();

  // The db pool is a finite resource: hardResourceLevel follows the same
  // 2-sample hysteresis as resourceLevel and both reach "high" together.
  const first = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 4,
    dbPoolMax: 12,
  });
  assert.equal(first.hardResourceLevel, "watch");

  const second = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 4,
    dbPoolMax: 12,
  });
  assert.equal(second.hardResourceLevel, "high");

  __resetApiResourcePressureForTests();
});

test("event-loop and finite-resource hysteresis trackers stay independent", () => {
  __resetApiResourcePressureForTests();

  // resourceLevel rides the event loop up; hardResourceLevel only moves when a
  // finite resource does. Proves the two hysteresis trackers do not
  // cross-contaminate.
  updateApiResourcePressure({ eventLoopDelayP95Ms: 1_500 });
  const loopHigh = updateApiResourcePressure({ eventLoopDelayP95Ms: 1_500 });
  assert.equal(loopHigh.resourceLevel, "high");
  assert.equal(loopHigh.hardResourceLevel, "normal");

  // Now add real pool saturation on top: hard climbs on its own schedule.
  const poolFirst = updateApiResourcePressure({
    eventLoopDelayP95Ms: 1_500,
    dbPoolActive: 12,
    dbPoolWaiting: 4,
    dbPoolMax: 12,
  });
  assert.equal(poolFirst.hardResourceLevel, "watch");
  const poolSecond = updateApiResourcePressure({
    eventLoopDelayP95Ms: 1_500,
    dbPoolActive: 12,
    dbPoolWaiting: 4,
    dbPoolMax: 12,
  });
  assert.equal(poolSecond.hardResourceLevel, "high");

  __resetApiResourcePressureForTests();
});
