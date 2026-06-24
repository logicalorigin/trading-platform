-- Indexes for automation_diagnostics (see 20260624_automation_diagnostics_table.sql).
--
-- CONCURRENTLY: builds without locking writes; MUST run OUTSIDE a transaction
-- and with statement_timeout disabled. Apply manually AFTER the CREATE TABLE
-- migration:
--   PGOPTIONS="-c statement_timeout=0" psql "$DATABASE_URL" \
--     -f 20260624_automation_diagnostics_indexes.sql
-- (drizzle-kit push is disabled on the shared dev DB after the 2026-06-15 incident.)

-- Per-deployment union branch of listExecutionEvents and the dedup union in
-- findExistingEventByClientOrderId:
--   WHERE deployment_id = ? ORDER BY occurred_at DESC LIMIT n.
CREATE INDEX CONCURRENTLY IF NOT EXISTS automation_diagnostics_deployment_occurred_idx
  ON automation_diagnostics (deployment_id, occurred_at DESC);

-- Global (no deploymentId) union branch of listExecutionEvents.
CREATE INDEX CONCURRENTLY IF NOT EXISTS automation_diagnostics_occurred_idx
  ON automation_diagnostics (occurred_at DESC);

-- Expression index for the dedup union's clientOrderId lookup. Correctness does
-- NOT depend on this index (the JS match loop is the source of truth); it only
-- keeps the deployment-scoped scan cheap once this table grows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS automation_diagnostics_deployment_client_order_idx
  ON automation_diagnostics (deployment_id, (payload->>'clientOrderId'));
