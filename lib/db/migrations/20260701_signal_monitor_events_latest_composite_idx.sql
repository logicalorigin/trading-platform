-- Composite index for the latest-trusted-event lookup:
--   DISTINCT ON (symbol, timeframe) ... WHERE profile_id = $1 AND direction IN ('buy','sell')
--   AND close IS NOT NULL ORDER BY symbol, timeframe, signal_at DESC
-- (listLatestTrustedSignalMonitorEventsForProfile). With only signal_monitor_events_profile_idx
-- (one canonical profile per environment) the planner scanned + in-memory-sorted the whole table;
-- at a 2000-symbol universe (~4x the event insert rate) that scan+sort risks the 15s statement
-- timeout. This lets the DISTINCT ON walk the index in (symbol, timeframe, signal_at DESC) order.
CREATE INDEX CONCURRENTLY IF NOT EXISTS signal_monitor_events_profile_symbol_tf_signal_at_idx
  ON signal_monitor_events (profile_id, symbol, timeframe, signal_at DESC);
