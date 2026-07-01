import {
  pool,
  pruneBalanceSnapshots,
  pruneClosedShadowPositionMarks,
  pruneShadowBalanceSnapshots,
  pruneSignalMonitorBreadthSnapshots,
  resolveSnapshotRetentionConfig,
  type RetentionOptions,
  type RetentionResult,
} from "@workspace/db";

// CLI for DB maintenance roadmap Phase 2 Task 7 (snapshot/diagnostic retention).
// Mirrors db-storage.ts: dry-run by default, `--execute` to delete. Windows are
// env-configurable; the implementation lives in @workspace/db/retention so the
// PGlite test harness verifies the preservation SQL.
//
//   pnpm db:snapshot-retention:audit
//   pnpm db:snapshot-retention            # dry-run
//   pnpm db:snapshot-retention -- --execute

const command = process.argv[2] ?? "audit";
const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");

const config = resolveSnapshotRetentionConfig();
const BATCH_SIZE = config.batchSize;

type Target = {
  table: string;
  cutoffColumn: string;
  retentionDays: number;
  run: (opts: RetentionOptions) => Promise<RetentionResult>;
};

const TARGETS: Target[] = [
  {
    table: "signal_monitor_breadth_snapshots",
    cutoffColumn: "captured_at",
    retentionDays: config.signalBreadthSnapshotDays,
    run: pruneSignalMonitorBreadthSnapshots,
  },
  {
    table: "balance_snapshots",
    cutoffColumn: "as_of",
    retentionDays: config.balanceSnapshotDays,
    run: pruneBalanceSnapshots,
  },
  {
    table: "shadow_balance_snapshots",
    cutoffColumn: "as_of",
    retentionDays: config.shadowBalanceSnapshotDays,
    run: pruneShadowBalanceSnapshots,
  },
  {
    table: "shadow_position_marks",
    cutoffColumn: "as_of",
    retentionDays: config.shadowPositionMarkDays,
    run: pruneClosedShadowPositionMarks,
  },
];

// Table names are hardcoded constants above, never user input.
async function loadStats(
  target: Target,
): Promise<{ rows: number; total: string; oldest: string; newest: string }> {
  const sizeRes = await pool.query<{ rows: string; total: string }>(
    `select count(*)::text as rows,
            pg_size_pretty(pg_total_relation_size('public.${target.table}')) as total
       from public.${target.table}`,
  );
  const rangeRes = await pool.query<{ oldest: Date | null; newest: Date | null }>(
    `select min(${target.cutoffColumn}) as oldest, max(${target.cutoffColumn}) as newest
       from public.${target.table}`,
  );
  return {
    rows: Number(sizeRes.rows[0]?.rows ?? "0"),
    total: sizeRes.rows[0]?.total ?? "-",
    oldest: rangeRes.rows[0]?.oldest?.toISOString() ?? "-",
    newest: rangeRes.rows[0]?.newest?.toISOString() ?? "-",
  };
}

async function audit(): Promise<void> {
  console.log(`batch_size=${BATCH_SIZE}`);
  const table = [] as Array<Record<string, unknown>>;
  for (const target of TARGETS) {
    const stats = await loadStats(target);
    const preview = await target.run({
      retentionDays: target.retentionDays,
      batchSize: BATCH_SIZE,
      dryRun: true,
    });
    table.push({
      table: target.table,
      column: target.cutoffColumn,
      retentionDays: target.retentionDays,
      rows: stats.rows,
      total: stats.total,
      candidates: preview.candidates,
      oldest: stats.oldest,
      newest: stats.newest,
    });
  }
  console.table(table);
  console.log(
    "shadow_balance_snapshots: live (non-simulation) sources only, latest per (account,source) preserved; diagnostic_snapshots already self-prunes to 24h via the diagnostics collector.",
  );
}

async function retention(): Promise<void> {
  console.log(`batch_size=${BATCH_SIZE}`);
  console.log(`dry_run=${!execute}`);
  const results: RetentionResult[] = [];
  for (const target of TARGETS) {
    results.push(
      await target.run({
        retentionDays: target.retentionDays,
        batchSize: BATCH_SIZE,
        dryRun: !execute,
      }),
    );
  }
  console.table(
    results.map((result) => ({
      table: result.table,
      cutoff: result.cutoff,
      candidates: result.candidates,
      deleted: result.deleted,
      dryRun: result.dryRun,
    })),
  );

  if (!execute) {
    console.log("Pass --execute to delete eligible rows.");
    return;
  }

  for (const result of results) {
    if (result.deleted > 0) {
      await pool.query(`vacuum (analyze) public.${result.table}`);
    }
  }

  // Re-preview to confirm the eligible set is now drained.
  const after = [] as Array<Record<string, unknown>>;
  for (const target of TARGETS) {
    const preview = await target.run({
      retentionDays: target.retentionDays,
      batchSize: BATCH_SIZE,
      dryRun: true,
    });
    after.push({ table: target.table, remainingCandidates: preview.candidates });
  }
  console.table(after);
  console.log("retention_complete=true");
}

async function main(): Promise<void> {
  if (command === "audit") {
    await audit();
    return;
  }
  if (command === "retention") {
    await retention();
    return;
  }
  throw new Error(
    "Usage: pnpm db:snapshot-retention:audit | pnpm db:snapshot-retention [-- --execute]",
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
