# WO-FIX-11 Report

## Scope / Clean Check

- Observed before edits: `git status --short -- artifacts/api-server/src/services/signal-monitor.ts ...` returned no entry for `signal-monitor.ts`; the file was clean before this work.
- Touched paths:
  - `artifacts/api-server/src/services/signal-monitor.ts`
  - `artifacts/api-server/src/services/signal-monitor-stream.test.ts`
  - `artifacts/api-server/src/services/signal-monitor-backfill-base.test.ts`

## FIX A Hunk Set — Server-Owned Producer Profile Refresh

Observed source trace:

- `refreshSignalMonitorServerOwnedProducers()` already reloads enabled profiles with `listEnabledSignalMonitorProfiles()` on the 60s producer refresh cycle.
- `registerSignalMonitorServerOwnedProducer()` stored a synthetic subscriber containing `profile`, but its reuse guard only compared `symbolKey`.
- Therefore a settings save that changed profile fields without changing the universe kept the old synthetic subscriber/profile.
- Existing nearby worker pattern uses a JSON profile/deployment signature and resets runtime when that signature changes; no new cross-module infrastructure was required.

Change:

- Added `signalMonitorServerOwnedProducerProfileSignature()` over the fields that affect producer evaluation/persistence: id, environment, enabled, watchlist, timeframe, `pyrusSignalsSettings`, freshness, poll interval, max symbols, and concurrency.
- Extended `signalMonitorServerOwnedProducers` entries with `profileSignature`.
- Re-registers the synthetic producer subscriber when the same universe has a changed profile signature; unchanged universe + unchanged profile still only re-primes the aggregate stream.

Regression test:

- Added `server-owned producer replaces same-universe subscriber after profile settings change` in `signal-monitor-stream.test.ts`.
- It registers the same scope twice with changed `pyrusSignalsSettings`, emits the next aggregate evaluation, and asserts the evaluator receives the updated profile.

## FIX B Hunk Set — Backfill Refresh Catch + Diagnostics

Observed source trace:

- `refreshSignalMonitorBackfilledBaseBars()` had `try/finally` but no top-level `catch`.
- Both call sites invoke it with bare `void`, so a rejection before/around the inner per-cell best-effort catches could surface as an unhandled/background rejection.
- The module already records signal-monitor background DB/persistence failures through `recordSignalMonitorDbFallback()`.

Change:

- Added a top-level `catch` inside `refreshSignalMonitorBackfilledBaseBars()` and do not rethrow.
- Records:
  - `signalMonitorBackfillRefreshDiagnostics.failureCount`
  - `lastError`
  - `lastErrorAt`
  - `lastDiagnostic` from `recordSignalMonitorDbFallback()`
- Uses operation `refresh_signal_monitor_backfilled_base_bars` and source status `backfill-refresh-failed`.
- Passed producer/local-warmup environment into the refresh so diagnostics can include environment.
- Added a test-only seam for the grouped prefetch layer so a deterministic refresh-level rejection can be asserted without changing production call sites.

Regression test:

- Added `backfilled base refresh swallows grouped prefetch rejection and records diagnostics` in `signal-monitor-backfill-base.test.ts`.
- It forces the grouped prefetch layer to reject, asserts the refresh resolves, and checks the diagnostic count/message/operation/environment/source status.

## Validation Output

Command:

```text
pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-backfill-base.test.ts
```

Output:

```text
{"level":40,"time":1783544970720,"pid":317494,"hostname":"repl","err":{"type":"Error","message":"prefetch rejected for test","stack":"Error: prefetch rejected for test\n    at runWithStoredBarsPrefetch (/home/runner/workspace/artifacts/api-server/src/services/signal-monitor-backfill-base.test.ts:236:17)\n    at refreshSignalMonitorBackfilledBaseBars (/home/runner/workspace/artifacts/api-server/src/services/signal-monitor.ts:5654:13)\n    at TestContext.<anonymous> (/home/runner/workspace/artifacts/api-server/src/services/signal-monitor-backfill-base.test.ts:227:5)\n    at Test.runInAsyncScope (node:async_hooks:214:14)\n    at Test.run (node:internal/test_runner/test:1106:25)\n    at Test.processPendingSubtests (node:internal/test_runner/test:788:18)\n    at Test.postRun (node:internal/test_runner/test:1235:19)\n    at Test.run (node:internal/test_runner/test:1163:12)\n    at async Test.processPendingSubtests (node:internal/test_runner/test:788:7)"},"dbError":{"name":"Error","message":"prefetch rejected for test","code":null},"operation":"refresh_signal_monitor_backfilled_base_bars","environment":"shadow","sourceStatus":"backfill-refresh-failed","transient":false,"poolContention":false,"symbolCount":1,"timeframeCount":1,"msg":"Signal monitor backfilled base refresh failed"}
✔ merging a deep base under a shallow live edge yields a deeper series (0.979351ms)
✔ the live edge wins on a same-timestamp collision with the base (0.130405ms)
✔ empty base preserves prior live-only behavior (0.592044ms)
✔ stream promotion advances intraday backfilled base with the evaluated series (2.262572ms)
✔ stream promotion does not turn daily stream output into a backfilled base (2.896544ms)
✔ due-cell selection caps per cycle and refreshes the most-overdue first (0.346814ms)
✔ due-cell prefetch grouping keeps symbols scoped to their due timeframe (0.214711ms)
✔ backfilled base refresh swallows grouped prefetch rejection and records diagnostics (32.299628ms)
✔ pressure-high skips the backfill cycle; watch/normal keep running (0.191109ms)
✔ idle-session producer backfill skips when no aggregate can consume it (0.386339ms)
✔ active-market producer backfill stays enabled before first aggregate (0.081493ms)
✔ price trace explains daily rows marked stale by the policy window (0.735317ms)
✔ price trace distinguishes current rows from stale stored status (0.144431ms)
✔ backfill cadence is slow and the concurrency budget is small and dedicated (0.061077ms)
ℹ tests 14
ℹ suites 0
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8344.034797
```

Command:

```text
pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-stream.test.ts
```

Output excerpt:

```text
✔ server-owned producer evaluates bar-close ticks with no UI subscriber (0.675948ms)
✔ server-owned producer replaces same-universe subscriber after profile settings change (0.472236ms)
✔ server-owned producer subscriber does not count as real (0.13684ms)
ℹ tests 41
ℹ suites 0
ℹ pass 41
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 27587.712135
```

Command:

```text
pnpm --filter @workspace/api-server run typecheck
```

Output:

```text
> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit
```

## Notes

- No commit made.
- No `.claude/skills`, `~/.claude`, or `agents` paths were accessed.
