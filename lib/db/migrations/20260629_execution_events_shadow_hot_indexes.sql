-- Speeds up shadow account/dashboard reads that scan the execution_events
-- ledger for signal-options shadow repair and latest mark events.
--
-- CONCURRENTLY: run outside a transaction with statement_timeout disabled:
--   PGOPTIONS="-c statement_timeout=0" psql "$DATABASE_URL" -f <this file>

CREATE INDEX CONCURRENTLY IF NOT EXISTS execution_events_shadow_entry_exit_occurred_idx
  ON execution_events (occurred_at DESC)
  WHERE event_type IN ('signal_options_shadow_entry', 'signal_options_shadow_exit');

CREATE INDEX CONCURRENTLY IF NOT EXISTS execution_events_shadow_mark_symbol_occurred_idx
  ON execution_events (symbol, occurred_at DESC)
  WHERE event_type = 'signal_options_shadow_mark';

ANALYZE execution_events;
