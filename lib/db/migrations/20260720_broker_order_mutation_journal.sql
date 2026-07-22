-- Durable fail-closed journal for live broker mutations. One unresolved row
-- fences an account/provider until the broker outcome is reconciled.

BEGIN;

CREATE TABLE broker_order_mutations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES users(id),
  account_id uuid NOT NULL REFERENCES broker_accounts(id),
  provider broker_provider NOT NULL,
  operation varchar(16) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'inflight',
  broker_order_id varchar(128),
  reason varchar(128),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT broker_order_mutations_operation_chk
    CHECK (operation IN ('submit', 'replace', 'cancel')),
  CONSTRAINT broker_order_mutations_status_chk
    CHECK (
      status IN (
        'inflight', 'succeeded', 'rejected', 'reconciliation_required'
      )
    ),
  CONSTRAINT broker_order_mutations_resolution_chk
    CHECK (
      (status IN ('inflight', 'reconciliation_required')
        AND resolved_at IS NULL)
      OR (status IN ('succeeded', 'rejected')
        AND resolved_at IS NOT NULL)
    ),
  CONSTRAINT broker_order_mutations_metadata_chk
    CHECK (
      jsonb_typeof(metadata) = 'object'
      AND octet_length(metadata::text) <= 8192
    )
);

CREATE INDEX broker_order_mutations_account_status_idx
  ON broker_order_mutations (app_user_id, account_id, provider, status);

CREATE INDEX broker_order_mutations_broker_order_idx
  ON broker_order_mutations (provider, broker_order_id);

CREATE UNIQUE INDEX broker_order_mutations_unresolved_account_idx
  ON broker_order_mutations (app_user_id, account_id, provider)
  WHERE status IN ('inflight', 'reconciliation_required');

COMMIT;
