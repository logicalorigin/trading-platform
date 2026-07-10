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

const snapshot = (marker: string) => ({ marker, stateSource: "database" }) as never;

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

test("bootstrap snapshot is served from cache within the TTL and refreshed after expiry", async () => {
  let reads = 0;
  let nowMs = 0;
  let releaseRefresh = () => {};
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const reader = createSignalMonitorStreamBootstrapSnapshotReader({
    read: async () => {
      reads += 1;
      if (reads === 2) {
        await refreshGate;
      }
      return snapshot(`read-${reads}`);
    },
    now: () => nowMs,
  });

  const first = await reader("shadow" as never);
  nowMs += SIGNAL_MONITOR_MATRIX_BOOTSTRAP_SNAPSHOT_TTL_MS - 1;
  const cached = await reader("shadow" as never);
  assert.equal(reads, 1);
  assert.equal(cached, first);

  nowMs += 2;
  const refreshPromise = reader("shadow" as never);
  let refreshSettled = false;
  refreshPromise.then(() => {
    refreshSettled = true;
  });
  await Promise.resolve();
  assert.equal(refreshSettled, false);
  assert.equal(reads, 2);
  releaseRefresh();
  const refreshed = await refreshPromise;
  assert.notEqual(refreshed, first);
});

test("an expired snapshot never hides a failed database refresh", async () => {
  let reads = 0;
  let nowMs = 0;
  const reader = createSignalMonitorStreamBootstrapSnapshotReader({
    read: async () => {
      reads += 1;
      if (reads === 2) {
        throw new Error("database unavailable");
      }
      return snapshot(`read-${reads}`);
    },
    ttlMs: 10,
    now: () => nowMs,
  });

  await reader("shadow" as never);
  nowMs = 11;
  await assert.rejects(() => reader("shadow" as never), /database unavailable/);
  const recovered = (await reader("shadow" as never)) as unknown as {
    marker: string;
  };
  assert.equal(recovered.marker, "read-3");
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
