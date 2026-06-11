# Pyrus container drops — DB bloat / unscheduled retention fix

**Status:** proposed (review before executing). Nothing in this plan has been run against the live system.
**Author:** investigation 2026-06-11.
**Scope:** data housekeeping + scheduling only. No trading-logic changes.

---

## 1. Problem

The Replit container "keeps losing connection." Observed ~87 drops/24h.

A drop = Replit kills and relaunches the pyrus `[services.development]` workflow because the app stopped answering. The app stops answering because heavy DB reads/writes take 15–45s and stall the single Node event loop, so the health probe fails.

This is **not** the port reaper, OOM, or an app crash. Evidence ruled those out (see §6).

## 2. Root cause (proven)

Two market-data tables are badly bloated because **the retention job is never scheduled to run**.

Live storage stats (from `/api/diagnostics/latest`, 2026-06-11):

| table | live rows | dead rows | size | oldest row | policy |
|---|---|---|---|---|---|
| `bar_cache` | 16,308 | **137,310 (89% dead)** | **3.5 GB** | **2016-05-02** | 30 days |
| `option_chain_snapshots` | 27,337 | 0 | **2.6 GB** | 2026-05-31 (11 days) | 7 days |
| `diagnostic_snapshots` | 12 | 1,392 (99%) | 138 MB | — | — |

DB total: 9.3 GB / 15 GB warning. Postgres is **remote/shared** (`PGHOST=helium`), so every query is a network round-trip — bloat hurts disproportionately.

`option_chain_snapshots` has **0 dead tuples and 11 days of data under a 7-day policy** → proof no delete ever ran. `bar_cache` holds data back to 2016 under a 30-day policy → same conclusion.

Why retention never runs:
- `retention::run_retention(...)` exists only as a manual CLI subcommand — `crates/market-data-worker/src/main.rs:100` (`Command::Retention { execute }`). It deletes only when `execute = true`.
- The running worker uses `Command::Run` (job processor) — `main.rs` `run_loop`. It never calls retention.
- The npm helper `market-data-worker:retention` (`package.json:31`) omits `--execute`, so even manual runs are **dry-run only** (count, no delete).
- Nothing else (cron, `.replit`, CI, Replit scheduled deployment) invokes it. Verified by repo grep.

Contributing fragility (not the root cause, but they amplify it):
- Rust worker DB pool capped at **2 connections** — `config.rs:40` (`MARKET_DATA_WORKER_DB_POOL_MAX` default 2), 5s acquire timeout. Writes serialize.
- `option_chain_snapshots` is append-only with 2 FKs + 4 indexes maintained per row.
- The API is a single Node event loop (~2.1 GB RSS) doing GEX/flow math + DB orchestration.

The **trigger** that tips the already-fragile app over: an agent running headless-browser QA against the live app. `.gstack/browse-network.log` shows 355 requests to the heaviest endpoints (`/api/gex/*/zero-gamma`, `/api/flow/events?limit=1000`, `/api/bars?limit=720` ×many, `/api/signal-monitor/matrix`) in ~14s, 17s before a drop; `.gstack/qa-reports/*-5min-soak.json` are sustained soak runs. A normal user opening the dashboard is a milder version of the same load.

## 3. Fix — three parts

### Part A — One-time backlog delete (cheap, reversible-by-design)
The delete is small: only a few thousand *live* rows are older than policy (the 6 GB is dead-tuple/index bloat, not live rows). Reclaiming the space is Part B.

1. **Dry-run first** (no writes — prints counts that *would* be deleted):
   ```
   pnpm market-data-worker:retention
   ```
   Expect log lines: `market-data retention target evaluated ... dry_run=true affected_rows=N` for `quote_cache`, `option_chain_snapshots`, `bar_cache`, `gex_snapshots`, `provider_request_log`. Sanity-check the counts look like "old rows", not "everything".

2. **Execute** (performs the deletes):
   ```
   pnpm market-data-worker:retention -- --execute
   ```
   (Forwards `--execute` → `... -- retention --execute`; `execute` is a clap bool flag in `main.rs:68`.)

   Risk: deletes rows older than policy from cache/snapshot tables. These are regenerated caches, not source-of-truth trading records — confirm with whoever owns the data model before running. Run during low usage.

### Part B — Reclaim the ~6 GB (one-time, brief lock — off-hours)
Deletes alone don't return space to the OS. After Part A:
```
-- run as the DB owner, off-hours:
VACUUM (VERBOSE, ANALYZE) bar_cache;
VACUUM (VERBOSE, ANALYZE) option_chain_snapshots;
VACUUM (VERBOSE, ANALYZE) diagnostic_snapshots;
```
- Plain `VACUUM` does **not** hold an exclusive lock and lets the space be reused (stops further growth, speeds future inserts). Recommended first.
- To return space to the OS immediately, `VACUUM FULL <table>;` — **takes an exclusive lock** (table unavailable for the duration), so off-hours only, or use `pg_repack` (online) if available.
- Recommendation: plain `VACUUM` now; schedule `VACUUM FULL`/`pg_repack` in a maintenance window if disk pressure matters.

### Part C — Schedule retention so it never recurs (durable)
Pick one:

- **C1 (lowest risk, no rebuild):** a daily Replit Scheduled Deployment (or cron / a `/schedule` routine) running:
  ```
  pnpm market-data-worker:retention -- --execute
  ```
  Then let autovacuum reclaim steadily. Simplest; uses existing code.

- **C2 (most robust):** add a periodic retention call inside the worker `run_loop` (`crates/market-data-worker/src/main.rs`), e.g. every 6–24h, calling `retention::run_retention(&pool, &config, true)`. Requires a Rust rebuild + worker redeploy. Use batched/`LIMIT`ed deletes so the first run can't long-lock.

Recommendation: **C1 now** (immediate, reversible), consider C2 later.

### Part D — Optional hardening (separate follow-ups)
- Raise the worker DB pool: set `MARKET_DATA_WORKER_DB_POOL_MAX` (e.g. 4–6) — but only after confirming the remote Postgres `max_connections` headroom.
- Keep browser QA/soak (`/qa`, `/browse`, `/design-review`, `/benchmark`) **off the live workflow** — point it at a separate instance, or concurrency-cap the heavy `/api/{gex,flow,signal-monitor,bars}` endpoints so one dashboard load can't starve the event loop.
- Fix the flight-recorder misclassification (see §6) so future attribution is trustworthy.

## 4. Verification
After A+B:
- Re-fetch `curl -s http://127.0.0.1:8080/api/diagnostics/latest` → `bar_cache`/`option_chain_snapshots` `sizeMB` should drop sharply, `dead_pct` → low, `oldest` within policy.
- Watch `.pyrus-runtime/flight-recorder/incidents.jsonl` and `node scripts/diagnose-agent-restarts.mjs --since 6h` → drop rate should fall toward zero.
- Load the dashboard while running the read-only probe in §5; `sqlx` slow-statement warnings (`elapsed > 1s`) in `.local/state/workflow-logs/<id>/` should largely disappear.

## 5. Read-only confirmation probe (optional, run as DB owner)
```
psql "$DATABASE_URL" -P pager=off <<'SQL'
set statement_timeout='15s'; set default_transaction_read_only=on;
select relname, pg_size_pretty(pg_total_relation_size(c.oid)) total,
       pg_size_pretty(pg_indexes_size(c.oid)) idx
from pg_class c where relname in ('bar_cache','option_chain_snapshots') ;
select relname, n_live_tup, n_dead_tup, last_autovacuum
from pg_stat_user_tables where relname in ('bar_cache','option_chain_snapshots');
-- run while loading the dashboard to see contention:
select pid,state,wait_event_type,wait_event,
       round(extract(epoch from(now()-query_start))::numeric,1) secs
from pg_stat_activity where datname=current_database() and state<>'idle'
  and pid<>pg_backend_pid() order by secs desc nulls last limit 15;
SQL
```

## 6. Evidence appendix / things to trust
- Drops are external workflow relaunches of a *healthy* supervisor (fresh heartbeat, no graceful shutdown), not crashes/OOM: `scripts/diagnose-agent-restarts.mjs --since 24h` (87 incidents), cgroup `memory.events oom_kill:0`.
- **Do not trust** the `api-child-exit code=143` labels in `incidents.jsonl` — `flightRecorder.mjs` reuses a stale prior child-exit (`lastRelevantChildExit`) and mislabels abrupt supervisor kills. Real evidence is in `.local/state/workflow-logs/<runId>/` (per-run console) and `/api/diagnostics/latest`.
- Agent transcripts (`~/.codex`) do not survive container cycles; surviving agent-activity evidence is in `.gstack/` (`browse.json`, `browse-network.log`, `qa-reports/`).
- Key source: `crates/market-data-worker/src/{main.rs,retention.rs,config.rs}`, `artifacts/api-server/src/services/diagnostics.ts:2795` (`MONITORED_STORAGE_TABLES`), `.replit`, `artifacts/pyrus/.replit-artifact/artifact.toml`.
