-- Raw IBKR Flex statements are transient parsing inputs, not durable records.
-- Normalized account history and bounded run metadata remain authoritative.
BEGIN;

DO $purge$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'flex_report_runs'
      AND column_name = 'raw_xml'
  ) THEN
    UPDATE flex_report_runs
    SET raw_xml = NULL
    WHERE raw_xml IS NOT NULL;
  END IF;
END
$purge$;

ALTER TABLE flex_report_runs
DROP COLUMN IF EXISTS raw_xml;

COMMIT;
