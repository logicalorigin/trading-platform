# Database Audit & Consolidation Plan

> **Revision note:** v3, after an exhaustive 29-agent multi-language audit (TS + Rust + Python) that
> re-derived every table's writers/readers/retention from source and adversarially verified each
> claim. It corrected **three high-severity errors in v2** (one of which would have broken live
> trading data) and found genuinely-unbounded tables v2 missed. Key flips are listed in
> "Corrections incorporated (v2 → v3)" at the end. Confidence: **high** on the static
> code-verified findings (every file:line below re-confirmed); **medium** on disk/size/index-usage
> claims that still need live `pg_stat` data (Phase 0).

## Context

One shared Postgres ("helium", hard **12-connection** cap, ~9.3 / 15 GB) serving **~70 tables** and
**three writers in two languages**: the Node API (`artifacts/api-server`), the **Rust**
`market-data-worker` (`crates/market-data-worker`, owns market-data ingest + retention), and the
Python `pyrus_compute` service. Goals (all four): **cut disk/cost, simplify schema, lower ongoing
maintenance, improve query/stability.** The binding constraint on app stability is **pool /
event-loop saturation by a handful of unbounded append firehoses** — not table count. Container
drops (~87/24h historically) trace to heavy DB ops (15–45 s) stalling the single Node event loop.

The user asked: *"if I asked you to rebuild the DB to better accommodate the app in its current
form, how would you go about it?"* → target design first, then a phased, reversible path on a **live
trading DB** with a **prior data-loss incident** and `drizzle-kit push` disabled
(`lib/db/package.json:12-13`). **Deliverable:** prioritized audit + phased plan. **No changes this
pass.**

---

## Part 1 — Current-state findings (audit)

### 1a. Confirmed dead — grep = 0 in TS + Rust + Python (deadConfidence in parens)
Safe to **quarantine-rename** after Phase-0 row counts confirm them empty/stale:
- `flow_summaries` (0.92), `instrument_aliases` (0.90), `saved_scans` (0.90), `alert_rules` (0.90),
  `alert_events` (0.90), `order_requests` (0.90), `broker_orders` (0.90), `execution_fills` (0.90),
  plus `shadow_portfolio_analysis_snapshots` and `activity_log` (assert via direct grep at retire time).
- Caveats: `instrument_aliases` is touched once by migration `20260601_massive_provider_rename.sql:46-58`
  (a no-op backfill; nothing populates it). `broker_orders` "BrokerOrderSnapshot" hits are an
  in-memory IBKR DTO, not the table.
- `order_requests`/`broker_orders`/`execution_fills` are the **real-broker order ledger** — dead;
  live trading flows through `shadow_*` + the IBKR `flex_*` import. (Open decision #2: confirm row
  counts before retiring.)

> ⚠️ `alert_*` / `saved_scans` / `activity_log` may be *intended-but-unbuilt* features — **confirm
> intent before retiring** (Open decision #1).

### 1b. Dead-but-NEEDS-UNWIRING-FIRST (do **not** DROP blind)
- **`option_chain_snapshots`** — **data-plane dead** (zero app/Rust INSERT, zero read; read path
  cut over to `option_chain_latest`, enforced by `option-chain-latest-cutover.test.ts`). It is
  **DELETE-only**: Rust retention `retention.rs:37`, TS prune allow-list `diagnostics.ts:4648`,
  size monitor `diagnostics.ts:2854`. **CRITICAL correction to v2:** the Rust
  `persist_option_chain_snapshots` (`ingest.rs:161`) writes **`option_chain_latest`**
  (`upsert_option_chain_latest_tx` → `ingest.rs:552`), **not** this table — there is *no*
  `insert into option_chain_snapshots` anywhere (verified). Removing that call (as v2 said) would
  **break the live `option_chain_latest` cache that GEX reads at `gex.rs:56`.** Retire by unwiring
  the three DELETE/monitor references + the cutover test, then quarantine-rename. (2.6 GB; biggest
  single reclaim.)
- **`ticker_reference_cache`** — no writer, but referenced by account schema-readiness
  (`account.ts:456`) and the prune/monitor lists (it *is* in `PRUNABLE_CACHE_TABLES`,
  `diagnostics.ts:4651`). Unwire those before any drop.
- **`position_lots`** — **write-dead** (zero writers in any language; sole reader `getPositionLots`
  `account.ts:5988`, called on the live path `:5212`, always returns `[]`). Belongs with the dead
  real-broker ledger, **not** Tier A. Drop the always-`[]` reader, then quarantine-rename.

### 1c. Retention — the DEFINITIVE corrected picture
**Already bounded (REMOVE from v2's "unbounded" list — v2 was wrong):**
- `flow_events` + `flow_event_hydration_sessions` self-prune on the **write path**:
  `historical-flow-events.ts:885` → `:897` (`flow_events WHERE occurred_at < cutoff`) / `:900`
  (hydration `window_to < cutoff`), `HISTORICAL_FLOW_RETENTION_MS = 45d` (`:67`).
- `automation_diagnostics` self-prunes: `overnight-spot-execution.ts:1034` `pruneAutomationDiagnostics()`,
  `AUTOMATION_DIAGNOSTICS_RETENTION_MS = 7d` (`:1043`).
- **Caveat:** these piggyback on writes — they **stall if the trigger path idles**. Phase-0 task =
  verify `max(occurred_at)` age is within policy, not build new retention.

**Rust `retention.rs` (6-hourly, executing) — verify it's firing (Phase 0):** `quote_cache` (7d),
`option_chain_snapshots` (7d), `bar_cache` (`starts_at`, 90d + coarse), `gex_snapshots` (30d),
`provider_request_log` (14d). Defaults `config.rs:48-64`.

**GENUINELY UNBOUNDED, no effective retention (the REAL gap — needs NEW prune code):**
| Table | Why | Fix owner / cutoff |
|---|---|---|
| `market_data_ingest_jobs` | **Omitted by v2.** Zero DELETE anywhere (verified); terminal `dedupeKey` rows never reused/deleted → monotonic. | `retention.rs`: `DELETE WHERE status IN ('completed','failed','cancelled') AND created_at < cutoff` (NOT flat time — live `queued`/`running` must survive). |
| `execution_events` | DELETE only by replay id; **NOT in the prune allow-list.** | new time prune on `occurred_at`. |
| `shadow_position_marks` | append per-mark (~563k); not allow-listed. | new time prune on `as_of`. |
| `signal_monitor_events` | INSERT `signal-monitor.ts:122`; no DELETE; not allow-listed. | new prune on `signal_at`. |
| `signal_monitor_breadth_snapshots` | **Omitted by v2.** INSERT `:1783`; no DELETE. | new prune on `captured_at`. |
| `balance_snapshots` | **Mis-tiered Tier A by v2.** INSERT-only `account.ts:4094`, ~1440 rows/day/acct. | Tier C; prune on `as_of`. |
| `shadow_balance_snapshots` | **Omitted by v2.** Live-source rows never time-pruned (existing DELETEs are replay-scoped). | Tier C; prune on time **scoped to live source**. |
| `option_contracts` (expired backlog) | `is_active` never set false on expiry; no delete. | worker: deactivate/delete past-`expiration_date` beyond a grace window. |

**Mechanism gotcha (v2's Phase 1.2 was broken):** `pruneDiagnosticStorage` filters its input to
`PRUNABLE_CACHE_TABLES` (`diagnostics.ts:4667`) and **silently drops** anything not allow-listed,
reporting success. So scheduling it for `execution_events`/`shadow_position_marks`/etc. prunes
**nothing**. Only `diagnostic_snapshots`, `diagnostic_events`, `ticker_reference_cache`, `bar_cache`,
`quote_cache`, `option_chain_snapshots`, `flow_events`, `flow_event_hydration_sessions` are
allow-listed; those just need a **scheduler** around the existing helper.

### 1d. Parallel ledgers (duplication)
- `execution_events` ↔ `automation_diagnostics` — column-for-column identical (`automation.ts:125`),
  split deliberately for hot-read isolation. (Both still need retention — see 1c.)
- Real-broker ledger (`order_requests`/`broker_orders`/`execution_fills`/`position_lots` — all
  dead/write-dead) mirrors the live shadow ledger → **retire the dead side**, no live merge.
- `flex_*` (6 tables) and `bar_cache` vs `historical_bars` — distinct purpose; keep.

### 1e. jsonb `raw`/`payload` bloat (compression lever — inventory extended)
`flow_events.raw_provider_payload`, `execution_events.payload`, `flex_*.raw`,
`provider_request_log.metadata`, **plus (v2 omitted):** `signal_monitor_events.payload`
(`signal-monitor.ts:122`), `diagnostic_snapshots.{dimensions,metrics,raw}` (`diagnostics.ts:30-32`),
`diagnostic_events.raw` (`:64`), `automation_diagnostics.payload` (`automation.ts:141`),
`gex_snapshots.payload` notNull (`market-data.ts:242`). `raw` = verbatim-upstream duplicate → the
exact column-DROP/side-table target; `lz4` the bounded-but-high-volume payloads.

### 1f. Indexing (drop candidates pending Phase-0 `idx_scan = 0`)
- **Redundant** (single-col == leading prefix of a composite/unique): `gex_snapshots_symbol_latest_idx`
  (identical to unique `gex_snapshots_symbol_computed_at_idx`); `watchlist_items_watchlist_idx`
  (prefix of unique `(watchlist_id,instrument_id)`); `option_contracts_underlying_idx` (prefix of
  `(underlying,expiration)`); the already-flagged `shadow_position_marks_position_idx`
  (`trading.ts:342`).
- **Unused (not redundant) → drop only on `idx_scan=0`:** `option_contracts_expiration_idx`
  (composite leads with `underlying`, no expiration-only filter exists), `pine_scripts_status_idx`
  (`status` never in a WHERE).
- **KEEP** `bar_cache_starts_at_idx` — the only index serving the timeframe-scoped retention DELETE
  (`retention.rs:50`).
- **Existing drift to reconcile NOW:** `historical_bars_provider_contract_quote_idx` exists in SQL
  (`20260530_historical_bar_quote_fields.sql:12-14`, partial `WHERE provider_contract_id IS NOT NULL
  AND quote_as_of IS NOT NULL`) but Drizzle (`backtesting.ts`) models only 2 historical_bars
  indexes; those columns are unpopulated → it indexes **zero rows** (pure write-amplification + TS
  drift). Drop it (or add to Drizzle) and wire a generic `pg_indexes`-vs-Drizzle drift check into
  `audit:guards`/`typecheck`.

---

## Part 2 — Target design ("how I'd rebuild it")

Core insight: **high-churn regenerable data shares one instance + one 12-conn pool with low-churn
source-of-truth data.** Separate by **lifecycle tier**; make Tier C retention **structural**.

### Principle 1 — Tier every table (corrected tiers in **bold**)
- **Tier A · Source of truth** (small, durable): broker config, shadow ledger, `flex_*`, algo
  strategies/deployments, backtests, pine_scripts, watchlists, preferences, instruments,
  option_contracts (*with* expiry retention — 1c), signal_monitor_profiles, diagnostic_threshold_overrides.
  **NOT `balance_snapshots` (→ C), NOT `position_lots` (dead).**
- **Tier B · Derived "latest"** (compact upsert): `option_chain_latest`, `flow_universe_rankings`,
  `signal_monitor_symbol_states`, `mtf_pattern_results`. **NOT `gex_snapshots`** — it's
  `ON CONFLICT (symbol, computed_at)` = a 30-day *history* (`gex.rs:208`) → **Tier C**.
- **Tier C · Ephemeral firehose / history** (must be bounded): `bar_cache`, `quote_cache`,
  `flow_events`, `signal_monitor_events`, `shadow_position_marks`, `provider_request_log`,
  `diagnostic_snapshots`, `execution_events`/`automation_diagnostics`, `mtf_pattern_occurrences`,
  `historical_bars`, **`gex_snapshots`, `balance_snapshots`, `shadow_balance_snapshots`,
  `signal_monitor_breadth_snapshots`, `market_data_ingest_jobs`**.

### Principle 2 — Bound every Tier C table; partition ONLY where it pays (80/20)
- **Default: scheduled, time-batched `DELETE` + `ANALYZE` + a BRIN index on the time column.** Most
  Tier C tables stay small once retention runs and never need more.
- **Partition only the large/hot append tables** where cheap `DROP PARTITION` beats a rewrite —
  realistically **`bar_cache` first**, reassess `execution_events` after retention. **Gotcha:** PG
  requires the partition key in the PK and every UNIQUE index; `bar_cache.id` is a bare surrogate
  uuid (`market-data.ts:46`) → PK must become `(id, starts_at)`; its unique upsert key already
  includes `starts_at` and **must be kept** (ON CONFLICT target); per-partition copies of the
  `(symbol,timeframe,source,starts_at)` read index still required (pruning only handles time).

### Principle 3 — Don't merge the ledgers
Real-broker ledger is dead → **retire**, no merge. `execution_events`+`automation_diagnostics`
re-merge re-introduces the contention the split fixed for a one-table saving → **not recommended**
absent concrete pain. `balance_snapshots` vs `shadow_balance_snapshots` are distinct real-vs-shadow
sources of truth → **do not merge**.

### Principle 4 — Strip/relocate raw payloads (extended inventory in 1e).
### Principle 5 — Index to mapped read paths; drop redundant/unused (1f) on Phase-0 stats.
### Principle 6 (strategic, decide EARLY) — Move the Tier C market-data lake off the OLTP pool
The binding constraint is the 12-conn ceiling; the Rust-written market-data firehoses saturate it.
Highest-leverage architectural move: a separate worker-owned store for Tier C market-data so a
dashboard load can't starve trading writes. **Gates Phase 2** (in-place `bar_cache` partitioning is
wasted if market-data moves off helium).

### Target table count
~70 → ~55–58 by retiring ~10–12 dead tables; the win is **disk + pool headroom + no recurring
surgery**, not the count.

---

## Part 3 — Phased path (measurement-first, reversible-first)

### Phase 0 — Ground truth (read-only; do first)
From a DB-owner `psql` session: `pg_stat_user_tables` (live/dead rows), `pg_total_relation_size` per
table, `pg_stat_user_indexes.idx_scan` for every index named in 1f, `pg_cron`/`pg_partman`
availability. **Plus:** (a) confirm the in-process self-prunes actually fired — `max(occurred_at)`
age for `flow_events` (≤45d) and `automation_diagnostics` (≤7d); (b) snapshot row counts/sizes for
the **omitted unbounded set** (`market_data_ingest_jobs`, `balance_snapshots`,
`shadow_balance_snapshots`, `signal_monitor_breadth_snapshots`, `execution_events`,
`signal_monitor_events`, `shadow_position_marks`); (c) confirm the dead tables (1a) are empty/stale.

### Phase 0.5 — Backup gate (blocking, before anything destructive)
Verified, test-restored snapshot/`pg_dump`; confirm PITR window covers the project. Doubles as the
**staging Postgres** for rehearsing Phases 2+ (PGlite can't test partitioning).

### Phase 1 — Safe wins (reversible, no merges) — ~90% of the value
1. **Reclaim accumulated dead space** *after* confirming Rust retention is firing: time-batched
   delete of any backlog in an out-of-pool `psql` session (`statement_timeout=0`, batched, paused),
   then `VACUUM` (plain first; `VACUUM FULL`/`pg_repack` off-hours for `option_chain_snapshots` /
   `bar_cache`), then `ANALYZE`.
2. **Close the REAL app-table retention gap** (1c) — split into:
   - **(i) Schedule** the existing `pruneDiagnosticStorage` for its already-allow-listed tables
     (`diagnostic_*`, `ticker_reference_cache`, etc.).
   - **(ii) Write NEW prune code** for the genuinely-unbounded set (NOT routable through the
     allow-list helper): `execution_events` (`occurred_at`), `shadow_position_marks` (`as_of`),
     `signal_monitor_events` (`signal_at`), `signal_monitor_breadth_snapshots` (`captured_at`),
     `balance_snapshots` (`as_of`), `shadow_balance_snapshots` (live-source-scoped), and add
     `market_data_ingest_jobs` status+age cleanup to `retention.rs`.
3. **Quarantine-rename confirmed-dead** (1a): `ALTER TABLE … RENAME TO _trash_<name>`, soak N days,
   then DROP. Start with `flow_summaries`, `instrument_aliases`, `order_requests`, `broker_orders`,
   `execution_fills`; hold `alert_*`/`saved_scans`/`activity_log` pending Open decision #1.
4. **Retire `option_chain_snapshots` CORRECTLY** (1b): unwire `retention.rs:37` +
   `diagnostics.ts:4648` (prune) + `:2854` (monitor) + the cutover test — **NOT `ingest.rs:161`** —
   then quarantine-rename.
5. **Drop redundant/unused indexes** confirmed `idx_scan=0` (1f); **reconcile the `historical_bars`
   drift index** and wire the generic drift guard into `audit:guards`.
6. **`position_lots`:** drop the always-`[]` `getPositionLots` reader, then quarantine-rename.
Each as its own SQL migration in `lib/db/migrations/` (push disabled). **No `CASCADE`** — enumerate
FK dependents first.

> **STOP condition:** if container-drop rate → ~0 and disk is healthy after Phase 1, **halt and
> re-justify Phases 2–4.** For a single-user app, Phase 0 + 0.5 + 1 likely meets all four goals.

### Phase 2 — Partition `bar_cache` (only if still large/hot post-retention; decide Principle 6 first)
Composite-PK `(id, starts_at)` + hand-mirror into Drizzle (+ drift guard). Create partitioned twin →
**pause Rust ingestion** (regenerable; beats dual-write) → batched out-of-pool backfill → atomic
rename-swap with `lock_timeout` → repoint readers/writers → `ANALYZE` → resume. Touches
**`crates/market-data-worker`** (writer + `retention.rs`).

### Phase 3 — Strip/relocate raw jsonb payloads (Principle 4 / extended 1e inventory).
### Phase 4 — Strategic: execute Principle 6 if chosen. Ledger merges remain not recommended.

---

## Critical files
- Schema: `lib/db/src/schema/*.ts`; migrations `lib/db/migrations/` (SQL-file path; push disabled).
- **Rust worker (writer + retention): `crates/market-data-worker/src/{main.rs,ingest.rs,retention.rs,config.rs}`**
  — note `persist_option_chain_snapshots` writes `option_chain_latest`, not the snapshots table.
- TS retention: `artifacts/api-server/src/services/diagnostics.ts` (`pruneDiagnosticStorage`,
  `PRUNABLE_CACHE_TABLES`); self-prunes in `historical-flow-events.ts` (`pruneHistoricalFlowEvents`)
  and `overnight-spot-execution.ts` (`pruneAutomationDiagnostics`).
- Readers (drop/merge safety): `artifacts/api-server/src/services/{account,option-metadata-store,
  historical-flow-events,diagnostics,backtesting,shadow-account,signal-monitor}.ts`,
  `gex-universe-refresh.ts:981` (raw-SQL reader of `universe_catalog_listings`).
- Prior art: `docs/plans/{pyrus-container-drop-db-bloat-retention-fix-plan,option-chain-upsert-latest-redesign,
  db-pool-starvation-repair-plan}.md`.

## Verification
- **Phase 0 / after Phase 1:** `GET /api/diagnostics/latest` → Tier C `sizeMB` drops, `dead_pct`
  low, `oldest` within policy, DB total well under 15 GB; container-drop rate
  (`scripts/diagnose-agent-restarts.mjs --since 6h`) → ~0.
- **Retention code (Phase 1.2):** unit-test each new prune deletes the right rows and preserves live
  ones (esp. `market_data_ingest_jobs` queued/running; `shadow_balance_snapshots` replay scope).
- **Per migration:** `EXPLAIN (ANALYZE)` the mapped hot reads before/after; confirm dropped indexes
  weren't load-bearing; `ANALYZE` after every bulk op.
- **Partitioning (Phase 2):** rehearse on the staging Postgres; verify pruning + `DROP PARTITION`
  reclaim; confirm the Rust worker still writes/retains post-swap.
- **Retirements:** Phase-0 row counts + repo grep (TS **and** Rust **and** Python) before each rename;
  soak in `_trash_` before final DROP.

## Open decisions
1. **Roadmap status** of `alert_rules`/`alert_events`/`saved_scans`/`activity_log` — retire or keep?
2. **Confirm** the real-broker ledger (`order_requests`/`broker_orders`/`execution_fills`/`position_lots`)
   is dormant (Phase-0 row counts) before retiring.
3. **Principle 6** — move market-data off helium? Decide **before** Phase 2.
4. **`pg_cron`/`pg_partman` availability** on helium (Phase 0) — partition-maintenance mechanism.

---

## Corrections incorporated (v2 → v3)
- **[CRITICAL]** `option_chain_snapshots` is **not written by the Rust worker** —
  `persist_option_chain_snapshots` (`ingest.rs:161`) writes `option_chain_latest` (`:552`). v2's
  "remove the Rust persist call" would have broken the live cache GEX reads. Reclassified as a
  DELETE-only drain: unwire the retention/monitor refs + cutover test, then rename.
- **[HIGH]** `flow_events`, `flow_event_hydration_sessions`, `automation_diagnostics` **self-prune on
  the write path** (45d/45d/7d) → removed from the "unbounded" gap.
- **[HIGH]** v2's "schedule `pruneDiagnosticStorage`" fix is broken — it filters to an allow-list and
  silently no-ops non-listed tables. Phase 1.2 split into schedule-existing + write-new-prune-code.
- **[NEW]** `market_data_ingest_jobs` is unbounded with zero retention (omitted by v2).
- **Re-tiered:** `balance_snapshots` A→C, `gex_snapshots` B→C, `position_lots` out of A (write-dead);
  added `shadow_balance_snapshots` + `signal_monitor_breadth_snapshots` to Tier C.
- **Indexes:** added `gex_snapshots_symbol_latest_idx`, `watchlist_items_watchlist_idx`,
  `option_contracts_underlying_idx` (redundant), `option_contracts_expiration_idx`,
  `pine_scripts_status_idx` (unused); keep `bar_cache_starts_at_idx`; reconcile the
  `historical_bars` SQL-only drift index now + add a drift guard.
- **jsonb inventory extended** to `signal_monitor_events.payload`, `diagnostic_*.{dimensions,metrics,raw}`,
  `automation_diagnostics.payload`, `gex_snapshots.payload`.
- Table count corrected ~50 → ~70.
- (Note: `algo_runs` was map-flagged dead but **refuted** on deeper verification — left live.)
