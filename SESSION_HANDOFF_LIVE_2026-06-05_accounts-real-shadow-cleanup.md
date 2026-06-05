# Live Session Handoff - Accounts Real/Shadow Cleanup

- Session ID: pending
- Saved (MT): `2026-06-04 19:40:38 MDT`
- Saved (UTC): `2026-06-05T01:40:38Z`
- CWD: `/home/runner/workspace`
- TTY: not a tty
- User request: finish the account/real-shadow positions and option quote cleanup slice referenced in `SESSION_HANDOFF_2026-06-04_019e94a9-bc59-7e40-93d2-8f113348cca2.md`, then run a full bug hunt and cleanup on the real and shadow account pages.

## Current Scope

- Focus files: `artifacts/api-server/src/services/account.ts`, `shadow-account.ts`, `account-page-streams.ts`, `account-position-model.ts`, `bridge-option-quote-stream.ts`, plus account page display/quote files under `artifacts/pyrus/src/screens/account/` and `artifacts/pyrus/src/features/account/`.
- Preserve unrelated dirty work across Signal Matrix, GEX ingest, Python compute, diagnostics, generated API clients, and other sessions.
- Replit startup config is locked with `pnpm run replit:config:lock`.

## What Changed This Continuation

- Fixed `AccountScreen.jsx` so `prefetchAccountSectionLiveQueries()` itself returns early when `accountQueriesEnabled` is false. This closes the safe-QA live-prefetch leak path through account-section intent callbacks, not just the active prefetch effect.
- Updated `accountSafeQaFixtures.test.js` to guard the stronger callback-level safe-QA invariant and the active prefetch effect gate.
- Fixed `account-page-streams.ts` critical cache diagnostics so real-account critical reads still record `criticalMisses` after account-page live/snapshot caches were removed.
- Updated `account-page-streams.test.ts` to assert the diagnostic miss accounting and shadow-only critical cache behavior.
- Cleaned up malformed wrapped-read blocks in `shadow-account.ts` for summary, allocation, equity-history, orders, closed-trades, ledger-bundle diagnostics, and risk-build diagnostics. Behavior was preserved; the cleanup makes the shadow account-page pressure path reviewable.

## Validation Status

- PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/account-page-streams.test.ts src/services/account-positions.test.ts src/services/shadow-account.test.ts src/services/account-risk.test.ts src/services/bridge-option-quote-stream.test.ts` (`206` passed).
- PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/account/*.test.js src/features/account/*.test.js` (`228` passed).
- PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/account-read-cache.test.ts src/services/account-trade-annotations.test.ts src/services/account-greek-scenarios.test.ts src/services/platform-quote-snapshot.test.ts src/services/marketing-shadow-dashboard.test.ts` (`28` passed).
- PASS: `pnpm --filter @workspace/api-server run typecheck`.
- PASS: `pnpm --filter @workspace/pyrus run typecheck`.
- PASS: `pnpm --filter @workspace/api-server run build`.
- PASS: `pnpm --filter @workspace/pyrus run build`.
- PASS: scoped `git diff --check` for account/shadow/quote touched files.

## Post-Restart Verification

- PASS: Replit startup config remains locked with `pnpm run replit:config:lock`.
- PASS: Replit restarted the existing Pyrus artifact runner; API process is `node --enable-source-maps ./dist/index.mjs`.
- PASS: rebuilt `artifacts/api-server/dist/index.mjs` contains `accountPageShadowCriticalCache`, `ACCOUNT_PAGE_SHADOW_CRITICAL_CACHE_TTL_MS`, and `shadow_read_stale_cache` markers.
- PASS: runtime diagnostics via `GET /api/diagnostics/runtime` expose account-page `criticalMisses` and no restored account-page live cache hits/misses.
- PASS: runtime diagnostics expose `shadowAccountReads` routes including `positions`, `ledger-bundle`, `orders`, `closed-trades`, `allocation`, `equity-history`, `summary`, `risk`, and `risk-build`.
- PASS: shadow positions API returned `200` with `31` rows and quote shape present.
- PASS: shadow risk API returned `200` with fast-detail deferred Greek warning.
- PASS: real account positions API returned `200` with `2` rows, including `1` option row and quote/display shape present.
- PASS: real account risk API returned `200` with fast-detail deferred Greek warning.
- PASS: account-page SSE stream emitted `critical` then `ready` for both `shadow` and real account `U24762790`; each critical payload included summary, positions, and risk.
- PASS: browser QA at `http://127.0.0.1:18747/?pyrusQa=safe` opened the Account screen with no root crash, no platform error boundary, no console/page errors, no failed or bad responses, and no `/api/accounts` or `/api/streams/accounts/page` requests.
- PASS: focused rerun `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/account-page-streams.test.ts` (`6` passed).
- PASS: focused rerun `pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/account/accountSafeQaFixtures.test.js src/screens/account/PositionsPanel.test.js src/features/account/positionDisplayModel.test.js` (`47` passed).
- PASS: `git diff --check HEAD~1 HEAD -- ...account/shadow/quote touched files`.

## Manual Activity / Option Valuation Bug Hunt

- Fixed real-account `getAccountClosedTrades()` to merge filled live broker orders into account activity as `LIVE_ORDER` rows when Flex has not already represented the same account/day/symbol/side/quantity/price. These rows are labeled `sourceType: "manual"` / `strategyLabel: "Manual"` and keep `realizedPnl: null` because broker order snapshots do not provide realized P&L.
- Fixed P&L calendar daily series so explicit account activity rows with unknown realized P&L count toward day/footer trade totals while realized P&L remains known-only.
- Fixed Trading Analysis metrics so unknown-P&L manual activity is counted as activity but is not treated as a flat $0 outcome for win rate, expectancy, equity curves, waterfall, or risk ratios.
- Fixed account position option valuation so an existing backend option quote can normalize an option row even before a live option stream snapshot arrives. This covers the F 6/26/26 15C symptom: 5 contracts at 0.86 now value near $430 instead of keeping a stale backend notional/exposure value.
- Fixed account position display weights by recomputing row `weightPercent` from displayed market value and current net liquidation.

## Latest Validation

- PASS: `node --import tsx --test src/screens/account/accountPnlCalendarModel.test.js src/screens/account/PositionsPanel.test.js src/screens/account/tradingAnalysisModel.test.js src/screens/account/accountTradingAnalysis.test.js` from `artifacts/pyrus` (`88` passed).
- PASS: `DATABASE_URL=${DATABASE_URL:-postgres://test:test@127.0.0.1:5432/test} DIAGNOSTICS_SUPPRESS_DB_WARNINGS=1 node --import tsx --test src/services/account-orders.test.ts` from `artifacts/api-server` (`5` passed).
- PASS: `pnpm -C artifacts/pyrus run typecheck`.
- PASS: `pnpm -C artifacts/api-server run typecheck`.
- PASS: `pnpm -C artifacts/api-server run build`.
- PASS: `pnpm -C artifacts/pyrus run build` (existing chunk-size warning only).
- PASS: `pnpm run replit:config:lock`.
- PASS: `git diff --check`.

## Post-Restart Check 2026-06-04 19:40 MDT

- PASS: Replit startup config remains locked with `pnpm run replit:config:lock`.
- PASS: restarted app is running through `artifacts/pyrus/scripts/runDevApp.mjs`; API process is `node --enable-source-maps ./dist/index.mjs`; Vite dev server is serving Pyrus.
- PASS: rebuilt API bundle contains `mergeLiveOrderActivityTrades`, `LIVE_ORDER`, `activityDegraded`, and `activityReason`; rebuilt Pyrus account bundles contain the account activity calendar logic and option display weight/valuation fix.
- PASS: focused frontend regressions still pass after restart (`88/88`): account P&L calendar, PositionsPanel, Trading Analysis KPI/model coverage.
- PASS: focused backend account-order regressions still pass after restart (`5/5`).
- PASS: real account positions endpoint returned `2` rows. The F 2026-06-26 15C row is corrected at runtime: quantity `5`, mark near `0.855`, market value about `$428`/`$415` across quote refreshes, and weight about `6%` of current `$6,893.99` net liquidation.
- PASS: real account page SSE emitted `critical` then `ready`; critical payload included summary, positions, orders, and risk.
- PASS: real closed-trades endpoint returned `200` with `activityDegraded: false`; current June 5 live/Flex response has no filled activity rows to merge.
- PASS: shadow positions endpoint returned `31` rows with option quote shape present.
- PASS: shadow closed-trades endpoint returned `1` June 5 row with summary realized P&L `-4.62`.
- PASS: frontend dev server returned the Pyrus HTML for `/?pyrusQa=safe`.
- PASS: isolated orders-history retry returned `200` without API process bounce. An earlier retry during the restart window reset the connection; it did not reproduce.
- PASS: `git diff --check`.

## Next Step

- Review/land the account real/shadow cleanup slice separately from unrelated dirty sessions. No Replit startup config, secrets, or artifact startup files were changed.
