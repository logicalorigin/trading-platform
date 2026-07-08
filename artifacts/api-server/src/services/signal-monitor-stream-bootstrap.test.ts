import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_MONITOR_MATRIX_BOOTSTRAP_SNAPSHOT_TTL_MS,
  createSignalMonitorStreamBootstrapSnapshotReader,
} from "./signal-monitor";

// Regression guards for the SSE bootstrap single-flight: every matrix stream
// subscriber shares one environment-wide stored-state read. Without this,
// each connection ran its own full-universe read (~12k rows), and the boot
// double-connect (initial + timeframe-widen re-key, multiplied by tabs)
// queued duplicate reads on the saturated 12-connection pool until the 15s
// statement timeout 500'd the stream.

const snapshot = (marker: string, stateSource = "stored") =>
  ({ marker, stateSource }) as never;

test("concurrent bootstrap reads share one underlying stored-state read", async () => {
  let reads = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reader = createSignalMonitorStreamBootstrapSnapshotReader({
    read: async () => {
      reads += 1;
      await gate;
      return snapshot(`read-${reads}`);
    },
  });

  const first = reader("shadow" as never);
  const second = reader("shadow" as never);
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(reads, 1);
  assert.equal(left, right);
});

test("bootstrap snapshot is served from cache within the TTL and refreshed after stale reuse", async () => {
  let reads = 0;
  let nowMs = 0;
  let releaseRefresh = () => {};
  let resolveRefreshDone = (_snapshot: unknown) => {};
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const refreshDone = new Promise<unknown>((resolve) => {
    resolveRefreshDone = resolve;
  });
  const reader = createSignalMonitorStreamBootstrapSnapshotReader({
    read: async () => {
      reads += 1;
      if (reads === 2) {
        await refreshGate;
      }
      const result = snapshot(`read-${reads}`);
      if (reads === 2) {
        resolveRefreshDone(result);
      }
      return result;
    },
    now: () => nowMs,
  });

  const first = await reader("shadow" as never);
  nowMs += SIGNAL_MONITOR_MATRIX_BOOTSTRAP_SNAPSHOT_TTL_MS - 1;
  const cached = await reader("shadow" as never);
  assert.equal(reads, 1);
  assert.equal(cached, first);

  nowMs += 2;
  const stalePromise = reader("shadow" as never);
  let staleSettled = false;
  stalePromise.then(() => {
    staleSettled = true;
  });
  await Promise.resolve();
  assert.equal(staleSettled, true);
  assert.equal(await stalePromise, first);
  assert.equal(reads, 2);
  releaseRefresh();
  await refreshDone;
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

  const refreshed = await reader("shadow" as never);
  assert.notEqual(refreshed, first);
});

test("environments do not share bootstrap snapshots", async () => {
  const seen: string[] = [];
  const reader = createSignalMonitorStreamBootstrapSnapshotReader({
    read: async (environment) => {
      seen.push(String(environment));
      return snapshot(String(environment));
    },
  });

  await reader("shadow" as never);
  await reader("live" as never);
  assert.deepEqual(seen, ["shadow", "live"]);
});

test("degraded runtime-fallback snapshots are never cached", async () => {
  let reads = 0;
  const reader = createSignalMonitorStreamBootstrapSnapshotReader({
    read: async () => {
      reads += 1;
      return snapshot(`read-${reads}`, "runtime-fallback");
    },
  });

  await reader("shadow" as never);
  await reader("shadow" as never);
  // Each call re-reads: a transient DB blip must not pin empty bootstraps on
  // every reconnect for a full TTL.
  assert.equal(reads, 2);
});

test("a failed read is not cached and the next call retries", async () => {
  let reads = 0;
  const reader = createSignalMonitorStreamBootstrapSnapshotReader({
    read: async () => {
      reads += 1;
      if (reads === 1) {
        throw new Error("statement timeout");
      }
      return snapshot(`read-${reads}`);
    },
  });

  await assert.rejects(() => reader("shadow" as never), /statement timeout/);
  const recovered = (await reader("shadow" as never)) as unknown as {
    marker: string;
  };
  assert.equal(reads, 2);
  assert.equal(recovered.marker, "read-2");
});
