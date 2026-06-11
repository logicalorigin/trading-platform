# Implementation Plan: Pyrus container-drop fix (DB bloat / retention)

Companion task breakdown for `docs/plans/pyrus-container-drop-db-bloat-retention-fix-plan.md` (full diagnosis + evidence live there).

## ✅ EXECUTION LOG — 2026-06-11 (executed live, market open, user-authorized "no need to wait for close")
- **One-time cleanup DONE** via direct batched psql (`$DATABASE_URL` in-shell). bar_cache: deleted >180d then >90d (~2.6M rows) → 0. option_chain_snapshots: deleted >7d (~56k) → 0. quote_cache → 0. Then `VACUUM (ANALYZE)` on all (bar_cache dead 1.5M→~30k).
- **Real row counts** (pg_stat estimates were ~100× low): bar_cache ~7M live, option_chain ~8.1M live. Growth ~252k bars/day, ~975k option rows/day.
- **Decision D1 final: bar=90d** (180d→~45M rows would blow the 15GB DB cap; 90d≈23M≈5GB). option_chain=7d.
- **Result: bar read 15s → ~250ms warm** (planning time ~0; stats fixed). Disconnect root cause addressed.
- **Recurrence: chose worker-code path** (pg_cron unavailable — not preloaded on hosted PG; Replit-scheduled-job declined). Edited `crates/market-data-worker/src/{config.rs,retention.rs,main.rs}`: 90d default, batched deletes (20k/chunk), background sweep every 6h in `run_loop`. `cargo check` clean. Release build + worker restart pending.
- **Still optional:** `VACUUM FULL`/`pg_repack` off-hours to return ~6GB to disk (plain VACUUM only freed it for reuse; DB still ~9.5GB). Raise `MARKET_DATA_WORKER_DB_POOL_MAX` (currently 2). Keep browser-QA off the live workflow.
- **Verify over next hours:** `node scripts/diagnose-agent-restarts.mjs --since 2h` drop count should trend toward zero.

---

## Overview
The pyrus dev workflow gets restarted by Replit (~87×/day = "lost connection") because two cache tables — `bar_cache` (3.5 GB, 89% dead rows, data back to 2016) and `option_chain_snapshots` (2.6 GB, 11 days under a 7-day policy) — are bloated. Their auto-cleanup (`retention`) exists but is never scheduled, so queries take 15–45 s, stall the single Node event loop, the health probe fails, and Replit restarts the app. This plan cleans up the backlog, reclaims the space, and schedules cleanup so it can't recur.

## Architecture decisions
- **Sequential, not vertical-sliced:** this is a data-maintenance fix; order is forced by safety (preview → delete → compact → schedule), not by feature dependencies.
- **Fix recurrence before/with the one-time cleanup**, so the backlog can't simply rebuild.
- **Destructive DB steps run as the user (👤).** The agent is blocked from the live trading DB by design; agent-doable steps are marked 🤖.
- **Prefer the no-rebuild scheduling path (C1)** first; treat the Rust `run_loop` change (C2) as a later hardening.
- **Plain `VACUUM` before `VACUUM FULL`:** reclaim/space-reuse without an exclusive lock first; lock-taking compaction only if disk pressure demands it, off-hours.

---

## Task List

### Phase 0 — Pre-flight (no changes to live system)

- [x] **Task 0.1 — Confirm the two tables are regenerable caches** `[XS]` — RESOLVED 2026-06-11 by code investigation (no human owner needed; the code is authoritative).
  **Verdict: both are regenerable caches sourced from the external "massive"/IBKR market-data feed. No table is a sole source of truth.**
  Evidence:
  - **Writers** are all feed-sourced and re-fetchable: `bar_cache` ← `persistMarketDataBars` (`market-data-store.ts:332`) from the massive websocket + history REST; `option_chain_snapshots` ← `persist_option_chain_snapshots` (`crates/market-data-worker/src/ingest.rs:161`) + `persistDurableOptionChain` (`option-metadata-store.ts:488`). Nothing is hand-entered.
  - **No FK dependents:** repo-wide grep for `references option_chain_snapshots` / `references bar_cache` = 0 hits. Deleting rows cannot orphan/cascade.
  - **Intent is ephemeral:** both grouped with `quote_cache`/`provider_request_log` in `retention.rs`; "cache" is literally in the names; the app already self-prunes option snapshots at 24h (`option-metadata-store.ts:470` `pruneOldSnapshots`); migrations are `create table if not exists` (boots on empty DB); empty-DB behavior is graceful (GEX returns a clean error, bar readers return `[]`).
  - **`option_chain_snapshots`: SAFE to prune to 7 d.** No reader looks back > ~24h (GEX reads latest-per-contract `gex.rs:8`; metadata filters `asOf >= now-≤2h`).
  - **`bar_cache`: SAFE to prune to 30 d, with one behavioral caveat** — the watchlist backtest (`shadow-account.ts:11671`) can request up to YTD (~5 months). When old bars are pruned it does **not** error; it transparently re-fetches from the massive history API and re-caches (`platform.ts:10491`). Effect = the first long-range backtest after a prune is **slower** (provider round-trips), and depends on `MASSIVE_API_KEY` + provider health. No data loss, no correctness break. (Note: the bulk `Backfill` CLI is a stub — `main.rs:107` — so regeneration is on-demand via reads only, which is sufficient for existing readers.)
  **Acceptance criteria:**
  - [x] Both tables confirmed safe to prune per policy.
  - [x] Rows needed beyond policy identified → only long-range backtests touch `bar_cache` history, and they self-heal. See Decision D1.
  **Dependencies:** None. **Scope:** XS.

- [x] **Task 0.2 — Capture baseline metrics 🤖** `[XS]` — DONE 2026-06-11T14:49Z
  **Description:** Record current size/health so the fix is measurable.
  **Acceptance criteria:**
  - [x] Saved snapshot of `/api/diagnostics/latest` storage table stats.
  - [x] Saved current drop rate.

  **Baseline (2026-06-11T14:49Z):** DB **9,511 MB** / 15,360 warning. Drops last 24h: **88** (`diagnose-agent-restarts.mjs`).

  | table | rows | dead | sizeMB | oldest |
  |---|---|---|---|---|
  | bar_cache | 19,197 | **196,731** | **3,634** | 2016-05-02 |
  | option_chain_snapshots | 58,673 | 0 | **2,670** | 2026-05-31 |
  | diagnostic_snapshots | 12 | 2,004 | 138 | 2026-06-10 |
  | flow_events | 706 | 197 | 38 | 2026-04-27 |

  **Live-growth note:** over ~23 min of observation, `bar_cache` dead rows grew 137K→197K and `option_chain_snapshots` grew 27K→59K rows — the bloat accumulates in real time, corroborating the diagnosis.
  **Verification:** numbers recorded above. **Dependencies:** None. **Scope:** XS.

#### ✅ Checkpoint: Pre-flight
- [ ] Caches confirmed regenerable (0.1). Baseline captured (0.2). Approved to proceed.

---

### Phase 1 — Stop recurrence (do this first so the backlog can't rebuild)

- [ ] **Task 1.1 — Schedule daily retention with `--execute` (path C1) 🤖→👤** `[S]`
  **Description:** Set up a daily job running `pnpm market-data-worker:retention -- --execute` (Replit Scheduled Deployment, cron, or a `/schedule` routine). No rebuild. Agent drafts the schedule config; user enables it (needs account/deploy access).
  **Acceptance criteria:**
  - [ ] A daily trigger exists that runs the retention command with `--execute`.
  - [ ] First scheduled (or manual) run logs `dry_run=false ... affected_rows=N` per target table.
  **Verification:** job appears in the scheduler; one run's logs show `dry_run=false`.
  **Dependencies:** Phase 0 checkpoint. **Scope:** S.
  **Files/commands:** scheduler config; `package.json:31` (`market-data-worker:retention`).

#### ✅ Checkpoint: Recurrence
- [ ] Daily cleanup is scheduled and verified to run in execute mode.

---

### Phase 2 — One-time backlog delete (👤, low usage window)

- [x] **Task 2.1 — Dry-run preview 🤖** `[XS]` — DONE 2026-06-11T14:58Z (read-only, via prebuilt `target/release/market-data-worker retention`, no `--execute`).
  **Preview — rows that WOULD be deleted (nothing was):**
  | table | rows | cutoff |
  |---|---|---|
  | bar_cache | **1,726,767** | < 2025-12-13 (180 d) |
  | option_chain_snapshots | 56,614 | < 2026-06-04 (7 d) |
  | quote_cache | 82 | < 2026-06-04 (7 d) |
  | gex_snapshots | 0 | < 30 d |
  | provider_request_log | 0 | < 14 d |

  **⚠️ Correction:** the earlier "a few thousand live rows" estimate was wrong — it came from Postgres' `n_live_tup` estimate (which read ~19k for bar_cache and was off by ~100×). The true backlog is **1.7M bar rows**. This changes the execution approach (see 2.2): a single unbounded `DELETE` of 1.7M rows on the remote shared DB could lock/spike load — must be **batched + off-hours**.
  **Dependencies:** Phase 0 checkpoint. **Scope:** XS.

- [ ] **Task 2.2 — Execute the delete — BATCHED, MARKETS CLOSED 👤** `[S]`
  **Description:** Because bar_cache has ~1.7M rows to remove, do NOT run the worker's single-statement delete for the initial backlog. Delete in chunks so each transaction is small and autovacuum keeps pace. option_chain_snapshots (56k) and quote_cache (82) are small enough for the worker command, but bundle them into the same off-hours window.
  **Pre-req:** set `MARKET_DATA_BAR_RETENTION_DAYS=180` in the worker env (Decision D1).
  **Approach for bar_cache (batched, run as DB owner during closed market):**
  ```sql
  -- repeat until 0 rows affected; small chunks keep locks/WAL bounded
  DELETE FROM bar_cache
  WHERE ctid IN (
    SELECT ctid FROM bar_cache
    WHERE starts_at < now() - interval '180 days'
    LIMIT 50000
  );
  ```
  Then the small tables via the worker (single statement is fine at 56k/82):
  ```
  MARKET_DATA_BAR_RETENTION_DAYS=180 target/release/market-data-worker retention --execute
  ```
  (Run the worker command AFTER the batched bar_cache delete so it only mops up the small remainder.)
  **Acceptance criteria:**
  - [ ] bar_cache rows older than 180 d → 0; option_chain_snapshots older than 7 d → 0 (re-run dry-run to confirm).
  - [ ] No drop/restart spike during the operation (`diagnose-agent-restarts.mjs --since 1h`).
  **Verification:** dry-run shows `affected_rows=0` for all targets; `/api/diagnostics/latest` oldest dates within policy.
  **Dependencies:** Task 2.1; **markets closed**. **Scope:** S.
  **Rollback note:** delete is not reversible; safety comes from 0.1 (caches) + this preview. Deleted bars re-fetch on demand (Task 0.1).

#### ✅ Checkpoint: Backlog
- [ ] Old rows gone; `oldest` within 7 d / 30 d policy. (Size still large until Phase 3 — expected.)

---

### Phase 3 — Reclaim the ~6 GB (👤)

- [ ] **Task 3.1 — Plain VACUUM (no downtime) 👤** `[XS]`
  **Description:** `VACUUM (VERBOSE, ANALYZE) bar_cache; option_chain_snapshots; diagnostic_snapshots;` — marks dead space reusable, refreshes planner stats, no exclusive lock.
  **Acceptance criteria:**
  - [ ] VACUUM completes; `n_dead_tup` drops sharply (probe in §5 of runbook).
  - [ ] Slow-query (`elapsed>1s`) warnings in `.local/state/workflow-logs/<id>/` largely gone under a dashboard load.
  **Verification:** read-only probe + dashboard load test.
  **Dependencies:** Phase 2 checkpoint. **Scope:** XS.

- [ ] **Task 3.2 — (Optional) VACUUM FULL / pg_repack to return space to OS 👤** `[XS]`
  **Description:** Only if disk pressure matters. `VACUUM FULL` takes an exclusive lock (off-hours) or use `pg_repack` (online). Skip if 3.1 + autovacuum is enough.
  **Acceptance criteria:**
  - [ ] Table `sizeMB` in `/api/diagnostics/latest` drops toward live-data size.
  **Verification:** diagnostics size before/after.
  **Dependencies:** Task 3.1. **Scope:** XS.

#### ✅ Checkpoint: Space + speed
- [ ] Tables compact, queries fast. **Confirm drop rate is falling:** `diagnose-agent-restarts.mjs --since 6h` should trend toward zero vs the 0.2 baseline.

---

### Phase 4 — Optional hardening (separate follow-ups, not required to stop drops)

- [ ] **Task 4.1 — Keep browser-QA off the live workflow 🤖** `[S]`
  Point `/qa` `/browse` `/design-review` `/benchmark` at a non-live instance, or concurrency-cap the heavy `/api/{gex,flow,signal-monitor,bars}` endpoints so one dashboard load can't starve the loop. Acceptance: a full QA dashboard load no longer produces a drop. Dependencies: none.

- [ ] **Task 4.2 — Raise worker DB pool 👤** `[XS]`
  Set `MARKET_DATA_WORKER_DB_POOL_MAX` to 4–6 **after** confirming remote Postgres `max_connections` headroom. Acceptance: writes no longer serialize on 2 connections; no `max_connections` errors. Dependencies: none.

- [ ] **Task 4.3 — Fix flight-recorder misclassification 🤖** `[S]`
  `flightRecorder.mjs` reuses a stale `lastRelevantChildExit`, mislabeling abrupt supervisor kills as `api-child-exit code=143`. Tighten it to only attribute a child-exit belonging to the dead run. Acceptance: a forced abrupt kill classifies correctly, not as `143`. Dependencies: none.

- [ ] **Task 4.4 — (Durable) Move scheduling into the worker run_loop (path C2) 🤖** `[M]`
  Replace the external schedule (1.1) with a periodic `run_retention(execute=true)` inside `run_loop` using batched/`LIMIT`ed deletes. Requires Rust rebuild + redeploy. Acceptance: worker prunes on its own interval; `cargo build --release` + tests pass. Dependencies: validate after Phase 3.

#### ✅ Checkpoint: Complete
- [ ] Drop rate ≈ 0 over 24 h. Cleanup recurs automatically. Hardening items triaged.

---

## Risks and mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Deleting a non-cache table by mistake | High | Task 0.1 owner sign-off + Task 2.1 dry-run preview before any delete |
| First delete long-locks the table | Med | Live-row counts are small (few k); run low-usage; C2 adds batched deletes |
| `VACUUM FULL` locks tables | Med | Plain VACUUM (3.1) first; FULL/pg_repack off-hours only (3.2) |
| Bigger DB pool exhausts remote `max_connections` | Med | Check headroom before raising (4.2) |
| Schedule runs but silently dry-runs | Med | Verify `dry_run=false` in logs (1.1) |
| Agent can't run DB steps | Low | All destructive steps marked 👤 with exact commands; agent verifies via `/api/diagnostics/latest` |

## Decisions / open questions
- [x] ~~Are `bar_cache` / `option_chain_snapshots` purely regenerable?~~ **Resolved: yes (Task 0.1).**
- [x] **Decision D1 — `bar_cache` retention window: RESOLVED → ~6 months (set `MARKET_DATA_BAR_RETENTION_DAYS=180`).**
  Keeps roughly half a year of bars local so most backtests stay instant, while still bounding the table (vs. today's unbounded 2016→now). Minor accepted caveat: a backtest reaching back **more than 180 days** (e.g. a full year-to-date run late in the calendar year) re-fetches the older bars from the provider on first run — safe and self-healing, just slower once. `MARKET_DATA_OPTION_CHAIN_RETENTION_DAYS` stays at 7 (no tradeoff).
  Implementation: set `MARKET_DATA_BAR_RETENTION_DAYS=180` in the worker's env **before** the first execute run (Task 2.2 / Task 1.1) so the first prune uses 180 d, not the 30 d default.
- [ ] Maintenance window for the optional `VACUUM FULL` (3.2)?
- [ ] Scheduling preference: external daily job now (1.1 / C1) vs. worker-internal later (4.4 / C2)?

> Note: the live DELETE itself is small — only a few thousand *live* rows are older than policy (`bar_cache` ~19k live rows total, `option_chain_snapshots` ~59k). The multi-GB bulk is dead tuples reclaimed by VACUUM (Phase 3), not rows removed by DELETE. Batching the DELETE is optional defensive hygiene, not required.

## Execution order (the short version)
0.1 → 0.2 → **[checkpoint]** → 1.1 → **[checkpoint]** → 2.1 → 2.2 → **[checkpoint]** → 3.1 → (3.2) → **[checkpoint]** → (Phase 4 as follow-ups)
