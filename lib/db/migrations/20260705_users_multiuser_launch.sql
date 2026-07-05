-- Multi-user launch identity for the users table (additive; no behavior change
-- for existing password users). JIT "launch" users authenticate via the parent
-- site and key on (external_issuer, external_user_id); they may have a NULL
-- password. Existing password users are unaffected.

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS external_user_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS external_issuer text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS entitlements text[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan text;

-- Launch identity is (external_issuer, external_user_id), unique when present.
CREATE UNIQUE INDEX IF NOT EXISTS users_external_identity_idx
  ON users (external_issuer, external_user_id)
  WHERE external_user_id IS NOT NULL;

-- Relax email uniqueness: it must stay unique among PASSWORD users (login keys on
-- email) but must NOT collide for JIT launch users (email is display-only there;
-- identity is (issuer, sub)). Replace the global unique index with a partial one.
-- All existing rows have a password_hash, so this is a no-op for current data.
DROP INDEX IF EXISTS users_email_idx;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx
  ON users (email)
  WHERE password_hash IS NOT NULL;
