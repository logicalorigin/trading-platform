-- SnapTrade per-user credential custody foundation.
-- Stores only encrypted SnapTrade user secrets; no OAuth callback or portal flow.

CREATE TABLE IF NOT EXISTS snaptrade_user_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES users(id),
  snaptrade_user_id varchar(128) NOT NULL,
  user_secret_ciphertext text NOT NULL,
  user_secret_key_version varchar(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'registered',
  registered_at timestamp with time zone NOT NULL DEFAULT now(),
  disabled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS snaptrade_user_credentials_app_user_idx
  ON snaptrade_user_credentials (app_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS snaptrade_user_credentials_snaptrade_user_idx
  ON snaptrade_user_credentials (snaptrade_user_id);

CREATE INDEX IF NOT EXISTS snaptrade_user_credentials_status_idx
  ON snaptrade_user_credentials (status);
