-- ============================================================
-- 20260617_covering_indexes_add.sql
--
-- Layer 1 of the DB pool-saturation fix (docs/plans/db-pool-saturation-index-fix.md).
-- ADD a covering composite index that matches the hot bar_cache read access
-- pattern, which was doing a full over-fetch + sort and pinning the shared
-- 12-connection helium pool up to the 6s statement_timeout:
--
--   bar_cache (symbol, timeframe, source, starts_at)
--     Serves loadStoredMarketBars (market-data-store.ts): WHERE symbol=? AND
--     timeframe=? AND source=? AND starts_at <range> ORDER BY starts_at.
--     Replaces the (symbol, timeframe)-only plan that EXPLAIN ANALYZE showed
--     hitting the 6s statement_timeout on high-volume symbols.
--     VERIFIED 2026-06-17: same /bars query 6000ms (timeout) -> 36ms after.
--
-- NOTE: execution_events was originally scoped here too, but EXPLAIN ANALYZE
-- showed deployment_id has n_distinct=1 (one deployment = 100% of the table),
-- so a (deployment_id, ...) index provides no selectivity. The execution_events
-- read fix (event_type-targeted, plus the unbounded-log retention/projection)
-- is deferred to the Layer 2 design cycle. See the plan doc.
--
-- ADDITIVE + REVERSIBLE: creates an index only; no data change; DROP INDEX to
-- revert. The now-redundant single-column indexes are removed by the FOLLOW-UP
-- migration 20260617_covering_indexes_drop_redundant.sql, only AFTER this
-- composite is verified in prod (add-first / drop-later sequencing).
--
-- !! APPLY OUTSIDE A TRANSACTION. CREATE INDEX CONCURRENTLY cannot run in a
--    transaction block, and the server default statement_timeout=6000ms would
--    CANCEL the build at 6s and leave an INVALID index. Apply with:
--
--      PGOPTIONS="-c statement_timeout=0" \
--        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <thisfile>
--
--    (do NOT pass --single-transaction). CONCURRENTLY takes no write lock, so
--    it is safe to run during live market data.
--
-- POST-APPLY CHECK (an interrupted CONCURRENTLY build leaves an invalid index):
--      SELECT indexrelid::regclass AS idx FROM pg_index WHERE NOT indisvalid;
--    If the index appears: DROP INDEX CONCURRENTLY <name>; then re-run.
-- ============================================================

SET statement_timeout = 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS bar_cache_symbol_timeframe_source_starts_at_idx
  ON bar_cache (symbol, timeframe, source, starts_at);
