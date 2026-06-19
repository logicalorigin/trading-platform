-- Partial index for the hot listDeploymentEvents query:
--   SELECT * FROM execution_events
--   WHERE deployment_id = ? AND event_type LIKE 'signal_options_%'
--   ORDER BY occurred_at DESC LIMIT n
--
-- A deployment's execution_events are dominated by continuously-growing
-- overnight_spot_signal_blocked rows; the signal_options_* rows are a minority
-- and older. A plain occurred_at scan must skip ~750k newer non-matching rows to
-- reach them (~15-23s, hitting statement_timeout and pinning a pool connection ->
-- the "Signal-Options Deployment Unavailable" fallback). Indexing ONLY the
-- signal_options rows, ordered by occurred_at, makes the LIMIT a sub-ms index
-- scan regardless of planner stats (verified via EXPLAIN ANALYZE: 0.12-0.94ms vs
-- the prior backward-scan trap at cost ~227k).
--
-- A plain composite (deployment_id, event_type, occurred_at) is NOT used by the
-- planner for this query (a LIKE-prefix predicate can't drive a btree without
-- text_pattern_ops, and its ordering doesn't yield occurred_at order for the
-- filtered subset); verified empirically. This supersedes the earlier
-- (deployment_id, occurred_at) index, which was also unused; it is dropped here.
--
-- CONCURRENTLY: builds without locking; MUST run OUTSIDE a transaction. Apply
-- manually with statement_timeout disabled, e.g.:
--   PGOPTIONS="-c statement_timeout=0" psql "$DATABASE_URL" -f <this file>
-- (drizzle-kit push is disabled on the shared dev DB after the 2026-06-15 incident.)

DROP INDEX CONCURRENTLY IF EXISTS execution_events_deployment_occurred_idx;

CREATE INDEX CONCURRENTLY IF NOT EXISTS execution_events_sigopt_deploy_occurred_idx
  ON execution_events (deployment_id, occurred_at DESC)
  WHERE event_type LIKE 'signal_options_%';
