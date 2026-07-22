-- Replace duplicate target-allocation/account-ceiling write semantics with one
-- typed allowance at each scope. Existing percentages retain their exact unit
-- and value. Every target is explicitly execution-disabled after migration;
-- configuration and later live activation are separate actions.

BEGIN;

ALTER TABLE algo_deployment_targets
  ADD COLUMN IF NOT EXISTS allowance_unit varchar(16),
  ADD COLUMN IF NOT EXISTS allowance_value numeric(20, 6),
  ADD COLUMN IF NOT EXISTS execution_enabled boolean NOT NULL DEFAULT false;

UPDATE algo_deployment_targets
SET
  allowance_unit = 'percent',
  allowance_value = allocation_percent
WHERE (allowance_unit IS NULL OR allowance_value IS NULL)
  AND allocation_percent IS NOT NULL;

ALTER TABLE algo_deployment_targets
  ALTER COLUMN allowance_unit SET NOT NULL,
  ALTER COLUMN allowance_value SET NOT NULL,
  ALTER COLUMN allocation_percent DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'algo_deployment_targets_allowance_chk'
      AND conrelid = 'algo_deployment_targets'::regclass
  ) THEN
    ALTER TABLE algo_deployment_targets
      ADD CONSTRAINT algo_deployment_targets_allowance_chk CHECK (
        allowance_unit IN ('usd', 'percent')
        AND allowance_value > 0
        AND (
          (allowance_unit = 'usd' AND allowance_value <= 10000000)
          OR (allowance_unit = 'percent' AND allowance_value <= 100)
        )
      );
  END IF;
END $$;

ALTER TABLE algo_account_controls
  ADD COLUMN IF NOT EXISTS total_algo_allowance_unit varchar(16),
  ADD COLUMN IF NOT EXISTS total_algo_allowance_value numeric(20, 6);

UPDATE algo_account_controls
SET
  total_algo_allowance_unit = 'percent',
  total_algo_allowance_value = hard_ceiling_percent
WHERE (
    total_algo_allowance_unit IS NULL
    OR total_algo_allowance_value IS NULL
  )
  AND hard_ceiling_percent IS NOT NULL;

ALTER TABLE algo_account_controls
  ALTER COLUMN total_algo_allowance_unit SET NOT NULL,
  ALTER COLUMN total_algo_allowance_value SET NOT NULL,
  ALTER COLUMN hard_ceiling_percent DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'algo_account_controls_allowance_chk'
      AND conrelid = 'algo_account_controls'::regclass
  ) THEN
    ALTER TABLE algo_account_controls
      ADD CONSTRAINT algo_account_controls_allowance_chk CHECK (
        total_algo_allowance_unit IN ('usd', 'percent')
        AND total_algo_allowance_value > 0
        AND (
          (
            total_algo_allowance_unit = 'usd'
            AND total_algo_allowance_value <= 10000000
          )
          OR (
            total_algo_allowance_unit = 'percent'
            AND total_algo_allowance_value <= 100
          )
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN algo_deployment_targets.allocation_percent IS
  'Deprecated read-only compatibility value; allowance_unit/value are canonical.';
COMMENT ON COLUMN algo_account_controls.hard_ceiling_percent IS
  'Deprecated read-only compatibility value; total_algo_allowance_unit/value are canonical.';
COMMENT ON COLUMN algo_deployment_targets.execution_enabled IS
  'Separate per-target live activation gate. Assignment/configuration never enables it.';

COMMIT;
