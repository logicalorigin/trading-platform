import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { __shadowAccountStreamInternalsForTests } from "./shadow-account-streams";
import type { ShadowAccountChange } from "./shadow-account-events";

const source = readFileSync(new URL("./shadow-account-streams.ts", import.meta.url), "utf8");

test("shadow account stream snapshot uses live quote hydration", () => {
  const start = source.indexOf("export async function fetchShadowAccountSnapshotBase");
  assert.notEqual(start, -1, "Missing fetchShadowAccountSnapshotBase");
  const nextFunction = source.indexOf("\nexport function", start + 1);
  const body = source.slice(start, nextFunction === -1 ? undefined : nextFunction);

  assert.match(body, /getShadowAccountPositions\(\{ liveQuotes: true \}\)/);
  assert.doesNotMatch(body, /getShadowAccountPositions\(\{ liveQuotes: false \}\)/);
});

test("shadow account stream snapshot cache spans multiple poll ticks", () => {
  const ttl = source.match(/const SHADOW_ACCOUNT_SNAPSHOT_TTL_MS = ([0-9_]+);/);
  const interval = source.match(
    /export const SHADOW_ACCOUNT_STREAM_INTERVAL_MS = ([0-9_]+);/,
  );
  assert.ok(ttl, "Missing shadow snapshot TTL");
  assert.ok(interval, "Missing shadow stream interval");

  const ttlMs = Number(ttl[1]?.replaceAll("_", ""));
  const intervalMs = Number(interval[1]?.replaceAll("_", ""));
  assert.ok(ttlMs >= intervalMs * 4);
});

test("shadow account stream skips full signature work for reused cached snapshots", () => {
  const start = source.indexOf("function createPollingStream");
  assert.notEqual(start, -1, "Missing createPollingStream");
  const end = source.indexOf("\nexport async function", start + 1);
  const body = source.slice(start, end === -1 ? undefined : end);

  assert.match(body, /let lastSnapshot: T \| null = null/);
  assert.match(body, /snapshot !== lastSnapshot/);
  assert.match(body, /lastSnapshot = snapshot/);
});

type FakeTimer = {
  callback: () => void;
  delayMs: number;
  cleared: boolean;
  unrefCalled: boolean;
  unref: () => void;
};

async function flushAsyncWork() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("shadow account stream waits a full interval after an in-flight event", async (t) => {
  const timeouts: FakeTimer[] = [];
  t.mock.method(globalThis, "setTimeout", ((callback: () => void, delayMs: number) => {
    const timer: FakeTimer = {
      callback,
      delayMs,
      cleared: false,
      unrefCalled: false,
      unref: () => {
        timer.unrefCalled = true;
      },
    };
    timeouts.push(timer);
    return timer as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
  t.mock.method(globalThis, "clearTimeout", ((timer: FakeTimer) => {
    timer.cleared = true;
  }) as unknown as typeof clearTimeout);

  let releaseFirstFetch: () => void = () => undefined;
  const firstFetch = new Promise<void>((resolve) => {
    releaseFirstFetch = resolve;
  });
  let releaseSecondFetch: () => void = () => undefined;
  const secondFetch = new Promise<void>((resolve) => {
    releaseSecondFetch = resolve;
  });
  let fetchCount = 0;
  let snapshotCount = 0;
  let invalidationCount = 0;
  let immediateSubscribed = false;
  let emitShadowChange!: (_change: ShadowAccountChange) => void;

  const unsubscribe = __shadowAccountStreamInternalsForTests.createPollingStream({
    intervalMs: 2_000,
    fetchSnapshot: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        await firstFetch;
      } else if (fetchCount === 2) {
        await secondFetch;
      }
      return { fetchCount };
    },
    onSnapshot: () => {
      snapshotCount += 1;
    },
    subscribeImmediate: (listener) => {
      immediateSubscribed = true;
      emitShadowChange = listener;
      return () => {
        immediateSubscribed = false;
      };
    },
    beforeImmediateSnapshot: () => {
      invalidationCount += 1;
    },
  });
  let unsubscribed = false;
  try {
    assert.equal(fetchCount, 1, "the initial fetch starts immediately");

    emitShadowChange({
      reason: "ledger",
    });
    assert.equal(invalidationCount, 1);
    releaseFirstFetch();
    await flushAsyncWork();
    assert.equal(snapshotCount, 1);

    assert.equal(
      fetchCount,
      1,
      "an in-flight event must not trigger a recovery-loop fetch",
    );
    assert.equal(timeouts.length, 1);
    assert.equal(timeouts[0]?.delayMs, 2_000);
    assert.equal(timeouts[0]?.unrefCalled, true);

    timeouts[0]?.callback();
    assert.equal(fetchCount, 2, "the coalesced refresh runs on the next cadence");
    unsubscribe();
    unsubscribed = true;
    assert.equal(immediateSubscribed, false);
    releaseSecondFetch();
    await flushAsyncWork();
    assert.equal(timeouts.length, 1, "unsubscribe cancels post-flight scheduling");
    timeouts[0]?.callback();
    await flushAsyncWork();
    assert.equal(fetchCount, 2, "a stale timer cannot fetch after unsubscribe");
  } finally {
    if (!unsubscribed) {
      unsubscribe();
    }
  }
});
