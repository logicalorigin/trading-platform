# DB Maintenance Phase 1 Checkpoint B Evidence - 2026-06-25

## Scope

- Roadmap: `docs/plans/db-maintenance-roadmap-2026-06-25.md`
- Session: `019f0123-d58e-7be3-9c04-a1f835e5960c`
- DB target: Replit internal Postgres host `helium`, database `heliumdb`
- Prior Phase 1 Task 3 evidence: `docs/plans/db-maintenance-phase1-task3-evidence-2026-06-25.md`
- Forbidden path status: no `drizzle-kit push` used.

## Task 4: `bar_cache` Retention

Source-confirmed defaults in `crates/market-data-worker/src/config.rs`:

- `MARKET_DATA_BAR_RETENTION_DAYS`: default `90`
- `MARKET_DATA_BAR_COARSE_RETENTION_DAYS`: default `730`
- `MARKET_DATA_RETENTION_BATCH_SIZE`: default `20,000`

Runtime env check:

```text
MARKET_DATA_BAR_RETENTION_DAYS=<unset>
MARKET_DATA_BAR_COARSE_RETENTION_DAYS=<unset>
MARKET_DATA_RETENTION_BATCH_SIZE=<unset>
```

Observed result: runtime falls back to the source-confirmed defaults.

Source-confirmed retention scopes in `crates/market-data-worker/src/retention.rs`:

- Intraday 90-day scope: `timeframe in ('1m','2m','5m','15m','1h','5s')`
- Coarse 730-day scope: `timeframe not in ('1m','2m','5m','15m','1h','5s')`
- Execute path deletes in bounded chunks using `limit {batch_size}` over `ctid`.
- CLI is dry-run by default; `--execute` is required for deletes.

Dry-run command:

```bash
pnpm run market-data-worker:retention
```

Dry-run output:

| Table | Scope | Retention | Affected rows | Dry-run |
|---|---|---:|---:|---|
| `quote_cache` | all | 7 days | 0 | true |
| `bar_cache` | intraday scope | 90 days | 0 | true |
| `bar_cache` | coarse scope | 730 days | 0 | true |
| `gex_snapshots` | all | 30 days | 0 | true |
| `provider_request_log` | all | 14 days | 0 | true |

The intraday count query logged as slow at about `31.8s`, but it completed and returned `0`.

Exact `bar_cache` scope breakdown:

| Scope | Rows | Oldest | Newest | Due rows |
|---|---:|---|---|---:|
| `coarse_730d` | 86,135 | 2025-10-27 00:00:00+00 | 2026-06-25 00:00:00+00 | 0 |
| `intraday_90d` | 10,914,535 | 2026-03-30 07:45:00+00 | 2026-06-26 00:00:00+00 | 0 |

No retention execute command was run because the dry-run found no eligible rows.

`/bars` verification:

- Source check: `/api/bars` delegates to `getBarsWithDebug`.
- Source check: `getBarsWithDebug` can serve stored bars first for chart families and refresh in the background.
- Source check: `getBaseBarsImpl` reads `loadStoredMarketBars` before provider gap-fill and persists closed provider bars after fetch.
- Focused test passed:

```bash
pnpm --filter @workspace/api-server exec tsx --test src/services/platform-bars-bridge-health.test.ts
```

Result: 4/4 tests passed.

## Task 5: Stale Stats Refresh

Before `ANALYZE`, these roadmap tables had `n_live_tup=0` and no `last_analyze`, despite earlier exact counts proving real rows:

- `backtest_run_points`
- `flex_report_runs`
- `gex_snapshots`
- `historical_bars`
- `mtf_pattern_occurrences`
- `mtf_pattern_results`
- `universe_catalog_listings`

Stats command:

```sql
analyze public.gex_snapshots;
analyze public.historical_bars;
analyze public.mtf_pattern_occurrences;
analyze public.universe_catalog_listings;
analyze public.backtest_run_points;
analyze public.flex_report_runs;
analyze public.mtf_pattern_results;
```

Post-`ANALYZE` stats:

| Table | `n_live_tup` | `n_dead_tup` | `last_analyze` |
|---|---:|---:|---|
| `backtest_run_points` | 110,411 | 0 | 2026-06-26 00:23:44.502838+00 |
| `flex_report_runs` | 41 | 34 | 2026-06-26 00:23:44.50352+00 |
| `gex_snapshots` | 1,468 | 0 | 2026-06-26 00:23:34.42373+00 |
| `historical_bars` | 777,727 | 0 | 2026-06-26 00:23:40.034824+00 |
| `mtf_pattern_occurrences` | 265,085 | 0 | 2026-06-26 00:23:43.39567+00 |
| `mtf_pattern_results` | 22,097 | 0 | 2026-06-26 00:23:45.527619+00 |
| `universe_catalog_listings` | 31,225 | 1,557 | 2026-06-26 00:23:43.462458+00 |

Interpretation:

- `historical_bars` is real cache/history data, not dead.
- `mtf_pattern_occurrences` is research/backtest detail, not dead.
- `gex_snapshots` has a small row count but heavy JSON/TOAST payload.
- `flex_report_runs` has only 41 rows but a large TOAST footprint and should not be treated as empty.
- Differences between earlier exact counts and post-`ANALYZE` estimates are expected where live writes occurred between observations.

## Checkpoint B Audit

Final command:

```bash
pnpm run db:phase0:audit -- --limit 25
```

Observed result:

- Exit code: `0`
- `database_size=7.27 GB`
- `public_tables=72`
- `missing_focus_tables=0`
- `time_range_probe_errors=0`
- `option_chain_snapshots`: total `48.0 KB`
- `bar_cache`: total `5.07 GB`; intraday/coarse dry-run due rows both `0`
- Stale-stat findings for `gex_snapshots`, `historical_bars`, and `mtf_pattern_occurrences` are gone.
- Remaining notable finding: `gex_snapshots` is still TOAST-heavy (`377.2 MB` of `377.8 MB`).
- Load-bearing warnings for `execution_events` and `signal_monitor_events` remain informational; no flat prune was performed.

## Status

- Phase 1 Task 3 is complete.
- Phase 1 Task 4 is complete; no `bar_cache` delete was needed.
- Phase 1 Task 5 is complete.
- Checkpoint B is complete.
