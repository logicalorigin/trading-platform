-- Materialized signal-quality KPI calibration responses.
-- The normal read route returns these cheap snapshots; explicit refresh or
-- background work owns the expensive full-universe bar_cache sweep.
CREATE TABLE IF NOT EXISTS "signal_quality_kpi_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "deployment_id" uuid NOT NULL REFERENCES "algo_deployments"("id"),
  "settings_hash" varchar(64) NOT NULL,
  "as_of_day" date NOT NULL,
  "generated_at" timestamp with time zone NOT NULL,
  "resolved_timeframe" varchar(16),
  "calibration_state" varchar(32),
  "recommended_model_key" varchar(64),
  "evaluated_symbol_count" integer,
  "symbols_with_bars" integer,
  "symbols_timed_out" integer,
  "response" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "signal_quality_kpi_snapshots_deployment_settings_day_idx"
  ON "signal_quality_kpi_snapshots" ("deployment_id", "settings_hash", "as_of_day");

CREATE INDEX IF NOT EXISTS "signal_quality_kpi_snapshots_deployment_generated_idx"
  ON "signal_quality_kpi_snapshots" ("deployment_id", "generated_at" DESC);

CREATE INDEX IF NOT EXISTS "signal_quality_kpi_snapshots_deployment_day_generated_idx"
  ON "signal_quality_kpi_snapshots" ("deployment_id", "as_of_day", "generated_at" DESC);
