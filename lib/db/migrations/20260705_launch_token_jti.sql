-- Slice 6: one-time replay guard for launch-token JWTs (/auth/launch).
-- A launch token's jti is inserted on first use; a replay violates the PK.
-- Additive; no existing data affected. (users.external_user_id/issuer +
-- password_hash-nullable already landed in 20260705_users_multiuser_launch.sql.)
CREATE TABLE IF NOT EXISTS launch_token_jti (
  jti text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS launch_token_jti_expires_at_idx ON launch_token_jti (expires_at);
