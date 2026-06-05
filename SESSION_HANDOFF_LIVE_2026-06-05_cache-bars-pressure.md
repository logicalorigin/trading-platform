# Live Session Handoff - Cache Bars Pressure

- Session ID: pending
- Workstream: `/api/bars` and cache-pressure investigation
- CWD: `/home/runner/workspace`
- Last Updated (MT): `2026-06-04 23:36:24 MDT`
- Last Updated (UTC): `2026-06-05T05:36:24Z`

## User Request

Dive into the remaining post-push pressure target after Signals/Matrix fixes: cache/bars pressure.

## Current Status

- Local `main` is ahead of `origin/main` by `d78d172 fix: allow visible signal matrix hydration at watch pressure`.
- `origin/main` and `origin/HEAD` point at `b4bcfdd fix: shed background flow history under pressure`.
- Startup config drift was cleaned and committed: `.replit` now exposes only `8080 -> 8080` and `18747 -> 3000`, `replit.md` satisfies the guard markers, `pnpm run audit:replit-startup` passes, and config files are locked again.
- Current app-code slice is committed as `b4bcfdd`.
- Remaining dirty files include handoff pointers/notes plus separate Account/route-admission/live-stream worktree files. The Signal Matrix slice is committed separately.

## Baseline Evidence

- Post-restart `pnpm -C artifacts/pyrus exec node scripts/checkDevRuntime.mjs` reports fresh API PID `152110` and Vite PID `152192` with no stale-bundle warning.
- Post-push Signals safe QA passed:
  - Ready `627ms`
  - Slow API calls `0`
  - Max long task `212ms`
- Diagnostics immediately after smoke:
  - API subsystem `ok`, p95 `543ms`, errors `0`
  - Market data `ok`, pressure `normal`
  - Resource pressure `watch` from cache pressure
  - `/signal-monitor/matrix` not present as API slow route
  - Browser diagnostics still show `/api/bars` p95 around `1307ms`, no errors
- Backend runtime cache attribution showed shared bars cache pressure dominated by `option-flow-history`:
  - `option-flow-history:miss` was roughly `1.8k+`.
  - `signal-matrix:miss` was much lower and no longer the leading bars-cache driver.
  - `/api/bars` foreground safe-screen probes did not reproduce browser-side bars requests, pointing at background/live-client scanner paths.

## Implementation Update - 2026-06-04 22:54 MT

- Committed source fix as `b4bcfdd fix: shed background flow history under pressure`.
- Added `shouldHydrateFlowScannerHistoricalBars` in `platform.ts`.
- Manual flow requests still hydrate historical option bars regardless of resource pressure.
- Non-manual/background scanner phases (`seed`/`expanded`) hydrate historical option bars only while API resource pressure is `normal`.
- Under `watch` or worse pressure, the background scanner now skips the optional historical option-bar leg and goes directly to live quote hydration.
- Existing normal-pressure background behavior remains covered by the existing historical timestamp test.
- Added regression coverage asserting that under `cacheLevel: "watch"` a seed scanner run still admits live quote hydration but does not call `getHistoricalBars`.

## Validation - 2026-06-04 22:54 MT

- PASS: `pnpm -C artifacts/api-server exec tsx validation runner src/services/options-flow-scanner.validation.ts` (`71/71` tests).
- PASS: `pnpm -C artifacts/api-server run typecheck`.
- PASS: `pnpm -C artifacts/api-server run build`.
- PASS: `git diff --check -- artifacts/api-server/src/services/platform.ts artifacts/api-server/src/services/options-flow-scanner.validation.ts`.

## Next Step

Next source target is Account-screen bar/slow-route attribution after the fresh restart: browser diagnostics still report `/api/bars` from first screen `account` with p95 around `14.1s`, while server slow-route attribution is now dominated by account/shadow routes rather than `/api/bars`.

## Post-Restart Check - 2026-06-04 23:13 MT

- Fresh runtime loaded:
  - API PID `152110`
  - Vite PID `152192`
  - `pnpm -C artifacts/pyrus exec node scripts/checkDevRuntime.mjs` shows no stale API bundle warning.
- `pnpm run audit:replit-startup` passes.
- `b4bcfdd` source validation rerun passes:
  - PASS: `pnpm --filter @workspace/api-server exec node JS validation runner src/services/options-flow-scanner.validation.ts` (`71/71`).
- Diagnostics after restart:
  - Overall diagnostics status remains `degraded` / `warning`.
  - API p95 is around `1170ms`, `0` API errors.
  - Dominant API slow route is `/accounts/shadow/risk` at about `3850ms`; other slow routes are account/shadow equity-history, positions, and allocation.
  - Browser diagnostics still report first screen `account`, ready time about `17.5s`, and `/api/bars` `15` samples with p95 around `14074ms`, `10` slow, `0` errors.
  - Resource pressure is still `watch`, now driven by API latency rather than memory/cache hard pressure.
  - Bars cache attribution after restart: `signal-matrix:miss` about `43`, `sparkline:miss` about `17`, `option-flow-history:miss` about `4`, `unspecified:miss` about `6`.
- Important interpretation:
  - The background option-flow fix is loaded and `option-flow-history` is no longer the leading bars-cache driver in the fresh process.
  - The remaining visible symptom is Account-screen/browser `/api/bars` latency plus account/shadow slow routes.
  - Account Trade Forensics has an untagged `useGetBars` consumer in `artifacts/pyrus/src/screens/account/tradingAnalysis/TradeForensics.jsx`; those requests likely land in the server's `unspecified` bars family unless tagged.

## Live Matrix Probe Addendum - 2026-06-04 23:13 MT

- Live non-exact Matrix bootstrap for SPY/QQQ `1m/5m`:
  - HTTP `200`, duration `215ms`
  - `sourceRequestCount: 0`, `stateCount: 0`, `missingSymbols: 2`
  - Interpretation: cheap bootstrap path is loaded.
- Live regular leader exact-cell Matrix poll for SPY/QQQ `1m/5m` while resource pressure is `watch`:
  - HTTP `200`, duration `18ms`
  - `sourceRequestCount: 0`, `stateCount: 0`, `missingSymbols: 2`
  - Interpretation: regular leader startup/poll exact reads are being shed/cache-only at `watch`; this can leave visible cells missing until pressure drops or another allowed hydrator fills cache.
- Live manual exact-cell control for the same cells:
  - HTTP `200`, duration about `6163ms`
  - `sourceRequestCount: 4`, `stateCount: 4`, `missingSymbols: 0`
  - Interpretation: source hydration itself works.
- Live STA visible exact-cell control for the same cells after manual hydration:
  - HTTP `200`, duration `9ms`
  - `cacheStatus: "hit"`, `stateCount: 4`, `missingSymbols: 0`
- Runtime bars cache after probes:
  - `cacheMiss: 113`, `providerFetch: 80`, `inFlight: 6`
  - by family: `signal-matrix: 49`, `sparkline: 19`, `option-flow-history: 4`, `unspecified: 13`
- Open product/engineering question: decide whether regular leader exact-cell Matrix reads should remain fully cache-only at `watch`, or whether they need a tiny visible-cell allowance so Signals does not appear stuck while pressure is elevated.

## Post-Push Drift Check - 2026-06-04 23:15 MT

- `git fetch --prune` confirms `main`, `origin/main`, and `origin/HEAD` all point at `b4bcfdd`.
- `pnpm -C artifacts/pyrus exec node scripts/checkDevRuntime.mjs` confirms the fresh runtime remains loaded:
  - API PID `152110`
  - Vite PID `152192`
  - Repo `main@b4bcfdd0a92d dirty` only because handoff markdown is dirty.
- Focused safe Signals route smoke passed after push/restart:
  - Command: `PYRUS_SAFE_QA_PERF_RUNS=1 PYRUS_SAFE_QA_PERF_SCREEN_SEQUENCE=signals PYRUS_SAFE_QA_SLOW_API_MS=500 pnpm -C artifacts/pyrus exec browser QA test e2e/safe-qa-route-performance.browser-validation.ts --project=chromium`
  - Signals ready `613ms`, API requests `5`, slow API `1`, max long task `223ms`.
- Option-flow bars fix validation:
  - Initial post-restart bars cache was low (`65` entries) with `option-flow-history:miss = 4`, down from the pre-fix ~`1.8k+`.
  - During a 60s window where resource pressure stayed `watch`, `option-flow-history:miss` stayed flat at `35` while bars in-flight drained from `6` to `0`.
  - This confirms `b4bcfdd` is shedding background option-flow historical bars under pressure.
- Remaining pressure shifted:
  - Latest diagnostics still `degraded` / `warning`, but API aggregate is `ok`, p95 around `843ms`, `0` errors.
  - Resource pressure is `watch` from cache pressure.
  - `/signal-monitor/matrix` has one slow 5m outlier (`p95/max 6129ms`, `slowCount5m: 1`) and `signal-matrix:miss` continued growing under cache pressure (`81 -> 114` during the watch-pressure minute; `143` after safe Signals smoke).
  - Account-shadow routes remain in the slow-route list.

## Signal Matrix Watch Allowance - 2026-06-04 23:24 MT

- Committed source fix as `d78d172 fix: allow visible signal matrix hydration at watch pressure`.
- Backend behavior now:
  - Follower automatic startup/poll reads remain cache-only.
  - Non-exact automatic leader startup/bootstrap reads remain cache-only under `watch`+ pressure.
  - Foreground exact-cell leader startup/poll reads may hydrate missing visible cells at `watch` pressure.
  - Foreground exact-cell leaders stay cache-only at `high` and ``.
  - STA visible-page exact cells keep their existing `watch`/`high` behavior.
- Validation:
  - PASS: `pnpm -C artifacts/api-server exec tsx validation runner src/services/signal-monitor.validation.ts` (`91/91`).
  - PASS: `pnpm -C artifacts/api-server run typecheck`.
  - PASS: `pnpm -C artifacts/api-server run build`.
  - PASS: `pnpm -C artifacts/pyrus exec tsx validation runner src/features/platform/signalMatrixScheduler.validation.js src/features/platform/platformRootSource.validation.js src/screens/SignalsScreen.validation.js` (`117/117`).
  - PASS: `git diff --check -- artifacts/api-server/src/services/signal-monitor.ts artifacts/api-server/src/services/signal-monitor.validation.ts`.
- Runtime note:
  - `pnpm -C artifacts/pyrus exec node scripts/checkDevRuntime.mjs` reports API PID `152110` started before the rebuilt bundle timestamp `2026-06-05T05:23:13.929Z`.
  - Restart through normal Replit Run App before live-validating the Matrix allowance.

## Account Trade Forensics Bars Attribution - 2026-06-05 05:19 UTC

- Patched visible Account Trade Forensics candle requests:
  - `artifacts/pyrus/src/screens/account/tradingAnalysis/TradeForensics.jsx` now passes `buildBarsRequestOptions(BARS_REQUEST_PRIORITY.active, "account-trade-forensics")` to generated `useGetBars`.
  - `artifacts/api-server/src/services/route-admission.ts` now treats `account-trade-forensics` as an active request family.
- Added regression coverage:
  - `artifacts/pyrus/src/screens/account/tradingAnalysis/TradeForensics.validation.js` source-contract guard for the request family/options wiring.
  - `artifacts/api-server/src/services/route-admission.validation.ts` verifies tagged Account Forensics bars classify as `active-screen` and survive high API pressure, while untagged bars classify as `deferred-analytics` and are shed.
- Validation passed:
  - `pnpm -C artifacts/api-server exec tsx validation runner src/services/route-admission.validation.ts`
  - `pnpm -C artifacts/pyrus exec tsx validation runner src/screens/account/tradingAnalysis/TradeForensics.validation.js`
  - `pnpm -C artifacts/pyrus run typecheck`
  - `pnpm -C artifacts/api-server run typecheck`
  - `git diff --check`
- Remaining source target after this patch:
  - Account-shadow slow routes: `/accounts/shadow/risk`, `/accounts/shadow/equity-history`, `/accounts/shadow/positions`, `/accounts/shadow/allocation`.
  - Live verification of `account-trade-forensics` bars attribution requires an API/web reload after the patch is built into the running process.

## Account Shadow Route Performance Patch - 2026-06-05 05:26 UTC

- `main` advanced to `d78d172 fix: allow visible signal matrix hydration at watch pressure`; local branch is ahead of `origin/main` by one.
- Runtime source check:
  - `pnpm -C artifacts/pyrus exec node scripts/checkDevRuntime.mjs` passes connectivity checks but warns the live API PID `152110` started before the current rebuilt API bundle; restart Replit Run App before validating live API behavior.
- Live raw runtime diagnostics before the source patch showed the shadow-route cause:
  - `risk` route p95/max was dominated by `risk-build:ledger:fast:self`.
  - Fast risk self-builds were waiting on `closed-trades` plus a separate `positions:all:ledger:cached-quotes` read while the page also requested `positions:all:ledger:live-quotes`.
- Patched shadow-route fallback cost in `artifacts/api-server/src/services/shadow-account.ts`:
  - Fast risk now uses `buildDeferredShadowClosedTradesForFastRisk()` instead of reconstructing closed trades; full risk still calls `getShadowAccountClosedTrades`.
  - Cached-quote positions reads can reuse a fresh/stale-under-pressure live-quote positions response for the same source/filter because live-quote rows are a superset.
- Added/updated source contracts in `artifacts/api-server/src/services/shadow-account.validation.ts` for both behaviors.
- Validation passed:
  - `pnpm -C artifacts/api-server exec tsx validation runner src/services/shadow-account.validation.ts`
  - `pnpm -C artifacts/api-server exec tsx validation runner src/services/route-admission.validation.ts`
  - `pnpm -C artifacts/api-server exec tsx validation runner src/services/signal-monitor.validation.ts`
  - `pnpm -C artifacts/pyrus exec tsx validation runner src/features/platform/live-streams.validation.ts`
  - `pnpm -C artifacts/pyrus exec tsx validation runner src/screens/account/tradingAnalysis/TradeForensics.validation.js`
  - `pnpm -C artifacts/api-server run typecheck`
  - `pnpm -C artifacts/pyrus run typecheck`
  - `git diff --check`
- Remaining uncommitted app changes:
  - Account Forensics bars request-family attribution.
  - Shadow route fast-risk/positions reuse performance patch.
  - Live-stream shadow option day-change preservation changes are also dirty and validated, but appeared separately from the Account Forensics bars patch; do not casually split or revert them.

## Commit Checkpoint - 2026-06-05 05:27 UTC

- Committed validated account-page stability slice:
  - `2c564c7 fix: stabilize account shadow analysis`
- Local branch state:
  - `main...origin/main [ahead 2]`
  - Ahead commits are `d78d172` and `2c564c7`.
  - App code is clean after the commit; only session handoff markdown remains dirty.
- Runtime state:
  - `pnpm -C artifacts/pyrus exec node scripts/checkDevRuntime.mjs` still warns API PID `152110` predates the rebuilt API bundle.
  - Live validation of `2c564c7` requires restarting the normal Replit Run App path.
- Next required live checks after restart:
  - Account first-screen readiness and loading state for snapshot/analysis.
  - `/api/diagnostics/runtime` shadow read diagnostics, especially `risk`, `risk-build`, `positions`, `closed-trades`, and `equity-history`.
  - Bars hydration breakdown should show `account-trade-forensics` instead of growing `unspecified` for Trade Forensics charts.
  - Confirm Account Trading Analysis still includes today/manual SPY option trades and P&L calendar realized/unrealized values remain correct.

## Option Quote Follow-up Commits - 2026-06-05 05:31 UTC

- Committed two validated shadow option quote/day-change follow-up slices:
  - `f725a68 fix: hydrate shadow option day changes`
  - `8be2902 fix: harden shadow option day change feeds`
- Final app-code status:
  - `main...origin/main [ahead 4]`
  - Ahead commits: `d78d172`, `2c564c7`, `f725a68`, `8be2902`.
  - App code is clean after `8be2902`; only handoff markdown is dirty.
- Additional validation passed:
  - `pnpm -C artifacts/api-server exec tsx validation runner src/services/shadow-account.validation.ts`
  - `pnpm -C artifacts/pyrus exec tsx validation runner src/features/platform/live-streams.validation.ts src/screens/account/PositionsPanel.validation.js`
  - `pnpm -C artifacts/api-server run typecheck`
  - `pnpm -C artifacts/pyrus run typecheck`
  - `git diff --check`
- Runtime remains stale for live verification:
  - API PID `152110` predates rebuilt `artifacts/api-server/dist/index.mjs`.
  - Restart via normal Replit Run App before live-checking account/shadow and option quote behavior.

## Degradation Diagnosis Update - 2026-06-05 05:34 UTC

- Latest `pnpm -C artifacts/pyrus exec node scripts/checkDevRuntime.mjs`:
  - API PID `152110`, Vite PID `152192`.
  - Warning remains: API PID `152110` started before rebuilt `artifacts/api-server/dist/index.mjs`; live API source validation is stale until normal Replit Run App restart.
- Direct backend probes do not reproduce the browser's 40s path:
  - `/api/accounts/shadow/positions?mode=paper&assetClass=Equity&liveQuotes=true`: HTTP `200`, `0.712s`.
  - `/api/accounts/shadow/positions?mode=paper&assetClass=Options&liveQuotes=true`: HTTP `200`, `0.334s`.
  - `/api/accounts/shadow/risk?mode=paper&detail=fast`: HTTP `200`, `1.399s`.
- Latest `/api/diagnostics/latest`:
  - API subsystem `ok`, p95 `712ms`, no errors.
  - Browser subsystem still `degraded`, but latest client telemetry is old at `2026-06-05T05:24:34.855Z`.
  - Browser slow-route list is still dominated by the pre-fix `/api/options/quotes` fallback loop: `120` samples, p95 about `48.3s`.
  - Resource pressure is `watch` from cache pressure, not heap or API errors.
  - Bars cache attribution now points at `signal-matrix`: `signal-matrix:miss` `559`; `option-flow-history:miss` remains flat at `35`; `unspecified:miss` `27`.
- Current diagnosis:
  - Account/shadow route handlers are not the current 40s degradation path.
  - The option quote symptom was caused by live-stream/fallback behavior and stale or insufficient option day-change quote inputs; source fixes are committed but need reload/restart for live proof.
  - After restart/reload, the remaining likely pressure target is Signal Matrix bars-cache miss volume rather than shadow account routes.
- Additional validation rerun:
  - PASS: `pnpm --filter @workspace/api-server exec node JS validation runner src/services/shadow-account.validation.ts` (`138/138`).
  - PASS: `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/platform/live-streams.validation.ts src/screens/account/PositionsPanel.validation.js` (`93/93`).
  - PASS: `git diff --check`.

## Shadow Option Isolation Check - 2026-06-05 05:36 UTC

- User observed the blank day % symptom appears isolated to option positions in the Shadow account.
- Confirmed split:
  - Live HTTP API against `http://127.0.0.1:8080/api/accounts/shadow/positions?mode=paper&assetClass=Options&liveQuotes=true`: `11` option rows, `11` missing row-level `dayChange` or `dayChangePercent`.
  - Live HTTP API for Shadow stocks: `20` stock rows, `0` missing row-level day fields.
  - Direct current-source `getShadowAccountPositions({ assetClass: "Options", liveQuotes: true })`: `11` option rows, `0` missing row-level day fields.
  - Direct current-source Shadow stocks: `20` rows, `0` missing row-level day fields.
- Interpretation:
  - The symptom is option-specific.
  - The committed source fix is effective in current TypeScript source.
  - The running API still serves stale `dist/index.mjs` from PID `152110`, so live UI remains wrong until the normal Replit Run App restart actually starts a newer API process.

## Restart Check - 2026-06-04 22:47 MT

- User reported another restart, but runtime did not reload the API process:
  - API PID remains `128950`.
  - API PID `128950` started at `2026-06-05T04:20:14Z`.
  - Current `artifacts/api-server/dist/index.mjs` timestamp is `2026-06-05T04:38:34Z`.
- `pnpm -C artifacts/pyrus exec node scripts/checkDevRuntime.mjs` still warns that live API validation is stale; do not trust live HTTP Matrix or `/api/bars` endpoint behavior until the normal Replit Run App path starts a newer API PID.
- Fresh validation baseline for the next source pass:
  - PASS: `pnpm -C artifacts/api-server exec tsx validation runner src/services/trade-monitor-worker.validation.ts`
  - PASS: `git diff --check`
- Prepared next source target:
  - `artifacts/api-server/src/services/trade-monitor-worker.ts` already caps history fallback at `48`, interleaves pinned and expanded symbols, and skips timed-out per-symbol bar loads without blocking loaded siblings.
  - Next real investigation should compare live `/api/bars` browser attribution after a real API reload against backend bars family counters, then decide whether the remaining pressure is option-flow-history/background bars or account-shadow equity-history.

## Ford Option Position Unit Fix - 2026-06-05 07:14 MT

- User reported the real Account positions table showing the F 2026-06-26 15C row with `Avg 103.97`, `mark 0.86`, `marketValue ~$428`, and `unrealizedPnl -$51,556 / -99.18%`.
- Root cause:
  - The REST account positions route already normalizes IBKR option average cost from contract dollars to premium dollars (`103.96825 -> 1.0396825`).
  - The live account stream cache path did not. `accountPositionRowFromStream` and combined-account stream aggregation wrote raw `position.averagePrice` into `averageCost`.
  - Option quote overlay then repriced mark/market value in premium dollars while recomputing P&L against the raw contract-scaled average cost, causing the transient `-$51k` Ford P&L until REST corrected the row.
- Implemented source fixes:
  - `artifacts/pyrus/src/features/platform/live-streams.ts`
    - Added option premium normalization matching the backend heuristic.
    - Treats `assetClass: "option"` rows as option-priced even when `optionContract` is temporarily null.
    - Detects flat cost-basis fallback stream rows and refuses to seed them before REST data.
    - Normalizes stream average/mark/market value/unrealized P&L for actual live option marks.
    - Normalizes already-polluted cached option rows before option quote patch P&L recomputation.
  - `artifacts/pyrus/src/screens/account/PositionsPanel.jsx`
    - Added defensive option average-cost normalization in `applyLiveOptionQuoteToRow`, so stale polluted cache rows cannot keep producing wrong P&L after a quote lands.
- Added regressions:
  - `artifacts/pyrus/src/features/platform/live-streams.validation.ts`
    - Quote stream normalizes polluted `averageCost: 103.96825` before P&L.
    - Live stream does not seed contract-scaled cost-basis option rows.
    - Live stream does not seed fallback option rows from a mixed payload where a valid stock row, such as FCEL, also has market data.
    - Live stream normalizes option valuation units when an actual option market mark is present.
  - `artifacts/pyrus/src/screens/account/PositionsPanel.validation.js`
    - Table overlay normalizes contract-scaled option average cost before P&L.
- Validation passed:
  - `pnpm -C artifacts/pyrus exec tsx validation runner src/features/platform/live-streams.validation.ts`
  - `pnpm -C artifacts/pyrus exec tsx validation runner src/screens/account/PositionsPanel.validation.js`
  - `pnpm -C artifacts/pyrus run typecheck`
  - `git diff --check`
- Status:
  - This Ford option unit fix is committed as `b899bd9 fix: normalize live option position costs`.
  - No Replit startup config or artifact startup files were touched.

## Account Closed-Trades 1W Zero Fix - 2026-06-05 07:50 MT

- User reported the Account page still shows `0 trades` in the `1W` selection and asked to treat it as a UI symptom of deeper data/runtime issues.
- Investigation:
  - The visible workbench was using `tradesQuery.data.trades` as both visible trades and `allTrades`, so the range-scoped query became the entire trade universe.
  - Account closed-trades queries used the 120s derived stale window even though live closed-trades depends on live order/execution activity.
  - The account-page derived stream wrote `payload.closedTrades` and `payload.performanceCalendarTrades` directly into React Query cache. A degraded empty activity response could become a fresh cached zero and suppress correction.
  - The active API dist process was pegged at 100% CPU and `/api/healthz` timed out during validation; source changes were built and typechecked, but live proof requires normal Replit Run App restart to replace the wedged process.
- Implemented source fixes:
  - `artifacts/pyrus/src/features/platform/live-streams.ts`
    - Treats `activityDegraded: true` like degraded account data.
    - Refuses to write degraded empty closed-trades payloads over current query cache data, and avoids seeding degraded empty payloads as canonical closed-trades query data.
  - `artifacts/pyrus/src/screens/AccountScreen.jsx`
    - Adds short live-activity stale time for closed-trades queries instead of the 120s derived stale time.
    - Retries degraded empty closed-trades data on the short live-activity interval even when stream fallback polling would otherwise be disabled.
    - Feeds Trading Analysis from the broader performance-calendar trade set when available, then lets the workbench client-filter to the selected range.
  - `artifacts/api-server/src/services/account.ts`
    - Coalesces live account universe order/execution reads across positions/orders/closed-trades fanout.
    - Adds a short response cache for closed-trades derived responses.
  - `artifacts/api-server/src/services/ibkr-account-bridge.ts`
    - Preserves non-empty stale execution cache when a refresh returns empty.
- Behavioral regressions added:
  - Stream derived cache preserves existing closed trades over degraded empty activity payloads.
  - IBKR execution bridge cache preserves non-empty execution history across transient empty refreshes.
- Validation passed:
  - `pnpm -C artifacts/pyrus exec tsx validation runner src/features/platform/live-streams.validation.ts src/screens/account/accountCalendarData.validation.js ../api-server/src/services/ibkr-account-bridge.validation.ts ../api-server/src/services/account-orders.validation.ts ../api-server/src/services/account-read-cache.validation.ts`
  - `pnpm -C artifacts/pyrus run typecheck`
  - `pnpm -C artifacts/api-server run typecheck`
  - `pnpm -C artifacts/api-server run build`
  - `git diff --check`
- Runtime status:
  - `pnpm -C artifacts/pyrus exec node scripts/checkDevRuntime.mjs` still reports API health probe timeout.
  - `ps` shows active API PID `10374` at 100% CPU on `./dist/index.mjs`.
  - Did not kill/restart the supervisor from the shell; normal Replit Run App restart should replace the wedged dist process.

## Launch Load RCA - Massive Quote/Aggregate Fanout - 2026-06-05 08:04 MT

- User restarted and then provided a browser root crash:
  - `TypeError: Failed to fetch dynamically imported module: .../src/screens/account/SetupHealthPanel.jsx`
  - Local Vite check after the crash served `SetupHealthPanel.jsx` as `200 text/javascript` in about `1ms`, and the file exists. This points to a transient dev-server/module-fetch failure during launch pressure, not a missing module or syntax transform error.
- Runtime evidence before the source patch:
  - API accepted TCP on `8080` but `/api/healthz` timed out.
  - API Node main thread was pegged near `100%` CPU; RSS was high but not the immediate failure mode.
  - Node inspector CPU profile over 5s was dominated by:
    - `stock-aggregate-stream.ts`: `handleMassiveQuoteSnapshot`, `updateAccumulator`, `scheduleAggregateFanout`, `recordAggregateHistory`, `recordAggregateEvent`
    - `massive-stock-quote-stream.ts`: `notifySubscribers`, `getCurrentPayload`, `quoteFromState`
- Root cause:
  - Massive quote/trade websocket ticks synchronously notified matching subscribers for every tick.
  - For a single changed symbol, the Massive quote stream rebuilt the full subscriber symbol payload, unlike the IBKR bridge quote stream which sends matched changed quotes.
  - The stock aggregate stream then processed every quote in that full payload, synchronously recording aggregate stats/history and queueing fanout for each generated aggregate. Under launch subscriptions this amplified one tick into repeated full-set aggregate work and starved HTTP handling.
- Source fix implemented:
  - `artifacts/api-server/src/services/massive-stock-quote-stream.ts`
    - Batches changed quote symbols over a short `100ms` flush window.
    - Sends only changed-symbol snapshots to subscribers after the initial full cached payload.
    - Exposes pending snapshot count and a test flush hook.
  - `artifacts/api-server/src/services/stock-aggregate-stream.ts`
    - Keeps accumulator updates cheap per tick.
    - Defers aggregate stats/history recording until the coalesced fanout flush.
    - Stores only the latest message per `symbol:startMs` pending fanout key, so repeated same-minute ticks produce one emitted aggregate with final OHLC/volume state.
    - Optimizes history update to avoid clone/filter/sort on every quote tick.
- Contract review:
  - SSE quote routes already write an initial full snapshot separately.
  - IBKR quote stream callbacks are incremental matched-quote payloads.
  - The patch aligns Massive live stream callback semantics with the existing IBKR stream contract instead of adding sleeps or UI retries.
- Added regressions:
  - `massive-stock-quote-stream.validation.ts`: batched changed-symbol snapshots do not notify synchronously and do not resend unchanged subscribed symbols.
  - `stock-aggregate-stream.validation.ts`: repeated same-minute quote updates coalesce before fanout/history and emit one final aggregate.
- Validation passed:
  - `pnpm -C artifacts/api-server exec tsx validation runner src/services/massive-stock-quote-stream.validation.ts src/services/stock-aggregate-stream.validation.ts src/services/platform-quote-snapshot.validation.ts`
  - `pnpm -C artifacts/pyrus exec tsx validation runner src/features/platform/live-streams.validation.ts src/screens/account/accountCalendarData.validation.js ../api-server/src/services/ibkr-account-bridge.validation.ts ../api-server/src/services/account-orders.validation.ts ../api-server/src/services/account-read-cache.validation.ts ../api-server/src/services/massive-stock-quote-stream.validation.ts ../api-server/src/services/stock-aggregate-stream.validation.ts ../api-server/src/services/platform-quote-snapshot.validation.ts`
  - `pnpm -C artifacts/pyrus run typecheck`
  - `pnpm -C artifacts/api-server run typecheck`
  - `pnpm -C artifacts/api-server run build`
  - `git diff --check`
- Runtime status after build:
  - Replit-owned supervisor restarted at `2026-06-05T14:00:18Z` and API `/api/healthz` is responsive.
  - `checkDevRuntime.mjs` warns API PID `17907` predates rebuilt `artifacts/api-server/dist/index.mjs` timestamp `2026-06-05T14:02:24Z`; live proof still requires a normal Run restart after this patch.
  - Current old-bundle API is healthy but still high CPU under load, consistent with the pre-patch diagnosis.

## Launch Load Deferral - 2026-06-05 08:24 MT

- User restarted again and asked to improve app launch/load, specifically noting Bloomberg can load last.
- Runtime/source findings:
  - Safe-mode browser waterfall showed `0` requests for `BloombergLiveDock`, `bloomberg.com`, manifests, or `.m3u8` in the first launch window; the heavy Bloomberg player was not fetched unless opened.
  - The earlier `SetupHealthPanel.jsx` root crash was still a launch-scheduling symptom: Account's lower support panel was wrapped in `DeferredRender`, but `DeferredRender` auto-activated offscreen panels on a default `2.5s` idle timeout.
  - That meant non- Account panels could request optional dynamic chunks shortly after boot even if the user never scrolled, making restart-time Vite module-fetch failures fatal at the route/root boundary.
- Source fix implemented:
  - `artifacts/pyrus/src/components/platform/DeferredRender.jsx`
    - Default activation is now viewport/intersection driven; idle activation is opt-in via an explicit `idleDelayMs`.
    - Offscreen Account panels no longer mount simply because a startup timer elapsed.
  - `artifacts/pyrus/src/screens/AccountScreen.jsx`
    - `DeferredPanelSuspense` now wraps lazy Account panels in `PlatformErrorBoundary` with warning severity and account-panel categorization.
    - Optional panel import failures are contained to the panel instead of crashing the workspace root.
  - `artifacts/pyrus/src/features/platform/PlatformApp.jsx` and `PlatformShell.jsx`
    - Added an explicit auxiliary-surface launch tier.
    - Desktop Bloomberg launcher renders only after first screen readiness, startup protection clears, and a `30s` idle-delayed auxiliary gate opens.
    - Safe QA keeps this gate off so launch measurements are not polluted.
  - `artifacts/pyrus/e2e/platform-shell.browser-validation.ts`
    - Corrected Account Trading Analysis tab selectors from `button` to ARIA `tab`.
- Validation passed:
  - `pnpm -C artifacts/pyrus exec tsx validation runner src/features/platform/platformRootSource.validation.js src/screens/account/accountCalendarData.validation.js src/components/platform/PlatformErrorBoundary.validation.js`
  - `pnpm -C artifacts/pyrus run typecheck`
  - Safe-mode browser load probe: first screen ready around `1.2s`, Bloomberg button count `0`, Bloomberg request count `0`.
  - `PYRUS_BROWSER_QA_NO_WEB_SERVER=1 pnpm -C artifacts/pyrus exec browser QA test e2e/platform-shell.browser-validation.ts --project=chromium --grep "account desktop tables grow without vertical inner scroll caps|account shadow watchlist backtest posts today and week ranges"`
  - `git diff --check`
- Runtime note:
  - `pnpm -C artifacts/pyrus exec node scripts/checkDevRuntime.mjs` reports web/API ports healthy, but warns current API PID `25536` predates rebuilt API dist timestamp `2026-06-05T14:21:18.231Z`.
  - No Replit startup config or control-plane actions were touched.
