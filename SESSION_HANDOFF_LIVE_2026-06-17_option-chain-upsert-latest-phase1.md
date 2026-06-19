# SESSION HANDOFF (LIVE) — option-chain upsert-latest redesign (Phase 1) + live DB/bridge state

- **Date:** 2026-06-17 ~12:30 MDT
- **Session:** `ff8a6f9d-4207-4263-a9a2-de865f5f7ca0` (Claude Code, CWD `/home/runner/workspace`)
- **Why this handoff:** something kicked the app into recovery mode; user is restarting the container. Capturing in-flight work.

---

## ⛔ CRITICAL — do NOT lose / verify first after restart

1. **The dual-write Bug1/Bug2 fix is applied + deployed. Do NOT run a pre-fix build.** Before this fix, the Node dual-write would, when live market data resumes, throw `ON CONFLICT DO UPDATE cannot affect row a second time` on any batch with a duplicate `option_contract_id`, the catch would arm durable backoff → **option-chain writes silently stop**. Fix (in `option-metadata-store.ts`): dedup the upsert batch by `optionContractId` + wrap both writes in one `db.transaction`. Reviewer's doc: `docs/plans/option-chain-upsert-latest-redesign-REVIEW-FIXES.md` (from session `44004638`).
2. **The migration is already APPLIED to the live DB** (`option_chain_latest` exists — 18 cols, unique index `(option_contract_id, source)`). It persists across container restart (it's in helium Postgres, not the container). Migration file: `lib/db/migrations/20260617_option_chain_latest.sql`. Idempotent (`if not exists`) — safe to re-run.

---

## What I was working on
Implementing + deploying **Phase 1** of the option-chain ingestion redesign: replace the append-only `option_chain_snapshots` firehose (18–45 s batch writes that saturate the shared 12-conn helium pool) with an **upsert "latest-per-(contract,source)" table** (`option_chain_latest`), via additive **dual-write** (legacy table + new table both written; readers unchanged this phase). Full plan: `docs/plans/option-chain-upsert-latest-redesign.md`.

### Phase-1 status
- ✅ Migration `20260617_option_chain_latest.sql` — applied + verified (table/cols/unique index).
- ✅ Drizzle `optionChainLatestTable` added (`lib/db/src/schema/market-data.ts`); `lib/db/dist` rebuilt to export it.
- ✅ **Rust dual-write** (`crates/market-data-worker/src/ingest.rs`, in `insert_option_chain_snapshots_tx`) — correct (ticker-dedup via `unique_option_chain_snapshots` + single tx); reviewer confirmed clean, no change needed.
- ✅ **Node dual-write** (`artifacts/api-server/src/services/option-metadata-store.ts`) — FIXED (dedup + `db.transaction`), typecheck green (0 errors), deployed (new api-server pid, healthy).
- ✅ **Pre-existing typecheck regression fixed:** `automation.ts` `listAlgoDeployments` now annotated `: Promise<AlgoDeploymentListResponse>` (the `unavailable` fallback's untyped `[]` was inferring `never[]`, breaking `algo-cockpit-streams.ts`). Was masked by stale `lib/db/dist`; surfaced by the required dist rebuild.
- ✅ **Under-load validation COMPLETE (2026-06-17 ~13:18 MDT, session resume):** market data resumed; `option_chain_latest` actively filling under live Massive load — grew 3,372 → 4,908 rows (`source='massive'`) across two queries ~30 s apart; 1,536 rows updated in the last 60 s, 2,560 in 120 s; `max_updated` only ~42 s behind `now()`. Sustained broad upserting + a growing table proves the dedup/transaction fix works under load and **no durable backoff is armed** — a thrown `ON CONFLICT` would freeze all writes via the `catch` (`option-metadata-store.ts:591-592`); writes are instead current to the second.

---

## 🔴 Current live blocker (likely what caused recovery mode)
The shared **helium Postgres (hard 12-connection cap)** is **saturated** → repeated `canceling statement due to statement timeout` (57014) and `Connection terminated due to connection timeout` across:
- `execution_events … like 'signal_options_%' … limit 2500` — `SignalOptionsPositionTickManager.reconcile` (`signal-options-automation.ts:10873`)
- `signal_monitor_symbol_states` / `signal_monitor_events` — `persistSignalMonitorMatrixStatesBestEffort` (~900 states via `Promise.all`, `signal-monitor.ts:6277`)
- `bar_cache`, `instruments` — market-data store (`"durable market data store temporarily unavailable; serving provider fallback"`)

**Key insight (user-prompted):** this is **independent of the IBKR bridge** (which is intentionally OFF → 530/1033) and **independent of the option-chain firehose** (which is down). Massive's old-side option data **is** being fetched (provider fallback served) but **can't persist** because the DB is saturated by the **signal-options / signal-monitor** DB load. So fixing the option-chain firehose alone will NOT relieve the pool — these other paths are the current top offenders.

---

## ⛔ DB-SATURATION ROOT-CAUSE INVESTIGATION (2026-06-17 ~13:30 MDT, session resume — GROUND TRUTH)
The pre-restart "3 offenders" list above is partly STALE. Corrected, evidence-backed picture (server is healthy: max_connections=112 / 19 used, 0 deadlocks, cgroup oom_kill=0 — the "12 cap" is the APP POOL, and container restarts are dev-supervisor api-child restarts, NOT OOM):

1. **PRIMARY — `bar_cache` read has no covering index → real 6s timeouts.** `loadStoredMarketBars` (`market-data-store.ts:294-317`) filters `(symbol,timeframe,source)` + `starts_at` range ORDER BY `starts_at`; best index is only `bar_cache_symbol_timeframe_idx (symbol,timeframe)` → Postgres heap-fetches every bar for that symbol+timeframe (all sources/time), filters source+time in heap, then SORTS. `EXPLAIN (ANALYZE)` of `/bars` (AIZ/1m) **`canceling statement due to statement timeout`** — reproduced the live 57014. Table 7.3M rows / 3.7 GB. Called by `/bars` HTTP route (live p95=6009ms in flight-recorder) + `shadow-account.ts:11790` + `signal-monitor-local-bar-cache.ts:444` (universe-wide backfill, re-enabled by commit 4ff7b65 even with bar-eval flag off). FIX: composite `(symbol,timeframe,source,starts_at)` (CONCURRENTLY); drop now-redundant `(symbol,timeframe)` + `(instrument_id)`.
2. **SECONDARY — `execution_events` read missing `(deployment_id,occurred_at)` composite.** `listDeploymentEvents` (`signal-options-automation.ts:2018`): `WHERE deployment_id=X AND event_type LIKE 'signal_options_%' ORDER BY occurred_at DESC LIMIT ≤10000`. Only single-col indexes exist → planner scans `occurred_at` backward + heap-filters. `EXPLAIN (ANALYZE)` limit 2500: **171ms but Rows Removed by Filter=94472 (scanned ~97K to get 2500), Buffers read=17200 (~134 MB disk, 45% cache hit)**. Not timing out now, but the disk I/O pollutes shared_buffers → likely the cause of the 60% global cache-hit ratio that makes `bar_cache` slow. Fragile (ages toward 6s). One deployment `7e2e4e6f` has 835,439 events (unbounded-growth smell). FIX: composite `(deployment_id,occurred_at)` (CONCURRENTLY); drop redundant `(deployment_id)`.
3. **RESOLVED — signal-monitor ~900-write herd.** Commit 4ff7b65 ("coalesce signal-monitor state writes", Design A) coalesced the full-matrix persist into one in-flight run/profile so it no longer stacks connections vs the 12-cap. Old `persistSignalMonitorMatrixStatesBestEffort` is gone. NOT a current offender. (Same commit re-enabled universe-wide bar backfill → feeds offender #1.)

**Architectural follow-ups (not band-aids — flagged):** `execution_events` retention/rollup (835K/one deployment, no prune); whether reconcile should scan the raw event log on the hot path at all; `bar_cache` retention/partitioning + the 60% cache-hit (shared_buffers vs 3.7 GB+1.8 GB tables); redundant single-col indexes across `bar_cache`/`execution_events`/`signal_monitor_symbol_states` `(profile_id)`. **Do NOT raise the 12 pool cap** — shared helium PG, more conns = more disk contention at 60% cache hit; fix query cost, not pool size.

### Layer-1 fix — reviewed (/plan-eng-review) + IN PROGRESS (2026-06-17 ~14:10 MDT)
Plan doc: `docs/plans/db-pool-saturation-index-fix.md` (eng-review CLEAR). Scope decision: Layer 1 now, Layer 2 specced separately. Decisions: add-first/drop-later (two migrations), build now, regression guard via existing `market-data-schema-audit.ts`.
- ✅ Drizzle schema: composites added — `bar_cache (symbol,timeframe,source,starts_at)` (`lib/db/src/schema/market-data.ts`), `execution_events (deployment_id,occurred_at)` (`automation.ts`). Typecheck green (lib/db + scripts, EXIT 0). No dist rebuild needed (index decls are migration-metadata, inert at query runtime; no new exports).
- ✅ Migrations: `lib/db/migrations/20260617_covering_indexes_add.sql` (apply now) + `..._drop_redundant.sql` (STAGED — do NOT apply until composites verified). Both `CONCURRENTLY`, `statement_timeout=0`, idempotent; headers document apply constraints.
- ✅ Regression guard: `scripts/src/market-data-schema-audit.ts` extended (bar_cache composite + new execution_events spec).
- ✅ **bar_cache composite BUILT + VERIFIED (20:12:29Z, ~2 min build, exit 0, indisvalid=true).** BEFORE/AFTER proof (same query): `/bars` (AIZ/1m) that `EXPLAIN ANALYZE` **timed out at 6000ms** now runs in **36.4ms** — plan = `Index Scan Backward using bar_cache_symbol_timeframe_source_starts_at_idx`, all 4 cols as Index Cond, **NO Sort, NO Filter**, 355 blocks (hit=3 read=352). Confirmed 6s timeout eliminated.
- ❌→✅ **execution_events composite BUILT then DROPPED (deferred to Layer 2).** Verification caught it: `deployment_id` has **n_distinct=1** (ONE deployment = 100% of 835,889 rows), so `(deployment_id, occurred_at)` gives zero selectivity — `EXPLAIN ANALYZE` showed the planner ignoring it (still scanned ~97K rows / 23,116 blocks / ~180 MB; the real filter is `event_type`). Dropped the useless composite via `DROP INDEX CONCURRENTLY` (20:20:45Z, exit 0); reverted the schema/audit/migration artifacts. The existing `execution_events_deployment_idx` is ALSO dead (n_distinct=1) → its drop + an event_type-targeted partial index + the unbounded-log retention/projection all fold into **Layer 2** (the n_distinct=1 + 88%-one-event-type facts are the key Layer-2 input).
- ✅ **Migrations now bar_cache-only.** `20260617_covering_indexes_add.sql` (applied + verified). `..._drop_redundant.sql` STAGED = bar_cache_symbol_timeframe_idx + bar_cache_instrument_idx + signal_monitor_symbol_states_profile_idx (NOT execution_events).
- ✅ RULING (2026-06-17 ~20:51Z, multi-agent chat AGENT_CHAT_MESSAGES.jsonl seq51, user info@logicalorigins.com via agent3): **KEEP** `bar_cache_symbol_timeframe_source_starts_at_idx` as-is — accepted as a pressure mitigation (it removed the dominant `apiPressureLevel` driver behind the STA row-prune / agent3 vector-2). NO drop.
- ⛔ Migration 2 (redundant-index cleanup) is **NOT authorized** — HELD pending its own index-usage audit + explicit approval (codex-db-pool seq48 + user ruling seq51). Net live state = current +1 index on bar_cache. Do NOT apply `20260617_covering_indexes_drop_redundant.sql`.
- ⬜ Layer 2 (separate cycle, if assigned): execution_events event_type-targeted fix (partial index) + retention; bar_cache retention; cache-sizing re-measure. Plan doc: `docs/plans/db-pool-saturation-index-fix.md`.
- 📌 Working tree uncommitted (schema/migrations/audit/plan doc + handoffs). Live DB change made + RETAINED by ruling: bar_cache composite index (additive, reversible).
- ⚠️ If a build is interrupted it leaves an invalid index: `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;` → `DROP INDEX CONCURRENTLY <name>` and re-run the idempotent add migration.
- Env now sets `MALLOC_ARENA_MAX=2` and `PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED=false` (added by another agent/user; in the api-server dev script).

---

## Bridge ↔ Massive redundancy audit (completed; `tasks/wkvip13g6.output`)
Concrete (bridge OFF, so the log shows exactly what we still call it for):
- **Redundant w/ Massive (real-time, should NOT hit bridge):** `GET /quotes/snapshot` stock bootstrap — **firing every ~15 s vs the ~500-symbol universe**, all 530. Code literally says *"IBKR bridge watchlist prewarm disabled while Massive stocks are primary"* (`platform.ts:1536`) and `getQuoteSnapshotsUncached` already routes to Massive (`platform.ts:5033`). **Most glaring wrong call — gate it off first.** Also `/streams/quotes`, `/bars`, `/streams/bars` (stock; wired, not firing now).
- **NOT cleanly redundant (live edge — keep):** option quote streams `/streams/options/quotes` + `/options/quotes` = real-time NBBO/greeks; Massive provides option **snapshots** (old side, via `massive.rs:472-476` → `option_chain_snapshots/option_chain_latest`). Bridge = live edge.
- **IBKR-only (legit):** `/accounts /positions /orders /executions` order ops, `/market-depth` (L2), `/news`, `/universe/search`, `/session`, `/healthz`.
- **Likely dead:** `getOptionActivitySnapshots` (`/quotes/option-activity`) — no callers outside `bridge-client.ts`.

---

## Files changed (working tree — uncommitted)
- `lib/db/migrations/20260617_option_chain_latest.sql` (new, **applied to DB**)
- `lib/db/src/schema/market-data.ts` (`optionChainLatestTable`)
- `crates/market-data-worker/src/ingest.rs` (Rust dual-write upsert)
- `artifacts/api-server/src/services/option-metadata-store.ts` (Node dual-write upsert, **FIXED**: dedup + transaction)
- `artifacts/api-server/src/services/automation.ts` (return-type fix) — ⚠️ **co-edited by another agent**; confirm my line survives: `grep "Promise<AlgoDeploymentListResponse>" automation.ts`
- docs: `option-chain-upsert-latest-redesign.md`, `option-chain-snapshot-write-contention-fix.md` (interim batch-size mitigation), `option-chain-upsert-latest-redesign-REVIEW-FIXES.md`

---

## After restart — verify / next steps
1. ✅ **DONE (verified 2026-06-17 ~13:14 MDT, session resume):** the FIXED dual-write IS what's running. Evidence: source fix matches REVIEW-FIXES spec exactly (`option-metadata-store.ts:541-586`, dedup `Map` keep-last + single `db.transaction`); api-server rebuilt post-restart — `dist/index.mjs` mtime `13:00:28` contains the `new Map(values.map` marker; api pid `493` started `13:00:25` (low pid ⇒ post-container-restart), serving on **:8080** (PORT env), responds in ~4 ms, no restart in the ~14 min since boot. ⚠️ Could NOT scan logs for `cannot affect row`/`ON CONFLICT`/durable-backoff — no api log file in common paths (`/tmp/*api*.log`, `artifacts/api-server/*.log`, `.pyrus-runtime/**`); error-free claim is UNVERIFIED until logs are located or market data flows.
2. ✅ **DONE (2026-06-17 ~13:18 MDT):** market data resumed; `option_chain_latest` filling (`source='massive'`, 4,908 rows, 1,536 fresh in 60 s, ~42 s behind now). Phase-1 under-load validation COMPLETE — dual-write upsert verified working under live load. (Single direct psql connection, `statement_timeout=6s`, returned fast with no 57014 → the pool was not blocking this read; not a measure of the app pool's saturation under its own load.)
3. **The DB saturation is the live problem.** Top offenders to address (separate from the option-chain redesign): the `execution_events` `limit 2500` signal-options reconcile, and the ~900-state `Promise.all` signal-monitor matrix persist. These are what's currently timing out the pool / starving Massive persistence.
4. **Bridge:** gate the `/quotes/snapshot` stock bootstrap off the bridge (Massive is primary) — clearest redundant call.
5. **Redesign Phases 2–4** (gated reader switch → verify → decommission old table) per the plan doc.

## Env / tooling note
This shell intermittently lost `node`/`python3`/`psql` from PATH (nix-store binaries); coreutils (grep/sed/find/tr) were stable. Re-resolve interpreters after restart if needed.

## Related prior handoffs
- `SESSION_HANDOFF_LIVE_2026-06-16_pool-contention-launch-hang.md` (the original pool-contention root cause)
- Memory: `option-chain-write-db-contention.md` (root cause + redesign decision + the `(contract,source)` key)
