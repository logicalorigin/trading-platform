-- WO-IDX-1: bar_cache natural key — MANUAL APPLY, THREE PHASES, DO NOT RUN AS ONE SCRIPT.
-- Goal: per-insert index writes 4 -> 2 on the hottest write path; drop ~3.3GB of index structure
-- (pkey 826MB never scanned in the db's lifetime + instrument-keyed unique 2.5GB whose only role
-- is upsert arbitration, replaced by a symbol-keyed unique).
-- Evidence: session e2aac502 2026-07-09 (pg_stat lifetime idx_scan=0 on pkey; no inbound FKs;
-- no publications; Rust worker deletes by ctid; TS retention deletes by ctid as of 42514e81).
--
-- ══ PRE-FLIGHT (STOP GATES) — run when DB is quiet, AFTER the 2026-07-09 REINDEX finished ══
-- Gate 1: no in-flight reindex shadows:
--   select indexrelid::regclass from pg_index i join pg_class c on c.oid=i.indexrelid
--   where c.relname like 'bar_cache%_ccnew';                      -- MUST return 0 rows
-- Gate 2: definitive 1:1 proof on live rows (set statement_timeout=0; expect minutes):
--   select symbol from bar_cache group by symbol having count(distinct instrument_id) > 1; -- MUST be 0 rows
--   select instrument_id from bar_cache group by instrument_id having count(distinct symbol) > 1; -- MUST be 0 rows
--   If EITHER returns rows: ABORT the whole plan; the symbol quadruple is not a valid key.
--
-- ══ PHASE 1 (DDL, no code dependency, online) ══
CREATE UNIQUE INDEX CONCURRENTLY bar_cache_symbol_timeframe_source_starts_at_key
  ON bar_cache (symbol, timeframe, source, starts_at);
-- (fails atomically if any duplicate exists — that failure IS the abort signal)

-- ══ PHASE 2 — DEPLOY CODE FIRST (wo-idx-1-natural-key.md): upsert targets repointed to
--    (symbol,timeframe,source,starts_at); retention returning-id removed; drizzle schema updated.
--    Both unique indexes coexist during this window; either target resolves. Verify healthy ingest
--    (insert rate + zero 'no unique or exclusion constraint' errors) for >=30 min before Phase 3. ══

-- ══ PHASE 3 (DDL, only after Phase 2 verified) ══
DROP INDEX CONCURRENTLY bar_cache_instrument_timeframe_source_starts_at_idx;
DROP INDEX CONCURRENTLY bar_cache_symbol_timeframe_source_starts_at_idx;  -- superseded by the UNIQUE twin
ALTER TABLE bar_cache DROP CONSTRAINT bar_cache_pkey;                     -- brief ACCESS EXCLUSIVE
ALTER TABLE bar_cache DROP COLUMN id;                                     -- brief ACCESS EXCLUSIVE
-- End state: 2 indexes (the unique symbol quadruple + bar_cache_starts_at_idx).
-- instrument_id column + its outbound FK are KEPT (cheap, preserves lineage; revisit in the
-- signal-tables consolidation plan). Note: no code deletes instruments rows; if that ever changes,
-- the FK check will seq-scan bar_cache (no instrument-leading index remains).
-- Replica identity: table has no pkey afterward; it is in no publication today. If logical
-- replication is ever added: ALTER TABLE bar_cache REPLICA IDENTITY USING INDEX
-- bar_cache_symbol_timeframe_source_starts_at_key (all four columns are NOT NULL).
--
-- ══ ROLLBACK ══
-- Phase 1: DROP INDEX CONCURRENTLY bar_cache_symbol_timeframe_source_starts_at_key;
-- Phase 2: revert the code commit (old target's index still exists).
-- Phase 3 (hard): re-add id bigint identity + pkey and rebuild the instrument index CONCURRENTLY —
-- expensive; treat Phase 3 as the point of no easy return and take it only after a green soak day.
