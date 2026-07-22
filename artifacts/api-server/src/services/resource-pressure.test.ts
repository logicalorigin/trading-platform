import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetApiResourcePressureForTests,
  isApiResourcePressureHardBlock,
  subscribeApiResourcePressureChanges,
  updateApiResourcePressure,
} from "./resource-pressure";

test("pressure dispatch does not visit fresh listeners subscribed during the same update", (t) => {
  __resetApiResourcePressureForTests();
  let calls = 0;
  let unsubscribe = () => {};
  const makeListener = (): Parameters<
    typeof subscribeApiResourcePressureChanges
  >[0] => {
    return () => {
      calls += 1;
      unsubscribe();
      if (calls < 3) {
        unsubscribe = subscribeApiResourcePressureChanges(makeListener());
      }
    };
  };
  unsubscribe = subscribeApiResourcePressureChanges(makeListener());
  t.after(() => {
    unsubscribe();
    __resetApiResourcePressureForTests();
  });

  updateApiResourcePressure({ rssMb: 1 });
  assert.equal(calls, 1);

  updateApiResourcePressure({ rssMb: 2 });
  assert.equal(calls, 2);
});

test("pressure dispatch observes and contains rejected listener promises", async (t) => {
  __resetApiResourcePressureForTests();
  let thenCalled = false;
  const rejectedThenable = {
    then(
      _resolve: (value?: void | PromiseLike<void>) => void,
      reject: (reason?: unknown) => void,
    ) {
      thenCalled = true;
      reject(new Error("listener rejected"));
    },
  };
  const unsubscribe = subscribeApiResourcePressureChanges(
    () => rejectedThenable as Promise<void>,
  );
  t.after(() => {
    unsubscribe();
    __resetApiResourcePressureForTests();
  });

  updateApiResourcePressure({ rssMb: 1 });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(thenCalled, true);
});

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

test("rss saturation reads high on the headline at once but hard-blocks only after sustained (2-sample) saturation", () => {
  __resetApiResourcePressureForTests();

  // rss no longer instant-trips the trading gate: the container does not die from
  // our RSS (it recycles on a fixed infra schedule; memory stays calm), so a
  // single high sample surfaces on the display headline but the gate waits for the
  // 2-sample hysteresis — a benign RSS bump can't single-sample-freeze trading.
  const first = updateApiResourcePressure({
    rssMb: 9_000,
    apiP95LatencyMs: 2_000,
    dominantSlowRouteP95Ms: 6_000,
  });

  assert.equal(first.level, "high");
  assert.equal(first.drivers.find((driver) => driver.kind === "api-rss")?.level, "high");
  assert.equal(first.resourceLevel, "watch");
  assert.equal(isApiResourcePressureHardBlock(first), false);

  // Sustained across a second sample, a genuine RSS climb still sheds.
  const second = updateApiResourcePressure({ rssMb: 9_000 });
  assert.equal(second.resourceLevel, "high");
  assert.equal(isApiResourcePressureHardBlock(second), true);

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
  assert.equal(isApiResourcePressureHardBlock(snapshot), false);

  __resetApiResourcePressureForTests();
});

test("sustained event-loop saturation raises resourceLevel with hysteresis but no longer hard-blocks scans (Stage 2)", () => {
  __resetApiResourcePressureForTests();

  updateApiResourcePressure({
    eventLoopDelayP95Ms: 500,
  });
  const sustained = updateApiResourcePressure({
    eventLoopDelayP95Ms: 500,
  });

  // resourceLevel still tracks event-loop for display/telemetry + hysteresis...
  assert.equal(sustained.resourceLevel, "high");
  // ...but scans now gate on hardResourceLevel (finite resources only), so a busy
  // loop with rss/heap/pool normal does NOT pause trading scans (Stage 2: the CPU
  // x-ray confirmed scans aren't the loop blocker).
  assert.equal(sustained.hardResourceLevel, "normal");
  assert.equal(isApiResourcePressureHardBlock(sustained), false);

  const firstClear = updateApiResourcePressure({
    eventLoopDelayP95Ms: 20,
  });
  assert.equal(firstClear.resourceLevel, "high");
  assert.equal(isApiResourcePressureHardBlock(firstClear), false);

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
  // watch does not hard-block, so signal-options action work keeps running.
  assert.equal(isApiResourcePressureHardBlock(snapshot), false);

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

  // A single saturated-pool sample (12/12 + a deep queue) is a transient blip: the
  // db-pool DRIVER reads "high", but the trading gate (resourceLevel) caps at
  // "watch" until the saturation persists across a second sample. The overall
  // `level` (display/general shedding) still reflects the high driver at once.
  const first = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 8,
    dbPoolMax: 12,
  });

  const driver = first.drivers.find((entry) => entry.kind === "db-pool");
  assert.equal(first.level, "high");
  assert.equal(driver?.level, "high");
  assert.equal(driver?.detail, "12/12 active, 8 waiting");
  assert.equal(driver?.score, 8);
  assert.equal(first.resourceLevel, "watch");
  assert.equal(isApiResourcePressureHardBlock(first), false);

  // Sustained saturation across a second sample reaches "high" and hard-blocks.
  const second = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 8,
    dbPoolMax: 12,
  });
  assert.equal(second.resourceLevel, "high");
  assert.equal(isApiResourcePressureHardBlock(second), true);

  __resetApiResourcePressureForTests();
});

test("a saturated pool with a queue below the waiter floor stays watch and never hard-blocks", () => {
  __resetApiResourcePressureForTests();

  // The hard-block floor is half the 12-connection pool: a saturated pool with
  // only a few waiters (normal ~10-sub-read dashboard fan-out) must stay "watch"
  // even when sustained, so a busy-but-serviceable pool never degrades trading.
  const shallowQueue = {
    dbPoolActive: 12,
    dbPoolWaiting: 4,
    dbPoolMax: 12,
  };
  updateApiResourcePressure(shallowQueue);
  const sustained = updateApiResourcePressure(shallowQueue);

  const driver = sustained.drivers.find((entry) => entry.kind === "db-pool");
  assert.equal(driver?.level, "watch");
  assert.equal(sustained.resourceLevel, "watch");
  assert.equal(isApiResourcePressureHardBlock(sustained), false);

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

test("a deep queue (>= the waiter floor) against a full pool enters high after two samples", () => {
  __resetApiResourcePressureForTests();

  const first = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 6,
    dbPoolMax: 12,
  });

  const driver = first.drivers.find((entry) => entry.kind === "db-pool");
  // A deep queue (>= half the pool) is real saturation - the driver reads high
  // immediately, but the trading gate waits one more sample so a momentary deep
  // queue that drains in milliseconds does not instantly freeze trading.
  assert.equal(driver?.level, "high");
  assert.equal(first.resourceLevel, "watch");
  assert.equal(isApiResourcePressureHardBlock(first), false);

  // Sustained across a second sample, the genuine queue engages the gates.
  const second = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 6,
    dbPoolMax: 12,
  });
  assert.equal(second.resourceLevel, "high");
  assert.equal(isApiResourcePressureHardBlock(second), true);

  __resetApiResourcePressureForTests();
});

test("sustained event-loop saturation raises resourceLevel but not route memory pressure", () => {
  __resetApiResourcePressureForTests();

  // Two sustained event-loop spikes with rss/heap/pool normal: resourceLevel
  // enters "high" (telemetry/display + scan gate), while both finite-resource
  // telemetry and the memory-only route-admission level stay normal.
  updateApiResourcePressure({ eventLoopDelayP95Ms: 1_500 });
  const sustained = updateApiResourcePressure({ eventLoopDelayP95Ms: 1_500 });

  assert.equal(sustained.resourceLevel, "high");
  assert.equal(sustained.hardResourceLevel, "normal");
  assert.equal(sustained.memoryResourceLevel, "normal");

  __resetApiResourcePressureForTests();
});

test("rss saturation trips memoryResourceLevel after two samples", () => {
  __resetApiResourcePressureForTests();

  // RSS is a finite resource but no longer an INSTANT hard-block: it follows the
  // same 2-sample hysteresis as heap/pool, so real memory exhaustion still sheds
  // cheap price reads once sustained, without single-sample false freezes.
  const first = updateApiResourcePressure({ rssMb: 9_000 });
  assert.equal(first.memoryResourceLevel, "watch");
  const sustained = updateApiResourcePressure({ rssMb: 9_000 });

  assert.equal(sustained.resourceLevel, "high");
  assert.equal(sustained.hardResourceLevel, "high");
  assert.equal(sustained.memoryResourceLevel, "high");

  __resetApiResourcePressureForTests();
});

test("heap saturation surfaces immediately but hard-blocks only after two samples", () => {
  __resetApiResourcePressureForTests();

  const first = updateApiResourcePressure({ apiHeapUsedPercent: 80 });
  assert.equal(first.level, "high");
  assert.equal(first.resourceLevel, "watch");
  assert.equal(first.hardResourceLevel, "watch");
  assert.equal(first.memoryResourceLevel, "watch");
  assert.equal(isApiResourcePressureHardBlock(first), false);

  const second = updateApiResourcePressure({ apiHeapUsedPercent: 80 });
  assert.equal(second.resourceLevel, "high");
  assert.equal(second.hardResourceLevel, "high");
  assert.equal(second.memoryResourceLevel, "high");
  assert.equal(isApiResourcePressureHardBlock(second), true);

  __resetApiResourcePressureForTests();
});

test("saturated db pool remains hard-resource telemetry but not route memory pressure", () => {
  __resetApiResourcePressureForTests();

  // The db pool is a finite resource: hardResourceLevel follows the same
  // 2-sample hysteresis as resourceLevel and both reach "high" together.
  const first = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 8,
    dbPoolMax: 12,
  });
  assert.equal(first.hardResourceLevel, "watch");

  const second = updateApiResourcePressure({
    dbPoolActive: 12,
    dbPoolWaiting: 8,
    dbPoolMax: 12,
  });
  assert.equal(second.hardResourceLevel, "high");
  assert.equal(second.memoryResourceLevel, "normal");

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
    dbPoolWaiting: 8,
    dbPoolMax: 12,
  });
  assert.equal(poolFirst.hardResourceLevel, "watch");
  const poolSecond = updateApiResourcePressure({
    eventLoopDelayP95Ms: 1_500,
    dbPoolActive: 12,
    dbPoolWaiting: 8,
    dbPoolMax: 12,
  });
  assert.equal(poolSecond.hardResourceLevel, "high");

  __resetApiResourcePressureForTests();
});
