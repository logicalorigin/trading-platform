# Route Loading Diagnosis Handoff

- Last Updated (MT): `2026-06-03 09:09:50 MDT`
- Last Updated (UTC): `2026-06-03T15:09:50.000Z`
- Native Codex Session ID: `live-route-loading-diagnosis`
- Scope: Account, Research, Diagnostics, and Settings route/container loading after safe-QA restart.

## Summary

Investigated slow page/container rendering after the Settings loading audit. The confirmed runtime blockers were:

- Account mounted many visible `MarketIdentityMark` instances and issued one `/api/universe/logos` request per symbol. The backend already accepts comma-separated symbols, so the frontend now batches same-turn logo hydration.
- Diagnostics safe-QA opened visible pages while posting client telemetry to endpoints classified as deferred analytics, causing expected 429s to appear as console errors. The frontend now no-ops those telemetry posts in safe-QA.
- `GET /api/diagnostics/thresholds` is visible UI data for Settings/Diagnostics panels, but route admission classified it with deferred diagnostics history. The API classifier now treats threshold reads as `active-screen`.
- After restart validation, the threshold endpoint was admitted but still measured slow because every threshold read hit the database for overrides. The diagnostics service now caches override rows briefly and invalidates after threshold saves.
- The waterfall audit still treated `PhotonicsObservatory` as Research first-viewport critical. The current render policy is shell-first, with the observatory allowed to hydrate behind a visible workspace fallback, so the audit contract was updated.
- Full mocked route waterfall audit then exposed Research nested preload readiness. `preloadDynamicImport` and the screen module preloader now await declared nested first-viewport preloads before marking a route module ready.
- Full live safe-QA route probing then exposed two Trade-specific issues: visible REST quote fallback reads were still classified as shed-able live data, and `TradeEquityPanel` could call a parent workspace setter from inside a functional state updater. Trade quote fallback now sends `trade-visible` admission headers, quote snapshots honor visible request context, and timeframe sync no longer performs side effects inside state updater functions.

## Files Touched

- `artifacts/pyrus/src/features/platform/marketIdentity.jsx`
- `artifacts/pyrus/src/features/platform/marketIdentity.test.js`
- `artifacts/api-server/src/services/route-admission.ts`
- `artifacts/api-server/src/services/route-admission.test.ts`
- `artifacts/api-server/src/services/diagnostics.ts`
- `artifacts/api-server/src/services/diagnostics.test.ts`
- `artifacts/pyrus/src/screens/DiagnosticsScreen.jsx`
- `artifacts/pyrus/src/screens/diagnostics/localAlerts.test.js`
- `artifacts/pyrus/e2e/app-waterfall-audit.spec.ts`
- `artifacts/pyrus/src/lib/dynamicImport.ts`
- `artifacts/pyrus/src/features/platform/screenModulePreloader.js`
- `artifacts/pyrus/src/features/platform/platformRootSource.test.js`
- `artifacts/pyrus/src/screens/TradeScreen.jsx`
- `artifacts/pyrus/src/features/trade/TradeEquityPanel.jsx`
- `artifacts/pyrus/src/features/charting/chartHydrationWiring.test.js`

Note: these files already had unrelated dirty work in the workspace. Do not interpret the full file diff as only this session's work.

## Validation

Passed:

- `pnpm exec node --import tsx --test src/features/platform/marketIdentity.test.js` from `artifacts/pyrus`
- `pnpm exec node --import tsx --test src/screens/diagnostics/localAlerts.test.js` from `artifacts/pyrus`
- `pnpm exec node --import tsx --test src/services/route-admission.test.ts` from `artifacts/api-server`
- `pnpm exec node --import tsx --test src/services/diagnostics.test.ts` from `artifacts/api-server`
- `pnpm exec tsc -p tsconfig.json --noEmit` from `artifacts/pyrus`
- `pnpm exec tsc -p tsconfig.json --noEmit` from `artifacts/api-server`
- `pnpm run build` from `artifacts/api-server`
- `PYRUS_PLAYWRIGHT_NO_WEB_SERVER=1 pnpm exec playwright test e2e/app-waterfall-audit.spec.ts --project=chromium --grep "desktop" --reporter=list` from `artifacts/pyrus`
- `pnpm exec node --import tsx --test src/features/platform/platformRootSource.test.js` from `artifacts/pyrus`
- `pnpm exec node --import tsx --test src/features/charting/chartHydrationWiring.test.js` from `artifacts/pyrus`
- `PYRUS_PLAYWRIGHT_NO_WEB_SERVER=1 pnpm exec playwright test e2e/app-waterfall-audit.spec.ts --project=chromium --reporter=list` from `artifacts/pyrus`

Safe-QA browser probe against `http://127.0.0.1:18747/?pyrusQa=safe`:

- Desktop Account: shell `438ms`, ready `546ms`, 7 API responses total, `/api/universe/logos` count `3`, no busy containers, no console errors.
- Desktop Research: ready `944ms`, no busy containers, no console errors.
- Desktop Diagnostics: ready `856ms`, no busy containers, no console errors.
- Desktop Settings: ready `716ms`, no busy containers, no console errors.
- Second warm mobile pass: Account ready `1872ms` with one logo batch; Diagnostics ready `432ms`; Settings ready `274ms`; no failed responses or console errors.

Post-restart check confirmed `/api/diagnostics/thresholds` now returns `200` in safe-QA with `X-Pyrus-Route-Class: active-screen`. The threshold panel still revealed DB latency, so a short-lived threshold override cache was added and the API bundle was rebuilt.

Final post-restart verification confirmed the rebuilt cache is live:

- Direct safe-QA threshold reads: `54ms`, `52ms`, `43ms`, `38ms`.
- Settings System tab threshold rows were present at the first `200ms` sample with no loading text.
- Desktop/mobile Account, Research, Diagnostics, and Settings safe-QA probes had no failed responses, console errors, page errors, or stuck busy containers.

Full mocked waterfall audit now passes for all 11 routes on desktop and mobile. The latest mocked audit measured these route-ready times:

- Desktop: Market `107ms`, Signals `296ms`, Flow `771ms`, GEX `513ms`, Trade `442ms`, Account `402ms`, Research `319ms`, Algo `702ms`, Backtest `1099ms`, Diagnostics `416ms`, Settings `489ms`.
- Mobile: Market `23ms`, Signals `312ms`, Flow `664ms`, GEX `379ms`, Trade `420ms`, Account `378ms`, Research `366ms`, Algo `998ms`, Backtest `406ms`, Diagnostics `450ms`, Settings `283ms`.

Focused live mobile Trade probe after the frontend fix showed the `TradeEquityPanel` React warning is gone. The only remaining live probe console error was the expected stale-backend `429` for `/api/quotes/snapshot?symbols=SPY`; direct header checks showed the currently running API process still returns `X-Pyrus-Route-Class: live-data` even with `trade-visible` headers, because the API dev server runs the already-loaded `dist/index.mjs`. The code and API build are fixed; live validation of the quote-admission fix requires a Replit app restart.

## Next Steps

1. Keep extending this policy app-wide: visible page data is `active-screen`; telemetry/history/background enrichment is deferable or suppressed in safe-QA; decorative per-item fetches should batch.
2. Restart the Replit app before the next live Trade route probe so the rebuilt API route-admission bundle is active.
3. Treat remaining Diagnostics `DEGRADED`/`DOWN` status as backend health signals, not page/container loading regressions, unless they create new visible load blockers.
