# WO-FIX-01 — Skip discarded rollup work when live-aggregate persistence is disabled

You are a codex worker in the PYRUS monorepo at /home/runner/workspace, implementing ONE fix.

IMPORTANT: Do NOT read or execute files under ~/.claude/, ~/.agents/, .claude/skills/, or agents/.
Do NOT modify agents/openai.yaml. Repository code only.

## Gate
- `git status --porcelain -- artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts artifacts/api-server/src/services/signal-monitor-local-bar-cache-rollup.test.ts` must show BOTH files modified (M). They carry in-flight work — DIRTY-file protocol below applies. If status differs, STOP and report.

## Operating discipline (binding)
- Ponytail: laziest correct fix; one guard at the shared root; no drive-by refactors; match style.
- Fact-first: read every function you touch end-to-end first; verify callers with grep.
- Surgical: every changed line traces to THIS finding.

## The finding (verified by orchestrator + profile evidence)
artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts — `enqueueRollups` (line ~1297,
sole caller `handleMassiveAggregate` ~1344) performs the recent-window scan + `rollupMinuteBars`
across ALL INTRADAY_TIMEFRAMES (clone/sort/group/allocate, limit:3 each) on EVERY incoming live
aggregate, then hands every produced bar to `queuePersist` (~736) which, when
`liveAggregatePersistEnabled()` is false (env `PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES`
unset — the LIVE state), discards it (increments `liveAggregatePersistSkipCount`, returns). Under
market-hours aggregate firehose this is pure discarded CPU+GC on the pinned event loop (profile:
GC 15.8%, aggregation cluster ~12-15%).

## Fix shape (required)
Add a single early-return guard at the TOP of `enqueueRollups`: when `!liveAggregatePersistEnabled()`,
record the skip cheaply (increment `liveAggregatePersistSkipCount` once and set
`lastLiveAggregatePersistSkippedAt` — same fields `queuePersist` maintains, so diagnostics stay
truthful) and return BEFORE the window scan. Keep `lastEnqueueScannedBarCount` semantics sane
(set it to 0 on the skip path only if a test/diagnostic reads it — check). Do NOT change
`queuePersist` behavior (it still guards for any other future caller). Do NOT touch the in-flight
dirty hunks elsewhere in these files.

## Test (required — extend the existing suite minimally)
artifacts/api-server/src/services/signal-monitor-local-bar-cache-rollup.test.ts uses
`__signalMonitorLocalBarCacheInternalsForTests` (`internals.reset()`, env-var save/restore pattern
at the top of each test). Add ONE test: with `PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES`
unset/false, ingesting an aggregate performs no rollup scan work (assert via the cheapest observable:
e.g. `lastEnqueueScannedBarCount` stays 0 / skip counter increments / no pending persist bars —
pick what the internals object already exposes; do not add new test-only exports unless nothing
observable exists, in which case extend `__signalMonitorLocalBarCacheInternalsForTests` minimally).
Existing tests set the env var explicitly where they need rollups — verify they still pass; if any
existing test relied on rollups running with the flag unset, set the flag in that test's setup
(that is the test encoding the OLD buggy behavior — fix the setup, not the guard).

## Verification (run, paste output)
`pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-local-bar-cache-rollup.test.ts src/services/signal-monitor-local-bar-cache.test.ts`
(both bar-cache test files; also run any other signal-monitor-local-bar-cache*.test.ts you see in
git status). All must pass. Do NOT run full suite/typecheck/build/app.

## Git rules (DIRTY-file protocol)
NO git write commands. Edit the working tree only. In your report include the EXACT unified diff
of your fix hunks (git diff output for both files is fine — but clearly separate YOUR hunks from
the pre-existing dirty hunks: produce `git diff -- <file>` BEFORE editing, save it mentally/notes,
and emit only the delta you introduced).

## Deliverable
Write EXACTLY ONE file: .codex-watch/wo-fix-01-report.md — what changed & why (2-4 sentences),
your fix-hunk unified diff, test output, anything out-of-scope discovered (report only).
