-- 20260629_shadow_account_stream_indexes.sql
--
-- Current runtime evidence: shadow-account stream/dashboard polling saturated the
-- 12-slot DB pool while repeatedly running account-scoped shadow order/fill/
-- balance reads. Single-column indexes existed, but the hot queries combine
-- account_id with ORDER BY placed_at/as_of/occurred_at or with latest order
-- attribution by asset/side/symbol. These additive composites match the observed
-- access patterns without changing data.
--
-- APPLY OUTSIDE A TRANSACTION. CREATE INDEX CONCURRENTLY cannot run in a
-- transaction block. Use:
--
--   PGOPTIONS="-c statement_timeout=0" \
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/20260629_shadow_account_stream_indexes.sql
--
-- Post-apply check:
--
--   SELECT indexrelid::regclass AS idx FROM pg_index WHERE NOT indisvalid;

SET statement_timeout = 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS shadow_orders_account_placed_at_idx
  ON shadow_orders (account_id, placed_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS shadow_orders_account_asset_side_symbol_placed_at_idx
  ON shadow_orders (account_id, asset_class, side, symbol, placed_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS shadow_fills_account_occurred_at_idx
  ON shadow_fills (account_id, occurred_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS shadow_balance_snapshots_account_as_of_idx
  ON shadow_balance_snapshots (account_id, as_of);
