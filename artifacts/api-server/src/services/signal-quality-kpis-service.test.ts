import assert from "node:assert/strict";
import test from "node:test";

import { __signalQualityKpisServiceInternalsForTests } from "./signal-quality-kpis-service";

const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("signal-quality KPI cold recomputes are serialized", async () => {
  const { getKpiComputeQueueSnapshot, runQueuedKpiCompute } =
    __signalQualityKpisServiceInternalsForTests;
  const starts: string[] = [];
  let releaseFirst: () => void = () => {
    throw new Error("first task did not start");
  };

  const first = runQueuedKpiCompute(async () => {
    starts.push("first");
    await new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    return "first";
  });
  const second = runQueuedKpiCompute(async () => {
    starts.push("second");
    return "second";
  });

  await nextTick();

  assert.deepEqual(starts, ["first"]);
  assert.deepEqual(getKpiComputeQueueSnapshot(), {
    active: 1,
    queued: 1,
    concurrency: 1,
    barFetchConcurrency: 3,
  });

  releaseFirst();

  assert.equal(await first, "first");
  assert.equal(await second, "second");
  assert.deepEqual(starts, ["first", "second"]);
  await nextTick();
  assert.deepEqual(getKpiComputeQueueSnapshot(), {
    active: 0,
    queued: 0,
    concurrency: 1,
    barFetchConcurrency: 3,
  });
});

test("signal-quality KPI queue releases the slot after synchronous failure", async () => {
  const { getKpiComputeQueueSnapshot, runQueuedKpiCompute } =
    __signalQualityKpisServiceInternalsForTests;
  const starts: string[] = [];

  const failed = runQueuedKpiCompute(() => {
    starts.push("failed");
    throw new Error("synthetic failure");
  });
  const next = runQueuedKpiCompute(async () => {
    starts.push("next");
    return "next";
  });

  await assert.rejects(failed, /synthetic failure/);
  assert.equal(await next, "next");
  assert.deepEqual(starts, ["failed", "next"]);
  await nextTick();
  assert.deepEqual(getKpiComputeQueueSnapshot(), {
    active: 0,
    queued: 0,
    concurrency: 1,
    barFetchConcurrency: 3,
  });
});
