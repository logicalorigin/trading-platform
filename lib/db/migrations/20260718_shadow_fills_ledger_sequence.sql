BEGIN;

LOCK TABLE shadow_fills IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE shadow_fills_ledger_sequence_migration_state
ON COMMIT DROP AS
SELECT EXISTS (
  SELECT 1
  FROM pg_attribute
  WHERE attrelid = 'shadow_fills'::regclass
    AND attname = 'ledger_sequence'
    AND NOT attisdropped
) AS already_installed;

ALTER TABLE shadow_fills
  ADD COLUMN IF NOT EXISTS ledger_sequence bigserial;

-- Existing UUIDs and transaction timestamps cannot recover the original order
-- of same-time fills. This deterministic legacy fallback establishes a stable
-- baseline; new fills receive their causal sequence after the account lock.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      ORDER BY account_id, occurred_at, created_at, id
    )::bigint AS ledger_sequence
  FROM shadow_fills
)
UPDATE shadow_fills AS fill
SET ledger_sequence = ranked.ledger_sequence
FROM ranked
WHERE fill.id = ranked.id
  AND NOT (
    SELECT already_installed
    FROM shadow_fills_ledger_sequence_migration_state
  );

SELECT setval(
  pg_get_serial_sequence('shadow_fills', 'ledger_sequence'),
  coalesce((SELECT max(ledger_sequence) FROM shadow_fills), 1),
  EXISTS (SELECT 1 FROM shadow_fills)
);

ALTER TABLE shadow_fills
  ALTER COLUMN ledger_sequence SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS shadow_fills_ledger_sequence_idx
  ON shadow_fills (ledger_sequence);

COMMIT;
