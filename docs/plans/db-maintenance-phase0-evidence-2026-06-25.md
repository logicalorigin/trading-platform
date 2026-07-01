# DB Maintenance Phase 0 Evidence - 2026-06-25

## Scope

- Roadmap: `docs/plans/db-maintenance-roadmap-2026-06-25.md`
- Session: `019f0123-d58e-7be3-9c04-a1f835e5960c`
- Evidence timestamp: `2026-06-25T23:52:23Z`
- DB target: Replit internal Postgres host `helium`, database `heliumdb`
- Destructive SQL status: none run as of this note.
- Forbidden path status: no `drizzle-kit push` used.

## Required Phase 0 Audit

Command:

```bash
pnpm run db:phase0:audit -- --limit 25
```

Observed result:

- Exit code: `1`
- Reason for nonzero exit: `time_range_probe_errors=2`
- Read-only output was produced.
- `database_size=9.06 GB`
- `public_tables=72`
- `missing_focus_tables=0`
- Failed time range probes:
  - `option_chain_latest`: `canceling statement due to statement timeout`
  - `option_contracts`: `canceling statement due to statement timeout`

Selected audit observations:

| Table | Estimate | Dead estimate | Total | Indexes | Oldest | Newest |
|---|---:|---:|---:|---:|---|---|
| `bar_cache` | 11,101,940 | 186,140 | 5.07 GB | 2.91 GB | 2025-10-27T00:00:00Z | 2026-06-25T23:48:00Z |
| `option_chain_snapshots` | 0 | 0 | 1.79 GB | 1.35 GB | - | - |
| `gex_snapshots` | 0 | 0 | 377.8 MB | 248.0 KB | 2026-05-29T14:19:26.881Z | 2026-06-24T01:03:00.462Z |
| `historical_bars` | 0 | 0 | 181.8 MB | 88.4 MB | 2021-04-22T13:30:00Z | 2026-05-15T20:00:00Z |
| `mtf_pattern_occurrences` | 0 | 0 | 58.1 MB | 17.5 MB | 2026-02-17T14:30:00Z | 2026-05-15T19:55:00Z |
| `execution_events` | 90,028 | 904 | 256.4 MB | 11.9 MB | 2026-04-01T13:30:00Z | 2026-06-25T23:48:36.579Z |
| `signal_monitor_events` | 39,113 | 2,847 | 46.2 MB | 7.7 MB | 2026-04-23T21:23:00Z | 2026-06-25T23:46:00Z |

## Exact Counts For Suspicious Tables

Exact-count command shape:

```sql
select '<table>' as table_name, count(*)::bigint as exact_count, min(<time_column>) as oldest, max(<time_column>) as newest
from public.<table>;
```

Observed exact counts:

| Table | Exact count | Time column | Oldest | Newest |
|---|---:|---|---|---|
| `backtest_run_points` | 110,411 | `occurred_at` | 2021-04-22 13:30:00+00 | 2026-05-15 20:00:00+00 |
| `flex_report_runs` | 41 | `requested_at` | 2026-04-23 18:47:04.842294+00 | 2026-06-24 07:00:00.157139+00 |
| `gex_snapshots` | 1,468 | `computed_at` | 2026-05-29 14:19:26.881692+00 | 2026-06-24 01:03:00.462928+00 |
| `historical_bars` | 777,735 | `starts_at` | 2021-04-22 13:30:00+00 | 2026-05-15 20:00:00+00 |
| `mtf_pattern_occurrences` | 265,154 | `occurred_at` | 2026-02-17 14:30:00+00 | 2026-05-15 19:55:00+00 |
| `mtf_pattern_results` | 22,097 | `created_at` | 2026-06-23 00:11:44.255475+00 | 2026-06-24 00:02:26.394557+00 |
| `option_chain_snapshots` | 0 | `as_of` | - | - |
| `universe_catalog_listings` | 30,771 | `last_seen_at` | 2026-04-23 17:55:31.899+00 | 2026-06-23 00:44:05.996+00 |

Interpretation:

- `option_chain_snapshots` is the only named suspicious table confirmed empty in this pass.
- `gex_snapshots`, `historical_bars`, `mtf_pattern_occurrences`, `universe_catalog_listings`, `backtest_run_points`, `flex_report_runs`, and `mtf_pattern_results` have stale or misleading row estimates and must not be treated as empty.

## Physical Metrics For Suspicious Tables

| Table | Estimated live | Estimated dead | Total | Table | Indexes | TOAST/aux | Last vacuum/analyze evidence |
|---|---:|---:|---:|---:|---:|---:|---|
| `option_chain_snapshots` | 0 | 0 | 1836 MB | 457 MB | 1380 MB | 160 kB | autovacuum 2026-06-24T19:59:45Z; autoanalyze 2026-06-24T19:59:04Z |
| `gex_snapshots` | 0 | 0 | 378 MB | 336 kB | 248 kB | 377 MB | none observed |
| `historical_bars` | 0 | 0 | 182 MB | 93 MB | 88 MB | 48 kB | none observed |
| `mtf_pattern_occurrences` | 0 | 0 | 58 MB | 40 MB | 18 MB | 48 kB | none observed |
| `universe_catalog_listings` | 0 | 0 | 43 MB | 28 MB | 15 MB | 40 kB | none observed |
| `backtest_run_points` | 0 | 0 | 28 MB | 12 MB | 16 MB | 32 kB | none observed |
| `flex_report_runs` | 0 | 0 | 21 MB | 24 kB | 64 kB | 21 MB | none observed |
| `mtf_pattern_results` | 0 | 0 | 14 MB | 9432 kB | 5096 kB | 40 kB | none observed |

## Index Usage Baseline

| Candidate index | Table | Size | `idx_scan` | `idx_tup_read` | `idx_tup_fetch` |
|---|---|---:|---:|---:|---:|
| `gex_snapshots_symbol_latest_idx` | `gex_snapshots` | 80 kB | 215 | 152 | 152 |
| `historical_bars_provider_contract_quote_idx` | - | missing | - | - | - |
| `option_chain_snapshots_as_of_idx` | `option_chain_snapshots` | 66 MB | 13,979 | 6,667,634 | 639,698 |
| `option_chain_snapshots_contract_idx` | `option_chain_snapshots` | 90 MB | 0 | 0 | 0 |
| `option_chain_snapshots_pkey` | `option_chain_snapshots` | 345 MB | 0 | 0 | 0 |
| `option_chain_snapshots_underlying_contract_as_of_idx` | `option_chain_snapshots` | 806 MB | 0 | 0 | 0 |
| `option_chain_snapshots_underlying_idx` | `option_chain_snapshots` | 71 MB | 0 | 0 | 0 |
| `option_contracts_expiration_idx` | `option_contracts` | 13 MB | 0 | 0 | 0 |
| `option_contracts_underlying_idx` | `option_contracts` | 17 MB | 0 | 0 | 0 |
| `pine_scripts_status_idx` | `pine_scripts` | 16 kB | 0 | 0 | 0 |
| `shadow_position_marks_position_idx` | `shadow_position_marks` | 4432 kB | 13,639 | 25,739,946 | 1,006,790 |
| `watchlist_items_watchlist_idx` | `watchlist_items` | 16 kB | 0 | 0 | 0 |

## Phase 0 Gate Status

- Task 1 baseline: complete for the roadmap's named suspicious tables and index candidates.
- Task 2 backup gate: complete for Phase 1 target tables.
- Checkpoint A: complete after active handoff refresh.

## Backup Gate Evidence

Maintenance-window action:

- Stopped the running dev app/API/market-data-worker supervisor with `kill -TERM 292991` before backup.
- Immediate post-TERM process check showed no matching `api-server`, `market-data-worker`, `runDevApp`, or `vite` process.
- Later sanity check observed `runDevApp`, `api-server`, `vite`, and `market-data-worker` processes active again with start time around 2026-06-25 17:56 MDT, so the dev app auto-restarted during or shortly after backup.
- Backup remains a valid `pg_dump` snapshot; the next destructive maintenance step should reconfirm or intentionally establish a quiet window before action.
- No destructive SQL ran before or during backup.

Backup command:

```bash
pg_dump -h helium -U postgres -d heliumdb -Fc --no-owner --no-privileges --table=public.option_chain_snapshots --table=public.option_chain_latest --table=public.bar_cache --file=/tmp/db-maintenance-backups/phase1-targets-20260625T2355Z.dump
```

Backup artifact:

- Path: `/tmp/db-maintenance-backups/phase1-targets-20260625T2355Z.dump`
- Format: PostgreSQL custom archive
- Created by: `pg_dump` 16.10
- Dumped from DB version: 16.10
- Size: 546 MB
- SHA-256: `795ddfcd93e1ccffbc7cd75e8469974d24cdc8e921627696a6c4840fd6cb5794`

Coverage proof from `pg_restore --list`:

- `TABLE public bar_cache`
- `TABLE public option_chain_latest`
- `TABLE public option_chain_snapshots`
- `TABLE DATA public bar_cache`
- `TABLE DATA public option_chain_latest`
- `TABLE DATA public option_chain_snapshots`
- Included primary-key constraints, option-chain snapshot indexes, option-chain latest indexes, and bar-cache indexes.

Restore confidence:

- `pg_restore --list /tmp/db-maintenance-backups/phase1-targets-20260625T2355Z.dump` exited `0`.
- `pg_restore --schema-only --file=/tmp/db-maintenance-backups/phase1-targets-20260625T2355Z.schema.sql /tmp/db-maintenance-backups/phase1-targets-20260625T2355Z.dump` exited `0`.
- Schema extraction contains `CREATE TABLE public.bar_cache`, `CREATE TABLE public.option_chain_latest`, and `CREATE TABLE public.option_chain_snapshots`.
