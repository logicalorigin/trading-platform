-- Manual apply only. App reload/start does not run lib/db/migrations.
-- The transaction preserves every removed row in the dated archive table before
-- enforcing the natural key. If any archive/delete/index step fails, all steps
-- roll back together.
BEGIN;

LOCK TABLE balance_snapshots IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS balance_snapshots_duplicate_archive_20260716
  (LIKE balance_snapshots INCLUDING DEFAULTS);

ALTER TABLE balance_snapshots_duplicate_archive_20260716
  ADD COLUMN IF NOT EXISTS duplicate_rank integer,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS balance_snapshots_duplicate_archive_20260716_id_idx
  ON balance_snapshots_duplicate_archive_20260716 (id);

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY account_id, as_of
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS duplicate_rank
  FROM balance_snapshots
)
INSERT INTO balance_snapshots_duplicate_archive_20260716 (
  id,
  account_id,
  currency,
  cash,
  buying_power,
  net_liquidation,
  maintenance_margin,
  as_of,
  created_at,
  updated_at,
  duplicate_rank
)
SELECT
  duplicate.id,
  duplicate.account_id,
  duplicate.currency,
  duplicate.cash,
  duplicate.buying_power,
  duplicate.net_liquidation,
  duplicate.maintenance_margin,
  duplicate.as_of,
  duplicate.created_at,
  duplicate.updated_at,
  ranked.duplicate_rank
FROM balance_snapshots AS duplicate
INNER JOIN ranked ON ranked.id = duplicate.id
WHERE ranked.duplicate_rank > 1
ON CONFLICT (id) DO NOTHING;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY account_id, as_of
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS duplicate_rank
  FROM balance_snapshots
)
DELETE FROM balance_snapshots AS duplicate
USING ranked
WHERE duplicate.id = ranked.id
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS balance_snapshots_account_as_of_unique_idx
  ON balance_snapshots (account_id, as_of);

COMMIT;
