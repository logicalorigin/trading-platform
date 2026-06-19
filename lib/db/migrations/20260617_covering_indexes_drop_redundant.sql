-- ============================================================
-- 20260617_covering_indexes_drop_redundant.sql
--
-- ⛔ DO NOT APPLY until 20260617_covering_indexes_add.sql is applied AND the new
--    bar_cache composite is verified in prod:
--      - EXPLAIN shows bar_cache_symbol_timeframe_source_starts_at_idx used
--        (no Seq Scan, no Sort)   [verified 2026-06-17: /bars 6s -> 36ms]
--      - /bars p95 back to single-digit ms (flight-recorder)
--      - pg_stat_user_indexes.idx_scan climbing on the new composite
--
-- Layer 1 cleanup: drop the single-column indexes that the new composite (and
-- existing unique indexes) fully subsume. Each is a leading-column prefix of a
-- retained index, so every query and FK delete-check they served is still
-- served by the retained index:
--
--   bar_cache_symbol_timeframe_idx           -> subsumed by bar_cache_symbol_timeframe_source_starts_at_idx
--   bar_cache_instrument_idx                 -> subsumed by bar_cache_instrument_timeframe_source_starts_at_idx (unique)
--   signal_monitor_symbol_states_profile_idx -> subsumed by signal_monitor_symbol_states_unique_idx (profile_id, symbol, timeframe)
--
-- Removing them cuts write-amplification on these hot append tables (fewer index
-- updates per insert), which directly helps the market-data firehose.
--
-- NOTE: execution_events index cleanup (the existing execution_events_deployment_idx
-- is ALSO redundant — deployment_id has n_distinct=1) is intentionally NOT here.
-- All execution_events index work is deferred to the Layer 2 cycle alongside the
-- retention/projection redesign. See docs/plans/db-pool-saturation-index-fix.md.
--
-- WHEN THIS LANDS, also (same change):
--   - remove the dropped index() declarations from the Drizzle schema
--     (lib/db/src/schema/market-data.ts, signal-monitor.ts)
--   - remove bar_cache_symbol_timeframe_idx + bar_cache_instrument_idx from the
--     expected-index list in scripts/src/market-data-schema-audit.ts
--
-- !! APPLY OUTSIDE A TRANSACTION (DROP INDEX CONCURRENTLY cannot run in a txn):
--      PGOPTIONS="-c statement_timeout=0" \
--        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <thisfile>
-- ============================================================

SET statement_timeout = 0;

DROP INDEX CONCURRENTLY IF EXISTS bar_cache_symbol_timeframe_idx;
DROP INDEX CONCURRENTLY IF EXISTS bar_cache_instrument_idx;
DROP INDEX CONCURRENTLY IF EXISTS signal_monitor_symbol_states_profile_idx;
