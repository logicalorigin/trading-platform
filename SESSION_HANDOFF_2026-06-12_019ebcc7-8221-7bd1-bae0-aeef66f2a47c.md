# Session Handoff: API Connection Watch

- Last Updated (MT): `2026-06-12 12:54:26 MDT`
- Last Updated (UTC): `2026-06-12T18:54:26Z`
- Native Codex Session ID: `019ebcc7-8221-7bd1-bae0-aeef66f2a47c`
- Task: Watch the PYRUS app/API connection, explain IBKR/broker data-line fluctuations, remove header/footer line-count fallback paths, and enforce protected-lane priority over Flow Scanner.

## Scope

- Existing worktree is broadly dirty; do not revert or clean unrelated files.
- Use source-confirmed endpoints only.
- User clarified the restart was another agent and normal.
- User then requested removal of header/footer fallback paths after the mismatch was identified.

## Observed Before Watch

- `artifacts/pyrus/.replit-artifact/artifact.toml` runs `pnpm --filter @workspace/pyrus run dev:replit`.
- PYRUS web dev port is `18747`; API port is `8080`.
- Vite proxies `/api` to `http://127.0.0.1:8080` with websocket support.
- `node artifacts/pyrus/scripts/checkDevRuntime.mjs` found one Vite server and one API server.
- Runtime doctor warning: API PID `86617` started at `2026-06-12T16:40:43.936Z`, while `artifacts/api-server/dist/index.mjs` was rebuilt at `2026-06-12T16:40:46.503Z`; restart is needed before validating source changes against runtime behavior.
- Flight recorder at `2026-06-12T17:05:02.213Z` showed API pressure `high`, RSS `1767.4 MB`, heap used `1216.5 MB`, request p95 `9511 ms`, and no recent 5xx failures.

## Plan

1. Run `pnpm --filter @workspace/scripts run pyrus:performance-monitor -- --seconds=300 --interval-ms=5000 --deep-interval-ms=30000`.
2. Inspect generated `scripts/reports/pyrus-performance-monitor/.../report.md` and `samples-and-report.json`.
3. Produce a concise debug report with facts, inferences, unknowns, and next steps.

## Current Status

- Five-minute monitor completed.
- Report written by monitor at `scripts/reports/pyrus-performance-monitor/2026-06-12T17-07-00-905Z/report.md`.
- JSON samples at `scripts/reports/pyrus-performance-monitor/2026-06-12T17-07-00-905Z/samples-and-report.json`.
- UI fallback fix implemented in:
  - `artifacts/pyrus/src/features/platform/FooterMemoryPressureIndicator.jsx`
  - `artifacts/pyrus/src/features/platform/ibkrPopoverModel.js`
  - `artifacts/pyrus/src/features/platform/FooterMemoryPressureIndicator.test.mjs`
- Follow-up runtime mismatch fix implemented in:
  - `artifacts/pyrus/src/features/platform/useIbkrLineUsageSnapshot.js`
  - `artifacts/pyrus/src/features/platform/useIbkrLineUsageSnapshot.test.mjs`
- Backend Flow Scanner priority fix implemented in:
  - `artifacts/api-server/src/services/market-data-admission.ts`
  - `artifacts/api-server/src/services/market-data-admission.test.ts`
- Header active-bridge status fix implemented in:
  - `artifacts/pyrus/src/features/platform/IbkrConnectionStatus.jsx`
  - `artifacts/pyrus/src/features/platform/ibkrPopoverModel.test.mjs`
- Narrow unrelated typecheck cleanup made in `artifacts/api-server/src/services/platform.ts` by removing durable option-chain fallback branches that were already unreachable after an existing early `return durable`.

## Observed During Watch

- API connection stayed up:
  - direct `/api/healthz`: `61/61` ok, p95 `98ms`.
  - frontend-proxied `/api/healthz`: `61/61` ok, p95 `388ms`.
  - `/api/settings/ibkr-line-usage`: `61/61` ok, p95 `296ms`.
- Runtime was degraded:
  - latest diagnostics severity `warning`.
  - API p95 latency range `7854ms` to `11246ms`; p99 max `48615ms`.
  - event-loop max reached `3235.9ms`.
  - API RSS peaked around `1793.6 MB`.
  - `/api/settings/ibkr-lanes` failed `10/11` samples by 10s timeout.
- Slow routes in the monitor included:
  - `/signal-monitor/state` p95/max `58233ms`.
  - `/watchlists` p95/max `48615ms`.
  - `/signal-monitor/events` p95/max `30629ms`.
  - `/accounts/U24762790/equity-history` p95/max `13776ms`.
- IBKR line usage fluctuated sharply:
  - admission active lines min/avg/max: `5 / 89.803 / 167`.
  - bridge active lines min/avg/max: `0 / 77.885 / 167`.
  - flow-scanner charged lines min/max: `0 / 159`.
  - drift min/avg/max: `0 / 11.918 / 167`.

## Line-Count Findings

- `77/200` was observed around `2026-06-12T17:09:40Z` and meant backend admission app demand was `77` active lines out of configured budget `200`.
- At the `77/200` moment, scanner usage dominated the count: roughly `72` flow-scanner lines plus `5` account lines.
- The later UI symptom `Flow scanner: 7 option-chain scans active; quotes warming` matches frontend logic that displays that text only when flow-scanner line usage is `0` while deep scanner active count is greater than `0`.
- The line swings are primarily scanner-driven:
  - scanner filled toward dynamic cap `159`, total near `167`;
  - scanner rotated/dropped to `72`, total `77`;
  - scanner dropped to `0`, total `5-10`;
  - later refill sample showed total `113/200`, scanner `102`.
- Backend source facts:
  - `flow-scanner-live` priority is `55`, below execution/account/visible/automation.
  - dynamic scanner cap is `targetFillLines - active non-scanner line count`; Trade Options Chain reserve diagnostics are derived from active visible/Trade line IDs, not hard set.
  - scanner quote leases default to `300_000ms` and are retained on complete/abort for flow-scanner snapshots.
  - retained flow-scanner demand can trigger option quote stream reconfiguration.

## UI Fallback Fix

- Footer IBKR pressure bar no longer falls back from canonical total app usage to:
  - `lineUsage.activeLineCount`
  - `bridge.used`
  - `bridge.cap`
  - `allocation.bridgeLineBudget`
  - `allocation.targetFillLines`
  - `allocation.remainingToTargetLineCount`
- Header compact line usage no longer falls back from the total row to:
  - any first finite pool row
  - bridge usage/cap/free
  - allocation bridge/target/free fields
- Bridge/allocation fields remain available as explicit diagnostics; they no longer replace the visible app line-count ratio.
- New footer regression test verifies that bridge-only data shows `IBKR --` instead of a misleading ratio, and canonical total usage wins over bridge/allocation disagreement.
- Follow-up correction removed the remaining frontend fallback from live Trade Options Chain demand to `admission.budget.visibleOptionQuoteLineReserve`.
- Header/footer/settings copy now describes derived Trade Options Chain/protected demand as `active` / `Protected active lines`, not reserved demand.

## Runtime Header/Footer Mismatch Follow-Up

- User observed current UI still showed header `165` and footer `4`.
- Direct backend sample at `2026-06-12T17:32:22.152Z` showed `active: 166`, `bridge: 1`, drift `api_active_bridge_missing`, scanner `159`; this matched the header-side high count but exposed why a stale/other snapshot could show a small footer count.
- Source trace found header and footer each owned independent `useIbkrLineUsageSnapshot` state:
  - Header: `HeaderStatusCluster.jsx` calls `useIbkrLineUsageSnapshot(...)`.
  - Footer: `PlatformApp.jsx` calls `useRuntimeControlSnapshot(...)`, which calls `useIbkrLineUsageSnapshot(...)`, then passes `footerApiSourceRuntime.snapshot` to the footer.
- Fix: `useIbkrLineUsageSnapshot.js` now publishes every fetched/SSE payload into a module-level shared snapshot store keyed by detail level and uses `useSyncExternalStore` so all consumers read the same latest snapshot.
- The shared store is monotonic by `updatedAt` / `admission.generatedAt`; older payloads cannot overwrite a newer line-usage snapshot.
- Served Vite module contains `sharedLineUsageSnapshots`, `useSyncExternalStore`, and the older-payload guard.

## Backend Priority Follow-Up

- User clarified desired priority: Automation, Account monitor, and Trade Options Chain must be prioritized over Flow Scanner.
- Source already had higher static intent priorities than scanner:
  - account monitor `90`
  - visible/Trade Options Chain `80`
  - automation `60` plus signal-options owner adjustment
  - flow scanner `55`
- Gap found: the earlier scanner cap math was being treated like a standing reserve. User clarified that Automation, Account monitor, and Trade Options Chain demand must be derived from active leases, not hard set.
- Fix: removed the hard reserve fields and made Flow Scanner cap subtract actual active non-scanner line demand from `targetFillLines`.
- With a 200-line target and no protected demand, scanner effective cap can be `200`.
- With only Account monitor using `3` lines, scanner effective cap should be `197`.
- With `70` active protected lines from Account monitor, Trade Options Chain, or Automation, scanner effective cap becomes `130`; if scanner was full, `70` scanner leases are demoted.
- Diagnostics still expose `tradeOptionsChainReserveLineCount`, `optionReserveLineCount`, and `protectedPriorityLineCount`, but those values are live derived counts, not configured reserves.

## Validation

- `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/FooterMemoryPressureIndicator.test.mjs src/features/platform/ibkrPopoverModel.test.mjs src/features/platform/headerIbkrLineUsagePolicy.test.mjs` passed: `13/13`.
- `pnpm --filter @workspace/pyrus run typecheck` passed.
- A direct `node --test` invocation failed before the rerun because raw Node cannot load the app's `.jsx` imports; rerun with workspace `tsx` passed.
- Post-rebuild check at `2026-06-12T17:28-17:31Z`:
  - `node artifacts/pyrus/scripts/checkDevRuntime.mjs` found one Vite server and one API server, but still warned API PID `100483` started at `2026-06-12T17:27:33.751Z` before the current API bundle rebuild at `2026-06-12T17:27:36.891Z`.
  - Served Vite module `FooterMemoryPressureIndicator.jsx` contains `const used = sourceNumber(total.used)` and no longer contains the removed `bridge.used`/`lineUsage.activeLineCount` fallback matches.
  - Served Vite module `ibkrPopoverModel.js` contains only `const totalRow = lineUsage.rows?.find((row) => row.id === "total") || null` for compact usage and no longer contains the removed first-finite-row/bridge fallback matches.
  - Runtime model probe against live `/api/settings/ibkr-line-usage` payload resolved `rawAdmissionActive: 95`, `rawBudget: 200`, `normalizedSummary: "95 of 200"`, header compact `"95 of 200"`, and footer label `"IBKR 95/200"`.
  - Live `/api/settings/ibkr-line-usage` at `2026-06-12T17:30:36.103Z` showed `active: 95`, bridge `95`, drift `matched`, scanner `88`, deepActive `3`, and warming text would not show.
  - `/api/diagnostics/latest` still reported degraded runtime: API p95 `28075ms`, p99 `75527ms`, with slow `/positions`, `/signal-monitor/state`, and `/signal-monitor/events`.
- Follow-up validation after user reported `165` header / `4` footer:
  - `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/useIbkrLineUsageSnapshot.test.mjs src/features/platform/FooterMemoryPressureIndicator.test.mjs src/features/platform/ibkrPopoverModel.test.mjs src/features/platform/headerIbkrLineUsagePolicy.test.mjs` passed: `15/15`.
  - `pnpm --filter @workspace/pyrus run typecheck` passed.
  - Served Vite module `useIbkrLineUsageSnapshot.js` includes the shared store and monotonic timestamp guard.
- Backend priority validation:
  - `pnpm --filter @workspace/api-server exec tsx --test src/services/market-data-admission.test.ts` passed: `9/9`.
  - Tests cover derived scanner cap math, live Trade demand, and scanner preemption for account monitor, Trade Options Chain, and automation.
  - `pnpm --filter @workspace/api-server run typecheck` passed.
  - `pnpm --filter @workspace/api-server exec tsx --test src/services/option-chain-policy.test.ts src/routes/account-positions-route.test.ts` passed: `6/6`.
  - `pnpm --filter @workspace/api-server run build` passed and rebuilt `artifacts/api-server/dist/index.mjs`.
  - Built API bundle contains no `accountMonitorLineReserve`, `automationLineReserve`, `protectedLaneLineReserve`, or `minimumProtectedReserveLineCount` symbols.
  - `git diff --check` passed for touched IBKR line-usage files.
  - Follow-up correction after user rejected hard reserves:
    - `pnpm --filter @workspace/api-server exec tsx --test src/services/market-data-admission.test.ts` passed: `9/9`.
    - `pnpm --filter @workspace/api-server run typecheck` passed.
    - `pnpm --filter @workspace/api-server run build` passed and rebuilt `artifacts/api-server/dist/index.mjs`.
    - `rg` over source/tests/dist found no hard-reserve symbols.
    - Built API bundle has derived scanner-cap math: active non-scanner line IDs determine protected demand.
- Final validation after removing the frontend budget fallback:
  - `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/useIbkrLineUsageSnapshot.test.mjs src/features/platform/FooterMemoryPressureIndicator.test.mjs src/features/platform/ibkrPopoverModel.test.mjs src/features/platform/headerIbkrLineUsagePolicy.test.mjs` passed: `17/17`.
  - Added regression: Trade Options Chain demand is derived from live allocation, not `visibleOptionQuoteLineReserve`.
  - Added regression: footer labels derived Trade Options Chain demand as active, not reserved.
  - `pnpm --filter @workspace/pyrus run typecheck` passed.
  - `pnpm --filter @workspace/api-server exec tsx --test src/services/market-data-admission.test.ts` passed: `9/9`.
  - `pnpm --filter @workspace/api-server run typecheck` passed.
  - `pnpm --filter @workspace/api-server run build` passed and rebuilt `artifacts/api-server/dist/index.mjs`.
  - `git diff --check` passed for the touched API/Pyrus/handoff files.
- Runtime doctor after the final derived-demand build showed API PID `112790` started at `2026-06-12T17:55:38.959Z`, before rebuilt API bundle `artifacts/api-server/dist/index.mjs` at `2026-06-12T18:09:08.016Z`.
- Live `/api/settings/ibkr-line-usage` at `2026-06-12T18:09:30.757Z` still showed old loaded-process values: scanner effective cap `141`, scanner dynamic cap `141`, `optionReserveLineCount: 59`.
- Interpretation: source/tests/dist are fixed, but the running API has not picked up the new backend code yet. Normal Replit app restart is needed before runtime should show the derived scanner cap (`200 - active non-scanner lines`).
- Post-user rebuild validation:
  - `node artifacts/pyrus/scripts/checkDevRuntime.mjs` at `2026-06-12T18:14:31.928Z` showed API PID `119816` and Vite PID `119922` with no stale API bundle warning.
  - Live `/api/settings/ibkr-line-usage` at `2026-06-12T18:19:21.246Z` showed `activeLineCount: 92`, `accountMonitorLineCount: 1`, `visibleLineCount: 2`, `automationLineCount: 3`, `flowScannerLineCount: 88`.
  - Same sample showed `targetFillLines: 200`, `protectedPriorityLineCount: 4`, `scannerEffectiveLineCap: 196`; formula check `200 - 4 = 196` matched.
  - Live model probe resolved header summary `92 of 200` and footer label `IBKR 92/200` from the same payload; footer detail included `2 Trade Options Chain active`.
  - Re-ran focused Pyrus tests: `17/17`.
  - Re-ran API admission tests: `9/9`.
  - Re-ran Pyrus and API typechecks; both passed.
  - Re-ran scoped `git diff --check`; passed.

## Remaining Unknowns / Risks

- Runtime remains degraded; this change removes UI fallback mismatches but does not fix scanner/bridge churn or API latency.
- `/api/settings/ibkr-lanes` timing out during pressure still limits live explainability.
- Need a separate backend slice to determine whether retained flow-scanner option demand is causing avoidable full option-stream reconfiguration churn.
- Current runtime is serving the derived Flow Scanner cap policy after user rebuild.

## 2026-06-12 IBKR Header Disconnected While Lines Nonzero

- User reported current runtime showed app-side IBKR line usage while the header said disconnected and IB Gateway itself looked connected.
- Live evidence at `2026-06-12T18:30-18:32Z`:
  - `/api/session` returned `ibkrBridge: null`.
  - `/api/diagnostics/runtime` showed IBKR configured with runtime override active and desktop agent online, but bridge health was backed off: `ibkr_bridge_health_backoff`, last failure `HTTP 502 Bad Gateway: error code: 502`.
  - Direct probe of the stored bridge tunnel URL showed `/readyz`, `/healthz`, `/diagnostics/lanes`, and `/async-sidecar/health` all returned HTTP `502`, so the API is not reaching the bridge package through the Cloudflare tunnel.
  - `/api/settings/ibkr-line-usage?detail=debug` still showed `admission.activeLineCount: 1`, but `bridge.activeLineCount: null`, `bridge.error: HTTP 502 Bad Gateway`, and active fallback provider counts were cache-backed, not live IBKR broker lines.
- Root cause for the UI mismatch: compact header/footer IBKR line display was using app admission demand (`Total app`) as if it were active broker-line usage. Admission demand can remain nonzero while bridge diagnostics are unavailable or fallback/cache is serving data.
- Small frontend package fix:
  - `ibkrPopoverModel.js` compact line usage now reads `lineUsage.bridge` and no longer falls back to the Total app row or allocation target.
  - `FooterMemoryPressureIndicator.jsx` IBKR source pressure bar now reads `lineUsage.bridge` and no longer falls back to total app/admission/allocation counts.
  - `runtimeControlModel.js` bridge-line normalization now ignores `null`/`undefined`/empty bridge fields before numeric conversion, preventing missing bridge diagnostics from becoming `0 of 0`.
- Live model probe after the fix against the current runtime payload:
  - `admissionActive: 1`
  - `bridgeActive: null`
  - `bridgeError: HTTP 502 Bad Gateway: error code: 502`
  - `compactSummary: "—"`
  - app-demand detail still reports `lineUsageSummary: "1 of 200"`
  - footer reports `IBKR --` / `IBKR line usage unavailable`
- Validation:
  - `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/FooterMemoryPressureIndicator.test.mjs src/features/platform/ibkrPopoverModel.test.mjs` passed: `13/13`.
  - `pnpm --filter @workspace/pyrus run typecheck` passed.
  - `pnpm --filter @workspace/pyrus run build` passed.
- Remaining package issue: the actual bridge/tunnel is still returning Cloudflare 502. The UI no longer reports cache/admission demand as broker data lines, but a separate bridge package/tunnel slice is needed to restore API bridge health.

## 2026-06-12 Header Active Bridge Status Correction

- User clarified to assume the bridge/Gateway is up and focus on app/UI code.
- Header path confirmed:
  - `HeaderStatusCluster.jsx` builds `gatewayConnection` from `getIbkrConnection(session, "tws")`.
  - It then builds `gatewayBrokerSnapshot` with `buildIbkrConnectionSnapshot`.
  - It passes `gatewayBrokerSnapshot.runtimeDiagnostics` to `buildHeaderIbkrTriggerModel`, which calls `resolveIbkrGatewayHealth`.
- Root cause for the red/offline header under the current session shape:
  - `/api/session` can have no `ibkrBridge` object while `session.runtime.ibkr.runtimeOverrideActive === true` and `desktopAgentOnline === true`.
  - `buildIbkrConnectionSnapshot` correctly preserves active override/helper context, but coerces missing configured health proof to `healthFresh: false`.
  - `resolveIbkrGatewayHealth` previously only treated stale health as pending when it also had reachable/socket/auth proof, so active bridge context without fresh proof fell through to `Offline`.
- Fix:
  - `resolveIbkrGatewayHealth` now treats stale health with active bridge context (`desktopAgentOnline` or `runtimeOverrideActive`) as `Health Pending`/warning, not `Offline`.
  - It does not mark the broker ready; inactive unreachable bridge payloads still resolve to `Offline`.
- Regression coverage:
  - Added `closed IBKR trigger treats active bridge context with missing health proof as pending`.
  - Existing inactive unreachable regression still asserts `Offline`.
- Live-shape source-model probe against current `/api/session`:
  - `sessionConfigured: true`
  - `sessionHasIbkrBridge: false`
  - `runtimeOverrideActive: true`
  - `desktopAgentOnline: true`
  - `healthFresh: false`
  - resulting `headerHealth.status: "stale"`, label `"Health Pending"`
  - resulting `headerIssue.key: "stale"`, severity `"warning"`
- Validation:
  - `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/ibkrPopoverModel.test.mjs src/features/platform/FooterMemoryPressureIndicator.test.mjs` passed: `14/14`.
  - `pnpm --filter @workspace/pyrus run typecheck` passed.
  - `pnpm --filter @workspace/pyrus run build` passed.
  - `git diff --check` passed for touched API/Pyrus/handoff files.
- Runtime note:
  - `node artifacts/pyrus/scripts/checkDevRuntime.mjs` at `2026-06-12T18:52:49.426Z` found one Vite server and one API server.
  - It warned the API process started before the latest API bundle rebuild, so live API behavior should not be used to validate backend changes until the app is restarted again.

## 2026-06-12 Account Monitor Real + Shadow Position Demand

- User asked whether both real and shadow positions are accounted for in account-monitor broker lines.
- Observed runtime before the fix:
  - `/api/accounts/combined/positions?mode=live&assetClass=all&detail=fast&liveQuotes=false` returned `3` real positions with `2` option positions under `F` and `SPY`.
  - `/api/settings/ibkr-line-usage?detail=full` showed only `account-monitor-live: 1`, with the active account-monitor option line for shadow/automation `AIP`; real `F`/`SPY` option positions were absent from account-monitor demand.
  - Shadow positions endpoint timed out on the 5s probe, so shadow runtime count was not independently confirmed in that sample.
- Source root cause:
  - `getAccountPositions` suppressed real account-position demand declaration when callers used `liveQuotes:false` and/or `detail:"fast"`.
  - Account page real and inactive-real paths intentionally request `detail:"fast", liveQuotes:false`, so real equity/option position demand could disappear while shadow demand remained covered by shadow live quote paths.
  - The same wrapper-level declaration used filtered response rows, so asset filters could also drop demand for non-visible option positions.
- Fix:
  - `artifacts/api-server/src/services/account.ts` now collects `allPositions` before applying the asset filter.
  - Real account-monitor equity and option demand is declared inside `getAccountPositionsUncached(...)` from all open real positions, independent of `detail`, `liveQuotes`, and visible asset filter.
  - Equity demand declaration uses `hydrate:false`, so it admits account-monitor lines without turning fast/no-live-quote account loads back into blocking quote hydration.
  - The public wrapper no longer gates demand declaration on `liveQuotes`/`detail`; `liveQuotes:false` still prevents blocking quote hydration.
- Regression:
  - Added `artifacts/api-server/src/services/account-position-market-data-demand.test.ts`.
- Validation passed:
  - `pnpm --filter @workspace/api-server exec tsx --test src/services/account-position-market-data-demand.test.ts`
  - `pnpm --filter @workspace/api-server exec tsx --test src/services/account-page-streams.test.ts`
  - `pnpm --filter @workspace/api-server exec tsx --test src/routes/account-positions-route.test.ts`
  - `pnpm --filter @workspace/api-server run typecheck`
  - `pnpm --filter @workspace/api-server run build`
  - `git diff --check -- artifacts/api-server/src/services/account.ts artifacts/api-server/src/services/account-position-market-data-demand.test.ts`
- Runtime note:
  - The API build succeeded, but the running API process will not reflect the source fix until the normal app restart/rebuild path reloads the backend.
