ALTER TABLE broker_accounts
  ADD COLUMN IF NOT EXISTS account_status varchar(32),
  ADD COLUMN IF NOT EXISTS capabilities text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS execution_blockers text[] NOT NULL DEFAULT ARRAY[]::text[];
