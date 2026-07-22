-- First-class Algo deployment kinds and immutable configuration versions.
-- Account targets and allowances intentionally remain separate operational
-- controls. This migration does not enable a deployment or arm a target.

BEGIN;

ALTER TABLE algo_deployments
  ADD COLUMN IF NOT EXISTS kind varchar(32),
  ADD COLUMN IF NOT EXISTS draft_version_id uuid,
  ADD COLUMN IF NOT EXISTS active_version_id uuid;

ALTER TABLE algo_deployments
  ALTER COLUMN strategy_id DROP NOT NULL;

-- Infer the two currently supported deployment kinds using the same markers as
-- the existing runtime, including the canonical source written by the legacy
-- overnight-profile repair path.
UPDATE algo_deployments
SET kind = CASE
  WHEN config ? 'overnightSpot'
    OR config -> 'parameters' ? 'overnightSpotTrading'
    OR config -> 'parameters' ? 'overnightSpot'
    OR config ->> 'source' IN (
      'overnight_spot_manual',
      'overnight_spot_repaired'
    )
    THEN 'overnight_spot'
  WHEN config -> 'parameters' ->> 'executionMode' = 'signal_options'
    OR config ? 'signalOptions'
    THEN 'signal_options'
  ELSE NULL
END
WHERE kind IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM algo_deployments WHERE kind IS NULL) THEN
    RAISE EXCEPTION
      'Cannot infer kind for every algo deployment; migration aborted without changing activation state.';
  END IF;
END $$;

ALTER TABLE algo_deployments
  ALTER COLUMN kind SET DEFAULT 'signal_options',
  ALTER COLUMN kind SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'algo_deployments_kind_chk'
  ) THEN
    ALTER TABLE algo_deployments
      ADD CONSTRAINT algo_deployments_kind_chk
      CHECK (kind IN ('signal_options', 'overnight_spot'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS algo_deployments_kind_idx
  ON algo_deployments (kind);

CREATE TABLE IF NOT EXISTS algo_deployment_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES algo_deployments(id),
  version_number integer NOT NULL,
  kind varchar(32) NOT NULL,
  name text NOT NULL,
  symbol_universe jsonb NOT NULL,
  config jsonb NOT NULL,
  content_hash varchar(64) NOT NULL,
  source varchar(32) NOT NULL,
  source_strategy_id uuid REFERENCES algo_strategies(id) ON DELETE SET NULL,
  parent_version_id uuid REFERENCES algo_deployment_versions(id),
  created_by_app_user_id uuid REFERENCES users(id),
  change_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT algo_deployment_versions_kind_chk
    CHECK (kind IN ('signal_options', 'overnight_spot')),
  CONSTRAINT algo_deployment_versions_source_chk
    CHECK (source IN ('scratch', 'backtest', 'edit', 'restore', 'migration', 'system')),
  CONSTRAINT algo_deployment_versions_number_chk
    CHECK (version_number > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS algo_deployment_versions_number_key
  ON algo_deployment_versions (deployment_id, version_number);

CREATE UNIQUE INDEX IF NOT EXISTS algo_deployment_versions_deployment_id_key
  ON algo_deployment_versions (deployment_id, id);

CREATE INDEX IF NOT EXISTS algo_deployment_versions_created_idx
  ON algo_deployment_versions (deployment_id, created_at DESC);

INSERT INTO algo_deployment_versions (
  deployment_id,
  version_number,
  kind,
  name,
  symbol_universe,
  config,
  content_hash,
  source,
  source_strategy_id,
  created_by_app_user_id,
  change_summary,
  created_at
)
SELECT
  deployment.id,
  1,
  deployment.kind,
  deployment.name,
  deployment.symbol_universe,
  deployment.config,
  md5(
    jsonb_build_object(
      'kind', deployment.kind,
      'name', deployment.name,
      'symbolUniverse', deployment.symbol_universe,
      'config', deployment.config
    )::text
  ),
  'migration',
  deployment.strategy_id,
  deployment.app_user_id,
  'Backfilled existing deployment configuration.',
  deployment.updated_at
FROM algo_deployments AS deployment
ON CONFLICT (deployment_id, version_number) DO NOTHING;

UPDATE algo_deployments AS deployment
SET
  draft_version_id = version.id,
  active_version_id = CASE WHEN deployment.enabled THEN version.id ELSE NULL END
FROM algo_deployment_versions AS version
WHERE version.deployment_id = deployment.id
  AND version.version_number = 1
  AND deployment.draft_version_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'algo_deployments_draft_version_fk'
  ) THEN
    ALTER TABLE algo_deployments
      ADD CONSTRAINT algo_deployments_draft_version_fk
      FOREIGN KEY (id, draft_version_id)
      REFERENCES algo_deployment_versions(deployment_id, id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'algo_deployments_active_version_fk'
  ) THEN
    ALTER TABLE algo_deployments
      ADD CONSTRAINT algo_deployments_active_version_fk
      FOREIGN KEY (id, active_version_id)
      REFERENCES algo_deployment_versions(deployment_id, id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

COMMIT;
