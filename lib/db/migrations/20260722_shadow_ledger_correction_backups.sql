BEGIN;

CREATE TABLE IF NOT EXISTS shadow_ledger_correction_backups (
  correction_id uuid NOT NULL,
  table_name text NOT NULL,
  row_id text NOT NULL,
  row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (correction_id, table_name, row_id)
);

CREATE INDEX IF NOT EXISTS shadow_ledger_correction_backups_created_idx
  ON shadow_ledger_correction_backups (backed_up_at DESC);

COMMIT;
