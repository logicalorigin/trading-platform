-- Durable provenance for the signal-options seen-signal sidecar. Unknown is
-- deliberately fail-closed: retained live rows can outlive their source event,
-- so orphaned legacy rows cannot safely be classified or discarded.
--
-- Deployment phase 1: apply this additive schema before deploying the writer
-- that explicitly maintains source_kind. Do not apply the phase-2 classifier
-- until every old writer has drained.
ALTER TABLE "signal_options_seen_signals"
  ADD COLUMN IF NOT EXISTS "source_kind" varchar(16) NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'signal_options_seen_signals_source_kind_chk'
      AND conrelid = 'signal_options_seen_signals'::regclass
  ) THEN
    ALTER TABLE "signal_options_seen_signals"
      ADD CONSTRAINT "signal_options_seen_signals_source_kind_chk"
      CHECK ("source_kind" IN ('live', 'historical', 'unknown'));
  END IF;
END $$;
