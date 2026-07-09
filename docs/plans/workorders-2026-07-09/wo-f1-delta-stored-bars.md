# WO-F1-DELTA — stored-bars delta reads (the F1 real demand fix)

> **HEADLESS WORKER PREAMBLE:** You are a headless fix worker. Do NOT create/update SESSION_HANDOFF_*
> files; do NOT read ~/.claude/, .claude/skills/, agents/, or AGENTS.md session rituals. **No git**
> (the leader reviews and commits). No app restart/reload/rebuild, no .replit edits, no DB
> maintenance. Ponytail: smallest correct diff that satisfies the spec.

## Problem (evidence)
Universe eval re-reads the full warmup window (PYRUS_SIGNALS_SIGNAL_WARMUP_BARS=1000 bars) from the
bar_cache table for every (symbol × timeframe ∈ {15m,1h,1d} × source) EVERY cycle via
`loadStoredMarketBars` (market-data-store.ts ~:508-556), through the signal-monitor prefetch
(`runWithSignalMonitorStoredBarsPrefetch`, signal-monitor-local-bar-cache.ts ~:1178). node-postgres
`_parseRowAsArray` was 50.7% of all sampled allocation (47% midday even after other fixes) — this
re-read is the app's #1 allocator and DB-pool consumer. Warmup CANNOT be reduced:
docs/plans/warmup-sensitivity-2026-07-09.md proves 1000 is the smallest byte-identical N.

The cross-cycle cache already exists (`storedBarsCrossCycleCache`, LRU 30000) but NEVER hits:
commit fe6217e2 (F1B) split the counters and proved invalidationFull=6319, invalidationDelta=0,
hit=0 — the delta path is structurally unreachable because the write side never emits
delta-eligible invalidations; every persist storms a FULL invalidation. Read
`.codex-watch/wo-fb2-f1b-report.md` and the F1B counter code before writing anything.

## Approved fix
Make the delta path reachable, flag-gated:
1. **Write side (market-data-store.ts):** where bars are persisted/upserted, emit a precise
   per-(symbol, timeframe, source) change notification carrying the new max `starts_at` (and whether
   the write was an append at the tail vs a historical correction). A historical correction (any
   written bar with starts_at <= the previously known max) MUST still trigger FULL invalidation.
2. **Read side (signal-monitor-local-bar-cache.ts):** on a warmup read where the cross-cycle cache
   holds a window for the key and only tail-appends occurred since, read ONLY bars with
   `starts_at > cachedMaxStartsAt` (small LIMIT), verify contiguity (first new bucket must extend the
   cached tail; on any gap/overlap anomaly fall back to the full read and count it), append + trim to
   the warmup limit, serve from cache.
3. **Flag:** `PYRUS_SIGNALS_STORED_BARS_DELTA` = off (default) | shadow | on. off = byte-identical
   behavior to today (full reads; the only added instruction may be the mode check). shadow = serve
   the FULL read, also compute the delta-served window and deep-compare on a deterministic sample;
   count mismatches. on = serve the delta path with full-read fallback on any anomaly.
4. **Counters:** extend `getSignalMonitorLocalBarCacheDiagnostics()` with
   `storedBarsDelta: {mode, deltaReads, fullReads, appliedAppends, gapFallbacks, shadowChecks,
   shadowMismatches}` (this surface already flows to /api/diagnostics/runtime).

## Hard constraints
- Edit ONLY: `artifacts/api-server/src/services/market-data-store.ts`,
  `artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts`, plus ONE test file for each
  (extend `signal-monitor-local-bar-cache-prefetch.test.ts` / `market-data-store-pglite.test.ts` or
  add one sibling test file per source file). Do NOT touch signal-monitor.ts (an incremental-eval
  soak is running against it tonight).
- Flag unset/off must be byte-identical (tests must prove serving parity: delta-served window
  deep-equals the full read for append sequences, corrections, gaps, and cold cache).
- Validation you run: typecheck via `pnpm --filter @workspace/api-server run typecheck` and ONLY the
  test files you touched via `pnpm --filter @workspace/api-server exec node --import tsx --test <files>`.
  If a validation refuses with rc=75 ("validation lock is held"), wait 30s and retry — other lanes share the lock.

## Deliverable
Report to `.codex-watch/run-wo-f1-delta-report.md`: change sites (file:line), the invalidation
semantics table (event → cache action), counter locations, test results, and any deviation with
rationale. Final message ≤ 5 lines.
