# 2026-05-29 Signal-Options Contract Starvation Fix

## DEBUG REPORT

- Symptom: after fresh Pyrus Signals candidates arrived, the signal-options cockpit kept reporting contract selection as waiting/running with no selected contracts.
- Root cause: `runSignalOptionsShadowScanUnlocked` spent the worker action budget on open-position mark refreshes before candidate processing. When option marks were stale/unavailable, the worker could exhaust the 20s action budget and store the action cursor back in the `positions` phase, so the next tick retried marks again instead of reaching fresh candidate contract resolution.
- Live evidence: the deployment had 5 fresh candidates with `selectedContract: null` and 4 active positions. Recent events showed position mark skips for HOOD, SQQQ, and RTX due stale/unavailable option quotes. The small state request itself took about 20s, matching the worker action budget.
- Fix: reserve a bounded signal-candidate action window after position-mark budget exhaustion when actionable signals remain. Deferred/unprocessed positions are still treated as degraded so execution safety can block entries with `position_mark_feed_degraded`; the change prevents the UI and event stream from staying empty at the contract stage.
- Files: `artifacts/api-server/src/services/signal-options-automation.ts`, `artifacts/api-server/src/services/signal-options-automation.test.ts`.
- Regression test: `signal-options detects pending actionable states after a worker cursor` plus the updated source-order guard for signal reserve behavior.
- Validation:
  - `node --import tsx --test src/services/signal-options-automation.test.ts` from `artifacts/api-server` passed, 93/93.
  - `pnpm --filter @workspace/api-server run typecheck` passed.
- Status: DONE_WITH_CONCERNS. The running Replit API process still needs the usual app rebuild/restart path before this code is live in `dist/index.mjs`; no manual restart was performed during this fix.
