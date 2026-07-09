# Hand-off to the overnight-expectancy / backtest-worker lane (owner of artifacts/backtest-worker/* WIP)

From: claude-lead session `03a2bec8` (time-semantics/pressure lane), 2026-07-07 ~19:45 MDT.
Owner directive in force: the DB must never be overloaded — every demand source is a bug to fix.
Evidence: live pg_stat probes 2026-07-08T01:30-01:35Z during your job's run + pg_stat_user_tables.

## 1. WAL-write saturation from overnight_signal_expectancy_samples (trading-severity while RTH, observed after-hours)
Observed: up to 4 CONCURRENT inserts into overnight_signal_expectancy_samples all blocked on
LWLock:WALWrite / IO:WALSync, alongside a 100s+ autovacuum VACUUM ANALYZE of the same table also
stuck on WALWrite. Table churn: 425k inserts vs 1.10M deletes, 229k dead tuples — autovacuum ran
twice within 15 min. While this storm runs, UNRELATED trading writes (shadow_position_marks,
option_chain_latest, shadow_orders) sat in the same WALWrite queue — the research job degrades the
trading path even with pool slots free.
CORRECTION (verified): inserts are ALREADY chunked multi-row (OVERNIGHT_SAMPLE_INSERT_CHUNK_SIZE,
backtest-worker/src/index.ts:~2880) — the remaining problems are the FOUR concurrent chunk writers
and the delete churn. Recommended (pick the cheapest that fits your flow):
- Cap sample-insert concurrency at 1 writer (serialize the chunk loop across jobs/symbols).
- For reruns, replace mass DELETE with TRUNCATE (or per-study partition/drop) — kills the dead-tuple
  churn and the autovacuum thrash.
- Pace the writer (small sleep between chunks) so WAL flushes interleave with trading writes.

## 2. backtest_study_jobs poll loop — 425k idx scans on a 28-row table
Observed: backtest_study_jobs + backtest_studies at ~425k idx scans each since stats reset (~6h) —
a hot poll loop. Likely site: artifacts/backtest-worker/src/index.ts:3267-3282 (`while(true)` +
WORKER_POLL_INTERVAL_MS). Recommend idle backoff (e.g. 1s hot → 10-30s after N empty polls) or
LISTEN/NOTIFY on job insert. If the poller is actually the api-server status route, tell us and
we'll take it.

## Context
Full demand ledger + live-DB evidence: this session's workflow results (ask claude-lead) and
`.codex-watch/db-census-2026-07-07.md`. Trading-gate removals + S9/S11/S14 fixes are landing from
our lane in parallel — none touch your files.
