# DB Maintenance Phase 1 Task 3 Evidence - 2026-06-25

## Scope

- Roadmap: `docs/plans/db-maintenance-roadmap-2026-06-25.md`
- Task: Phase 1 Task 3, reclaim `option_chain_snapshots`
- Session: `019f0123-d58e-7be3-9c04-a1f835e5960c`
- DB target: Replit internal Postgres host `helium`, database `heliumdb`
- Backup gate: `/tmp/db-maintenance-backups/phase1-targets-20260625T2355Z.dump`
- Backup SHA-256: `795ddfcd93e1ccffbc7cd75e8469974d24cdc8e921627696a6c4840fd6cb5794`
- Forbidden path status: no `drizzle-kit push` used.

## Source Proof

- `crates/market-data-worker/src/ingest.rs` keeps `persist_option_chain_snapshots`, but that path writes through `upsert_option_chain_latest_tx` and inserts into `option_chain_latest`, not `option_chain_snapshots`.
- `crates/market-data-worker/src/compute/gex.rs` reads Massive option-chain rows from `option_chain_latest`.
- `option_chain_latest` was reconfirmed before reclaim:
  - Total rows: `57,467`
  - Massive rows: `57,432`
  - Oldest `as_of`: `2026-06-17 19:13:16.922732+00`
  - Newest overall `as_of`: `2026-06-25 18:56:58.582+00`
  - Newest Massive `as_of`: `2026-06-24 01:02:36.396374+00`

## Code Unwiring

Legacy `option_chain_snapshots` active references were removed from:

- `crates/market-data-worker/src/retention.rs`
- `crates/market-data-worker/src/main.rs`
- `crates/market-data-worker/src/config.rs`
- `artifacts/api-server/src/services/diagnostics.ts`
- `artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.js`
- `lib/db/src/schema/market-data.ts`
- `scripts/src/market-data-schema-audit.ts`
- `artifacts/api-server/src/services/option-chain-latest-cutover.test.ts`
- `artifacts/pyrus/docs/architecture/market-data-ingest-worker.md`

`persist_option_chain_snapshots` was not removed or altered.

## Pre-Action Evidence

Required pre-action audit:

```bash
pnpm run db:phase0:audit -- --limit 25
```

Observed before destructive work:

- Exit code: `0`
- `database_size=9.06 GB`
- `public_tables=72`
- `missing_focus_tables=0`
- `time_range_probe_errors=0`
- `option_chain_snapshots`: estimated rows `0`, dead rows `0`, total `1.79 GB`, table `456.6 MB`, indexes `1.35 GB`

Immediate pre-action exact check:

```sql
select count(*)::bigint as option_chain_snapshots_count,
  pg_size_pretty(pg_total_relation_size('public.option_chain_snapshots')) as total_size,
  pg_size_pretty(pg_relation_size('public.option_chain_snapshots')) as table_size,
  pg_size_pretty(pg_indexes_size('public.option_chain_snapshots')) as index_size
from public.option_chain_snapshots;
```

Observed result immediately before the script:

| Count | Total | Table | Indexes |
|---:|---:|---:|---:|
| 0 | 1836 MB | 457 MB | 1380 MB |

Immediate activity check found:

- Relation locks: `0`
- Active queries involving `option_chain_snapshots`: `0`

Rollback dry-run preview:

- `snapshot_rows=0`
- `total_size_before=1836 MB`
- Planned action: `truncate table public.option_chain_snapshots; analyze public.option_chain_snapshots;`
- Transaction rolled back before the real action.

## Executed Reclaim

Chosen strategy: guarded `TRUNCATE` plus `ANALYZE`, leaving an empty table shell for soak. This matches the roadmap alternate strategy because currently running old code may still expect the relation to exist until all processes are refreshed.

Script:

```bash
psql -h helium -U postgres -d heliumdb -v ON_ERROR_STOP=1 -f lib/db/migrations/20260626_reclaim_empty_option_chain_snapshots.sql
```

Observed result:

```text
BEGIN
SET
SET
DO
COMMIT
```

The script refuses to truncate if `public.option_chain_snapshots` contains any rows and uses local `lock_timeout='5s'` plus `statement_timeout='30s'`.

## After-State Evidence

Exact post-action check:

| Count | Total | Table | Indexes |
|---:|---:|---:|---:|
| 0 | 48 kB | 0 bytes | 40 kB |

Required after-action audit:

```bash
pnpm run db:phase0:audit -- --limit 25
```

Observed after reclaim:

- Exit code: `0`
- `database_size=7.27 GB`
- `public_tables=72`
- `missing_focus_tables=0`
- `time_range_probe_errors=0`
- `option_chain_snapshots`: estimated rows `0`, dead rows `0`, total `48.0 KB`, table `0 bytes`, indexes `40.0 KB`

Observed reclaim delta:

- Table allocation reduced from `1836 MB` to `48 kB`.
- Database size reduced from `9.06 GB` before action to `7.27 GB` after action.

## Validation

Commands that passed after the source edits and reclaim:

```bash
pnpm run db:market-data:audit
pnpm --filter @workspace/api-server exec tsx --test src/services/option-chain-latest-cutover.test.ts
```

The cutover test passed 4/4 and still asserts:

- API durable option metadata uses `option_chain_latest`.
- Rust worker option-chain persistence no longer appends snapshots.
- GEX hydration reads Massive rows from `option_chain_latest`.
- Legacy `option_chain_snapshots` is not retained, monitored, or modeled.

## Status

- Phase 1 Task 3 is complete.
- The legacy table is reclaimed but still exists as an empty shell for soak.
- Final quarantine/drop, if desired, should be a later dead-table cleanup after deployed processes no longer reference the relation.
