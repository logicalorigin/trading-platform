# Live Session Handoff: Pressure / Bar-Cache Runtime Work

- Last Updated (MT): `2026-07-09 12:16:58 MDT`
- Last Updated (UTC): `2026-07-09T18:16:58Z`
- Session ID: `pending`
- Repo: `/home/runner/workspace`
- Workstream: continue pending runtime pressure work from subagent findings, focused on signal-monitor local bar-cache churn, high RSS/pressure, and runtime verification.

## Current Status

- User asked to proceed with pending work and subagent learnings, then requested quick autosave.
- Runtime constraint remains: use existing Replit runtime only, no sideports.
- Skills re-read/applied this turn: `ponytail`, `performance-optimization`, `gstack/investigate`, `session-handoff`.
- Current runtime snapshot from `/api/diagnostics/runtime` at about `2026-07-09T18:14:45Z`:
  - RSS about `2059 MB`, heap used about `1405 MB`.
  - ELU about `0.91`; display pressure high, finite resource/hard pressure watch.
  - DB pool driver showed `11/12 active, 1 waiting`.
  - Signal DB fallback showed `list_signal_monitor_events` statement timeout (`57014`).
- Full runtime diagnostics exposed local bar-cache counters:
  - `subscribedSymbolCount: 2000`, `cachedSymbolCount: 1927`, `minuteBarCount: 6622`.
  - `storedBarsCache.hitCount: 0`, `missCount: 4192`, `fullReadCount: 6`.
  - `invalidationCount: 1648`, `invalidationFullCount: 1648`.
  - `storedBarsRead.prefetchHitCount: 1276`, `fallbackCount: 122`, `fallbackNoPrefetchCount: 122`, `fallbackMismatchCount: 0`, `pressureSkipCount: 0`.
  - Live aggregate persistence is currently disabled in runtime (`liveAggregatePersistSkipCount` equals aggregate count, persisted count `0`).

## Active Edits

- `artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts`
  - Added a high-pressure guard in the unbatched `readStoredBars` fallback path: if API pressure level is high, it returns no durable stored bars instead of opening per-symbol pooled `bar_cache` reads.
  - Existing batched prefetch path remains intact; finite hard-block prefetch skip was already present in the dirty tree.
- `artifacts/api-server/src/services/signal-monitor-local-bar-cache-prefetch.test.ts`
  - Added regression test: direct no-prefetch local-bar read skips durable storage under high API pressure and increments pressure skip count without incrementing fallback count.

## Completed Before This Autosave

- Consolidated tracker/status for completed work from prior steps:
  - options OPRA identity/freshness, account REST/live duplication, SnapTrade timeout, offscreen algo polling, news fallback, diagnostics collector overlap, app-user/provider fallback, marketing dashboard cache/in-flight, stock quote/aggregate stream cap.
- Subagent learnings captured:
  - Franklin: option bid/ask path receives stale REST snapshots labeled live; OPRA identity/freshness fixed.
  - Galileo: route latency from marketing snapshot, accounts/SnapTrade, sparkline seed, diagnostics overlap, and account/news 503s from IBKR config.
  - McClintock: high ELU/RSS from 2000-symbol quote/aggregate firehose, local bar-cache churn, account boot fanout, IBKR retry noise.

## Validation Status

- Not yet run after the latest bar-cache guard/test edit.
- Recommended next commands:
  - `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-local-bar-cache-prefetch.test.ts`
  - `pnpm --filter @workspace/api-server run typecheck`

## Next Steps

1. Run the focused bar-cache prefetch test.
2. If it passes, run API typecheck.
3. Check `artifacts/api-server/src/routes/platform.ts` before typecheck: current source inspection showed a suspicious extra `});` near `/diagnostics/runtime` and `/accounts`; determine whether that is another agent's active WIP or a real syntax blocker before editing.
4. Reload/verify on existing Replit runtime only, then re-read `/api/diagnostics/runtime` and compare local bar-cache fallback/pressure counters, RSS, ELU, and slow-route timeout state.
