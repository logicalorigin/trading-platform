-- execution_events receives a bounded diagnostic firehose and deletes it after
-- 48 hours. The default 20% thresholds let dead heap/TOAST pages linger after
-- each retention sweep; keep cleanup proportional to this churn instead.
-- Catalog-only and idempotent; no table rewrite or connection change.

ALTER TABLE execution_events SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 100,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 100,
  autovacuum_vacuum_cost_limit = 2000
);
