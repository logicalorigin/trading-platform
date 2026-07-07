import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";

import { pool } from "@workspace/db";

import {
  getCachedSerializedSignalMonitorBreadthHistory,
  resetSignalMonitorBreadthHistoryRouteCacheForTests,
} from "./signal-monitor";

afterEach(() => {
  resetSignalMonitorBreadthHistoryRouteCacheForTests();
});

after(async () => {
  await pool.end();
});

test("breadth-history route cache dedupes concurrent misses", async () => {
  let calls = 0;
  let resolve!: (value: string) => void;
  const compute = () => {
    calls += 1;
    return new Promise<string>((done) => {
      resolve = done;
    });
  };

  const first = getCachedSerializedSignalMonitorBreadthHistory({
    cacheKey: "shadow:month",
    compute,
    nowMs: 0,
  });
  const second = getCachedSerializedSignalMonitorBreadthHistory({
    cacheKey: "shadow:month",
    compute,
    nowMs: 0,
  });

  assert.equal(calls, 1);
  resolve('{"range":"month"}');
  assert.deepEqual(await Promise.all([first, second]), [
    '{"range":"month"}',
    '{"range":"month"}',
  ]);
});

test("breadth-history route cache serves hits inside TTL and recomputes after TTL", async () => {
  let calls = 0;
  const compute = async () => {
    calls += 1;
    return `{"call":${calls}}`;
  };

  assert.equal(
    await getCachedSerializedSignalMonitorBreadthHistory({
      cacheKey: "shadow:week",
      compute,
      nowMs: 0,
    }),
    '{"call":1}',
  );
  assert.equal(
    await getCachedSerializedSignalMonitorBreadthHistory({
      cacheKey: "shadow:week",
      compute,
      nowMs: 4_999,
    }),
    '{"call":1}',
  );
  assert.equal(
    await getCachedSerializedSignalMonitorBreadthHistory({
      cacheKey: "shadow:week",
      compute,
      nowMs: 5_001,
    }),
    '{"call":2}',
  );
  assert.equal(calls, 2);
});
