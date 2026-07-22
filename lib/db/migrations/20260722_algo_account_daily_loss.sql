-- Persist the account-wide daily-loss circuit breaker separately from any one
-- deployment. Existing accounts remain unconfigured until an owner explicitly
-- chooses a positive USD limit. This migration does not alter target activation.

BEGIN;

ALTER TABLE algo_account_controls
  ADD COLUMN IF NOT EXISTS daily_loss_limit_usd numeric(20, 6),
  ADD COLUMN IF NOT EXISTS daily_loss_scope varchar(64)
    NOT NULL DEFAULT 'account_options_realized';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'algo_account_controls_daily_loss_limit_chk'
      AND conrelid = 'algo_account_controls'::regclass
  ) THEN
    ALTER TABLE algo_account_controls
      ADD CONSTRAINT algo_account_controls_daily_loss_limit_chk CHECK (
        daily_loss_limit_usd IS NULL OR daily_loss_limit_usd > 0
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'algo_account_controls_daily_loss_scope_chk'
      AND conrelid = 'algo_account_controls'::regclass
  ) THEN
    ALTER TABLE algo_account_controls
      ADD CONSTRAINT algo_account_controls_daily_loss_scope_chk CHECK (
        daily_loss_scope = 'account_options_realized'
      );
  END IF;
END $$;

COMMENT ON COLUMN algo_account_controls.daily_loss_limit_usd IS
  'Owner-configured account-wide maximum realized options loss for the current America/New_York trading day; NULL is unconfigured and blocks live activation.';
COMMENT ON COLUMN algo_account_controls.daily_loss_scope IS
  'V1 scope is account-wide realized options P&L for the current America/New_York trading day.';

COMMIT;
