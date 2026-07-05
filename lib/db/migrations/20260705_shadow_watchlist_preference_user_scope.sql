-- Per-user scope for the previously-global shadow paper account, watchlists, and
-- user preferences (additive). Legacy global rows are backfilled to the founding
-- admin (oldest admin) so their history stays intact; new members get their own
-- rows. Shadow: one standalone paper account per user + one paired paper account
-- per connected broker account (source_broker_account_id).

DO $$
DECLARE admin_id uuid;
BEGIN
  SELECT id INTO admin_id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1;

  -- shadow_accounts: owner + optional source broker account (NULL = standalone).
  ALTER TABLE shadow_accounts ADD COLUMN IF NOT EXISTS app_user_id uuid REFERENCES users(id);
  ALTER TABLE shadow_accounts ADD COLUMN IF NOT EXISTS source_broker_account_id uuid REFERENCES broker_accounts(id);
  IF EXISTS (SELECT 1 FROM shadow_accounts WHERE id = 'shadow') AND admin_id IS NULL THEN
    RAISE EXCEPTION 'legacy shadow account exists but no admin to own it -- bootstrap an admin first';
  END IF;
  UPDATE shadow_accounts SET app_user_id = admin_id WHERE id = 'shadow' AND app_user_id IS NULL;

  -- watchlists
  ALTER TABLE watchlists ADD COLUMN IF NOT EXISTS app_user_id uuid REFERENCES users(id);
  UPDATE watchlists SET app_user_id = admin_id WHERE app_user_id IS NULL AND admin_id IS NOT NULL;

  -- user_preference_profiles
  ALTER TABLE user_preference_profiles ADD COLUMN IF NOT EXISTS app_user_id uuid REFERENCES users(id);
  UPDATE user_preference_profiles SET app_user_id = admin_id WHERE app_user_id IS NULL AND admin_id IS NOT NULL;
END $$;

-- shadow_accounts: one active standalone shadow per user, one active paired shadow per broker account.
CREATE UNIQUE INDEX IF NOT EXISTS shadow_accounts_user_standalone_idx
  ON shadow_accounts (app_user_id)
  WHERE app_user_id IS NOT NULL AND source_broker_account_id IS NULL AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS shadow_accounts_source_account_idx
  ON shadow_accounts (source_broker_account_id)
  WHERE source_broker_account_id IS NOT NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS shadow_accounts_app_user_idx ON shadow_accounts (app_user_id);

CREATE INDEX IF NOT EXISTS watchlists_app_user_idx ON watchlists (app_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS user_preference_profiles_app_user_idx
  ON user_preference_profiles (app_user_id)
  WHERE app_user_id IS NOT NULL;
