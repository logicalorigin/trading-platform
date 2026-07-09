# Landing manifest — time-semantics / signal-age lane (2026-07-07)

Owner: session `03a2bec8` (resumed `dbf9de08`). Purpose: hunk-level attribution of the
shared dirty tree so this lane can land in themed commits without staging other live
lanes' WIP. Attribution basis: diff marker comments + file mtimes + lane handoffs.
Verify each ⚠ before staging. Sibling lanes live NOW: `ea30b14a` (signal-options,
resumed 4f0c846b), `03f2c018` (work-orders, resumed f68a9158), Codex overnight-expectancy.

## Commit 1 — feat(market-calendar): trading-day + RTH-bar utilities
- `lib/market-calendar/src/index.ts` (+188: tradingDaysBetween, previousTradingDayOrSame, addTradingDays, rthBarsBetween, rthBarsBack)
- `lib/market-calendar/src/index.test.mjs` (+152, 15/15)
- `pnpm-lock.yaml`, `lib/backtest-core/package.json` (market-calendar dep)

## Commit 2 — fix(api): market-time correctness adoption (Wave-2 C1–C4, F3/F4/F6/F7/F8)
- `artifacts/api-server/src/services/backtesting.ts` (C1 trading-day DTE) + `backtesting-dte.test.ts` (new)
- `lib/backtest-core/src/option-greek-selector.ts` + `.test.ts` (F8 DST-correct expiry close)
- `artifacts/api-server/src/services/signal-options-automation.ts` — ONLY the hunks marked `Wave-2 C1/C2/C3/C4` (import block, daysBetweenUtc→tradingDaysBetween in selectSignalOptionsExpiration, session predicates, marketDateKey loss-halt, backfill dates). ⚠ hunk-split: same file carries signal-options lane's Fix C/tally WIP — do not stage those.
- `artifacts/api-server/src/services/shadow-account.ts` — F3 (rthBarsBack warmup) + F4 (trading-day helpers) hunks. ⚠ hunk-split: file also has exit-dedup work (new `shadow-account-signal-options-exit-dedup.test.ts` appeared 2026-07-07 evening — likely signal-options lane; verify).
- `artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts` + `.test.ts` + `-rollup.test.ts` (F6 120h retention, F7 session-aware rollup)
- `artifacts/api-server/src/services/signal-options-greek-trail.test.ts`, `signal-options-overnight-exit.test.ts`, `signal-options-trailing-ratchet.test.ts` (updated expectations)

## Commit 3 — feat(api): prior-session actionability block (provisional) + C5 seam fix
- `artifacts/api-server/src/services/signal-monitor-actionability.ts` + `.test.ts` (SIGNAL_MONITOR_BLOCK_PRIOR_SESSION_ENTRIES flag + gate)
- `artifacts/api-server/src/services/signal-monitor.ts` — prior-session hunks only: `signalMonitorCurrentSessionOpenAtNow` (memo + export), quiet-session call sites. ⚠ hunk-split: file also carries census B1/B2/B4 hunks (commit 5) and possibly events-cache residue.
- `artifacts/api-server/src/services/signal-options-automation.ts` — the C5 hunk (sessionOpenAt via monitor helper) + `signal-options-automation.test.ts` seam pin (line ~24) and updated blocker expectations.

## Commit 4 — fix(web): MTF truth + n-of-N panel ruling end-to-end
- `artifacts/pyrus/src/screens/algo/`: `algoTimeframeControls.js` + `.test.mjs`, `algoHelpers.js` + `.test.mjs`, `OperationsSignalRow.jsx`, `OperationsSignalTable.test.mjs`, `AlgoLivePage.test.mjs`, `algoSettingsFields.js`
- `artifacts/pyrus/src/screens/SignalsScreen.jsx`, `artifacts/pyrus/src/features/platform/PlatformAlgoMonitorSidebar.jsx` + `.test.mjs`
- `lib/backtest-core/src/signal-options.ts` + `.test.ts` (resolver: stored panel values honored; unset → 2, never unanimity)

## Commit 5 — perf(api): census/pressure follow-ups (⚠ verify completeness vs .codex-watch/fix-signal-monitor-db-2026-07-07.md)
- `artifacts/api-server/src/services/signal-monitor.ts` — census B1/B2/B4 hunks
- `artifacts/api-server/src/services/runtime-flight-recorder.ts` + `.test.ts` (slow-query firehose diet)
- `artifacts/api-server/src/services/signal-monitor-db-demand.test.ts` (new)
- `automation.ts` (+95: listExecutionEvents merge/in-flight dedup — confirmed census theme, pairs with `automation.merge-events.test.ts`)
- ⚠ unattributed, likely this theme — verify by diff read before staging: `platform.ts` (+131), `routes/platform.ts`, `platform-sparkline-seed.test.ts`, `market-data-store.ts`, `background-worker-pressure.test.ts`, `diagnostics-ibkr-metrics.test.ts`, `platform-bars-background-persist.test.ts`, `automation.merge-events.test.ts`, `signal-monitor-stream.test.ts`, `signal-monitor-completed-bars.test.ts`, `scripts/src/shadow-options-management-review.ts`

## DO NOT STAGE (other lanes)
- Signal-options lane (`ea30b14a`): Fix C / tally hunks in `signal-options-automation.ts`; `signal-options-worker.ts` (incl. new starvation floor — confirm owner); `signal-options-exit-policy.ts` + exit-dedup test hunks in `shadow-account.ts`
- Codex overnight-expectancy: `artifacts/backtest-worker/*`, `overnight-signal-expectancy.*`, `BacktestingPanels.tsx`, `lib/db/migrations/20260707_overnight_signal_expectancy.sql`, `lib/db/src/schema/overnight-signal-expectancy.ts`, `lib/db/src/schema/index.ts` (+1: exports `./overnight-signal-expectancy` — confirmed overnight lane)
- `lib/db/src/schema/robinhood.ts` — Robinhood lane residue (5 unpushed commits; verify whether this is committed-adjacent drift)
- Session handoffs / `.codex-watch/` / `docs/` — land separately or leave

## Gate before landing
Per-commit: scoped tests for the touched suites + `pnpm --filter @workspace/api-server run typecheck` + `pnpm run typecheck:libs`. Full set already green as of 2026-07-07 19:00 MDT (79/79 options+DTE, 128/128 core+monitor, 13/13 cache/actionability, 111/111 algo, 15/15 calendar).
