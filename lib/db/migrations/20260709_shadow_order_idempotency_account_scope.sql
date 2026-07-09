-- Shadow order idempotency belongs to a ledger, not the whole installation.
-- Create the replacement indexes before dropping the legacy global indexes so
-- every writer remains protected throughout this migration.

CREATE UNIQUE INDEX IF NOT EXISTS shadow_orders_account_source_event_idx
  ON shadow_orders (account_id, source_event_id);

CREATE UNIQUE INDEX IF NOT EXISTS shadow_orders_account_client_order_idx
  ON shadow_orders (account_id, client_order_id);

CREATE UNIQUE INDEX IF NOT EXISTS shadow_fills_account_source_event_idx
  ON shadow_fills (account_id, source_event_id);

DROP INDEX IF EXISTS shadow_orders_source_event_idx;
DROP INDEX IF EXISTS shadow_orders_client_order_idx;
DROP INDEX IF EXISTS shadow_fills_source_event_idx;
