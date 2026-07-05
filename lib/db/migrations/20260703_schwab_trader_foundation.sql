-- Schwab Trader API connection foundation.
-- Adds schwab as a broker provider and per-user OAuth token custody.
-- Stores only encrypted OAuth material (access/refresh tokens); Schwab's
-- refresh token hard-expires 7 days after issuance, tracked explicitly so the
-- UI can surface the weekly reconnect requirement.

ALTER TYPE broker_provider ADD VALUE IF NOT EXISTS 'schwab';

CREATE TABLE IF NOT EXISTS schwab_user_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES users(id),
  status varchar(32) NOT NULL DEFAULT 'pending',
  oauth_state varchar(128),
  connect_started_at timestamp with time zone,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_key_version varchar(64) NOT NULL,
  access_token_expires_at timestamp with time zone,
  refresh_token_expires_at timestamp with time zone,
  scope varchar(128),
  connected_at timestamp with time zone,
  disabled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS schwab_user_credentials_app_user_idx
  ON schwab_user_credentials (app_user_id);

CREATE INDEX IF NOT EXISTS schwab_user_credentials_status_idx
  ON schwab_user_credentials (status);
