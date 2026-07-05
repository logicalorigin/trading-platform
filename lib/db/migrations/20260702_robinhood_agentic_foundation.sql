-- Robinhood Agentic Trading (MCP) connection foundation.
-- Adds robinhood as a broker provider and per-user OAuth token custody.
-- Stores only encrypted OAuth material (PKCE verifier during the pending
-- authorization window, access/refresh tokens once connected).

ALTER TYPE broker_provider ADD VALUE IF NOT EXISTS 'robinhood';

CREATE TABLE IF NOT EXISTS robinhood_user_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES users(id),
  oauth_client_id varchar(128) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  oauth_state varchar(128),
  pkce_verifier_ciphertext text,
  connect_started_at timestamp with time zone,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_key_version varchar(64) NOT NULL,
  access_token_expires_at timestamp with time zone,
  scope varchar(128),
  connected_at timestamp with time zone,
  disabled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS robinhood_user_credentials_app_user_idx
  ON robinhood_user_credentials (app_user_id);

CREATE INDEX IF NOT EXISTS robinhood_user_credentials_status_idx
  ON robinhood_user_credentials (status);
