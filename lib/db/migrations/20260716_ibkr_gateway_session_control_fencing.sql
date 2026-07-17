-- Persist the replacement fence while the fleet is disabled. Database time alone
-- must not authorize reuse until capsule hosts durably enforce the propagated
-- monotonic expiry.

BEGIN;

ALTER TABLE ibkr_gateway_sessions
  ADD COLUMN control_attempt_id uuid,
  ADD COLUMN control_acknowledged_at timestamptz,
  ADD COLUMN replacement_deadline_at timestamptz;

UPDATE ibkr_gateway_sessions
SET replacement_deadline_at = GREATEST(
  clock_timestamp() + interval '155 seconds',
  lease_expires_at + interval '125 seconds'
)
WHERE host_id IS NOT NULL;

ALTER TABLE ibkr_gateway_sessions
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
      AND replacement_deadline_at >= lease_expires_at + interval '125 seconds'
      AND (
        control_acknowledged_at IS NULL
        OR control_attempt_id IS NOT NULL
      )
    )
  );

COMMIT;
