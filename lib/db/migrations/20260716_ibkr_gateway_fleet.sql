-- Durable, owner-bound IBKR capsule placement and host admission.
-- Host rows contain only routable service identity plus immutable runtime
-- attestation; session rows contain no credentials, browser state, or relay ports.

BEGIN;

ALTER TABLE broker_connections
  ADD CONSTRAINT broker_connections_id_app_user_id_key
  UNIQUE (id, app_user_id);

ALTER TABLE broker_connections
  ADD CONSTRAINT broker_connections_ibkr_identity_key
  UNIQUE (id, app_user_id, broker_provider, connection_type);

CREATE TABLE ibkr_gateway_hosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workload_identity_digest varchar(64) NOT NULL,
  control_origin varchar(2048) NOT NULL,
  image_digest varchar(71) NOT NULL,
  runtime_spec_digest varchar(71) NOT NULL,
  runtime_attestation_digest varchar(71) NOT NULL,
  failure_domain varchar(128) NOT NULL,
  measured_slot_capacity integer NOT NULL,
  admission_slot_capacity integer NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'quarantined',
  last_heartbeat_at timestamptz NOT NULL,
  heartbeat_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ibkr_gateway_hosts_workload_identity_digest_key
    UNIQUE (workload_identity_digest),
  CONSTRAINT ibkr_gateway_hosts_workload_identity_digest_chk
    CHECK (workload_identity_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ibkr_gateway_hosts_digest_chk
    CHECK (
      image_digest ~ '^sha256:[0-9a-f]{64}$'
      AND runtime_spec_digest ~ '^sha256:[0-9a-f]{64}$'
      AND runtime_attestation_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  CONSTRAINT ibkr_gateway_hosts_capacity_chk
    CHECK (
      measured_slot_capacity BETWEEN 1 AND 20
      AND admission_slot_capacity BETWEEN 1 AND measured_slot_capacity
    ),
  CONSTRAINT ibkr_gateway_hosts_status_chk
    CHECK (status IN ('active', 'draining', 'quarantined')),
  CONSTRAINT ibkr_gateway_hosts_heartbeat_chk
    CHECK (heartbeat_expires_at > last_heartbeat_at),
  CONSTRAINT ibkr_gateway_hosts_control_origin_chk
    CHECK (control_origin ~ '^https://[^/?#]+/?$' AND control_origin !~ '@')
);

CREATE INDEX ibkr_gateway_hosts_admission_idx
  ON ibkr_gateway_hosts (status, heartbeat_expires_at);

CREATE FUNCTION reject_ibkr_gateway_host_attestation_change()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.workload_identity_digest IS DISTINCT FROM OLD.workload_identity_digest
    OR NEW.control_origin IS DISTINCT FROM OLD.control_origin
    OR NEW.image_digest IS DISTINCT FROM OLD.image_digest
    OR NEW.runtime_spec_digest IS DISTINCT FROM OLD.runtime_spec_digest
    OR NEW.runtime_attestation_digest IS DISTINCT FROM OLD.runtime_attestation_digest
    OR NEW.failure_domain IS DISTINCT FROM OLD.failure_domain
  THEN
    RAISE EXCEPTION 'ibkr_gateway_hosts_attestation_immutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER ibkr_gateway_hosts_attestation_immutable
BEFORE UPDATE ON ibkr_gateway_hosts
FOR EACH ROW
EXECUTE FUNCTION reject_ibkr_gateway_host_attestation_change();

CREATE TABLE ibkr_gateway_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL,
  broker_connection_id uuid NOT NULL,
  broker_provider broker_provider NOT NULL DEFAULT 'ibkr',
  connection_type connection_type NOT NULL DEFAULT 'broker',
  generation integer NOT NULL DEFAULT 0,
  lifecycle_state varchar(32) NOT NULL DEFAULT 'requested',
  host_id uuid,
  slot_number integer,
  lease_holder_id uuid,
  lease_expires_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ibkr_gateway_sessions_id_owner_connection_key
    UNIQUE (id, app_user_id, broker_connection_id),
  CONSTRAINT ibkr_gateway_sessions_broker_connection_id_key
    UNIQUE (broker_connection_id),
  CONSTRAINT ibkr_gateway_sessions_generation_nonnegative_chk
    CHECK (generation >= 0),
  CONSTRAINT ibkr_gateway_sessions_ibkr_identity_chk
    CHECK (broker_provider = 'ibkr' AND connection_type = 'broker'),
  CONSTRAINT ibkr_gateway_sessions_lifecycle_state_chk
    CHECK (
      lifecycle_state IN (
        'requested', 'provisioning', 'login_required', 'verifying',
        'authenticated', 'degraded', 'reauth_required', 'draining',
        'released', 'quarantined'
      )
    ),
  CONSTRAINT ibkr_gateway_sessions_placement_lease_chk
    CHECK (
      (
        host_id IS NULL
        AND slot_number IS NULL
        AND lease_holder_id IS NULL
        AND lease_expires_at IS NULL
      ) OR (
        host_id IS NOT NULL
        AND slot_number IS NOT NULL
        AND lease_holder_id IS NOT NULL
        AND lease_expires_at IS NOT NULL
      )
    ),
  CONSTRAINT ibkr_gateway_sessions_slot_number_chk
    CHECK (slot_number IS NULL OR slot_number BETWEEN 1 AND 20),
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
    ),
  CONSTRAINT ibkr_gateway_sessions_host_fk
    FOREIGN KEY (host_id)
    REFERENCES ibkr_gateway_hosts (id)
);

CREATE UNIQUE INDEX ibkr_gateway_sessions_host_slot_key
  ON ibkr_gateway_sessions (host_id, slot_number)
  WHERE host_id IS NOT NULL;

CREATE INDEX ibkr_gateway_sessions_active_lease_idx
  ON ibkr_gateway_sessions (host_id, lease_expires_at);

COMMIT;
