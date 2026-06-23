-- Mirror the signal-options hot-list partial index for Overnight Spot events.
-- The Algo page reads recent events by deployment, and a repaired deployment
-- can have hundreds of thousands of overnight_spot_* rows. Without this partial
-- index, those reads and maintenance moves can pin shared pool connections long
-- enough to starve control-panel saves.
CREATE INDEX CONCURRENTLY IF NOT EXISTS execution_events_overnight_deploy_occurred_idx
ON execution_events (deployment_id, occurred_at DESC)
WHERE event_type LIKE 'overnight_spot_%';
