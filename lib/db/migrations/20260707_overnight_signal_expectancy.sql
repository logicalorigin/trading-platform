-- Overnight signal-expectancy result tables.
--
-- A study compares completed Pyrus buy-state expectancy across 15m, 30m, 1h,
-- and 4h signals from regular-session close to the next regular-session open.
-- Orchestration reuses backtest_studies + backtest_study_jobs (kind =
-- 'overnight_signal_expectancy'); result/sample rows live in dedicated tables
-- so they are not mixed with MTF pattern-discovery or position backtest rows.
--
-- Additive only (CREATE ... IF NOT EXISTS); no data rewrite. Apply manually
-- (drizzle-kit push is disabled on the shared dev DB after the 2026-06-15
-- data-loss incident).

CREATE TABLE IF NOT EXISTS overnight_signal_expectancy_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL REFERENCES backtest_studies(id),
  job_id uuid REFERENCES backtest_study_jobs(id),
  timeframe varchar(16) NOT NULL,
  sample_count integer NOT NULL,
  eligible_sample_count integer NOT NULL DEFAULT 0,
  buy_state_count integer NOT NULL DEFAULT 0,
  valid_return_coverage_pct numeric(18, 6),
  buy_state_frequency_pct numeric(18, 6),
  expectancy_pct numeric(18, 6),
  median_return_pct numeric(18, 6),
  win_rate_pct numeric(18, 6),
  avg_win_pct numeric(18, 6),
  avg_loss_pct numeric(18, 6),
  payoff_ratio numeric(18, 6),
  std_return_pct numeric(18, 6),
  t_stat numeric(18, 6),
  ci95_low_pct numeric(18, 6),
  ci95_high_pct numeric(18, 6),
  rank integer,
  winner_status varchar(32) NOT NULL DEFAULT 'tie',
  pairwise_summary jsonb,
  data_quality jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS overnight_signal_expectancy_results_study_tf_idx
  ON overnight_signal_expectancy_results (study_id, timeframe);
CREATE INDEX IF NOT EXISTS overnight_signal_expectancy_results_rank_idx
  ON overnight_signal_expectancy_results (study_id, rank);

CREATE TABLE IF NOT EXISTS overnight_signal_expectancy_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL REFERENCES backtest_studies(id),
  job_id uuid REFERENCES backtest_study_jobs(id),
  symbol varchar(64) NOT NULL,
  session_date date NOT NULL,
  timeframe varchar(16) NOT NULL,
  status varchar(32) NOT NULL,
  exclusion_reason varchar(64),
  signal_at timestamptz,
  signal_available_at timestamptz,
  entry_at timestamptz,
  entry_price numeric(18, 6),
  exit_at timestamptz,
  exit_price numeric(18, 6),
  return_pct numeric(18, 6),
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS overnight_signal_expectancy_samples_unique_idx
  ON overnight_signal_expectancy_samples (study_id, symbol, session_date, timeframe);
CREATE INDEX IF NOT EXISTS overnight_signal_expectancy_samples_page_idx
  ON overnight_signal_expectancy_samples (study_id, session_date, symbol, timeframe, id);
CREATE INDEX IF NOT EXISTS overnight_signal_expectancy_samples_filter_idx
  ON overnight_signal_expectancy_samples (study_id, timeframe, status, session_date);
CREATE INDEX IF NOT EXISTS overnight_signal_expectancy_samples_symbol_idx
  ON overnight_signal_expectancy_samples (study_id, symbol);
