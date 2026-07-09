# WO-SO-03 P4 Re-Entry Watch Report

## Gate

- Observed `.codex-watch/wo-so-02-p2-dual-confirm-report-2026-07-07.md` exists, so the WO-SO-03 gate passed.

## Design Decisions

- Added `exitPolicy.reEntryWatch` to `lib/backtest-core/src/signal-options.ts`:
  - `enabled: false`
  - `watchWindowBars: 6`
  - `maxReEntriesPerSignal: 1`
  - Supports nested `exitPolicy.reEntryWatch` and root deployment keys.
- Watch entries are event-payload state, not a new table. Full exits with reason `early_invalidation` or `hard_stop` emit `payload.reEntryWatch` only when the policy is enabled.
- The folded automation state now tracks `reEntryWatches` beside active positions. Default-off state responses do not add a top-level `reEntryWatches` field.
- Re-validation runs in the normal entry scan. A watched setup can bypass only the `seenSignals.has(signalKey)` skip when:
  - the current signal is actionable,
  - symbol, timeframe, and direction match the watch,
  - bars since exit are within `watchWindowBars`,
  - `reEntries < maxReEntriesPerSignal`.
- All existing entry gates still run after the bounded seen-signal bypass: same-position/flip logic, MTF/actionability, liquidity, session, budget, allowance, and contract selection.
- Re-entry entries emit `payload.reEntry: true` and the consumed `payload.reEntryWatch`; the consumed watch increments `reEntries`. Contract selection is unchanged, so re-entry always resolves a fresh contract instead of reopening the decayed one.

## Test Evidence

- Red step observed: `signal-options-reentry-watch.test.ts` initially failed because `buildSignalOptionsReEntryWatchFromExit` was missing.
- `cd artifacts/api-server && pnpm exec tsx --test src/services/signal-options-reentry-watch.test.ts` passed.
- `cd artifacts/api-server && pnpm exec tsx --test ../../lib/backtest-core/src/signal-options.test.ts src/services/signal-options-reentry-watch.test.ts` passed.
- `pnpm --filter @workspace/backtest-core exec tsc --noEmit` passed.
- `pnpm --filter @workspace/backtest-core exec tsc -p tsconfig.json` passed and refreshed local declarations for API typecheck.
- `pnpm --filter @workspace/api-server run typecheck` passed.
- Requested API suite passed:
  - `cd artifacts/api-server && pnpm exec tsx --test src/services/signal-options-reentry-watch.test.ts src/services/signal-options-scale-out.test.ts src/services/signal-options-opposite-dual-confirm.test.ts src/services/signal-options-automation.test.ts`
  - Result: 67 passing, 0 failing.

## Diff Stat

P4-focused stat:

```text
 .../src/services/signal-options-automation.ts      | 1170 +++++++++++++++++---
 lib/backtest-core/src/signal-options.test.ts       |  118 +-
 lib/backtest-core/src/signal-options.ts            |  145 +++
 .../services/signal-options-reentry-watch.test.ts  |  291 +++++++++++++++++++++
```

Note: `signal-options-automation.ts`, `signal-options.test.ts`, and `signal-options.ts` already contained P1/P2/P3 uncommitted work, so the tracked-file stat includes prior scoped lane changes as well as this P4 work.

## Deferred Items

- Review-script re-entry count line deferred. Adding a real count requires a new query plus summary/markdown shape changes, which is not the trivial sub-10-line addition requested for opportunistic observability.
- No new scheduler, DB table, deployment flag, or Replit startup/config change.
