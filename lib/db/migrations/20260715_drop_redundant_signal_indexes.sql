-- Redundant signal-system indexes found by the 2026-07-15 live schema audit.
-- Run outside a transaction: CONCURRENTLY keeps reads and writes available.
--
-- gex_snapshots_symbol_latest_idx duplicates the leading columns and ordering
-- of the unique gex_snapshots_symbol_computed_at_idx exactly.
-- The two signal-options sidecar indexes have no reader in the repository;
-- runtime reads use (deployment_id, occurred_at DESC), while upserts use the
-- unique (deployment_id, signal_key) index.

DROP INDEX CONCURRENTLY IF EXISTS gex_snapshots_symbol_latest_idx;
DROP INDEX CONCURRENTLY IF EXISTS signal_options_seen_signals_event_idx;
DROP INDEX CONCURRENTLY IF EXISTS signal_options_seen_signals_deployment_reason_idx;
