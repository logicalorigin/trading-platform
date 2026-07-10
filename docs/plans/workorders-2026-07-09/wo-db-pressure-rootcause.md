# WO-DB-PRESSURE — root-cause slow Postgres (3s pings) + storage pressure flags (task #2)

Dispatched by Claude session 26888663 (2026-07-09 ~13:40 MDT), Riley-approved. Worker: codex sol.
Report to: `.codex-watch/wo-db-pressure-report.md`. STRICTLY READ-ONLY: no file edits (except the
report), psql SELECT/EXPLAIN only — no DDL/DML/VACUUM/ANALYZE, no config changes. Recommend, don't act.
Directive: no band-aid recommendations (pool stays at 12 per lib/db/src/index.ts:206 — relief must
reduce demand). DATABASE_URL is in the environment; `psql "$DATABASE_URL"` works.

Context: degradedReasons persistently include `postgres_storage_pressure` and `read_probe_failed`;
the storage self-check reports pingMs 2,687-3,127 to the Replit internal dev DB (helium/heliumdb).
Known bloat: bar_cache (~8GB, manual drain ran this morning — RET-1 commit 11811b78 added
drain-to-done), execution_events 3.4GB / 1.10M rows, shadow_balance_snapshots 285k rows growing
14k/day. Fix WOs already in flight for SSE and positions; equity-history WO queued. Prior aggregation:
docs/plans/signal-monitor-gc-pool-rootcause-2026-07-09.md.

## Deliverables
1. **The 3-second ping.** Find the storage self-check implementation (rg for pingMs / storage status
   in artifacts/api-server/src/services/diagnostics*.ts or storage-health*). Determine from source
   whether pingMs measures pure DB round-trip or includes pool-acquisition wait — if it includes
   pool wait it is mislabeled and the "slow DB" signal is really pool saturation (diagnostic defect;
   say so). Then measure reality: time `SELECT 1` via a FRESH direct psql connection (outside the app
   pool) several times; compare. Verdict: DB actually slow vs app-side queueing.
2. **read_probe_failed + postgres_storage_pressure.** Locate both emitters in source; state their
   thresholds and the current live values that trip them. For storage pressure: report
   pg_database_size, top-15 relations by total size (heap/TOAST/indexes split), dead-tuple counts,
   last_autovacuum/last_vacuum per hot table (bar_cache, execution_events, shadow_balance_snapshots,
   signal_monitor_events, shadow_orders, bar_cache indexes). Quantify remaining bar_cache bloat
   post-drain.
3. **Pool demand attribution NOW.** Sample pg_stat_activity every ~5s for ~3 minutes; bucket by query
   family (bar_cache read/insert, execution_events, snapshots, signal_monitor_*, auth, other) with
   counts, max age, and wait events. Rank families by connection-seconds. Note which families the
   in-flight fix WOs (SSE, positions, EQH) will remove, and what remains unaddressed.
4. **Ranked recommendations** with expected effect: retention/VACUUM (FULL?) windows per table (note
   execution_events VACUUM FULL is already a pending Riley decision), the queued EQH fix, any
   demand source not yet covered by an existing WO. Include codex-style acceptance gates.

## Report format
Facts (observed, with commands + outputs summarized), inferences labeled, unknowns listed, then
ranked recommendations. End with a 10-line executive summary.
