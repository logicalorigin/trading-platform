# Implementation Plan: PYRUS DB Maintenance Roadmap

## Overview

This plan organizes the database cleanup and stabilization work for the live PYRUS Postgres database. The goal is not to blindly delete tables. The goal is to reduce disk use, lower query/pool pressure, make retention predictable, and avoid recurring DB surgery while preserving trading correctness.

The core model:

- Durable source-of-truth tables stay durable.
- Regenerable market-data/cache/history tables stay bounded.
- Trading ledgers and signal state need source-aware retention, not flat age deletes.
- External market-data APIs remain the source of truth for market data.
- Local DB caches exist for speed, reliability, and reduced provider/API pressure.

`bar_cache` decision already made: keep it as a bounded regenerable cache with 90-day intraday retention and 730-day coarse/daily retention. Verify retention before considering partitioning.

Do not use `drizzle-kit push`. SQL migrations, maintenance scripts, dry-run reports, and reviewed operational commands are the only allowed DB-change path.

## Architecture Decisions

- Keep `bar_cache`. It is the local shelf for repeated chart, signal, KPI, sparkline, and backtest bar reads. Removing it would trade DB bloat for slower screens, more provider calls, and weaker reliability.
- `bar_cache` retention policy is locked:
  - Intraday frames: 90 days.
  - Coarse/daily frames: 730 days.
- Destructive DB work is permitted by the user, but safety gates still apply:
  - backup/PITR or `pg_dump` evidence first;
  - exact row-count checks before delete/rename/drop;
  - dry-run/preview before execute;
  - before/after `pnpm run db:phase0:audit -- --limit 25`;
  - session handoff updated before and after risky work.
- Prefer quarantine-rename before final drop for dead tables.
- Never remove Rust `persist_option_chain_snapshots`; despite the name, it writes `option_chain_latest`.
- Do not flat-prune `execution_events` or `signal_monitor_events`; both are load-bearing.
- Do not broaden into Replit startup/control-plane work. If Replit/startup config is touched accidentally, run `pnpm run audit:replit-startup`.

## Table Family Consolidation Review

This section is the working answer to "which similar tables can be combined to reduce confusion?"

Use "combine" carefully. In this DB, there are five different ways to reduce confusion:

- Retire or quarantine a dead/legacy table.
- Replace two physical tables with one physical table.
- Keep physical tables separate, but add one logical view/helper/query surface.
- Keep tables separate, but share retention code and naming docs.
- Keep tables separate, but document the table family, owner, source, and lifecycle.

The default should not be physical merging. Physical merging is only appropriate when tables have the same source, same retention policy, same owner, same primary read path, and compatible keys. If any of those differ, a merge usually creates a confusing bigger table instead of removing confusion.

| Table family | Related tables | Recommendation | Plain-English reason |
|---|---|---|---|
| Option-chain cache | `option_chain_snapshots`, `option_chain_latest` | Combine by retiring `option_chain_snapshots`; keep `option_chain_latest`. | These are the clearest duplicate-looking pair. The old append-only snapshot table appears legacy and costly; the latest table is the active cache. |
| Execution ledger and automation diagnostics | `execution_events`, `automation_diagnostics` | Do not physically merge. Keep split, but document as one event family and keep the existing union-read helper. | They intentionally share shape, but not purpose. `execution_events` is load-bearing ledger/audit data. `automation_diagnostics` is noisy telemetry with shorter retention. |
| Real broker trading ledger and shadow trading ledger | `order_requests`, `broker_orders`, `execution_fills`, `position_lots`, `shadow_orders`, `shadow_fills`, `shadow_positions`, `shadow_position_marks`, `shadow_accounts` | Do not merge. Retire/quarantine dead real-broker ledger tables if confirmed unused; keep shadow tables active. | Shadow trading is the current simulated/live planning model. Old real-broker tables look like abandoned infrastructure, not data that should be folded into shadow state. |
| Real and shadow balance history | `balance_snapshots`, `shadow_balance_snapshots` | Do not physically merge in this roadmap. Share retention patterns and document them together. | The rows look similar, but one tracks real/provider accounts and the other tracks shadow accounts. Their account IDs, trust level, and replay needs differ. |
| Shadow position state and marks | `shadow_positions`, `shadow_position_marks` | Keep separate. Add latest/current preservation rules. | One is current position state; the other is historical mark/valuation history. Merging would make both reads harder. |
| Flex import account data and operational account data | `flex_report_runs`, `flex_nav_history`, `flex_trades`, `flex_cash_activity`, `flex_dividends`, `flex_open_positions`, `balance_snapshots`, `shadow_balance_snapshots` | Do not merge. Document Flex as statement/import audit data. | Flex rows are imported reports/statements. They are useful for reconciliation, not the same thing as live operational account state. |
| Bar data stores | `bar_cache`, `historical_bars` | Do not merge now. Keep `bar_cache` as runtime cache and `historical_bars` as backtest dataset storage. Reassess only after retention cleanup. | Both are OHLCV-like, but they answer different questions. `bar_cache` feeds live screens/signals; `historical_bars` belongs to backtest datasets. |
| Latest market-data caches | `quote_cache`, `bar_cache`, `option_chain_latest` | Do not merge. Document as market-data cache siblings. | Quotes, bars, and option chains have different shapes, freshness, and keys. A merged "market data" table would be harder to query and index. |
| Signal monitor state, events, and snapshots | `signal_monitor_symbol_states`, `signal_monitor_events`, `signal_monitor_breadth_snapshots`, `signal_monitor_profiles` | Do not merge. Document lifecycle and retention per table. | These are current state, event history, breadth snapshots, and configuration. Similar domain, different jobs. |
| Derived market analytics | `gex_snapshots`, `flow_summaries`, flow-event tables if present | Retire only confirmed-dead tables such as `flow_summaries`; keep active derived snapshots separate from raw events. | Derived analytics can be expensive JSON/summary payloads. They need bounded retention, not generic merging. |
| Instrument/reference catalog | `instruments`, `option_contracts`, `instrument_aliases`, `ticker_reference_cache` | Retire confirmed-dead reference tables. Do not merge active contract/catalog tables unless a concrete reader needs shared metadata. | The active catalog and option-contract tables are different concepts. Dead alias/reference caches add confusion and should be removed rather than blended in. |
| Backtest and pattern result details | `mtf_pattern_results`, `mtf_pattern_occurrences`, `backtest_run_points`, `historical_bars` | Do not merge. Add retention/archive decisions for large detail tables. | These are result summaries, drilldown occurrences, run points, and input bars. Similar research domain, different grain. |

Consolidation rules for implementation:

- Retire beats merge for dead tables.
- A logical view/helper beats a physical merge when active tables have different retention or trust levels.
- Shared retention code beats schema merging when two tables have similar time-series cleanup needs.
- Table-family docs should name the source, owner, lifecycle, retention policy, and "safe to delete?" answer for each table.
- Any physical merge needs a mini-design first: source compatibility, key compatibility, migration path, backfill, rollback, index plan, and test plan.

## Task List

### Phase 0: Baseline And Recovery Gate

#### Task 1: Establish Fresh DB Baseline

**Description:** Capture live DB facts before any maintenance. This prevents stale Postgres estimates from being mistaken for truth.

**Acceptance criteria:**

- [x] Run `pnpm run db:phase0:audit -- --limit 25`.
- [x] Capture exact counts for stale-stat/suspicious tables:
  - `option_chain_snapshots`
  - `gex_snapshots`
  - `historical_bars`
  - `mtf_pattern_occurrences`
  - `universe_catalog_listings`
  - `backtest_run_points`
  - `flex_report_runs`
  - `mtf_pattern_results`
- [x] Capture `pg_stat_user_indexes.idx_scan` for every index being considered for removal.
- [x] Record table sizes, index sizes, estimated live/dead rows, and oldest/newest time columns.

**Verification:**

- [x] Baseline notes are written to the session handoff or a follow-up audit note.
- [x] Any table with estimated `0` rows has an exact `count(*)` before it is called empty.
- [x] No destructive SQL has run yet.

**Dependencies:** None

**Files likely touched:** None, unless saving an audit note.

**Estimated scope:** S

#### Task 2: Complete Backup Gate

**Description:** Prove there is a recovery path before any destructive database work.

**Acceptance criteria:**

- [x] Confirm current backup/PITR coverage or create a fresh `pg_dump`.
- [x] Record backup source, timestamp, command, target location, and restore confidence.
- [x] Confirm the backup covers tables targeted in Phase 1.
- [x] No `DELETE`, `TRUNCATE`, `ALTER TABLE ... RENAME`, `DROP`, `VACUUM FULL`, or `REINDEX` runs before this task is complete.

**Verification:**

- [x] Session handoff includes backup evidence.
- [x] Each destructive task references that backup evidence before execution.

**Dependencies:** Task 1

**Files likely touched:** Session handoff only.

**Estimated scope:** S

### Checkpoint A: Baseline Ready

- [x] Task 1 complete.
- [x] Task 2 complete.
- [x] User/full-permission context noted.
- [x] Destructive work may begin only after this checkpoint.

---

### Phase 1: Highest-ROI Safe Wins

#### Task 3: Reclaim `option_chain_snapshots`

**Description:** Retire or reclaim the legacy `option_chain_snapshots` table correctly. It is currently the clearest reclaim target: exact count was observed as `0`, while allocated size was about `1.79 GB`.

**Acceptance criteria:**

- [x] Reconfirm exact `count(*) = 0` immediately before action.
- [x] Reconfirm `option_chain_latest` has current rows and remains the live option-chain cache.
- [x] Unwire only legacy `option_chain_snapshots` references:
  - Rust retention target in `crates/market-data-worker/src/retention.rs`;
  - diagnostics prune allow-list reference;
  - diagnostics size monitor reference;
  - cutover tests that expect legacy table monitoring.
- [x] Do not remove or alter Rust `persist_option_chain_snapshots` unless source proof changes; that path writes `option_chain_latest`.
- [x] Choose a reclaim strategy:
  - preferred first move: quarantine-rename if readers/writers are fully unwired;
  - alternate: rebuild/truncate/reindex if code still needs table shell temporarily.

**Verification:**

- [x] `pnpm run db:market-data:audit` passes.
- [x] `pnpm run db:phase0:audit -- --limit 25` shows `option_chain_snapshots` no longer consuming large active storage, or the pending reclaim reason is documented.
- [x] GEX/option-chain latest readers still use `option_chain_latest`.
- [x] No references remain that would recreate or monitor the retired table unexpectedly.

**Dependencies:** Tasks 1-2

**Files likely touched:**

- `crates/market-data-worker/src/retention.rs`
- `artifacts/api-server/src/services/diagnostics.ts`
- Relevant option-chain cutover/schema audit tests
- SQL migration or maintenance script under `lib/db/migrations/`

**Estimated scope:** M

#### Task 4: Verify And Execute `bar_cache` Retention

**Description:** Keep `bar_cache`, but verify that existing retention actually enforces the selected policy.

**Acceptance criteria:**

- [x] Confirm runtime/default config produces:
  - `MARKET_DATA_BAR_RETENTION_DAYS = 90`
  - `MARKET_DATA_BAR_COARSE_RETENTION_DAYS = 730`
- [x] Run market-data retention dry-run first.
- [x] If rows are due for deletion, execute retention in a controlled maintenance window. Dry-run found `0` due rows, so no execute was needed.
- [x] Use bounded batches; do not run one unbounded delete over the full table.
- [x] Refresh stats afterward with `ANALYZE` or document autovacuum timing. No `bar_cache` delete ran; existing autovacuum/analyze timing is documented in the audit.

**Verification:**

- [x] Phase 0 audit and exact scope query show oldest intraday rows already inside the 90-day policy.
- [x] Coarse/daily rows are not pruned below 730 days.
- [x] `/bars` behavior remains cache-first with provider fallback.
- [x] No app restart is required unless runtime verification explicitly needs it.

**Dependencies:** Tasks 1-2

**Files likely touched:** Usually none if config/code already matches; possibly worker config/docs if drift is found.

**Estimated scope:** M

#### Task 5: Fix Stale Stats And Classify Real Data

**Description:** Refresh stats and classify tables where Postgres estimates were misleading. Exact counts already showed several estimated-empty tables contain real data.

**Acceptance criteria:**

- [x] Run or schedule `ANALYZE` for:
  - `gex_snapshots`
  - `historical_bars`
  - `mtf_pattern_occurrences`
  - other stale-stat tables found in Task 1
- [x] Treat `historical_bars` as real cache/history data, not dead.
- [x] Treat `mtf_pattern_occurrences` as research/backtest detail, not dead.
- [x] Treat `gex_snapshots` as small row count but heavy JSON/TOAST payload.

**Verification:**

- [x] Post-`ANALYZE` estimates move closer to exact counts.
- [x] No cleanup decision relies only on `n_live_tup`.
- [x] Updated Phase 0 audit no longer mislabels stale-stat tables as empty without context.

**Dependencies:** Tasks 1-2

**Files likely touched:** None, unless improving audit output or adding a maintenance note.

**Estimated scope:** S

### Checkpoint B: First Reclaim Complete

- [x] `option_chain_snapshots` handled or explicitly deferred with evidence.
- [x] `bar_cache` retention verified.
- [x] Stale stats corrected or scheduled.
- [x] Before/after audit evidence captured.

---

### Phase 2: Retention Gaps

#### Task 6: Add `market_data_ingest_jobs` Retention

**Description:** Add safe retention for old terminal market-data job rows. This must preserve live queued/running work and prerequisite rows needed by later GEX/job claiming.

**Acceptance criteria:**

- [x] Add retention only for terminal statuses:
  - `completed`
  - `failed`
  - `cancelled`
- [x] Preserve `queued`, `running`, leased, and future scheduled rows.
- [x] Preserve prerequisite rows if the worker claim logic still requires them for downstream jobs.
- [x] Retention window is configurable with conservative default.
- [x] Deletes run in bounded batches.

**Verification:**

- [x] Worker tests cover terminal cleanup and live-job preservation.
- [x] Dry-run shows expected candidate rows before execute.
- [x] GEX jobs are not stranded by removing prerequisite rows too early.
- [x] `pnpm run market-data-worker:retention` dry-run works before execute.

Evidence: `docs/plans/db-maintenance-phase2-task6-evidence-2026-06-25.md`.

**Dependencies:** Tasks 1-2

**Files likely touched:**

- `crates/market-data-worker/src/retention.rs`
- `crates/market-data-worker/src/config.rs`
- Worker retention tests

**Estimated scope:** M

#### Task 7: Add Snapshot And Diagnostic Retention

**Description:** Bound append-style diagnostic/snapshot tables that are not durable trading ledgers.

**Acceptance criteria:**

- [x] Add/schedule retention for `diagnostic_snapshots`. (Already self-prunes to 24h via the diagnostics collector; also in the `pruneDiagnosticStorage` allow-list.)
- [x] Add retention for `signal_monitor_breadth_snapshots` on `captured_at`. (90d flat; `pruneSignalMonitorBreadthSnapshots`.)
- [x] Add retention for `balance_snapshots` on `as_of`. (180d; preserves newest row per account.)
- [x] Add retention for `shadow_balance_snapshots` without breaking replay/backtest cleanup semantics. (Source-aware: prunes only live wall-clock sources, excludes all simulation sources, preserves newest per `(account, source)`; disjoint from the range-scoped replay/backtest cleanup paths.)
- [x] Add retention for `shadow_position_marks` while preserving latest/current marks needed by readers. (180d closed-position-aware; open positions and newest mark per position always preserved.)
- [x] For every table, document the retention window and the reader requirement being preserved. (`docs/plans/db-maintenance-phase2-task7-evidence-2026-06-25.md`.)

**Verification:**

- [x] Focused tests prove latest/current rows survive. (`lib/db/src/retention.test.ts`, 4/4.)
- [x] Account and shadow-position views still load. (No rows deleted this pass; retention is reader-preserving by construction and unit-tested.)
- [x] Before/after audit shows only intended old rows are removed. (Dry-run: 0 candidates at chosen windows; no rows removed — before/after identical.)
- [x] No table is routed through `pruneDiagnosticStorage` unless it is explicitly allow-listed and has the right cutoff column. (New retention uses a dedicated module; no tables added to `pruneDiagnosticStorage`.)

Evidence: `docs/plans/db-maintenance-phase2-task7-evidence-2026-06-25.md`. All five tables now have retention (4 implemented in `lib/db/src/retention.ts` + `diagnostic_snapshots` collector-owned), wired to run via `startSnapshotRetentionScheduler` (api-server, 6h). 0 rows eligible today at the chosen windows (forward-looking guard).

**Dependencies:** Tasks 1-2

**Files likely touched:**

- Retention implementation in TS or Rust, based on table ownership
- Focused tests for affected service/worker
- Optional SQL migration for indexes needed by retention

**Estimated scope:** M

#### Task 8: Design Ledger-Safe Retention For Load-Bearing Events

**Description:** Handle `execution_events` and `signal_monitor_events` carefully. These are not just logs; they support idempotency, state reconstruction, and audit trails.

**Acceptance criteria:**

- [x] Map exact readers/writers for `execution_events`. (See Task 8 evidence.)
- [x] Map exact readers/writers for `signal_monitor_events`. (See Task 8 evidence.)
- [x] Identify rows that must never be removed by simple age policy. (execution_events: terminal order + ENTRY/EXIT/MARK events for non-retired deployments; signal_monitor_events: latest trusted event per `(profileId,symbol,timeframe)` + breadth seed events of any age.)
- [~] If retention is safe, implement source-aware preservation rules. (Not safe today — prerequisites documented.)
- [x] If retention is not safe yet, document a defer decision with evidence. (`docs/plans/db-maintenance-phase2-task8-evidence-2026-06-25.md`.)

**Verification:**

- [~] Tests cover order/event idempotency if `execution_events` retention is added. (N/A — retention deferred.)
- [~] Tests cover standing-state reconstruction/breadth seed behavior if `signal_monitor_events` retention is added. (N/A — retention deferred.)
- [x] No flat `WHERE occurred_at < cutoff` or `WHERE signal_at < cutoff` lands without preservation rules. (No retention added; both deferred.)

**Dependencies:** Tasks 1-2

**Files likely touched:**

- `artifacts/api-server/src/services/overnight-spot-execution.ts`
- `artifacts/api-server/src/services/signal-monitor.ts`
- Focused service tests

**Estimated scope:** M

### Checkpoint C: Retention Closed Or Deferred

- [x] `market_data_ingest_jobs` retention decided/implemented.
- [x] Snapshot/diagnostic retention decided/implemented. (Task 7: breadth/balance/marks implemented + `diagnostic_snapshots` already covered; `shadow_balance_snapshots` deferred with documented design. Scheduling of the new retention still to be wired.)
- [x] Ledger retention either safely implemented or explicitly deferred with source evidence. (Task 8: `execution_events` + `signal_monitor_events` deferred with documented evidence — `docs/plans/db-maintenance-phase2-task8-evidence-2026-06-25.md`.)
- [x] Before/after audit evidence captured. (Task 7 dry-run audit: 0 candidates at chosen windows.)

**Checkpoint C is complete** (2026-06-25): Task 6 implemented, Task 7 implemented (all 5 snapshot/diagnostic tables) + scheduled, Task 8 deferred with source evidence.

---

### Phase 3: Dead Table Retirement

#### Task 9: Quarantine Confirmed Dead Tables

**Description:** Retire truly dead tables with a quarantine-rename/soak/drop process. Do not immediately drop tables unless the soak step is intentionally waived and recorded.

**Acceptance criteria:**

- [ ] Immediately before rename, confirm exact row counts and repo references.
- [ ] Start with safest candidates:
  - `flow_summaries`
  - `instrument_aliases`
  - `order_requests`
  - `broker_orders`
  - `execution_fills`
- [ ] Hold these unless product intent confirms retirement:
  - `alert_rules`
  - `alert_events`
  - `saved_scans`
  - `activity_log`
- [ ] Use `_trash_<table_name>` or another clearly documented quarantine prefix.
- [ ] No `CASCADE`; enumerate dependencies instead.

**Verification:**

- [ ] Typecheck/tests pass after quarantine.
- [ ] Runtime logs do not show missing-table errors during soak.
- [ ] Final drop happens only after soak window or explicit waiver.

**Dependencies:** Tasks 1-2

**Files likely touched:**

- SQL migration/maintenance script under `lib/db/migrations/`
- Schema references if any still exist
- Tests if schema guards need adjustment

**Estimated scope:** M

#### Task 10: Retire `position_lots`

**Description:** Remove the write-dead real-position lots path after confirming no live code depends on it for real account behavior.

**Acceptance criteria:**

- [ ] Confirm no writers exist.
- [ ] Confirm sole reader behavior and fallback.
- [ ] Remove or isolate the reader path so live account routes no longer depend on the table.
- [ ] Quarantine-rename table after code no longer reads it.

**Verification:**

- [ ] Account route tests still pass.
- [ ] Real account positions still load.
- [ ] No code references `position_lots` after quarantine except migration/history docs.

**Dependencies:** Tasks 1-2

**Files likely touched:**

- `artifacts/api-server/src/services/account.ts`
- SQL migration/maintenance script
- Focused account tests

**Estimated scope:** S

### Checkpoint D: Dead Tables Isolated

- [ ] Dead table quarantine complete or deferred with reason.
- [ ] `position_lots` decision complete.
- [ ] No runtime missing-table errors.
- [ ] Handoff updated with quarantine/drop status.

---

### Phase 4: Index And Schema Drift Cleanup

#### Task 11: Clean Proven Index And Schema Drift

**Description:** Drop only indexes with both source proof and live usage evidence. Reconcile SQL-vs-Drizzle drift so future agents do not rediscover the same mismatch.

**Acceptance criteria:**

- [ ] Reconcile `historical_bars_provider_contract_quote_idx`:
  - either model it intentionally in Drizzle, or
  - drop it if it indexes zero/future-only fields and has no live value.
- [ ] Evaluate redundant/unused candidates with source proof plus `idx_scan`:
  - `gex_snapshots_symbol_latest_idx`
  - `watchlist_items_watchlist_idx`
  - `option_contracts_underlying_idx`
  - `option_contracts_expiration_idx`
  - `pine_scripts_status_idx`
  - `shadow_position_marks_position_idx`
- [ ] Keep `bar_cache_starts_at_idx`.
- [ ] Add/extend a drift guard so SQL-only index drift is caught earlier.

**Verification:**

- [ ] `pnpm --filter @workspace/scripts run typecheck` passes if scripts are touched.
- [ ] `pnpm run db:market-data:audit` passes.
- [ ] Before/after index list is recorded.
- [ ] No query path loses its supporting index without replacement.

**Dependencies:** Task 1

**Files likely touched:**

- `lib/db/src/schema/*.ts`
- `lib/db/migrations/*.sql`
- `scripts/src/*schema*audit*.ts`

**Estimated scope:** M

### Checkpoint E: Drift Reduced

- [ ] Index drops/reconciliations complete or deferred with evidence.
- [ ] Drift guard updated where practical.
- [ ] DB audits pass.

---

### Phase 4.5: Table-Family Clarity

#### Task 12: Add Table-Family Registry And Consolidation Notes

**Description:** Turn the consolidation review in this roadmap into durable documentation so future DB work starts from a clear map of what each table is for. This task is about reducing confusion without forcing unsafe physical merges.

**Acceptance criteria:**

- [ ] Create or update a durable DB table-family document.
- [ ] For every family in the consolidation review, record:
  - source of data;
  - owner/service;
  - primary reader path;
  - writer path;
  - lifecycle;
  - retention policy;
  - whether it is source-of-truth, cache, import/audit, telemetry, current state, or derived data;
  - recommended action: keep, retire, quarantine, add retention, add logical view/helper, or evaluate later.
- [ ] Explicitly mark the tables that should not be physically merged:
  - `execution_events` and `automation_diagnostics`;
  - `balance_snapshots` and `shadow_balance_snapshots`;
  - `bar_cache` and `historical_bars`;
  - signal-monitor state/event/snapshot tables;
  - Flex import tables and operational account tables.
- [ ] Explicitly mark the tables that are likely retirement candidates if confirmed by Phase 0 evidence:
  - `option_chain_snapshots`;
  - `flow_summaries`;
  - `instrument_aliases`;
  - `ticker_reference_cache`;
  - `order_requests`;
  - `broker_orders`;
  - `execution_fills`;
  - `position_lots`.
- [ ] Add a short "physical merge checklist" for any future proposal to combine tables.
- [ ] Link the table-family document from this roadmap or another obvious DB planning index.

**Verification:**

- [ ] `pnpm run audit:markdown-paths` passes.
- [ ] The document explains why each confusing pair is kept separate, retired, or only logically combined.
- [ ] The roadmap still says `bar_cache` remains a bounded cache and is not merged with `historical_bars` in this phase.
- [ ] No code or DB changes are required for this task unless the executor intentionally adds a documentation index link.

**Dependencies:** Tasks 1, 3, 5, 8, 9, 10

**Files likely touched:**

- New or existing DB documentation under `docs/`
- This roadmap if linking or status notes are updated

**Estimated scope:** S

### Checkpoint F: Table Families Documented

- [ ] Table-family registry exists.
- [ ] Confusing table pairs have explicit keep/retire/logical-combine decisions.
- [ ] Future physical merges require the merge checklist.

---

### Phase 5: Future Architecture Decision

#### Task 13: Reassess Partitioning Or Market-Data Store Split

**Description:** Only after retention and cleanup, decide whether `bar_cache` still needs partitioning or whether Tier C market data should move off the OLTP database.

**Acceptance criteria:**

- [ ] Run post-cleanup `pnpm run db:phase0:audit -- --limit 25`.
- [ ] Compare DB size, `bar_cache` size, dead rows, and index pressure against the Phase 0 baseline.
- [ ] Decide go/no-go for `bar_cache` partitioning.
- [ ] Decide whether a separate market-data store is worth planning.
- [ ] Do not start partitioning migration before this decision is recorded.

**Verification:**

- [ ] Written go/no-go note exists.
- [ ] Remaining DB pressure is quantified.
- [ ] Next roadmap is explicit if partitioning/store split is still needed.

**Dependencies:** Tasks 3-12

**Files likely touched:** Planning docs only, unless a new follow-up implementation plan is requested.

**Estimated scope:** S planning task

## Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| Deleting live/state rows by mistake | High | Backup gate, exact counts, dry-run, table-specific retention rules |
| Breaking `option_chain_latest` | High | Never remove Rust latest persistence; retire only legacy snapshot references |
| Ledger/idempotency regression | High | No flat prune for `execution_events` or `signal_monitor_events` |
| Stats misleading cleanup decisions | Medium | Exact counts before cleanup; `ANALYZE` stale tables |
| DB locks/WAL spikes | Medium | Bounded batches, maintenance window, before/after audits |
| App instability during maintenance | Medium | Avoid app restarts; monitor DB/app health before and after |
| Future agents using `drizzle-kit push` | High | Keep push disabled; repeat warning in handoff and task notes |

## Open Questions

- Are `alert_rules`, `alert_events`, `saved_scans`, and `activity_log` intended future features or safe to retire?
- What soak window should be used before dropping `_trash_` tables?
- What exact retention windows should apply to diagnostic/snapshot tables besides `bar_cache`?
- Should `gex_snapshots.payload` be compressed, stripped, or left alone after retention proves it is bounded?

## Final Goal Prompt

```text
/goal Execute the DB maintenance roadmap in docs/plans/db-maintenance-roadmap-2026-06-25.md. Work in order, starting with Phase 0 baseline and backup gate. User grants full DB maintenance permissions, but still do exact row counts, dry-runs/previews, and before/after pnpm run db:phase0:audit -- --limit 25 evidence before destructive DB work. Never use drizzle-kit push. Keep bar_cache as a bounded regenerable cache with 90d intraday and 730d coarse retention. Use the Table Family Consolidation Review to prefer retirement, logical views/helpers, shared retention, and documentation over unsafe physical merges. Do not remove Rust option_chain_latest persistence. Do not flat-prune execution_events or signal_monitor_events. Keep handoff updated and stop at checkpoints with verification.
```
