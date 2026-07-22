-- Durable ownership and fencing identity for an attended IBKR gateway session.
-- Deliberately stores no broker credentials, cookies, tokens, browser profiles,
-- network endpoints, or brokerage account identifiers.

BEGIN;

ALTER TABLE broker_connections
  ADD CONSTRAINT broker_connections_id_app_user_id_key
  UNIQUE (id, app_user_id);

ALTER TABLE broker_connections
  ADD CONSTRAINT broker_connections_ibkr_identity_key
  UNIQUE (id, app_user_id, broker_provider, connection_type);

CREATE TABLE ibkr_gateway_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL,
  broker_connection_id uuid NOT NULL,
  broker_provider broker_provider NOT NULL DEFAULT 'ibkr',
  connection_type connection_type NOT NULL DEFAULT 'broker',
  generation integer NOT NULL DEFAULT 0,
  lease_holder_id uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ibkr_gateway_sessions_broker_connection_id_key
    UNIQUE (broker_connection_id),
  CONSTRAINT ibkr_gateway_sessions_generation_nonnegative_chk
    CHECK (generation >= 0),
  CONSTRAINT ibkr_gateway_sessions_ibkr_identity_chk
    CHECK (broker_provider = 'ibkr' AND connection_type = 'broker'),
  CONSTRAINT ibkr_gateway_sessions_lease_pair_chk
    CHECK ((lease_holder_id IS NULL) = (lease_expires_at IS NULL)),
  CONSTRAINT ibkr_gateway_sessions_connection_owner_fk
    FOREIGN KEY (broker_connection_id, app_user_id)
    REFERENCES broker_connections (id, app_user_id),
  CONSTRAINT ibkr_gateway_sessions_connection_identity_fk
    FOREIGN KEY (
      broker_connection_id,
      app_user_id,
      broker_provider,
      connection_type
    ) REFERENCES broker_connections (
      id,
      app_user_id,
      broker_provider,
      connection_type
    )
);

CREATE TABLE ibkr_gateway_resource_slots (
  resource_kind varchar(16) NOT NULL,
  slot_number integer NOT NULL,
  gateway_session_id uuid,
  gateway_generation integer,
  lease_holder_id uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ibkr_gateway_resource_slots_pkey
    PRIMARY KEY (resource_kind, slot_number),
  CONSTRAINT ibkr_gateway_resource_slots_number_chk
    CHECK (
      (resource_kind = 'core' AND slot_number BETWEEN 1 AND 10)
      OR (resource_kind = 'viewer' AND slot_number BETWEEN 1 AND 2)
      OR (resource_kind = 'cold_start' AND slot_number = 1)
    ),
  CONSTRAINT ibkr_gateway_resource_slots_assignment_pair_chk
    CHECK (
      (
        gateway_session_id IS NULL
        AND gateway_generation IS NULL
        AND lease_holder_id IS NULL
        AND lease_expires_at IS NULL
      ) OR (
        gateway_session_id IS NOT NULL
        AND gateway_generation IS NOT NULL
        AND lease_holder_id IS NOT NULL
        AND lease_expires_at IS NOT NULL
      )
    ),
  CONSTRAINT ibkr_gateway_resource_slots_generation_nonnegative_chk
    CHECK (gateway_generation IS NULL OR gateway_generation >= 0),
  CONSTRAINT ibkr_gateway_resource_slots_session_fk
    FOREIGN KEY (gateway_session_id)
    REFERENCES ibkr_gateway_sessions (id)
);

CREATE UNIQUE INDEX ibkr_gateway_resource_slots_session_kind_key
  ON ibkr_gateway_resource_slots (gateway_session_id, resource_kind)
  WHERE gateway_session_id IS NOT NULL;

CREATE INDEX ibkr_gateway_resource_slots_active_idx
  ON ibkr_gateway_resource_slots (resource_kind, lease_expires_at);

INSERT INTO ibkr_gateway_resource_slots (resource_kind, slot_number)
SELECT 'core', generate_series(1, 10)
UNION ALL
SELECT 'viewer', generate_series(1, 2)
UNION ALL
SELECT 'cold_start', 1;

COMMIT;
