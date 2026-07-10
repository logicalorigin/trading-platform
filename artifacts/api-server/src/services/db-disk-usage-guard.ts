import { pool } from "@workspace/db";
import * as dbExports from "@workspace/db";

import { logger } from "../lib/logger";

// DB disk-usage guard (Task: dev-DB crash-loop recovery hardening).
//
// Context: the shared dev Postgres has a hard disk quota. bar_cache once grew
// unbounded to ~18M rows / ~8GB; a manual VACUUM FULL against that table then
// hit the quota mid-rewrite and left the cluster crash-looping (orphaned
// rewrite files pinned the quota so recovery PANICked). Retention
// (lib/db/src/retention.ts + snapshot-retention-scheduler) now bounds growth,
// but nothing WATCHED total usage or stopped the highest-volume writer before
// the quota wall. This guard closes that gap:
//
//   1. Every `DB_DISK_USAGE_CHECK_INTERVAL_MS` (default 15 min) it samples
//      pg_database_size(current_database()) and bar_cache's relation size in
//      the background DB lane.
//   2. At/above `DB_DISK_USAGE_WARN_MB` (default 6144) it logs at WARN — the
//      dev supervisor pins the API to LOG_LEVEL=warn, so info logs are
//      invisible; warn is the minimum visible severity.
//   3. At/above `DB_DISK_USAGE_BAR_CACHE_BLOCK_MB` (default 8192) it blocks
//      the bar_cache WRITE path (persistMarketDataBars* return "skipped"/false,
//      their normal degraded-mode result; readers and every other table are
//      untouched) until usage drops back below the threshold — retention keeps
//      running and is what brings it back down.
//
// Fail-open by design: unknown usage never blocks. Before the first
// successful probe the guard is inert, and an existing BLOCK decision only
// holds while the last successful probe is fresh (within
// `DB_DISK_USAGE_BLOCK_MAX_STALE_MS`, default 3x the check interval). If the
// probe starts failing — DB down, quota-PANIC crash-loop — the block lapses
// once the snapshot goes stale instead of pinning writes off indefinitely;
// an unreachable DB already degrades persistence via the writers' transient
// backoff, so the guard must not add a second, sticky failure mode. Disable
// entirely with DB_DISK_USAGE_GUARD_ENABLED=false.

type DbLaneRunner = <T>(lane: "background", fn: () => T) => T;
const runInDbLane = (
  dbExports as typeof dbExports & { runInDbLane: DbLaneRunner }
).runInDbLane;

const MB = 1024 * 1024;
const DEFAULT_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const MIN_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_INITIAL_DELAY_MS = 90_000; // let startup settle first
const DEFAULT_WARN_MB = 6_144;
const DEFAULT_BAR_CACHE_BLOCK_MB = 8_192;

export type DbDiskUsageSnapshot = {
  checkedAt: string;
  databaseBytes: number;
  barCacheBytes: number;
  warnBytes: number;
  blockBytes: number;
  barCacheWritesBlocked: boolean;
};

function envMb(name: string, fallbackMb: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallbackMb;
}

function envMs(name: string, fallback: number, min: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= min ? Math.floor(parsed) : fallback;
}

let snapshot: DbDiskUsageSnapshot | null = null;
let guardTimer: ReturnType<typeof setTimeout> | null = null;
let probeRunning = false;
let resolvedCheckIntervalMs = DEFAULT_CHECK_INTERVAL_MS;

export function getDbDiskUsageSnapshot(): DbDiskUsageSnapshot | null {
  return snapshot;
}

function blockMaxStaleMs(): number {
  return envMs(
    "DB_DISK_USAGE_BLOCK_MAX_STALE_MS",
    3 * resolvedCheckIntervalMs,
    MIN_CHECK_INTERVAL_MS,
  );
}

/**
 * True only when the LAST SUCCESSFUL probe measured usage at/above the block
 * threshold AND that probe is still fresh. Unknown usage never blocks: no
 * probe yet, or a blocked snapshot older than DB_DISK_USAGE_BLOCK_MAX_STALE_MS
 * (probes failing), fails open.
 */
export function isBarCacheWriteBlockedByDbDiskUsage(
  nowMs: number = Date.now(),
): boolean {
  if (!snapshot?.barCacheWritesBlocked) {
    return false;
  }
  const checkedAtMs = Date.parse(snapshot.checkedAt);
  if (!Number.isFinite(checkedAtMs)) {
    return false;
  }
  return nowMs - checkedAtMs <= blockMaxStaleMs();
}

async function probeOnce(): Promise<void> {
  if (probeRunning) {
    return;
  }
  probeRunning = true;
  try {
    const warnBytes = envMb("DB_DISK_USAGE_WARN_MB", DEFAULT_WARN_MB) * MB;
    const blockBytes =
      envMb("DB_DISK_USAGE_BAR_CACHE_BLOCK_MB", DEFAULT_BAR_CACHE_BLOCK_MB) * MB;
    const result = await runInDbLane("background", async () =>
      pool.query<{ database_bytes: string; bar_cache_bytes: string }>(
        `select pg_database_size(current_database())::text as database_bytes,
                coalesce(pg_total_relation_size(to_regclass('public.bar_cache')), 0)::text as bar_cache_bytes`,
      ),
    );
    const databaseBytes = Number(result.rows[0]?.database_bytes ?? 0);
    const barCacheBytes = Number(result.rows[0]?.bar_cache_bytes ?? 0);
    if (!Number.isFinite(databaseBytes) || databaseBytes <= 0) {
      return; // fail-open: keep previous state
    }

    const wasBlocked = snapshot?.barCacheWritesBlocked ?? false;
    const safeBarCacheBytes = Number.isFinite(barCacheBytes) ? barCacheBytes : 0;
    const blocked = safeBarCacheBytes >= blockBytes;
    snapshot = {
      checkedAt: new Date().toISOString(),
      databaseBytes,
      barCacheBytes: safeBarCacheBytes,
      warnBytes,
      blockBytes,
      barCacheWritesBlocked: blocked,
    };

    const detail = {
      databaseMb: Math.round(databaseBytes / MB),
      barCacheMb: Math.round(safeBarCacheBytes / MB),
      warnMb: Math.round(warnBytes / MB),
      blockMb: Math.round(blockBytes / MB),
    };
    if (blocked) {
      logger.warn(
        detail,
        wasBlocked
          ? "bar_cache size still at/above hard cap; bar_cache writes remain paused"
          : "bar_cache size reached hard cap; pausing bar_cache writes until retention frees space",
      );
    } else if (wasBlocked) {
      logger.warn(detail, "bar_cache size back below hard cap; bar_cache writes resumed");
    } else if (databaseBytes >= warnBytes) {
      logger.warn(
        detail,
        "DB disk usage above warning threshold; check bar_cache retention before quota is hit",
      );
    }
  } catch (err) {
    // Fail-open: keep the last snapshot for observability, but an active block
    // lapses on its own once the snapshot exceeds the staleness window (see
    // isBarCacheWriteBlockedByDbDiskUsage).
    logger.warn(
      {
        err,
        lastCheckedAt: snapshot?.checkedAt ?? null,
        blockMaxStaleMs: blockMaxStaleMs(),
      },
      "DB disk-usage probe failed; an active bar_cache write block lapses once the last snapshot goes stale",
    );
  } finally {
    probeRunning = false;
  }
}

export function startDbDiskUsageGuard(): void {
  if (process.env["DB_DISK_USAGE_GUARD_ENABLED"] === "false") {
    logger.info("DB disk-usage guard disabled (DB_DISK_USAGE_GUARD_ENABLED=false)");
    return;
  }
  if (guardTimer) {
    return;
  }
  const intervalMs = envMs(
    "DB_DISK_USAGE_CHECK_INTERVAL_MS",
    DEFAULT_CHECK_INTERVAL_MS,
    MIN_CHECK_INTERVAL_MS,
  );
  resolvedCheckIntervalMs = intervalMs;
  const initialDelayMs = envMs(
    "DB_DISK_USAGE_INITIAL_DELAY_MS",
    DEFAULT_INITIAL_DELAY_MS,
    0,
  );
  const schedule = (delayMs: number) => {
    guardTimer = setTimeout(async () => {
      await probeOnce();
      schedule(intervalMs);
    }, delayMs);
    guardTimer.unref?.();
  };
  schedule(initialDelayMs);
  logger.info({ intervalMs, initialDelayMs }, "DB disk-usage guard started");
}

export function stopDbDiskUsageGuardForTests(): void {
  if (guardTimer) {
    clearTimeout(guardTimer);
    guardTimer = null;
  }
}

export function __setDbDiskUsageSnapshotForTests(
  value: DbDiskUsageSnapshot | null,
): void {
  snapshot = value;
}

export function __probeDbDiskUsageOnceForTests(): Promise<void> {
  return probeOnce();
}
