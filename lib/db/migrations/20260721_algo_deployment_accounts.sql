-- Owner-scoped deployment drafts, durable account targets, account-wide algo
-- ceilings, and target-aware live execution state. Additive only: existing
-- deployments and their histories are preserved.

BEGIN;

ALTER TABLE algo_deployments
  ADD COLUMN IF NOT EXISTS app_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE algo_deployments
  ALTER COLUMN provider_account_id DROP NOT NULL;

-- Existing rows predate drafts and are therefore applied deployments.
UPDATE algo_deployments
SET is_draft = false
WHERE is_draft = true;

-- Prefer the exact owned Shadow account. This safely backfills the current
-- Pyrus Signal Options deployment without choosing between multiple admins.
UPDATE algo_deployments AS deployment
SET app_user_id = shadow_account.app_user_id
FROM shadow_accounts AS shadow_account
WHERE deployment.app_user_id IS NULL
  AND deployment.provider_account_id = shadow_account.id
  AND shadow_account.app_user_id IS NOT NULL;

-- Backfill real legacy bindings only when the provider account identity has
-- exactly one non-null owner across the table.
WITH unambiguous_broker_owner AS (
  SELECT
    provider_account_id,
    (array_agg(app_user_id ORDER BY app_user_id::text))[1] AS app_user_id
  FROM broker_accounts
  WHERE app_user_id IS NOT NULL
  GROUP BY provider_account_id
  HAVING count(DISTINCT app_user_id) = 1
)
UPDATE algo_deployments AS deployment
SET app_user_id = owner.app_user_id
FROM unambiguous_broker_owner AS owner
WHERE deployment.app_user_id IS NULL
  AND deployment.provider_account_id = owner.provider_account_id;

CREATE INDEX IF NOT EXISTS algo_deployments_app_user_idx
  ON algo_deployments (app_user_id);

CREATE INDEX IF NOT EXISTS algo_deployments_owner_archived_idx
  ON algo_deployments (app_user_id, archived_at);

CREATE TABLE IF NOT EXISTS algo_deployment_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES algo_deployments(id),
  broker_account_id uuid REFERENCES broker_accounts(id),
  shadow_account_id varchar(64) REFERENCES shadow_accounts(id),
  lifecycle varchar(32) NOT NULL DEFAULT 'active',
  allocation_percent numeric(5, 2) NOT NULL,
  risk_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  joined_at timestamptz NOT NULL DEFAULT now(),
  draining_at timestamptz,
  detached_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT algo_deployment_targets_exactly_one_account_chk CHECK (
    (broker_account_id IS NOT NULL AND shadow_account_id IS NULL)
    OR (broker_account_id IS NULL AND shadow_account_id IS NOT NULL)
  ),
  CONSTRAINT algo_deployment_targets_lifecycle_chk CHECK (
    lifecycle IN ('active', 'draining', 'manual_takeover', 'detached')
  ),
  CONSTRAINT algo_deployment_targets_allocation_percent_chk CHECK (
    allocation_percent > 0 AND allocation_percent <= 100
  ),
  CONSTRAINT algo_deployment_targets_risk_overrides_chk CHECK (
    jsonb_typeof(risk_overrides) = 'object'
    AND octet_length(risk_overrides::text) <= 8192
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS algo_deployment_targets_broker_key
  ON algo_deployment_targets (deployment_id, broker_account_id)
  WHERE broker_account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS algo_deployment_targets_shadow_key
  ON algo_deployment_targets (deployment_id, shadow_account_id)
  WHERE shadow_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS algo_deployment_targets_deployment_lifecycle_idx
  ON algo_deployment_targets (deployment_id, lifecycle);

CREATE INDEX IF NOT EXISTS algo_deployment_targets_broker_lifecycle_idx
  ON algo_deployment_targets (broker_account_id, lifecycle);

CREATE TABLE IF NOT EXISTS algo_account_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES users(id),
  broker_account_id uuid NOT NULL REFERENCES broker_accounts(id),
  hard_ceiling_percent numeric(5, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT algo_account_controls_hard_ceiling_percent_chk CHECK (
    hard_ceiling_percent > 0 AND hard_ceiling_percent <= 100
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS algo_account_controls_broker_key
  ON algo_account_controls (broker_account_id);

CREATE INDEX IF NOT EXISTS algo_account_controls_owner_idx
  ON algo_account_controls (app_user_id);

CREATE TABLE IF NOT EXISTS algo_target_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES users(id),
  deployment_id uuid NOT NULL REFERENCES algo_deployments(id),
  target_id uuid NOT NULL REFERENCES algo_deployment_targets(id),
  source_event_id uuid NOT NULL REFERENCES execution_events(id),
  execution_key varchar(256) NOT NULL,
  action varchar(16) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  client_order_id uuid NOT NULL,
  broker_order_id varchar(128),
  broker_order_state varchar(64),
  contract_snapshot jsonb NOT NULL,
  order_snapshot jsonb NOT NULL,
  requested_quantity numeric(20, 6) NOT NULL,
  filled_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  premium_at_risk numeric(20, 6),
  error_code varchar(128),
  error_message varchar(512),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT algo_target_executions_action_chk CHECK (
    action IN ('entry', 'exit')
  ),
  CONSTRAINT algo_target_executions_status_chk CHECK (
    status IN (
      'pending', 'reviewed', 'submitted', 'filled', 'rejected',
      'reconciliation_required', 'cancelled'
    )
  ),
  CONSTRAINT algo_target_executions_quantity_chk CHECK (
    requested_quantity > 0
    AND filled_quantity >= 0
    AND filled_quantity <= requested_quantity
  ),
  CONSTRAINT algo_target_executions_payload_chk CHECK (
    jsonb_typeof(contract_snapshot) = 'object'
    AND jsonb_typeof(order_snapshot) = 'object'
    AND octet_length(contract_snapshot::text) <= 16384
    AND octet_length(order_snapshot::text) <= 16384
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS algo_target_executions_execution_key
  ON algo_target_executions (execution_key);

CREATE UNIQUE INDEX IF NOT EXISTS algo_target_executions_client_order_key
  ON algo_target_executions (client_order_id);

CREATE INDEX IF NOT EXISTS algo_target_executions_target_status_idx
  ON algo_target_executions (target_id, status, occurred_at DESC);

CREATE INDEX IF NOT EXISTS algo_target_executions_source_event_idx
  ON algo_target_executions (source_event_id);

CREATE TABLE IF NOT EXISTS algo_target_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES users(id),
  deployment_id uuid NOT NULL REFERENCES algo_deployments(id),
  target_id uuid NOT NULL REFERENCES algo_deployment_targets(id),
  strategy_position_key varchar(256) NOT NULL,
  symbol varchar(64) NOT NULL,
  provider_position_id varchar(128),
  contract_snapshot jsonb NOT NULL,
  quantity numeric(20, 6) NOT NULL,
  premium_basis numeric(20, 6),
  status varchar(32) NOT NULL,
  opened_at timestamptz,
  closed_at timestamptz,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT algo_target_positions_status_chk CHECK (
    status IN (
      'opening', 'open', 'closing', 'closed', 'manual_takeover', 'attention'
    )
  ),
  CONSTRAINT algo_target_positions_quantity_chk CHECK (quantity >= 0),
  CONSTRAINT algo_target_positions_contract_chk CHECK (
    jsonb_typeof(contract_snapshot) = 'object'
    AND octet_length(contract_snapshot::text) <= 16384
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS algo_target_positions_strategy_key
  ON algo_target_positions (target_id, strategy_position_key);

CREATE INDEX IF NOT EXISTS algo_target_positions_target_status_idx
  ON algo_target_positions (target_id, status);

CREATE INDEX IF NOT EXISTS algo_target_positions_deployment_status_idx
  ON algo_target_positions (deployment_id, status);

COMMIT;
