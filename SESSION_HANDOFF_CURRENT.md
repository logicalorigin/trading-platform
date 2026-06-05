# Current Session Handoff

This is a pointer to the active durable handoff. Do not use this file as the full session narrative.

- Last Updated (MT): `2026-06-05 15:29:38 MDT`
- Last Updated (UTC): `2026-06-05T21:29:38Z`
- Native Codex Session ID: `019e9923-c551-74c0-8f7a-4f4419b923ee`
- Summary: 2026-06-05 15:29:38 MDT | 019e9923-c551-74c0-8f7a-4f4419b923ee | GEX strikes are sourced and half-dollar filtered before display.
- Handoff: `SESSION_HANDOFF_2026-06-05_019e9923-c551-74c0-8f7a-4f4419b923ee.md`
- Master Index: `SESSION_HANDOFF_MASTER.md`

## Current Status

- Latest redirect: signal bubbles are Massive-backed and should not depend on IBKR bridge health.
- Root cause observed in source: Signals/STA matrix hydration was still visibility-gated. `SignalsScreen` refused to request hydration until `visibleHydrationSymbols.length > 0`, and `PlatformApp` treated the Signals matrix runtime as not ready unless priority/visible symbols existed.
- Fixed: removed the visible-row prerequisite from `SignalsScreen` hydration request and changed `PlatformApp` readiness to require the request symbol universe, not visible/priority rows.
- Follow-up fix: after gate removal, hydration priority still came only from `visibleHydrationSymbols`; rows could keep only their primary 5m state while non-5m cells waited behind broad universe rotation. Priority now uses selected symbol, visible symbols when available, then filtered rows as the no-visibility fallback; Signals requests are tagged into the STA exact-cell lane.
- STA table fix: `OperationsSignalTable` and `PlatformAlgoMonitorSidebar` now send the full row universe as `symbols` and the visible/page rows as `prioritySymbols`; `PlatformApp` also recognizes `algo-signal-table` as a signal-matrix surface request so retained/warm STA requests are not discarded.
- No-batching fix: removed the Signals pre-plan `2/4` symbol caps, removed the platform signal-matrix `24/36/48` cell/task caps, and removed the API `/api/signal-monitor/matrix` exact-cell cap. A 500-symbol x 6-timeframe matrix now plans 3,000 cells in one request with `queuedTaskCount: 0`.
- Repo test-surface cleanup was committed as `4e41e12 chore: remove repo test surface` and pushed by the user.
- Historical markdown/handoff references to retired validation commands and files were mechanically rewritten so repo searches no longer surface old executable names outside local cache/vendor/agent-skill areas.
- Signals page layout fix: table now keeps a real minimum height and the page scrolls instead of compressing the table when the header stack grows.
- Signals table density pass: table edge/cell padding, column gaps, track widths, and inline secondary text were tightened in `artifacts/pyrus/src/screens/SignalsScreen.jsx`; focused Pyrus typecheck and scoped diff check pass.
- GEX audit/fix: the visible GEX page strike profile, heatmap, OI profile, and table are sourced from `gexData.options`; the derived `Gamma Price Profile` sampled +/-5% spot levels and could show non-contract prices that looked like strikes. Removed that chart, its IV scenario control, and the dead `gammaPriceProfile` helper.
- GEX strike-grid fix: `normalizeGexOptionChain` and `normalizeGexResponseOptions` now reject provider rows whose strike is not on a `.00/.50` half-dollar grid before aggregation. The GEX table, strike profile chart, OI chart, heatmap strike labels, and call/put wall tiles now format strike values with exactly two decimals.
- Massive local bar cache: added `artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts`, an API-server-owned cache that subscribes to Massive stock minute aggregates, stores recent 1m bars in memory, rolls them up to matrix timeframes, asynchronously persists completed bars to `bar_cache`, and exposes diagnostics under `providers.massive.localBarCache`.
- Signal matrix path now starts the local bar cache daemon on API boot, permanently primes the cache with the resolved signal universe, primes it again from matrix requests, reads fresh local bars before provider work in `loadSignalMonitorCompletedBars`, and merges local bars after provider fetches.
- Store fix: `loadStoredMarketBars` now returns `massive_websocket` transport for WebSocket-backed cached rows and marks delayed rows from `massive-delayed-websocket` correctly.
- Signals page lazy-load fix: first-load matrix hydration now requests selected/visible symbols plus a 32-symbol fallback, then releases the full filtered-table hydration after idle/1.5s; `PlatformApp` now caps synchronous optimistic pending-state merge work at 240 cells while leaving the API request payload unchanged.
- Post-restart runtime verification passed: `/api/healthz` OK; `/api/diagnostics/runtime` shows `providers.massive.localBarCache.active: true`, `subscribedSymbolCount: 542`, `cachedSymbolCount: 133`, `minuteBarCount: 303`, `pendingPersistBarCount: 0`, `lastPersistError: null`; Massive websocket `status: ok`, `mode: real-time`, `subscribedSymbolCount: 500`, `lastError: null`.
- Exact matrix probe passed: RBLX/SPY x `1m/5m/15m/1h/1d` returned `10/10` hydrated `ok` cells with no missing cells.
- Verification passed: no repo-owned test paths/configs/runners match the cleanup scan; no retired validation command/file patterns remain in app/library/script code or historical markdown outside local cache/vendor/agent-skill areas; JSON manifests parse; `pnpm run audit:replit-startup`, `pnpm --filter @workspace/scripts run typecheck`, `pnpm --filter @workspace/pyrus run typecheck`, and `git diff --check` pass.

## Next Recommended Steps

1. Review the broad dirty worktree before staging; historical reference cleanup is working-tree only.
2. Restart or let the normal Pyrus dev runner rebuild so the frontend and API include the latest signal-matrix work.
3. Recheck the Signals page in-browser; initial route load should render before broad matrix hydration, then fill the remaining bubbles after idle.

## Validation Snapshot

- `git diff --check -- artifacts/pyrus/src/screens/SignalsScreen.jsx artifacts/pyrus/src/features/platform/PlatformApp.jsx`
- `git diff --check -- artifacts/pyrus/src/features/platform/PlatformAlgoMonitorSidebar.jsx artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx artifacts/pyrus/src/features/platform/PlatformApp.jsx artifacts/pyrus/src/screens/SignalsScreen.jsx`
- `node --input-type=module` planner smoke: 500 symbols, 3,000 cells, 0 queued tasks
- `pnpm -C artifacts/pyrus run typecheck`
- `pnpm -C artifacts/api-server run typecheck`
- `pnpm -C artifacts/api-server run build`
- Inline cache smoke: ingest five RBLX Massive AM minute bars and roll up one completed 5m bar.
- Signals planner smoke: 500 symbols x 5 table intervals plans 32 symbols/160 cells initially and 500 symbols/2,500 cells after full hydration is released.
- `/signals?pyrusQa=safe` dev HTML probe: TTFB `0.030807s`, total `0.030973s`.
- `pnpm -C artifacts/pyrus run build`
- `pnpm run audit:replit-startup`
- `pnpm --filter @workspace/scripts run typecheck`
- `pnpm --filter @workspace/pyrus run typecheck`
- `git diff --check`
- GEX strike guard inline smoke: `.25/.75` provider strikes rejected; `.00/.50` rows survive through `aggregateMetrics`.
