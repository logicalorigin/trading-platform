-- Compact sidecar for signal-options entry-candidate skip dedup.
-- Additive only; execution_events remains the authoritative ledger.
CREATE TABLE IF NOT EXISTS "signal_options_seen_signals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "deployment_id" uuid NOT NULL REFERENCES "algo_deployments"("id"),
  "provider_account_id" varchar(128),
  "event_id" uuid,
  "symbol" varchar(64),
  "signal_key" text NOT NULL,
  "reason" varchar(128) NOT NULL,
  "candidate_match_key" varchar(160),
  "occurred_at" timestamp with time zone NOT NULL,
  "payload_retryable" boolean NOT NULL DEFAULT false,
  "preflight" boolean NOT NULL DEFAULT false,
  "has_selected_contract" boolean NOT NULL DEFAULT false,
  "has_signal_matrix_mtf" boolean NOT NULL DEFAULT false,
  "premium_cap" double precision,
  "available" double precision,
  "chain_debug_reason" varchar(128),
  "expirations_debug_reason" varchar(128),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "signal_options_seen_signals_deployment_signal_key_idx"
  ON "signal_options_seen_signals" ("deployment_id", "signal_key");

CREATE INDEX IF NOT EXISTS "signal_options_seen_signals_deployment_occurred_idx"
  ON "signal_options_seen_signals" ("deployment_id", "occurred_at" DESC);

CREATE INDEX IF NOT EXISTS "signal_options_seen_signals_event_idx"
  ON "signal_options_seen_signals" ("event_id");

CREATE INDEX IF NOT EXISTS "signal_options_seen_signals_deployment_reason_idx"
  ON "signal_options_seen_signals" ("deployment_id", "reason");
