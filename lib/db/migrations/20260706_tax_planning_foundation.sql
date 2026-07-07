CREATE TABLE IF NOT EXISTS tax_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES users(id),
  tax_year integer NOT NULL,
  filing_status varchar(32) NOT NULL DEFAULT 'single',
  estimate_scope varchar(64) NOT NULL DEFAULT 'connected_accounts_only',
  federal_estimate_mode varchar(64) NOT NULL DEFAULT 'safe_harbor_plus_visible_gains',
  state_estimate_mode varchar(64) NOT NULL DEFAULT 'all_states',
  resident_state varchar(2),
  marginal_federal_rate numeric(8, 6),
  marginal_state_rate numeric(8, 6),
  prior_year_federal_tax numeric(20, 6),
  prior_year_state_tax numeric(20, 6),
  annualized_income_enabled boolean NOT NULL DEFAULT false,
  cpa_override_amount numeric(20, 6),
  reserve_mode varchar(64) NOT NULL DEFAULT 'virtual_plus_broker_beta',
  reserve_instrument_allowlist text[] NOT NULL DEFAULT '{}',
  broker_reserve_beta_enabled boolean NOT NULL DEFAULT false,
  notifications jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tax_profiles_app_user_year_idx
  ON tax_profiles(app_user_id, tax_year);
CREATE INDEX IF NOT EXISTS tax_profiles_app_user_idx ON tax_profiles(app_user_id);

CREATE TABLE IF NOT EXISTS tax_profile_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES users(id),
  tax_profile_id uuid NOT NULL REFERENCES tax_profiles(id),
  broker_account_id uuid REFERENCES broker_accounts(id),
  account_state varchar(32) NOT NULL DEFAULT 'connected_included',
  included boolean NOT NULL DEFAULT true,
  coverage_status varchar(32) NOT NULL DEFAULT 'connected',
  label text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tax_profile_accounts_app_user_idx
  ON tax_profile_accounts(app_user_id);
CREATE INDEX IF NOT EXISTS tax_profile_accounts_profile_idx
  ON tax_profile_accounts(tax_profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS tax_profile_accounts_broker_account_idx
  ON tax_profile_accounts(tax_profile_id, broker_account_id);

CREATE TABLE IF NOT EXISTS tax_state_rule_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction varchar(2) NOT NULL,
  tax_year integer NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'unavailable',
  version varchar(64),
  source_url text,
  source_name text,
  checksum varchar(128),
  effective_from date,
  effective_to date,
  verified_at timestamptz,
  raw_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tax_state_rule_sets_jurisdiction_year_idx
  ON tax_state_rule_sets(jurisdiction, tax_year);
CREATE INDEX IF NOT EXISTS tax_state_rule_sets_status_idx
  ON tax_state_rule_sets(status);

CREATE TABLE IF NOT EXISTS tax_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES users(id),
  account_id uuid REFERENCES broker_accounts(id),
  tax_year integer NOT NULL,
  occurred_at timestamptz NOT NULL,
  event_type varchar(48) NOT NULL,
  symbol varchar(64),
  asset_class varchar(32),
  side varchar(16),
  quantity numeric(20, 6),
  price numeric(20, 6),
  amount numeric(20, 6),
  fees numeric(20, 6),
  currency varchar(16) NOT NULL DEFAULT 'USD',
  option_identity jsonb,
  source_type varchar(48) NOT NULL,
  source_id text NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  basis_confidence varchar(32) NOT NULL DEFAULT 'unknown',
  raw_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tax_events_user_year_idx ON tax_events(app_user_id, tax_year);
CREATE INDEX IF NOT EXISTS tax_events_account_occurred_idx ON tax_events(account_id, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS tax_events_idempotency_idx ON tax_events(idempotency_key);

CREATE TABLE IF NOT EXISTS tax_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES users(id),
  account_id uuid REFERENCES broker_accounts(id),
  open_event_id uuid REFERENCES tax_events(id),
  close_event_id uuid REFERENCES tax_events(id),
  tax_year integer NOT NULL,
  symbol varchar(64) NOT NULL,
  asset_class varchar(32) NOT NULL,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  quantity_opened numeric(20, 6) NOT NULL,
  quantity_remaining numeric(20, 6) NOT NULL,
  basis_amount numeric(20, 6),
  proceeds_amount numeric(20, 6),
  basis_source varchar(32) NOT NULL DEFAULT 'unknown',
  basis_confidence varchar(32) NOT NULL DEFAULT 'unknown',
  status varchar(32) NOT NULL DEFAULT 'open',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tax_lots_user_year_idx ON tax_lots(app_user_id, tax_year);
CREATE INDEX IF NOT EXISTS tax_lots_account_symbol_idx ON tax_lots(account_id, symbol);
CREATE INDEX IF NOT EXISTS tax_lots_status_idx ON tax_lots(status);

CREATE TABLE IF NOT EXISTS tax_reconciliation_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES users(id),
  account_id uuid REFERENCES broker_accounts(id),
  tax_year integer NOT NULL,
  issue_type varchar(64) NOT NULL,
  severity varchar(24) NOT NULL DEFAULT 'warning',
  status varchar(24) NOT NULL DEFAULT 'open',
  symbol varchar(64),
  event_id uuid REFERENCES tax_events(id),
  lot_id uuid REFERENCES tax_lots(id),
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tax_reconciliation_user_year_idx
  ON tax_reconciliation_issues(app_user_id, tax_year);
CREATE INDEX IF NOT EXISTS tax_reconciliation_status_idx
  ON tax_reconciliation_issues(status);

CREATE TABLE IF NOT EXISTS tax_wash_sale_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES users(id),
  account_id uuid REFERENCES broker_accounts(id),
  tax_year integer NOT NULL,
  loss_event_id uuid REFERENCES tax_events(id),
  replacement_event_id uuid REFERENCES tax_events(id),
  risk_level varchar(24) NOT NULL,
  disallowed_loss_estimate numeric(20, 6),
  reason_codes text[] NOT NULL DEFAULT '{}',
  rationale text,
  status varchar(24) NOT NULL DEFAULT 'estimated',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tax_wash_sale_user_year_idx
  ON tax_wash_sale_matches(app_user_id, tax_year);
CREATE INDEX IF NOT EXISTS tax_wash_sale_account_idx ON tax_wash_sale_matches(account_id);

CREATE TABLE IF NOT EXISTS tax_preflight_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES users(id),
  account_id text NOT NULL,
  preflight_token varchar(128) NOT NULL,
  order_fingerprint varchar(128) NOT NULL,
  action varchar(32) NOT NULL,
  wash_sale_risk varchar(32) NOT NULL,
  self_trade_risk varchar(32) NOT NULL,
  reasons text[] NOT NULL DEFAULT '{}',
  warnings text[] NOT NULL DEFAULT '{}',
  required_acknowledgements text[] NOT NULL DEFAULT '{}',
  acknowledged_at timestamptz,
  expires_at timestamptz NOT NULL,
  submitted_order_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tax_preflight_token_idx
  ON tax_preflight_checks(preflight_token);
CREATE INDEX IF NOT EXISTS tax_preflight_user_account_idx
  ON tax_preflight_checks(app_user_id, account_id);
CREATE INDEX IF NOT EXISTS tax_preflight_fingerprint_idx
  ON tax_preflight_checks(order_fingerprint);
CREATE INDEX IF NOT EXISTS tax_preflight_expires_idx ON tax_preflight_checks(expires_at);

CREATE TABLE IF NOT EXISTS tax_reserve_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES users(id),
  tax_profile_id uuid NOT NULL REFERENCES tax_profiles(id),
  tax_year integer NOT NULL,
  target_amount numeric(20, 6) NOT NULL DEFAULT 0,
  reserved_amount numeric(20, 6) NOT NULL DEFAULT 0,
  currency varchar(16) NOT NULL DEFAULT 'USD',
  mode varchar(64) NOT NULL DEFAULT 'virtual',
  state varchar(32) NOT NULL DEFAULT 'draft',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tax_reserve_bucket_user_year_idx
  ON tax_reserve_buckets(app_user_id, tax_year);
CREATE INDEX IF NOT EXISTS tax_reserve_bucket_profile_idx
  ON tax_reserve_buckets(tax_profile_id);

CREATE TABLE IF NOT EXISTS tax_reserve_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES users(id),
  bucket_id uuid NOT NULL REFERENCES tax_reserve_buckets(id),
  account_id text,
  action_type varchar(32) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'draft',
  instrument_symbol varchar(64),
  amount numeric(20, 6),
  quantity numeric(20, 6),
  broker_order_id text,
  idempotency_key varchar(128) NOT NULL,
  capability_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP INDEX IF EXISTS tax_reserve_action_idempotency_idx;
CREATE UNIQUE INDEX IF NOT EXISTS tax_reserve_action_idempotency_idx
  ON tax_reserve_actions(app_user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS tax_reserve_actions_user_status_idx
  ON tax_reserve_actions(app_user_id, status);
CREATE INDEX IF NOT EXISTS tax_reserve_actions_bucket_idx
  ON tax_reserve_actions(bucket_id);

CREATE TABLE IF NOT EXISTS tax_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES users(id),
  tax_year integer,
  event_type varchar(64) NOT NULL,
  severity varchar(24) NOT NULL DEFAULT 'info',
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tax_audit_events_user_year_idx
  ON tax_audit_events(app_user_id, tax_year);
CREATE INDEX IF NOT EXISTS tax_audit_events_occurred_idx ON tax_audit_events(occurred_at);
