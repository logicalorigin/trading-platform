-- ============================================================
-- 20260624_bar_cache_autovacuum_tuning.sql
--
-- Per-table autovacuum tuning for bar_cache (Layer 2 follow-on to
-- docs/plans/db-pool-saturation-index-fix.md).
--
-- bar_cache is a hot, ~10.6M-row append+upsert table with a ~3:1
-- update:insert profile (the /bars cache-miss path re-upserts recent rows).
-- Under the global default autovacuum_vacuum_scale_factor=0.2, autovacuum did
-- not fire until ~2.1M dead tuples had accumulated, so dead tuples sat at
-- ~6.4% (863,690 observed 2026-06-24) and bloated the working set that has to
-- fit the fixed "helium" shared instance. These per-table overrides make
-- autovacuum trigger at ~2% of the table (scale_factor 0.02) with a low
-- absolute floor (threshold 1000) and a higher cost limit so a run finishes
-- before the next churn cycle. After tuning, dead tuples fell to <1%
-- (98,683 / 10.6M observed) with autovacuum firing on its own.
--
-- ALREADY APPLIED LIVE 2026-06-24 (verified: pg_class.reloptions on bar_cache
-- carries exactly these five settings). This migration RATIFIES that live
-- change so it is durable across a DB reprovision/replay and is guarded by
-- scripts/src/market-data-schema-audit.ts (pnpm db:market-data:audit).
--
-- SAFE TO RUN LIVE / IN A TRANSACTION: ALTER TABLE ... SET (reloptions) is a
-- catalog-only change (no table rewrite, no data movement). It takes a brief
-- ACCESS EXCLUSIVE lock to update the catalog row, so it may wait behind an
-- in-flight statement on bar_cache for a moment; it does NOT need
-- statement_timeout=0 and, unlike the CONCURRENTLY index migrations, it MAY be
-- applied inside a transaction. Idempotent: re-running sets the same values.
--
--      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <thisfile>
-- ============================================================

ALTER TABLE bar_cache SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 1000,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 1000,
  autovacuum_vacuum_cost_limit = 2000
);
