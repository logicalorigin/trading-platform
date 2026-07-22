-- Persist only runtime position-management state (ratcheted peak/stop and
-- quote provenance). This is separate from user-configured exit policy and
-- does not alter deployment or target activation.

BEGIN;

ALTER TABLE algo_target_positions
  ADD COLUMN IF NOT EXISTS management_state jsonb
    NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'algo_target_positions_management_state_chk'
      AND conrelid = 'algo_target_positions'::regclass
  ) THEN
    ALTER TABLE algo_target_positions
      ADD CONSTRAINT algo_target_positions_management_state_chk CHECK (
        jsonb_typeof(management_state) = 'object'
        AND octet_length(management_state::text) <= 16384
      );
  END IF;
END $$;

COMMENT ON COLUMN algo_target_positions.management_state IS
  'Durable runtime state for managing this exact algo-owned provider position; never a user settings source.';

COMMIT;
