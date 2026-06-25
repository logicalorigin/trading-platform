-- Composite index for the "latest mark per position" lookup that dominates
-- GET /accounts/shadow/positions (readLatestShadowPositionBaselineMarks,
-- shadow-account.ts): per requested position it does
--   WHERE position_id = $X AND as_of <= $cutoff ORDER BY as_of DESC, created_at DESC LIMIT 1
-- shadow_position_marks is an append-only, no-retention log (~563k rows / 115 MB,
-- ~735 marks/position, one position has 28k). With only single-column indexes the
-- planner scans the as_of index backward and discards every OTHER position's marks
-- (Rows Removed by Filter), per position, per page load -> ~15s live. This
-- composite lets a backward index scan jump straight to the position's latest
-- mark in the as_of/created_at order, turning the per-position scan into a seek.
--
-- Subsumes the single-column shadow_position_marks_position_idx (left in place for
-- now; drop in a later redundant-index cleanup after a verification window).
--
-- APPLY CONSTRAINTS: CREATE INDEX CONCURRENTLY cannot run in a transaction, and the
-- server default statement_timeout would cancel a long build and leave an INVALID
-- index. Apply with PGOPTIONS="-c statement_timeout=0" via `psql -f`, never with
-- --single-transaction. Post-apply, check: SELECT * FROM pg_index WHERE NOT indisvalid;
CREATE INDEX CONCURRENTLY IF NOT EXISTS shadow_position_marks_position_as_of_idx
  ON shadow_position_marks (position_id, as_of, created_at);
