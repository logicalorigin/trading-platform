-- Backtest ledger separation, Phase 1.
--
-- Manual apply only. Do not apply through drizzle-kit push.
-- Additive DDL only: existing study-mode backtest rows default to kind='study'.
--
-- Reversal note: after downstream writers/readers are stopped and data is archived,
-- drop backtest_run_executions, drop backtest_runs_kind_created_at_idx, and drop the
-- columns added below from backtest_runs and backtest_run_points.

ALTER TABLE backtest_runs
  ADD COLUMN IF NOT EXISTS kind varchar(32) NOT NULL DEFAULT 'study',
  ADD COLUMN IF NOT EXISTS source_run_key varchar(240),
  ADD COLUMN IF NOT EXISTS source_account_id varchar(64),
  ADD COLUMN IF NOT EXISTS market_date varchar(10),
  ADD COLUMN IF NOT EXISTS market_date_from varchar(10),
  ADD COLUMN IF NOT EXISTS market_date_to varchar(10),
  ADD COLUMN IF NOT EXISTS range_key varchar(160),
  ADD COLUMN IF NOT EXISTS window_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS window_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS config_used_ref varchar(240),
  ADD COLUMN IF NOT EXISTS fidelity varchar(16) NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS compacted_at timestamptz;

ALTER TABLE backtest_run_points
  ADD COLUMN IF NOT EXISTS source varchar(32),
  ADD COLUMN IF NOT EXISTS currency varchar(16),
  ADD COLUMN IF NOT EXISTS buying_power numeric(20, 6),
  ADD COLUMN IF NOT EXISTS realized_pnl numeric(20, 6),
  ADD COLUMN IF NOT EXISTS unrealized_pnl numeric(20, 6),
  ADD COLUMN IF NOT EXISTS fees numeric(20, 6);

CREATE TABLE IF NOT EXISTS backtest_run_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES backtest_runs(id),
  account_id varchar(64),
  source varchar(32),
  source_event_id uuid,
  source_order_id uuid,
  source_fill_id uuid,
  source_position_id uuid,
  source_position_mark_id uuid,
  client_order_id varchar(180),
  deployment_id uuid,
  provider_account_id varchar(128),
  event_type varchar(64) NOT NULL,
  summary text,
  symbol varchar(64),
  asset_class varchar(32),
  position_type varchar(32),
  position_key varchar(240),
  side varchar(16),
  direction varchar(16),
  timeframe varchar(16),
  order_type varchar(16),
  time_in_force varchar(16),
  status varchar(32),
  quantity numeric(20, 6),
  filled_quantity numeric(20, 6),
  limit_price numeric(18, 6),
  stop_price numeric(18, 6),
  average_fill_price numeric(18, 6),
  price numeric(18, 6),
  gross_amount numeric(20, 6),
  fees numeric(20, 6),
  realized_pnl numeric(20, 6),
  cash_delta numeric(20, 6),
  option_ticker varchar(96),
  option_underlying varchar(64),
  option_expiration_date date,
  option_strike numeric(18, 6),
  option_right varchar(8),
  option_multiplier integer,
  option_provider_contract_id varchar(128),
  signal_at timestamptz,
  signal_price numeric(18, 6),
  signal_close numeric(18, 6),
  signal_score numeric(18, 6),
  signal_score_details jsonb,
  watchlists jsonb,
  regime jsonb,
  fill_source varchar(160),
  candidate_id varchar(160),
  signal_key varchar(240),
  reason varchar(160),
  market_date varchar(10),
  position_market_date varchar(10),
  position_quantity numeric(20, 6),
  average_cost numeric(18, 6),
  mark numeric(18, 6),
  market_value numeric(20, 6),
  unrealized_pnl numeric(20, 6),
  position_status varchar(32),
  position_opened_at timestamptz,
  position_closed_at timestamptz,
  position_as_of timestamptz,
  occurred_at timestamptz NOT NULL,
  placed_at timestamptz,
  filled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS backtest_run_executions_run_idx
  ON backtest_run_executions (run_id);

-- Existing table listing path: apply outside an explicit transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS backtest_runs_kind_created_at_idx
  ON backtest_runs (kind, created_at DESC);

ALTER TABLE backtest_runs
  ALTER COLUMN study_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'backtest_runs_study_requires_study_id_chk'
      AND conrelid = 'backtest_runs'::regclass
  ) THEN
    ALTER TABLE backtest_runs
      ADD CONSTRAINT backtest_runs_study_requires_study_id_chk
      CHECK (kind <> 'study' OR study_id IS NOT NULL);
  END IF;
END $$;
