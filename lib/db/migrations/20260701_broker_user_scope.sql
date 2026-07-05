-- Adds optional per-user ownership for broker rows.
-- Existing global broker rows keep app_user_id NULL. SnapTrade rows should set
-- app_user_id so the same upstream connection/account ids can exist for
-- different PYRUS users without crossing authorization boundaries.

ALTER TABLE broker_connections
  ADD COLUMN IF NOT EXISTS app_user_id uuid REFERENCES users(id);

ALTER TABLE broker_accounts
  ADD COLUMN IF NOT EXISTS app_user_id uuid REFERENCES users(id);

DROP INDEX IF EXISTS broker_connections_unique_provider_mode_idx;

CREATE UNIQUE INDEX IF NOT EXISTS broker_connections_unique_provider_mode_idx
  ON broker_connections (connection_type, mode, name)
  WHERE app_user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS broker_connections_user_provider_mode_idx
  ON broker_connections (app_user_id, connection_type, mode, name)
  WHERE app_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS broker_connections_app_user_idx
  ON broker_connections (app_user_id);

DROP INDEX IF EXISTS broker_accounts_provider_account_id_idx;

CREATE UNIQUE INDEX IF NOT EXISTS broker_accounts_provider_account_id_idx
  ON broker_accounts (provider_account_id)
  WHERE app_user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS broker_accounts_user_provider_account_id_idx
  ON broker_accounts (app_user_id, provider_account_id)
  WHERE app_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS broker_accounts_app_user_idx
  ON broker_accounts (app_user_id);
