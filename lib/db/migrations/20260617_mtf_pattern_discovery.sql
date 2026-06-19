-- MTF pattern-discovery result tables.
--
-- A "pattern" is the per-timeframe signal-direction vector at a point in time
-- (e.g. "1m:sell|2m:sell|5m:sell|15m:buy"). mtf_pattern_results aggregates one
-- pattern at one forward horizon across all observed occurrences; the optional
-- mtf_pattern_occurrences holds the raw per-occurrence rows for drill-down.
-- Orchestration reuses backtest_studies + backtest_study_jobs (kind =
-- 'pattern_discovery'); no change to those tables.
--
-- Additive only (CREATE ... IF NOT EXISTS); no data rewrite. Apply manually
-- (drizzle-kit push is disabled on the shared dev DB after the 2026-06-15
-- data-loss incident).

CREATE TABLE IF NOT EXISTS mtf_pattern_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL REFERENCES backtest_studies(id),
  job_id uuid REFERENCES backtest_study_jobs(id),
  pattern_key text NOT NULL,
  timeframe_set jsonb NOT NULL,
  base_timeframe varchar(16) NOT NULL,
  horizon_bars integer NOT NULL,
  sample_count integer NOT NULL,
  bias varchar(8) NOT NULL DEFAULT 'neutral',
  win_rate_pct numeric(18, 6),
  mean_return_pct numeric(18, 6),
  median_return_pct numeric(18, 6),
  std_return_pct numeric(18, 6),
  avg_mae_pct numeric(18, 6),
  avg_mfe_pct numeric(18, 6),
  score numeric(18, 6),
  t_stat numeric(18, 6),
  rank integer,
  data_quality jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mtf_pattern_results_rank_idx
  ON mtf_pattern_results (study_id, horizon_bars, score);
CREATE UNIQUE INDEX IF NOT EXISTS mtf_pattern_results_pattern_idx
  ON mtf_pattern_results (study_id, pattern_key, horizon_bars);

CREATE TABLE IF NOT EXISTS mtf_pattern_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL REFERENCES backtest_studies(id),
  symbol varchar(64) NOT NULL,
  occurred_at timestamptz NOT NULL,
  pattern_key text NOT NULL,
  horizon_bars integer NOT NULL,
  realized_return_pct numeric(18, 6),
  mae_pct numeric(18, 6),
  mfe_pct numeric(18, 6),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mtf_pattern_occurrences_pattern_idx
  ON mtf_pattern_occurrences (study_id, pattern_key, horizon_bars);
CREATE INDEX IF NOT EXISTS mtf_pattern_occurrences_symbol_idx
  ON mtf_pattern_occurrences (study_id, symbol);
