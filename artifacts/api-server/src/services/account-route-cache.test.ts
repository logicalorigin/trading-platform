import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { __accountEquityHistoryInternalsForTests as internals } from "./account";

test("account route cache collapses identical in-flight reads", async () => {
  internals.clearAccountRouteResponseCache();

  let factoryCalls = 0;
  const control: {
    resolve?: (value: { version: number }) => void;
  } = {};
  const first = internals.readAccountRouteResponseCache(
    "accounts",
    { mode: "live" },
    async () => {
      factoryCalls += 1;
      return new Promise<{ version: number }>((resolve) => {
        control.resolve = resolve;
      });
    },
    5_000,
    60_000,
  );
  const second = internals.readAccountRouteResponseCache(
    "accounts",
    { mode: "live" },
    async () => {
      factoryCalls += 1;
      return { version: 2 };
    },
    5_000,
    60_000,
  );

  // readAccountRouteResponseCache invokes the factory on a microtask
  // (Promise.resolve().then(factory)), so flush one tick before asserting the
  // synchronous side-effects. The in-flight entry is cached synchronously, so
  // the second call still dedupes and factory2 never runs.
  await Promise.resolve();
  assert.equal(factoryCalls, 1);
  assert.equal(first, second);
  assert.ok(control.resolve);
  control.resolve({ version: 1 });

  assert.deepEqual(await first, { version: 1 });
  assert.deepEqual(await second, { version: 1 });
});

test("account route cache serves stale response while refresh continues", async () => {
  internals.clearAccountRouteResponseCache();

  const first = await internals.readAccountRouteResponseCache(
    "equity-history",
    { accountId: "U1", range: "1D" },
    async () => ({ version: 1 }),
    5,
    1_000,
  );
  assert.deepEqual(first, { version: 1 });

  await delay(15);
  const refreshControl: {
    resolve?: (value: { version: number }) => void;
  } = {};
  const refreshStarted = { value: false };
  const secondStartedAt = Date.now();
  const second = await internals.readAccountRouteResponseCache(
    "equity-history",
    { accountId: "U1", range: "1D" },
    async () => {
      refreshStarted.value = true;
      return new Promise<{ version: number }>((resolve) => {
        refreshControl.resolve = resolve;
      });
    },
    5,
    1_000,
  );

  assert.deepEqual(second, { version: 1 });
  assert.equal(refreshStarted.value, true);
  assert.ok(Date.now() - secondStartedAt < 50);
  assert.ok(refreshControl.resolve);
  refreshControl.resolve({ version: 2 });
  await delay(0);

  const third = await internals.readAccountRouteResponseCache(
    "equity-history",
    { accountId: "U1", range: "1D" },
    async () => ({ version: 3 }),
    5,
    1_000,
  );
  assert.deepEqual(third, { version: 2 });
});
