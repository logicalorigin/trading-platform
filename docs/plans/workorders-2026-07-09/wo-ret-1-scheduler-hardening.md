# WO-RET-1 — Retention scheduler: restart-resilient, drain-to-done on backlog

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** Headless fix worker. No
> SESSION_HANDOFF_* writes; don't read ~/.claude/, .claude/skills/, agents/, AGENTS.md session
> sections. NEVER restart/reload/signal the app, never `git push`, never run manual DB deletes
> (a manual drain is already running separately). 2-core live box: only the listed validations.
> Edit ONLY listed files; if dirty from another lane, wait 60s ×10 then BLOCKED. Never `git add -A`.
> index.lock → sleep 10s, retry. Minimum diff; reuse the file's patterns.

## Measured failure (2026-07-09)

`startSnapshotRetentionScheduler` (artifacts/api-server/src/services/snapshot-retention-scheduler.ts)
waits INITIAL_DELAY_MS=5min then runs every DEFAULT_INTERVAL_MS=6h, each sweep bounded
(DEFAULT_BAR_CACHE_MAX_ROWS_PER_RUN=1M, lib/db/src/retention.ts:270). Today the API restarted ~12×;
the 6h timer never survived to a second sweep and initial sweeps were interrupted/bounded → only
~700k of a 3.3M-row bar_cache backlog drained in 20h; the 8.3GB table kept 5m/15m signal reads slow
(measured 2.2s for a 1000-row indexed read). A manual drain is clearing the current backlog; this
WO makes the scheduler survive restart churn so it never regrows.

## Mandate

1. **Drain-to-done**: after a sweep that deletes exactly its row cap (i.e., backlog remains),
   schedule the next sweep after a SHORT backoff (env `SNAPSHOT_RETENTION_BACKLOG_INTERVAL_MS`,
   default 10min) instead of the full 6h; return to the 6h cadence once a sweep deletes < cap.
2. **Faster first sweep**: INITIAL_DELAY_MS env-overridable (`SNAPSHOT_RETENTION_INITIAL_DELAY_MS`),
   default stays 5min (startup settle is legitimate) — but if the PREVIOUS sweep this process ran
   hit its cap, rule 1 applies from the first sweep.
3. **Observability**: emit a flight-recorder event per sweep (find how other subsystems write
   events — the persist unit / diagnostics do) with {table, deleted, hitCap, durationMs} — today's
   sweeps were invisible to the events log, which is why the failure went unnoticed.
4. **Lane**: run sweeps inside `runInDbLane("background", ...)` (available from @workspace/db since
   commit 2fda13f3).

## Tests
Extend the scheduler's/retention's existing tests: cap-hit → short-interval rescheduling; under-cap
→ normal cadence; event emission shape. (Timer logic testable with injected runOnce/clock per the
file's structure — restructure minimally if needed.)

## Validation
1. `pnpm --filter @workspace/api-server run typecheck` → EXIT 0.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit <touched test files>` → 0 fail.

## Files you may touch
- `artifacts/api-server/src/services/snapshot-retention-scheduler.ts` (+ its test)
- `lib/db/src/retention.ts` ONLY if the sweep result doesn't already expose deleted/hitCap (+ its test)

## Commit
`perf(retention): drain-to-done scheduling + sweep events — restart churn can no longer starve bar_cache pruning (WO-RET-1)` + 3-5 evidence lines.

Do NOT push. Report: `.codex-watch/wo-ret-1-report.md`; final message 3 lines.
