-- Telemetry split: new automation_diagnostics table.
--
-- Splits high-volume telemetry + deployment lifecycle/audit events out of the
-- execution_events ledger. The ledger keeps everything load-bearing (all
-- signal_options_* run events, overnight_spot_{shadow,live}_*, and
-- overnight_spot_order_failed); this table receives only the moved types:
--   overnight_spot_signal_blocked, overnight_spot_signal_tracked,
--   deployment_created, deployment_profile_split, deployment_events_reassigned,
--   deployment_enabled, deployment_paused, deployment_mode_changed,
--   deployment_strategy_settings_updated, deployment_account_normalized.
-- (signal_options_profile_updated INTENTIONALLY stays in execution_events: it is
-- load-bearing for the signal-options runtime gate via listDeploymentEvents.)
--
-- Columns mirror execution_events exactly so union-reads need no reshaping.
--
-- MANUAL APPLICATION (drizzle-kit push is disabled on the shared DB):
--   This file (CREATE TABLE) is transactional and safe to run normally:
--     psql "$DATABASE_URL" -f 20260624_automation_diagnostics_table.sql
--   Then apply the CONCURRENTLY indexes (separate file, must run OUTSIDE a txn
--   with statement_timeout disabled):
--     PGOPTIONS="-c statement_timeout=0" psql "$DATABASE_URL" \
--       -f 20260624_automation_diagnostics_indexes.sql

CREATE TABLE IF NOT EXISTS automation_diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid REFERENCES algo_deployments(id),
  algo_run_id uuid REFERENCES algo_runs(id),
  provider_account_id varchar(128),
  symbol varchar(64),
  event_type text NOT NULL,
  summary text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
