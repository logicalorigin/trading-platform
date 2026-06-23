-- Generic deployment event readers use:
--   SELECT * FROM execution_events
--   WHERE deployment_id = ?
--   ORDER BY occurred_at DESC
--   LIMIT n
--
-- The signal_options_* and overnight_spot_* partial indexes only help when the
-- query predicate includes those event-type prefixes. Deployment-only readers
-- such as /algo/events?deploymentId=... need the generic ordered deployment
-- index so they do not scan the global occurred_at index under a large mixed
-- event log.
CREATE INDEX CONCURRENTLY IF NOT EXISTS execution_events_deployment_occurred_idx
ON execution_events (deployment_id, occurred_at DESC);
