-- Admit deadline-based placement reuse only for hosts whose immutable runtime
-- identity attests the in-capsule monotonic lease protocol.

BEGIN;

ALTER TABLE ibkr_gateway_hosts
  ADD COLUMN capsule_lease_protocol_version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT ibkr_gateway_hosts_capsule_lease_protocol_version_chk
  CHECK (capsule_lease_protocol_version IN (0, 1));

CREATE OR REPLACE FUNCTION reject_ibkr_gateway_host_attestation_change()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.workload_identity_digest IS DISTINCT FROM OLD.workload_identity_digest
    OR NEW.control_origin IS DISTINCT FROM OLD.control_origin
    OR NEW.image_digest IS DISTINCT FROM OLD.image_digest
    OR NEW.runtime_spec_digest IS DISTINCT FROM OLD.runtime_spec_digest
    OR NEW.runtime_attestation_digest IS DISTINCT FROM OLD.runtime_attestation_digest
    OR NEW.capsule_lease_protocol_version IS DISTINCT FROM OLD.capsule_lease_protocol_version
    OR NEW.failure_domain IS DISTINCT FROM OLD.failure_domain
  THEN
    RAISE EXCEPTION 'ibkr_gateway_hosts_attestation_immutable';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER TABLE ibkr_gateway_sessions
  DROP CONSTRAINT ibkr_gateway_sessions_control_fencing_chk,
  ADD CONSTRAINT ibkr_gateway_sessions_control_fencing_chk
  CHECK (
    (
      host_id IS NULL
      AND control_attempt_id IS NULL
      AND control_acknowledged_at IS NULL
      AND replacement_deadline_at IS NULL
    ) OR (
      host_id IS NOT NULL
      AND replacement_deadline_at IS NOT NULL
      AND (
        control_acknowledged_at IS NULL
        OR control_attempt_id IS NOT NULL
      )
    )
  );

COMMIT;
