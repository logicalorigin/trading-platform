-- Drop the dead execution_events_deployment_idx (deployment_id only).
--
-- Phase 3 / Task 5 of the execution_events saturation remediation. This index is
-- redundant with execution_events_deployment_occurred_idx (deployment_id,
-- occurred_at DESC) — a leading-column btree serves every WHERE deployment_id = ?
-- query the single-column index could — and is non-selective anyway
-- (n_distinct = 2, idx_scan ~ 0). Removing it cuts ~600 kB + per-insert index
-- maintenance on the ledger's hot write path.
--
-- MANUAL APPLICATION (drizzle-kit push is disabled on the shared DB):
--   CONCURRENTLY builds/drops without an ACCESS EXCLUSIVE table lock; MUST run
--   OUTSIDE a transaction with statement_timeout disabled:
--     PGOPTIONS="-c statement_timeout=0" psql "$DATABASE_URL" \
--       -f 20260624_drop_execution_events_deployment_idx.sql
--
-- Applied to heliumdb 2026-06-24.

DROP INDEX CONCURRENTLY IF EXISTS execution_events_deployment_idx;
