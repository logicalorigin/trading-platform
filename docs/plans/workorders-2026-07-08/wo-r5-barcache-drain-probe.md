# WO-R5 — Supervised bar_cache drain + post-drain 5m probe (NO git commands)

Codex worker, /home/runner/workspace. Apply /ponytail discipline (level: full). This work order is
DB-side only: you have NO git authority — do not run any git command that mutates state (status/diff
reads are fine). Do not edit tracked source files except the temporary probe file described below.

CONTEXT (proven by session 8939ce3f): SPY 5m durable reads (`loadSignalMonitorCompletedBars`,
source='massive-websocket') took 16,357ms and threw Postgres statement_timeout 57014 because the
~8GB bar_cache forces cold-disk reads (237/240 rows cold). The structural fix (pruneBarCache
retention) is capped at 1M rows/run every 6h — too slow. The user approved a SUPERVISED ONE-OFF
DRAIN now, market closed. pg_stat on this DB is unreliable (never analyzed); use only bounded probes.

## Policy (match lib/db/src/retention.ts pruneBarCache exactly — read it first)
- Intraday (timeframe NOT in the daily+ set): delete rows with starts_at older than 60 days.
- Daily+ (read the exact timeframe list from retention.ts): older than 400 days.

## Drain loop (bounded, pressure-aware)
1. Baseline: `SELECT pg_size_pretty(pg_total_relation_size('bar_cache'));` and a bounded deletable
   probe (`SET statement_timeout='15s'; SELECT count(*) FROM (SELECT 1 FROM bar_cache WHERE <intraday-policy> LIMIT 100000) t;`).
2. Batched delete, ≤50,000 rows per statement, `statement_timeout='60s'` per batch:
   `WITH doomed AS (SELECT id FROM bar_cache WHERE <policy> LIMIT 50000) DELETE FROM bar_cache WHERE id IN (SELECT id FROM doomed);`
   (If an `id` column doesn't exist, use ctid: read the table shape first with `\d bar_cache`.)
3. Between batches: sleep 3s AND check live pool pressure — read
   `.pyrus-runtime/flight-recorder/api-current.json` (jq for pool active/waiting). If waiting > 4
   for two consecutive checks, pause 60s before resuming. If the API looks unhealthy
   (`curl -fsS http://127.0.0.1:8080/api/healthz` non-200), STOP draining and report.
4. Loop until a batch deletes 0 rows for BOTH policies. Log per-batch deleted counts + cumulative.
5. Then: `VACUUM (ANALYZE) bar_cache;` (plain vacuum — NOT VACUUM FULL; do not take an exclusive
   lock). Record before/after `pg_total_relation_size`.

## Post-drain probe (the decisive verification)
Write a temporary probe at `artifacts/api-server/src/services/__probe-5m.mts` that imports
`loadSignalMonitorCompletedBars` from `./signal-monitor` and, for SPY on timeframes 1m, 5m, 15m,
measures wall-clock ms and catches any error (especially code 57014). Run it:
`cd /home/runner/workspace && timeout 180 pnpm --filter @workspace/api-server exec tsx src/services/__probe-5m.mts`
Mirror the call signature used in the codebase (read how signal-monitor calls it; pass evaluatedAt =
new Date(), default policy). Baseline for comparison: pre-fix 5m was 16,357ms + 57014; 15m 208ms;
1m 183ms. Success = 5m completes without 57014 and lands within ~3x of 15m/1m timings.
DELETE the probe file afterwards (`rm artifacts/api-server/src/services/__probe-5m.mts`).

## Guardrails
- Everything bounded: no unbounded count(*), no full-table SELECT, no VACUUM FULL, no REINDEX.
- Use `psql "$DATABASE_URL"` with explicit `SET statement_timeout` in every session.
- Do not touch retention env vars or restart the API (the main session handles reloads).
- If deletions consistently time out even at 10k-row batches, halve the batch and report; do not
  escalate lock scope.

Report → `.codex-watch/wo-r5-report.md`: total rows deleted per policy, batch count, pauses due to
pool pressure, table size before/after, vacuum result, and the full probe timing table (1m/5m/15m,
pre vs post).
