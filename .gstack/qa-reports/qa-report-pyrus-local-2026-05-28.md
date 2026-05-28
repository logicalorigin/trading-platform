# QA Report - PYRUS Local Signal Surfaces

- Date: 2026-05-28
- Target: `http://127.0.0.1:18747/`
- Scope: resumed `$qa` for watchlist signal bubbles, Signals-to-Action, and Algo route first paint after the new algo-strategy work
- Mode: focused browser/API QA with source fixes and re-test
- Browser: `.agents/skills/gstack/browse/dist/browse`
- Baseline score: 72/100
- Final score: 78/100

## Summary

QA found 1 high-severity runtime issue. The signal data surfaces themselves passed, but the Algo route was overloaded enough that the main pane stayed behind the global PYRUS route loader while the right Algo Monitor rail was already live.

Applied source fixes to prioritize the active route and reduce background competition during first paint. Re-test improved the failure from "Algo route never mounts within the bounded window" to "Algo route shell mounts, right rail is live, and the center pane is on the scoped Algo loading state." Full Algo control content still does not reliably render under runtime/API pressure, so the issue is classified as best-effort and partially verified, not fully closed.

QA result: `DONE_WITH_CONCERNS`.

## Evidence

Before fix:

- `.gstack/qa-reports/screenshots/qa-algo-after-60s-2026-05-28.png`: Algo route still on the global PYRUS loader after navigation.
- `.gstack/qa-reports/screenshots/issue-001-final-algo-after-45s-2026-05-28.png`: fresh Market -> Algo run; right rail has live `SIGNALS -> ACTIONS`, but the main pane remains on the global route fallback.
- `.gstack/qa-reports/screenshots/signal-qa-fresh-browser-algo-90s-2026-05-28.png`: fresh browser saw `ERR_CONNECTION_REFUSED` during the earlier supervisor restart window.

After fix:

- `.gstack/qa-reports/screenshots/issue-001-after-static-chain-fix-algo-45s-2026-05-28.png`: fresh Market -> Algo run after source fixes. Algo is the active screen, right rail is live, and the center pane no longer shows the global PYRUS loader.
- `.gstack/qa-reports/screenshots/issue-001-after-static-chain-fix-algo-90s-2026-05-28.png`: extended sample still shows residual instability/API pressure; the app fell back to Market and console/network contained 503s.

## Issue 001 - Algo Route First Paint Blocked By Runtime Pressure

- Severity: High
- Category: Functional / Performance / Runtime stability
- Status: Best-effort / partially verified
- Fix commits:
  - `52d003e fix(qa): ISSUE-001 - prioritize Algo module load before live data`
  - `759fb06 fix(qa): ISSUE-001 - make background screen preloads sequential`
  - `c83acf9 fix(qa): ISSUE-001 - shrink active Algo screen module chain`
  - `002e1a1 fix(qa): ISSUE-001 - prioritize active route loading`

Observed before fix:

1. Opened the local PYRUS app.
2. Waited for Market signal rail/sidebar hydration.
3. Navigated to Algo.
4. Confirmed Algo Monitor right rail showed Signals-to-Action rows.
5. Observed the central Algo route remain on the global PYRUS loader beyond the bounded QA window.
6. A fresh-browser run later hit `ERR_CONNECTION_REFUSED` while the app supervisor was restarting.

Source changes applied:

- Delayed and staggered background operational screen preloads so they stop competing with the active route.
- Preloaded the Account platform screen as a priority sibling to the initial screen so Account QA does not wait for low-priority background warmup.
- Added priority active-screen code preload tracking.
- Temporarily gates non-critical quote/account/aggregate streams while priority screen code preload is pending.
- Lazy-loaded heavy Algo screen dependencies that previously extended the active route module chain.
- Added/updated source tests to lock the active-route preload and stream-gating behavior.

Re-test result:

- Fresh browser state, local storage cleared.
- Loaded Market, waited 20 seconds, navigated to Algo through the app router, waited 45 seconds.
- JS/browser state showed:
  - `activeScreen: "algo"`
  - `hasAlgoScreen: true`
  - `hasDeployment: true`
  - `hasPyrusLoading: false`
  - scoped loader: `algo-live-loading`
  - right rail `SIGNALS -> ACTIONS`: present
  - console errors in the 45s sample: none

This verifies the route-level global fallback regression is fixed. It does not verify that the full Algo live/control content reliably reaches ready state under current API/cache pressure.

Residual issue:

The full Algo page can still remain on `Loading signal operations...` for too long, and the 90s sample showed 503s plus a route fallback to Market. The likely remaining cause is API/request fanout and large first-paint Algo payloads, especially quote/bar/logo/algo live calls, rather than the route-level module chain alone.

Recommended follow-up:

1. Cap or paginate the large Algo live/event/state payloads used during first paint.
2. Reduce logo/bar/quote fanout while the active route is still warming.
3. Split the remaining Algo live page/control container into a fast shell plus deferred diagnostics/history sections.
4. Add a browser regression check that fails if Algo remains on the scoped live loader after a bounded window while the right rail is already live.

## Passed Checks

- Market signal rail hydrated with fresh/stale 5m states after one refresh window.
- Visible watchlist/sidebar dots hydrated after one refresh window.
- Algo Monitor right rail populated Signals-to-Action rows with fresh candidates.
- Route-level Algo shell now mounts within the bounded post-fix QA window.
- Targeted unit tests and Pyrus typecheck passed after the source changes.

## Deferred

- Full clean QA pass for the Algo control container under load. Current status is improved but not ship-clean because the scoped Algo live loader and 503 pressure remain.
