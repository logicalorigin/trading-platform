# WO-PV-DIAG Report

## Observed

- `artifacts/pyrus/src/screens/DiagnosticsScreen.jsx` had `loadHistoryAndEvents` issuing history and event refresh promises without a generation check, and both failures were caught with empty handlers.
- The browser metrics effect started collection immediately and every 30 seconds, but it did not await `postClientMetrics`, and `postClientMetrics` swallowed fetch failures internally.

## Changed

- Added a history/events refresh generation token so only the latest refresh commits `historyData`, `events`, or refresh error state.
- Replaced silent history/event refresh catches with visible `historyEventsRefreshError` state shown in the Events panel.
- Made `postClientMetrics` return a promise and reject on non-2xx responses.
- Added a browser metrics in-flight guard so collection/posting cannot overlap.
- Added visible `browserMetricsPostError` state in the Browser Events panel and records an intentional warning event when browser metrics refresh/posting fails.

## Verification

- Ran a lightweight Node unit check against `DiagnosticsScreen.jsx` only.
- Result: `DiagnosticsScreen refresh/metrics unit checks passed`.

## Not Run

- Browser, Playwright, e2e, project-wide typecheck, and full-suite tests were not run per work-order constraints.
