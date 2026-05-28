# DEBUG REPORT: Signals-to-Action Signal Lag

- **Symptom:** The Signals-to-Action container showed newest rows roughly 15-20+ minutes old and often sat on `Awaiting scan`.
- **Root cause:** Three separate stale paths compounded:
  - Massive/Polygon-equity signal-matrix bar requests reused stored recent bars under the generic `max(20m, 3 bars)` freshness tolerance, so 5m signal bars could be accepted while 10-15 minutes behind.
  - Signal-options state surfaced every signal-monitor row marked `fresh`; the monitor default `freshWindowBars: 3` allowed action rows up to 3 completed bars old.
  - `/algo/deployments/:id/signal-options/state` and `/cockpit` were classified as `deferred-analytics`, so under pressure they became cache-only and React Query could keep showing an old response.
- **Fix:**
  - Signal-matrix Massive realtime bars now force provider gap-fill once coverage is more than one native bar behind.
  - Signal-options action rows and scan work now only accept current/one-bar-old signals (`barsSinceSignal <= 1`), not the 3-bar monitor diagnostic window.
  - Historical signal-option event candidates no longer rehydrate into active action rows unless their current signal is still actionable.
  - Signal-options `state` and `cockpit` routes are active-screen routes; only performance analytics remains deferred/cache-only.
- **Evidence:**
  - Passed `pnpm --dir artifacts/api-server exec node --import tsx --test --test-concurrency=1 src/services/route-admission.test.ts src/services/signal-options-automation.test.ts src/services/signal-options-worker.test.ts src/services/signal-monitor.test.ts src/services/option-chain-batch.test.ts` (`201` tests).
  - Passed `pnpm --filter @workspace/api-server typecheck`.
  - Passed `pnpm --filter @workspace/api-server run build`.
  - Passed scoped `git diff --check`.
  - Live probe at `2026-05-28T20:21Z`: `/api/algo/deployments/paper-enabled/signal-options/state` returned `200`, route class `active-screen`, pressure `watch`, zero stale signal rows, zero stale candidate rows.
- **Status:** DONE.

## Watchlist Signal Bubbles

- **Symptom:** Watchlist sidebar signal dots were not consistently hydrated/refreshed even though Massive could return fresh matrix bars when directly requested.
- **Root cause:** The client signal-matrix scheduler treated a once-hydrated symbol as hydrated forever, and its foreground priority list included the entire active watchlist while the universe included every saved watchlist. Under `watch` pressure that meant only two symbols per poll could be refreshed, so visible sidebar dots could wait behind non-visible rows and stale rows from other watchlists.
- **Fix:**
  - Signal-matrix states now re-enter the request plan when `latestBarAt` is stale for the timeframe/poll cadence.
  - `PlatformApp` passes `nowMs` into the scheduler so stale detection runs on every poll.
  - The matrix universe is now selected/current visible watchlist rows, open positions, recent monitor symbols, then the rest of the active watchlist, bounded by pressure caps.
  - The foreground priority list is now selected/visible/open-position/recent-monitor symbols only; the rest of the active watchlist rotates as background.
- **Evidence:**
  - Direct matrix probe at `2026-05-28T20:22Z` returned fresh Massive-backed latest bars when asked: `2m 20:22`, `5m 20:15`, `15m 20:00`.
  - Passed `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/platformRootSource.test.js src/features/platform/signalMatrixScheduler.test.js src/features/platform/watchlistModel.test.js` (`71` tests).
  - Passed `pnpm --filter @workspace/pyrus run typecheck`.
  - Passed `pnpm --filter @workspace/pyrus run build`.
  - Passed scoped `git diff --check`.
- **Status:** DONE.
