# DB pool-saturation fix — bar_cache covering index (Layer 1) + architecture spec (Layer 2)

**Status:** Layer 1 reviewed (/plan-eng-review), implemented, and **verified in prod** 2026-06-17.
**Owner workstream:** helium-Postgres app-pool saturation. Root-cause investigation: `SESSION_HANDOFF_LIVE_2026-06-17_option-chain-upsert-latest-phase1.md` ("DB-SATURATION ROOT-CAUSE INVESTIGATION").

## Problem

The api-server's Postgres connection pool is hard-capped at **12** (the shared "helium" dev DB; server itself is healthy — `max_connections=112`, ~19 used, 0 deadlocks, `oom_kill=0`). A hot read query with no covering index held a pool connection up to the **6s `statement_timeout`**. Under concurrency the 12 slots drain and new acquisitions fail with `Connection terminated due to connection timeout` (a pool-acquire timeout that never reaches Postgres, so it does not show as `xact_rollback` — which is why server stats looked clean). This pressure (not OOM) is the likely driver of the api-child restarts.

## Root cause (ground-truth)

| Offender | Evidence | Verdict |
|---|---|---|
| **bar_cache read** `loadStoredMarketBars` (market-data-store.ts:294-317): filter `(symbol,timeframe,source)`+`starts_at` range, ORDER BY `starts_at`. Only index `(symbol,timeframe)`. 7.3M rows / 3.7 GB. | `EXPLAIN ANALYZE` of `/bars` (AIZ/1m) **timed out at 6s**; flight-recorder live `/bars` p95 = **6009ms**. Plan = index `(symbol,timeframe)` + Filter(source,starts_at) + **Sort**. Hit by `/bars` HTTP + shadow-account + universe-wide signal-monitor backfill. | **PRIMARY — fixed (this doc, Layer 1)** |
| **execution_events read** `listDeploymentEvents` (signal-options-automation.ts:2018): filter `deployment_id` + `event_type LIKE 'signal_options_%'`, ORDER BY `occurred_at DESC` LIMIT. | `EXPLAIN ANALYZE` limit 2500 = 131-171ms but scanned ~97K rows for 2500 (`Rows Removed by Filter` ~95K), ~134-180 MB disk at ~45% cache hit → evicts shared_buffers (the likely cause of the 60% global cache-hit that slows bar_cache). **`deployment_id` n_distinct = 1** (one deployment = 100% of 835,889 rows): NOT timing out, but a cache-polluter, and the real filter is `event_type`. | **SECONDARY — deferred to Layer 2** |
| signal-monitor ~900-write herd | Commit `4ff7b65` already coalesced it. Old function gone. | **RESOLVED — stale in the handoff** |

## Layer 1 — bar_cache covering index (DONE + VERIFIED)

Additive composite matching the access pattern exactly, turning over-fetch+sort into an ordered range-scan:

```
bar_cache: (symbol, timeframe, source, starts_at)
  before: Index(symbol,timeframe) -> heap-fetch ALL rows for symbol+tf
          -> Filter(source, starts_at) -> Sort(starts_at) -> Limit   [6s TIMEOUT]
  after:  Index range-scan (symbol=,timeframe=,source=, starts_at range)
          in starts_at order -> Limit short-circuits                 [36 ms]
```

**Verified 2026-06-17** (same query that timed out): `EXPLAIN ANALYZE` `/bars` AIZ/1m = **36.4 ms**, plan `Index Scan Backward using bar_cache_symbol_timeframe_source_starts_at_idx`, all 4 cols as Index Cond, **no Sort, no Filter**, 355 blocks (was: 6000ms timeout). Built `CONCURRENTLY` in ~2 min, `indisvalid=true`.

**Decisions (from review):**
- **Add-first / drop-later (two migrations).** `..._covering_indexes_add.sql` created the bar_cache composite (APPLIED + verified). `..._covering_indexes_drop_redundant.sql` drops the subsumed single-col indexes — STAGED, apply only after the verification window.
- **Build now.** Applied immediately. `CREATE INDEX CONCURRENTLY` took no write lock.
- **Regression guard = `market-data-schema-audit.ts`.** The new composite is in bar_cache's expected-index list; `pnpm db:market-data:audit` fails if it is ever dropped.

**Redundant indexes dropped by migration 2** (each a leading-column prefix of a retained index → fully subsumed; net effect *fewer* indexes = cheaper writes on the hot append tables):
`bar_cache_symbol_timeframe_idx`, `bar_cache_instrument_idx`, `signal_monitor_symbol_states_profile_idx`.

**Apply constraints (in the migration headers):** `CREATE/DROP INDEX CONCURRENTLY` cannot run in a transaction, and the server default `statement_timeout=6000ms` would cancel the build at 6s and leave an INVALID index — apply with `PGOPTIONS="-c statement_timeout=0"` via `psql -f`, never `--single-transaction`. Post-apply, check `pg_index WHERE NOT indisvalid`.

## Layer 2 — deferred architecture (NOT in scope here)

- **execution_events — all index + data-model work.** `deployment_id` has **n_distinct = 1** (one deployment, 835,889 rows, no retention), so:
  - The existing `execution_events_deployment_idx` is dead weight (drop it in Layer 2).
  - A `(deployment_id, …)` index gives no selectivity today (verified: planner ignored it). The real filter is `event_type` (8 types, top one 88%).
  - Correct read fix is event_type-targeted, e.g. a **partial index** `(deployment_id, occurred_at) WHERE event_type LIKE 'signal_options_%'` — but the root issue is the **unbounded single-deployment log** (retention/rollup) and whether `reconcile` should scan the raw event log on the hot path at all vs. a maintained position-state projection. Design these together.
- **bar_cache retention/partitioning.** 7.3M 1-minute-bar rows; time-partitioning or pruning would shrink the working set and lift cache hit.
- **bar_cache read/write key alignment.** Read filters by `symbol`; unique key is `instrument_id`. Composite fixed the read as written; aligning is a larger change.
- **shared_buffers / cache sizing.** Re-measure the 60% cache hit after Layer 1 + the execution_events fix land (less eviction may restore it without sizing).
- **Rejected band-aids:** NOT raising the 12-pool cap (shared instance; more conns = more disk contention at low cache hit), NOT raising `statement_timeout` (lets slow queries hold connections longer).

## What already exists (reused, not rebuilt)
- The bar_cache query is correct and in place — this only adds the index its access pattern needs.
- Migration + Drizzle-schema mechanism: proven by `20260617_option_chain_latest.sql`. `drizzle-kit push` is hard-disabled (2026-06-15 data-loss incident); SQL migrations are the only path.
- `scripts/src/market-data-schema-audit.ts` (`pnpm db:market-data:audit`) — existing DB index/column guard, extended for the bar_cache composite.

## Failure modes
| Codepath | Failure | Covered? |
|---|---|---|
| `CREATE INDEX CONCURRENTLY` interrupted | Leaves INVALID index, never used | Mitigated: `statement_timeout=0` + detached run + post-apply `pg_index WHERE NOT indisvalid` check (verified clean) |
| Composite not used / underperforms | `/bars` stays slow | N/A — verified used (36 ms); add-first/drop-later keeps old indexes until migration 2 |
| Future change drops the index | Silent return of 6s timeouts | Covered: schema-audit guard fails loudly |
| Migration applied with `--single-transaction` | CONCURRENTLY errors | Mitigated: header documents the constraint |

## Implementation tasks
- [x] **T1** — bar_cache composite added to Drizzle schema (`market-data.ts`). (execution_events reverted — deferred.)
- [x] **T2** — Migration `20260617_covering_indexes_add.sql` (bar_cache only, CONCURRENTLY, `statement_timeout=0`, idempotent).
- [x] **T3** — Staged migration `20260617_covering_indexes_drop_redundant.sql` (bar_cache ×2 + signal_monitor; do-not-apply-yet header).
- [x] **T4** — Regression guard: bar_cache composite added to `market-data-schema-audit.ts`.
- [x] **T5** — Typecheck `lib/db` + `scripts` (exit 0).
- [x] **T6** — Applied bar_cache index to live DB (CONCURRENTLY, valid).
- [x] **T7** — Verified: `EXPLAIN ANALYZE` `/bars` 6s→36ms via the composite; no invalid indexes.
- [HELD→RECONCILED] **T8.** Migration 2 (redundant-index drops) was originally deferred pending its own index-usage audit + explicit approval (user ruling 2026-06-17, AGENT_CHAT_MESSAGES.jsonl seq51; codex-db-pool seq48 — "KEEP" held live at +1 bar_cache index).
  **DRIFT FOUND 2026-06-24:** a live `pg_indexes` check shows the two bar_cache drops ARE applied (`bar_cache_instrument_idx` and `bar_cache_symbol_timeframe_idx` are absent), i.e. the KEEP ruling was superseded at some point after 06-17. `signal_monitor_symbol_states_profile_idx` is still PRESENT, so migration 2 is only PARTIALLY applied (bar_cache portion done, signal-monitor portion not).
  **ACTION 2026-06-24 (ratify to live reality):** removed the two dropped bar_cache index declarations from the Drizzle schema (`market-data.ts`) and the expected-index list (`market-data-schema-audit.ts`) — exactly the "WHEN THIS LANDS" cleanup the migration header prescribes. Left the signal-monitor index in schema/audit since it still exists. Did NOT touch the live DB. Reversible via git if the original KEEP ruling should stand instead (in which case the two bar_cache indexes must be re-created CONCURRENTLY on the live DB).
- [x] **Layer 2 (partial) — bar_cache autovacuum tuning.** Per-table reloptions (vacuum/analyze scale_factor=0.02, threshold=1000, cost_limit=2000) applied live 2026-06-24 (dead tuples 6.4% → <1%, autovacuum now self-firing). Ratified as `migrations/20260624_bar_cache_autovacuum_tuning.sql` + guarded by `market-data-schema-audit.ts` (new reloptions check; `pnpm db:market-data:audit` fails if dropped).
- [ ] **Layer 2** — execution_events index + retention/projection; bar_cache retention; cache sizing re-measure.

## Parallelization
Sequential implementation, no parallelization opportunity.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | Scope reduced to Layer 1; 3 decisions resolved; verification caught + corrected a useless execution_events index (deployment_id n_distinct=1) → deferred to Layer 2; 0 critical gaps |

- **UNRESOLVED:** none.
- **VERDICT:** ENG CLEARED — Layer 1 (bar_cache covering index) implemented and verified in prod (6s→36ms). Redundant-index drops staged (migration 2). execution_events + retention deferred to Layer 2 with the n_distinct=1 finding as primary input.
