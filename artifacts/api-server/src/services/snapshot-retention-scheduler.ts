import {
  resolveSnapshotRetentionConfig,
  runAllSnapshotRetention,
} from "@workspace/db";
import * as dbExports from "@workspace/db";

import { logger } from "../lib/logger";

// Periodic driver for the Task 7 snapshot/diagnostic retention (DB maintenance
// roadmap Phase 2). The retention functions live in @workspace/db/retention and
// are reader-preserving + dry-run-tested; this just executes them on a cadence so
// the forward-looking windows actually bound table growth as data ages.
//
// Env: SNAPSHOT_RETENTION_ENABLED=false to disable; SNAPSHOT_RETENTION_INTERVAL_MS
// to override the 6h cadence; window/batch vars are read by resolveSnapshotRetentionConfig.

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h, matching the market-data worker cadence
const INITIAL_DELAY_MS = 5 * 60 * 1000; // let startup settle before the first sweep
const MIN_INTERVAL_MS = 60_000;
type DbLaneRunner = <T>(lane: "background", fn: () => T) => T;
const runInDbLane = (
  dbExports as typeof dbExports & { runInDbLane: DbLaneRunner }
).runInDbLane;

function resolveIntervalMs(): number {
  const raw = process.env.SNAPSHOT_RETENTION_INTERVAL_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= MIN_INTERVAL_MS
    ? Math.floor(parsed)
    : DEFAULT_INTERVAL_MS;
}

let running = false;

async function runOnce(): Promise<void> {
  return runInDbLane("background", async () => {
    if (running) {
      logger.warn("Snapshot retention sweep already running; skipping overlap");
      return;
    }
    running = true;
    try {
      const config = resolveSnapshotRetentionConfig();
      const results = await runAllSnapshotRetention({ config, dryRun: false });
      for (const result of results) {
        logger.info(
          {
            table: result.table,
            cutoff: result.cutoff,
            candidates: result.candidates,
            deleted: result.deleted,
          },
          "Snapshot retention sweep",
        );
      }
    } catch (err) {
      logger.warn({ err }, "Snapshot retention sweep failed");
    } finally {
      running = false;
    }
  });
}

export function startSnapshotRetentionScheduler(): void {
  if (process.env.SNAPSHOT_RETENTION_ENABLED === "false") {
    logger.info(
      "Snapshot retention scheduler disabled (SNAPSHOT_RETENTION_ENABLED=false)",
    );
    return;
  }

  const intervalMs = resolveIntervalMs();
  setTimeout(() => {
    void runOnce();
    const timer = setInterval(() => {
      void runOnce();
    }, intervalMs);
    timer.unref?.();
  }, INITIAL_DELAY_MS).unref?.();

  logger.info({ intervalMs }, "Snapshot retention scheduler started");
}
