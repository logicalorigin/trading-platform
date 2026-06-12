# Pressure-gating audit (WIP — PARKED mid-investigation 2026-06-11)

Task: find remaining pressure-related gating; verify every part respects the TRUE
internal (container memory/CPU/event-loop/DB pool/disk) and external (IBKR +
market-data provider rate limits, DB size cap) limits. Plus: add a small red "!"
UI indicator anywhere work is backed off due to pressure.

Status: parked before the fan-out auditors ran. Below is what's confirmed + the plan.

## Confirmed: the core is already true-limit-aware (good)

`artifacts/api-server/src/services/resource-pressure.ts` is the canonical source and
is well-built:
- `resolveApiRssPressureThresholds()` reads the REAL cgroup limit
  (`/sys/fs/cgroup/memory.max`) and, when ≥8192 MB, sets RSS watch/high at
  **37.5% / 50% of true container memory** (fallback 3072/4608 MB; env override
  `API_RSS_PRESSURE_WATCH_MB` / `_HIGH_MB`). So it respects the true container size.
- `resolveApiRssHardBlockMb()` returns `Infinity` — RSS no longer hard-blocks
  (the "stop shedding under resource pressure" direction).
- Heap watch/high = 70/80%; event-loop delay watch/high = 60/250 ms.
- `resourceLevel` (what TRADING caps gate on) = max(rss, heap, event-loop) and
  deliberately EXCLUDES request latency, so a slow broker route can't freeze
  signal/action work. `level` (incl. latency) drives display + deferred analytics.
- Caps at watch/high: signal-options `actionScansAllowed`, `positionMarksAllowed`,
  `watchlistPrewarmAllowed` → false (deployment scans + signal refresh still on).

## What the audit still needs to check (NOT yet done)

1. **Internal consumers — stale/ad-hoc thresholds.** Do all consumers read the
   canonical snapshot, or do some keep their own numbers? Prime suspects:
   - `services/diagnostics.ts` `api-memory-pressure` — is it a SECOND threshold
     separate from resource-pressure.ts (earlier we saw it fire ~1.6 GB RSS while
     the container is 16 GB)? Does it only report, or gate anything?
   - `runtime-flight-recorder.ts` `RSS_PRESSURE_*`; `signal-monitor-local-bar-cache.ts`
     `DEFAULT_MEMORY_RETENTION_MS`; `signal-options-worker.ts` /
     `overnight-spot-worker.ts` `*_RESOURCE_PRESSURE_RETRY_MS=30s`;
     `storage-health.ts` `STORAGE_WARNING_DATABASE_MB` vs the true 15 GB DB cap.
   - DB pools: API pg pool max vs Postgres `max_connections`; Rust worker
     `MARKET_DATA_WORKER_DB_POOL_MAX=2`.
2. **External IBKR limits.** `ibkr-historical-admission.ts` (50/s, conc 50),
   `bridge-governor.ts` (account/quotes/orders concurrency), `ibkr-line-usage.ts` /
   `ibkr-lanes.ts` / `ibkr-live-demand-coordinator.ts` (market-data line budget),
   `providers/ibkr/bridge-client.ts` 429/`retry-after`/`x-ratelimit-reset` handling.
   Verify limits match IBKR's true pacing + the account's real entitlement, and
   that NO IBKR path bypasses the governor/admission.
3. **External market-data limits.** `market-data-admission.ts`, `providers/massive/`,
   `providers/fmp/client.ts`, `options-flow-scanner.ts` (conc 8, 45s timeout),
   `gex-universe-refresh.ts` (conc 25/50) — 429 handling, compounding concurrency
   bursts vs provider true limits, ungated direct fetches.
4. **UI "!" indicator.** Map every "backed off due to pressure" condition →
   backend status field (resource-pressure caps, admission/governor `degraded`,
   scanner `skipped`, storage pressure) → the runtime-status endpoints the UI polls
   (`platform-runtime-status.ts`, `routes/platform.ts`) → where in
   `artifacts/pyrus/src/` (HeaderStatusCluster + per-feature components) the red "!"
   should attach. Likely needs a per-feature `backedOff` flag in runtime status.

## Threshold inventory (grep snapshot)
Concurrency/limit constants live across: `ibkr/client.ts:151` (16),
`ibkr-historical-admission.ts:52,55` (50/50), `signal-monitor.ts:333,347,349`
(2/10/6), `options-flow-scanner.ts:138` (8), `platform.ts:764,1954,5317,8537,10919`,
`gex-universe-refresh.ts:20,21` (25/50), `runtime-flight-recorder.ts:436,437`,
`diagnostics.ts:207-209`, `signal-options-automation.ts:183,184,214`.

Resume by running the 4 fan-out auditors (internal, IBKR, market-data, UI-mapping).
