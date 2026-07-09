# WO-RET-KEYSET — retention batched delete without the id-in anti-pattern

> **HEADLESS WORKER PREAMBLE:** Headless fix worker. No SESSION_HANDOFF_*, no ~/.claude//skills/
> agents reading, **no git**, no restarts, no DB maintenance against the live DB (tests use PGlite).
> Ponytail: smallest correct diff.

## Problem (evidence)
`lib/db/src/retention.ts` (~:340, pruneBarCache) batches deletes as
`delete from bar_cache where id in (select id from bar_cache where <deletable> limit N) returning id`.
Live pg_stat_user_indexes shows bar_cache_pkey has **idx_scan=0 over the database's lifetime** —
the planner never resolves the outer id-list via the pkey; each batch pays a heap-probing
hash/seq-scan against a multi-GB table. This is why 20k-row drain batches ran minutes each and one
failed outright during the 2026-07-09 manual drain.

## Approved fix
Rewrite the batched delete to resolve target rows by physical tuple id instead of the surrogate id:
`delete from bar_cache where ctid = any(array(select ctid from bar_cache where <deletable> limit N))`
(or the drizzle-compatible raw-SQL equivalent — this shape produces a TID Scan for the outer delete
and lets the inner scan keep using bar_cache_starts_at_idx via the starts_at/timeframe predicate).
Preserve EXACTLY: the deletable predicate semantics, batch size config, drain-to-done loop, hitCap
behavior, sweep-event emission, and the background DB lane (runInDbLane) from WO-RET-1 (11811b78).
Apply the same rewrite to any other prune helper in retention.ts that uses the id-in shape
(check pruneExecutionEventsDiagnostics added today by WO-EE-FIREHOSE — keep its allowlist/caps intact).
`returning` count semantics must stay equivalent (row count per batch drives the loop).

Note: ctid is only stable within a single statement — the select and delete MUST stay one statement
(as above). Do not select ctids in one round-trip and delete in another.

## Hard constraints
- Edit ONLY `lib/db/src/retention.ts` and `lib/db/src/retention.test.ts`.
- Behavior-equivalent except performance: same rows deleted for the same inputs, same events emitted.
- Tests: extend retention.test.ts to cover the new delete shape against PGlite, including a
  multi-batch drain and the cap path. Run ONLY that test file
  (`pnpm --filter @workspace/db exec node --import tsx --test src/retention.test.ts` — adjust to the
  actual runner used by neighboring lib/db tests; read package.json first). rc=75 = shared validation
  lock; wait 30s and retry.

## Deliverable
Report to `.codex-watch/run-wo-ret-keyset-report.md`: before/after SQL shapes, which helpers were
rewritten, test results. Final message ≤ 3 lines.
