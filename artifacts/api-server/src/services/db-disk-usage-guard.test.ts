import assert from "node:assert/strict";
import test from "node:test";

import {
  __setDbDiskUsageSnapshotForTests,
  isBarCacheWriteBlockedByDbDiskUsage,
  type DbDiskUsageSnapshot,
} from "./db-disk-usage-guard";

const MB = 1024 * 1024;

const snapshotAt = (
  checkedAtMs: number,
  overrides: Partial<DbDiskUsageSnapshot> = {},
): DbDiskUsageSnapshot => ({
  checkedAt: new Date(checkedAtMs).toISOString(),
  databaseBytes: 9_000 * MB,
  barCacheBytes: 7_000 * MB,
  warnBytes: 6_144 * MB,
  blockBytes: 8_192 * MB,
  barCacheWritesBlocked: true,
  ...overrides,
});

test("disk-usage guard never blocks before the first successful probe", () => {
  __setDbDiskUsageSnapshotForTests(null);
  assert.equal(isBarCacheWriteBlockedByDbDiskUsage(), false);
});

test("disk-usage guard blocks on a fresh at-cap snapshot", () => {
  const now = Date.now();
  __setDbDiskUsageSnapshotForTests(snapshotAt(now - 60_000));
  assert.equal(isBarCacheWriteBlockedByDbDiskUsage(now), true);
  __setDbDiskUsageSnapshotForTests(null);
});

test("disk-usage guard does not block when usage recovered below the cap", () => {
  const now = Date.now();
  __setDbDiskUsageSnapshotForTests(
    snapshotAt(now - 60_000, {
      databaseBytes: 5_000 * MB,
      barCacheWritesBlocked: false,
    }),
  );
  assert.equal(isBarCacheWriteBlockedByDbDiskUsage(now), false);
  __setDbDiskUsageSnapshotForTests(null);
});

test("disk-usage guard fails open when a blocked snapshot goes stale (probes failing)", () => {
  const now = Date.now();
  // Default staleness window is 3x the 15-min check interval = 45 min.
  const staleMs = 46 * 60_000;
  __setDbDiskUsageSnapshotForTests(snapshotAt(now - staleMs));
  assert.equal(isBarCacheWriteBlockedByDbDiskUsage(now), false);
  // Just inside the window still blocks.
  __setDbDiskUsageSnapshotForTests(snapshotAt(now - 44 * 60_000));
  assert.equal(isBarCacheWriteBlockedByDbDiskUsage(now), true);
  __setDbDiskUsageSnapshotForTests(null);
});

test("disk-usage guard fails open on an unparseable snapshot timestamp", () => {
  __setDbDiskUsageSnapshotForTests(
    snapshotAt(Date.now(), { checkedAt: "not-a-timestamp" }),
  );
  assert.equal(isBarCacheWriteBlockedByDbDiskUsage(), false);
  __setDbDiskUsageSnapshotForTests(null);
});
