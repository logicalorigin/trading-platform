# Live Session Handoff - Matrix Pressure Exact-Cell Cache

- Session ID: pending
- Workstream: Matrix/STA/Massive `/api/bars` pressure follow-up
- CWD: `/home/runner/workspace`
- Last Updated (MT): `2026-06-04 22:41:43 MDT`
- Last Updated (UTC): `2026-06-05T04:41:43Z`

## User Request

Proceed from the planning breakdown for remaining Matrix/STA/Massive work after the account real/shadow cleanup.

## Root Cause Found

Live diagnostics after the 21:35 app restart showed:

- Running API process was current for the prior bundle, but later became stale after this source patch and rebuild.
- `/api/diagnostics/latest` reported `/signal-monitor/matrix` as dominant slow route, p95 around `40762ms`.
- Browser diagnostics showed `/api/bars` as a top slow/error route with `32` client calls and `17` 429s in the 5-minute window.
- Backend bars cache attribution showed `signal-matrix` as the largest bars family: over `1000` signal-matrix bar hydrations after restart, with `signal-matrix:miss` dominating.
- Controlled exact-cell matrix probe of 12 cells took `7.347s` and increased `signal-matrix` bars from `1048` to `1077` and `signal-matrix:miss` from `951` to `980`, proving each foreground exact-cell batch can fan out into multiple bars hydrations while the API is already pressured.

The specific code issue: `shouldServeSignalMonitorMatrixFromCacheOnly()` excluded foreground exact-cell leaders from high/critical pressure cache-only behavior. That let regular Signals leader startup/poll requests synchronously hydrate exact cells under pressure.

## Changes Made

- `artifacts/api-server/src/services/signal-monitor.ts`
  - Removed the foreground exact-cell leader bypass from `shouldServeSignalMonitorMatrixFromCacheOnly`.
  - Regular `leader` startup/poll matrix requests now return cache/stored-state responses under high/critical pressure even when they include exact cells.
  - STA requests using `clientRole: "algo-sta"` remain outside this regular leader cache-only rule.

- `artifacts/api-server/src/services/signal-monitor.test.ts`
  - Updated behavior and source-contract tests so high-pressure regular leader exact-cell requests are cache-only.

## Validation

Passed:

- `pnpm -C artifacts/api-server exec tsx --test src/services/signal-monitor.test.ts`
- `pnpm -C artifacts/api-server run typecheck`
- `pnpm -C artifacts/pyrus exec tsx --test src/features/platform/signalMatrixScheduler.test.js src/features/platform/platformRootSource.test.js src/screens/SignalsScreen.test.js`
- `pnpm -C artifacts/pyrus run typecheck`
- `pnpm -C artifacts/api-server run build`
- `git diff --check`

Safe browser QA run:

- `PYRUS_SAFE_QA_PERF_RUNS=1 PYRUS_SAFE_QA_PERF_SCREEN_SEQUENCE=signals PYRUS_SAFE_QA_SLOW_API_MS=500 pnpm -C artifacts/pyrus exec playwright test e2e/safe-qa-route-performance.spec.ts --project=chromium`
- Passed, but safe mode did not reproduce the live matrix/bars pressure path.

## Runtime Status

- API process PID `106864` started at `2026-06-04 21:35:11 MDT`.
- Rebuilt bundle `artifacts/api-server/dist/index.mjs` timestamp is `2026-06-04 21:50:05 MDT`.
- Therefore the running API process is stale relative to this fix.

## Git/Scope Notes

Do not commit blindly. There are staged changes that this session did not stage:

- `SESSION_HANDOFF_2026-06-04_019e953f-041b-71c3-a43e-542a8ef6e00d.md`
- `artifacts/api-server/src/services/python-compute.ts`
- `artifacts/api-server/src/services/python-compute.test.ts`
- `artifacts/pyrus/src/features/platform/live-streams.ts`
- `artifacts/pyrus/src/features/platform/live-streams.test.ts`
- `artifacts/pyrus/src/screens/account/accountSafeQaFixtures.js`
- `artifacts/pyrus/src/screens/account/accountSafeQaFixtures.test.js`

This pressure fix is currently unstaged and mixed with existing dirty signal-monitor/breadth-history changes in the same files.

## Next Recommended Steps

1. Restart through the normal Replit Run App path so the API loads the rebuilt `dist/index.mjs`.
2. Re-run the controlled 12-cell matrix probe under high pressure. Expected: fast cache/stored-state response, no `signal-matrix` miss jump.
3. Recheck `/api/diagnostics/latest`: `/signal-monitor/matrix` should stop dominating p95 after old samples age out.
4. Recheck browser diagnostics for `/api/bars` 429s after the matrix pressure subsides.
5. Commit this fix only after isolating staged/unrelated dirty files, or fold it into the broader Matrix/STA/Massive signal-monitor commit if that is the intended landing slice.

## Resume Update - 2026-06-04 22:12 MT

- User restarted through the normal app path. API PID `119636` and Vite PID `119707` are live.
- Controlled high-pressure leader exact-cell probe returned in `49ms` with `coverage.sourceRequestCount: 0` and no `signal-matrix`/provider-fetch counter delta, proving the first cache-only fix is loaded.
- Remaining live issue: before pressure reaches high, automatic Matrix traffic still sends large foreground batches. Diagnostics showed `/signal-monitor/matrix` p95 around `28202ms`, browser `/api/bars` `62` calls with `28` errors, and `signal-matrix:miss` climbing past `700` after restart.
- Additional root cause found before edits: frontend active-screen matrix caps are `240` cells at every pressure level, and backend automatic non-exact stored-state bootstrap requests can still schedule a full background matrix refresh across the universe.
- Current edit plan: cap regular active-screen exact-cell batches to STA-sized pressure limits, make regular leader startup/poll cache-only at `watch` or above, and prevent automatic non-exact bootstrap reads from scheduling background matrix refreshes.

## Patch Update - 2026-06-04 22:18 MT

- Edited `artifacts/api-server/src/services/signal-monitor.ts`:
  - Regular foreground leader exact-cell caps now use `48/36/24/12` for `normal/watch/high/critical`.
  - Regular leader startup/poll matrix reads are cache-only at `watch`, `high`, and `critical`; followers remain cache-only.
  - Automatic non-exact bootstrap matrix reads now hydrate stored state only and do not schedule full background matrix refreshes.
- Edited `artifacts/pyrus/src/features/platform/signalMatrixScheduler.js`:
  - Active-screen Matrix exact-cell/request-task caps now match `48/36/24/12`.
- Updated focused API and scheduler tests for the narrower caps and watch-pressure cache-only behavior.
- Validation passed:
  - `pnpm -C artifacts/api-server exec tsx --test src/services/signal-monitor.test.ts`
  - `pnpm -C artifacts/pyrus exec tsx --test src/features/platform/signalMatrixScheduler.test.js`
  - `pnpm -C artifacts/pyrus exec tsx --test src/features/platform/platformRootSource.test.js src/screens/SignalsScreen.test.js`
  - `pnpm -C artifacts/api-server run typecheck`
  - `pnpm -C artifacts/pyrus run typecheck`
  - `pnpm -C artifacts/api-server run build`
  - `git diff --check`
- Runtime status after rebuild: API PID `119636` started at `2026-06-04 22:03:34 MDT`; rebuilt bundle timestamp is `2026-06-04 22:15:39 MDT`. The running API is stale and needs another normal Replit app restart before live pressure probes reflect this patch.

## Post-Restart Audit - 2026-06-04 22:27 MT

- User restarted through the normal app path again. Runtime check passed with API PID `128950`, Vite PID `129149`, and rebuilt API bundle timestamp `2026-06-04 22:20:15 MDT`; no stale API bundle warning remained.
- Live diagnostics after restart showed API pressure `normal`, API p95 around `957ms`, and `/accounts/shadow/equity-history` as the dominant slow route instead of `/signal-monitor/matrix`.
- Browser diagnostics showed `/api/bars` with `21` calls, p95 around `2056ms`, and `errorCount: 0`.
- Runtime bars counters at first snapshot showed `signal-matrix:miss 59`, `option-flow-history 96`; research lane was healthy with no rejections, and Massive WS was OK with 500 subscriptions.
- A roughly 20-second counter watch showed `signalMatrixMiss` rising only `66 -> 75`; `optionFlowHistory` rose `133 -> 178`, so option-flow background bars are the next likely pressure source.
- Non-exact automatic Matrix bootstrap probe returned in `33ms` with `coverage.sourceRequestCount: 0` and zero `signal-matrix`, `cacheMiss`, or provider-fetch bars-counter delta.
- Validation rerun passed:
  - `pnpm -C artifacts/api-server exec tsx --test src/services/signal-monitor.test.ts`
  - `pnpm -C artifacts/pyrus exec tsx --test src/features/platform/signalMatrixScheduler.test.js src/features/platform/platformRootSource.test.js src/screens/SignalsScreen.test.js`
  - `pnpm -C artifacts/api-server run typecheck`
  - `pnpm -C artifacts/pyrus run typecheck`
  - `git diff --check`
  - `git diff --cached --check`
- Backend Matrix pressure slice committed as `a536a9d fix: shed automatic signal matrix pressure`. The earlier frontend pending-cell scheduler slice is `ef89d4b fix: hydrate pending signal matrix cells`.

## Resume Queue

1. Continue the Matrix/STA/Massive backlog with option-flow-history/background `/api/bars` pressure, since Matrix is now calm after restart and commit `a536a9d`.
2. Keep the remaining dirty breadth-history/signals/generated API files separate from the committed Matrix pressure fix.
3. If switching back to account real/shadow, start from the dirty trade-monitor/account/API generated files and re-run the account page audit for realized/unrealized PnL, order history, and manual trade inclusion.

## Source/Service Audit - 2026-06-04 22:41 MT

User questioned whether `coverage.sourceRequestCount: 0` on the non-exact bootstrap probe was a red flag. Audit result:

- Code-path review:
  - The non-exact automatic bootstrap branch intentionally returns stored-state/empty metadata without source work when `isAutomaticSignalMonitorMatrixRequest(input)` is true and no exact cells are requested.
  - Exact visible-cell requests remain separate: frontend request plans build `requestCells`, pending placeholders are not counted as hydrated, and API exact-cell requests under normal pressure can still enter `withSignalMonitorMatrixEvaluationCache(...)` when stored coverage is incomplete.
- Focused validation passed:
  - `pnpm -C artifacts/api-server exec tsx --test src/services/signal-monitor.test.ts`
  - `pnpm -C artifacts/pyrus exec tsx --test src/features/platform/signalMatrixScheduler.test.js src/features/platform/platformRootSource.test.js src/screens/SignalsScreen.test.js`
- Current-source service probe, not the stale running API:
  - Non-exact automatic bootstrap for SPY/QQQ `1m/5m`: `cacheStatus: "miss"`, `sourceRequestCount: 0`, `stateCount: 0`, `coverage.missingSymbols: 2`, duration `21ms`. This confirms cheap bootstrap, not fresh hydration.
  - Exact visible-cell leader poll for SPY/QQQ `1m/5m`: `cacheStatus: "miss"`, `sourceRequestCount: 4`, `stateCount: 4`, `coverage.hydratedSymbols: 2`, `coverage.missingSymbols: 0`, duration about `6840ms`. Returned four stale-but-usable SPY/QQQ `1m/5m` states with latest bars at `2026-06-04T23:59:00.000Z` and `2026-06-04T23:55:00.000Z`.
- Interpretation:
  - `sourceRequestCount: 0` is expected for non-exact bootstrap.
  - It would be a red flag only if an exact visible-cell request returned `sourceRequestCount: 0` with missing requested coverage and no follow-up hydration.
- Live HTTP validation is still blocked: `pnpm -C artifacts/pyrus exec node scripts/checkDevRuntime.mjs` reports API PID `128950` started at `2026-06-05T04:20:14Z`, before the rebuilt API bundle timestamp `2026-06-05T04:38:34Z`. Restart through the normal Replit Run App path before trusting live endpoint probes.

## Staging Update - 2026-06-04 22:26 MT

- Local `main` is ahead of `origin/main` by `ef89d4b fix: hydrate pending signal matrix cells`.
- The matrix-pressure API slice is staged separately from the broader Signals breadth/history work.
- Staged files only:
  - `artifacts/api-server/src/services/signal-monitor.ts`
  - `artifacts/api-server/src/services/signal-monitor.test.ts`
- Staged matrix-pressure scope:
  - Cap regular foreground exact-cell coverage to `48/36/24/12`.
  - Serve regular leader startup/poll exact-cell reads from cache at `watch`, `high`, and `critical` pressure.
  - Prevent automatic non-exact matrix bootstrap reads from scheduling a full background refresh.
- Do not stage the remaining Signals breadth/history API, generated client, `.replit`, or handoff changes into this commit.
- Next step: rerun focused API validation, inspect the staged diff, and commit only this pressure slice if clean.
