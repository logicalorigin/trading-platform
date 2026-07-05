-- Speed up peak-mark lookups used by shadow position stops and the marketing
-- shadow-dashboard stream.
--
-- Apply outside a transaction:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f lib/db/migrations/20260629_shadow_position_marks_peak_idx.sql

SET statement_timeout = 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS shadow_position_marks_position_mark_idx
  ON shadow_position_marks (position_id, mark DESC);

ANALYZE shadow_position_marks;
