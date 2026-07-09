# WO-IDX-1 — repoint bar_cache upserts to the symbol-keyed natural key (Phase 2 code)

> **HEADLESS WORKER PREAMBLE:** Headless fix worker. No SESSION_HANDOFF_*, no ~/.claude//skills/
> agents reading, **no git**, no restarts, NO DDL — the DDL phases are manual
> (lib/db/migrations/20260710_bar_cache_natural_key.sql). Ponytail: smallest correct diff.
>
> **DISPATCH GATE (leader checks, not you):** Phase 1 of the migration has been applied — the
> UNIQUE index bar_cache_symbol_timeframe_source_starts_at_key EXISTS in the live DB — and the
> 1:1 pre-flight proof returned 0 rows. Do not proceed on the code alone.

## Change set
1. `artifacts/api-server/src/services/market-data-store.ts` — the three
   `onConflictDoUpdate` targets currently `[barCacheTable.instrumentId, timeframe, source,
   startsAt]` (~:1224, :1384, :1592) become `[barCacheTable.symbol, timeframe, source, startsAt]`.
   NOTHING else about the upserts changes (set/setWhere/returning stay byte-identical —
   the F1-DELTA change classification depends on those returning rows).
2. `lib/db/src/schema/market-data.ts` — barCacheTable: add the uniqueIndex
   bar_cache_symbol_timeframe_source_starts_at_key on (symbol,timeframe,source,startsAt); mark the
   OLD instrument uniqueIndex and the old non-unique symbol index and the id primaryKey with
   removal comments referencing the migration file (drizzle schema must describe the END state —
   coordinate: schema reflects Phase 3, so gate this file's index removals behind the same commit
   as the code retarget ONLY if the leader confirms Phase 3 timing; otherwise add the new unique
   index and leave removals for a follow-up commit. ASK via your report rather than guessing.)
3. `lib/db/src/retention.ts` — pruneBarCache's `returning ${t.id}` (and ONLY bar_cache's helper)
   must stop referencing id: return a constant (`returning 1`) or use rows_affected; keep the
   count-driven loop semantics identical.
4. Tests: extend market-data-store-pglite.test.ts (upsert conflict on the symbol quadruple:
   same-key upsert updates instead of duplicating; PGlite needs the new unique index in the test
   schema bootstrap) and retention.test.ts (bar_cache prune still counts batches correctly).

## Hard constraints
- Files: ONLY the four named above.
- The PGlite test schema must create BOTH unique indexes (transition state) so the off/on conflict
  targets both resolve during the Phase 2 window.
- Validation: api-server typecheck, lib/db tsc, ONLY the touched test files. rc=75 = shared
  validation lock; wait 30s, retry.

## Deliverable
Report to `.codex-watch/run-wo-idx-1-report.md`: exact hunks, the schema-file decision you took per
item 2, test results. Final message ≤ 4 lines.
