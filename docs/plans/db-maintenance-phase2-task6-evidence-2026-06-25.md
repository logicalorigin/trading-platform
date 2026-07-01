# DB Maintenance Phase 2 Task 6 Evidence - 2026-06-25

## Scope

- Roadmap: `docs/plans/db-maintenance-roadmap-2026-06-25.md`
- Task: Phase 2 Task 6, add `market_data_ingest_jobs` retention
- Session: `019f0123-d58e-7be3-9c04-a1f835e5960c`
- DB target: Replit internal Postgres host `helium`, database `heliumdb`
- Backup gate: `/tmp/db-maintenance-backups/phase2-task6-market-data-ingest-jobs-20260626T0037Z.dump`
- Backup SHA-256: `7c1d94bc3cc624c6cea228ea98edadaa0ef22e9ba5537419b6efafb3f982c5a1`
- Forbidden path status: no `drizzle-kit push` used.

## Source Proof

- `lib/db/src/schema/market-data.ts` defines `market_data_ingest_jobs` with `status`, lease fields, `next_run_at`, `dedupe_key`, `payload`, and timestamps.
- `crates/market-data-worker/src/jobs.rs` claims only due `queued` jobs or stale `running` jobs with expired leases.
- Same-bucket `gex_snapshot` jobs require matching completed `stock_snapshot` and `option_chain_snapshot` prerequisite jobs when `payload->>'dedupeBucket'` is present.
- `artifacts/api-server/src/services/market-data-ingest.ts` can requeue terminal dedupe rows and can insert a new row if an old terminal row was deleted.
- `artifacts/api-server/src/services/signal-monitor.ts` reads recent jobs for diagnostics; this is bounded recent visibility, not durable ledger state.

## Code Change

Worker retention now includes `market_data_ingest_jobs`:

- Config: `MARKET_DATA_JOB_RETENTION_DAYS`, default `14`.
- Scope: rows older than the configured window by `updated_at`.
- Status gate: `completed`, `failed`, and `cancelled` only.
- Live-job preservation: `queued` and `running` rows are not terminal candidates.
- GEX prerequisite preservation: old `stock_snapshot` and `option_chain_snapshot` rows are preserved while a same-symbol, same-`dedupeBucket` `gex_snapshot` job is still `queued` or `running`.
- Batch behavior: existing retention execution uses bounded `ctid` chunks with `MARKET_DATA_RETENTION_BATCH_SIZE`, default `20,000`.

Focused worker test:

```bash
node scripts/run-market-data-worker.mjs test -p market-data-worker retention_targets_include_safe_terminal_job_cleanup
```

Observed result: passed.

Full worker test/format checks:

```bash
node scripts/run-market-data-worker.mjs test -p market-data-worker
pnpm run fmt:market-data-worker
```

Observed result: both passed.

## Pre-Execute Evidence

Pre-change row distribution:

| Status | Kind | Rows |
|---|---|---:|
| `cancelled` | `gex_snapshot` | 2,122 |
| `cancelled` | `option_chain_snapshot` | 1,922 |
| `cancelled` | `stock_snapshot` | 1,263 |
| `completed` | `gex_snapshot` | 1,420 |
| `completed` | `option_chain_snapshot` | 1,626 |
| `completed` | `stock_snapshot` | 2,288 |
| `failed` | `gex_snapshot` | 13 |
| `failed` | `option_chain_snapshot` | 8 |
| `failed` | `stock_snapshot` | 6 |

Candidate counts by age before execute:

| Window | Terminal candidates |
|---|---:|
| Older than 14 days | 8,007 |
| Older than 30 days | 0 |
| Older than 60 days | 0 |

Runtime env check:

```text
MARKET_DATA_JOB_RETENTION_DAYS=<unset>
MARKET_DATA_RETENTION_BATCH_SIZE=<unset>
```

Observed result: runtime falls back to source-confirmed defaults, `14` days and `20,000` rows per chunk.

Dry-run command:

```bash
pnpm run market-data-worker:retention
```

Dry-run output:

| Table | Retention | Affected rows | Dry-run |
|---|---:|---:|---|
| `quote_cache` | 7 days | 0 | true |
| `bar_cache` intraday scope | 90 days | 0 | true |
| `bar_cache` coarse scope | 730 days | 0 | true |
| `market_data_ingest_jobs` | 14 days | 8,007 | true |
| `gex_snapshots` | 30 days | 0 | true |
| `provider_request_log` | 14 days | 0 | true |

Required before-execute audit:

```bash
pnpm run db:phase0:audit -- --limit 25
```

Observed result:

- Exit code: `0`
- `database_size=7.27 GB`
- `public_tables=72`
- `missing_focus_tables=0`
- `time_range_probe_errors=0`
- `market_data_ingest_jobs`: total about `5.9 MB`, oldest `created_at` `2026-05-29T14:16:25.858Z`, newest `2026-06-24T01:02:27.343Z`

Exact candidate preview before execute:

| Status | Kind | Candidate rows |
|---|---|---:|
| `cancelled` | `gex_snapshot` | 1,585 |
| `cancelled` | `option_chain_snapshot` | 1,481 |
| `cancelled` | `stock_snapshot` | 1,142 |
| `completed` | `gex_snapshot` | 1,072 |
| `completed` | `option_chain_snapshot` | 1,180 |
| `completed` | `stock_snapshot` | 1,524 |
| `failed` | `gex_snapshot` | 11 |
| `failed` | `option_chain_snapshot` | 8 |
| `failed` | `stock_snapshot` | 4 |

Active bucketed GEX prerequisite risk check:

- `gex_snapshot` jobs in `queued` or `running` with non-empty `dedupeBucket`: `0`

Backup command:

```bash
pg_dump -h helium -U postgres -d heliumdb -Fc --no-owner --no-privileges --table=public.market_data_ingest_jobs --file=/tmp/db-maintenance-backups/phase2-task6-market-data-ingest-jobs-20260626T0037Z.dump
```

Observed backup result:

- File size: `563 KB`
- SHA-256: `7c1d94bc3cc624c6cea228ea98edadaa0ef22e9ba5537419b6efafb3f982c5a1`
- `pg_restore --list` succeeded and showed table data, primary key, and four indexes.
- Schema-only restore extraction succeeded.

## Execute

Incorrect command attempted first:

```bash
pnpm run market-data-worker:retention -- --execute
```

Observed result: Clap rejected the extra `--` as an unexpected argument before running retention. No DB writes occurred from this failed argument-parse attempt.

Successful execute command:

```bash
pnpm run market-data-worker:retention --execute
```

Observed result:

| Table | Retention | Affected rows | Dry-run |
|---|---:|---:|---|
| `quote_cache` | 7 days | 0 | false |
| `bar_cache` intraday scope | 90 days | 0 | false |
| `bar_cache` coarse scope | 730 days | 0 | false |
| `market_data_ingest_jobs` | 14 days | 8,007 | false |
| `gex_snapshots` | 30 days | 0 | false |
| `provider_request_log` | 14 days | 0 | false |

Post-delete maintenance:

```sql
vacuum (analyze) public.market_data_ingest_jobs;
```

Observed result: succeeded.

## After-State Evidence

Exact after-counts:

| Status | Kind | Rows |
|---|---|---:|
| `cancelled` | `gex_snapshot` | 537 |
| `cancelled` | `option_chain_snapshot` | 441 |
| `cancelled` | `stock_snapshot` | 121 |
| `completed` | `gex_snapshot` | 348 |
| `completed` | `option_chain_snapshot` | 446 |
| `completed` | `stock_snapshot` | 764 |
| `failed` | `gex_snapshot` | 2 |
| `failed` | `stock_snapshot` | 2 |

Post-execute candidate check:

- Remaining 14-day terminal candidates under the retention predicate: `0`
- Active `queued` or `running` bucketed GEX jobs: `0`

Post-`VACUUM (ANALYZE)` stats:

| Metric | Value |
|---|---:|
| `n_live_tup` | 2,661 |
| `n_dead_tup` | 0 |
| `last_vacuum` | `2026-06-26 00:37:19.540306+00` |
| `last_analyze` | `2026-06-26 00:37:19.686874+00` |

Relation size after ordinary `DELETE` plus `VACUUM (ANALYZE)`:

| Total | Table | Indexes |
|---:|---:|---:|
| 6,104 kB | 3,032 kB | 3,032 kB |

Interpretation: ordinary `DELETE` plus `VACUUM` removed dead tuples and made space reusable, but it does not shrink the physical relation files like `TRUNCATE` or `VACUUM FULL`.

Required after-execute audit:

```bash
pnpm run db:phase0:audit -- --limit 25
```

Observed result:

- Exit code: `0`
- `database_size=7.27 GB`
- `public_tables=72`
- `missing_focus_tables=0`
- `time_range_probe_errors=0`
- `market_data_ingest_jobs`: estimated live rows `2,661`, dead rows `0`, total about `6.0 MB`
- Oldest remaining `created_at`: `2026-06-12T01:22:45.988Z`

Post-execute dry-run:

```bash
pnpm run market-data-worker:retention
```

Observed result: passed, with `market_data_ingest_jobs` affected rows `0` and all other retention targets `0`.

Additional validations:

```bash
pnpm run db:market-data:audit
pnpm run build:market-data-worker
```

Observed result: both passed.

## Status

- Phase 2 Task 6 is complete.
- `market_data_ingest_jobs` retention is now configurable, terminal-only, and bounded.
- No queued/running work was eligible for deletion.
- GEX prerequisite rows are preserved while active bucketed GEX jobs exist.
- Checkpoint C is not complete; Tasks 7 and 8 remain.
