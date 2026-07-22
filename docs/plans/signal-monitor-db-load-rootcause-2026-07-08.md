# FABLE HANDOFF — signal-monitor DB-load / event-loop pressure + gapped-signal freeze

Date: 2026-07-08. From: Claude Code session 8d9ff43d. This is a self-contained execution brief for fable-mode.
Everything below is PROVEN from the live running process (CPU + allocation profiles + per-table DB rates) unless
labeled hypothesis. Work on branch `main`, NO side branch (standing user directive). The working tree is already
dirty (a large pre-existing uncommitted pile + this session's changes); do NOT `git checkout`/revert whole files.

## LATEST STATE (handoff — read first)
KEY REFRAME: the loop has TWO regimes (proven by live profiling):
- COLD (~12-15min after every restart; the app restarts externally ~every 10-15min so it is cold OFTEN): GC 32% +
  _parseRowAsArray 47.6% = bar_cache re-read firehose + STA churn. ADDRESSED by Stage 1 + codex bar_cache fix.
- WARM (steady state): GC gone, allocation collapsed (_parseRowAsArray drops out of the top entirely), BUT ELU
  still ~1.0 driven by the SIGNAL-MONITOR EVAL CPU: rebuilding each cell's completed-bar series every tick —
  getRecentStockMinuteAggregateHistory (3.3%), the 125xxx bar-building anons (~11%), stockMinuteAggregateToSignalMonitorBar
  + aggregateStockMinuteBarsForTimeframe (~4.5%), resolveSignalMonitorReferenceBar (2.7%), normalizeSymbol (1.6%).
  This is Stage 3 and is NOT GC/DB — it is per-eval computation over 2000 symbols.

DONE + LIVE + VERIFIED:
- Stage 1 DB cuts: STA writes 32->0/s, reads 133->4/s (measured warm); events getSignalDirectionsForSymbolAsOf
  6->1 DISTINCT ON (EXPLAIN-proven single index scan, not a regression). signal-monitor.ts:9941/9462/14895 +
  dead getTrendDirectionsForSymbol deleted.
- Stage 2 gap-fill (codex, DONE): signal-monitor.ts:4991 gap-detect + memory-only 1m fill for 1m/2m/5m/15m;
  :9818 stream eval uses gap-filling merge when a base exists. Parity test (gap-filled == contiguous from-scratch)
  + no-gap test added; 79 signal-monitor tests + typecheck green. 1h/1d DEFERRED (need >120h memory or a bounded
  DB fetch — do NOT hack it into the hot path). CAVEAT: fill needs the in-memory 1m cache warm (post-restart it is
  cold ~a few min), so MIDD only unfreezes once the local cache has today's session bars.
- Earlier: algo-screen IBKR cleanup (frontend chips + backend algo-gateway shadow readiness) + codex bar_cache
  memory-first promote-from-stream. All tested.

STAGE 2 VERIFIED (result): after reload, frozen 1m cells (bars_since_signal>1000) dropped 1142 -> 1018 in ~4min
and kept falling as the in-memory 1m cache warmed = the gap-fill unfreezes cells at scale. MIDD itself did NOT
unfreeze in 9min (still 7228 bss) — it is a low-liquidity edge case: too few 1m bars stream into memory to fill
its ~21.5h gap (or its signal genuinely has not crossed). FOLLOW-UP for the stubborn tail (illiquid + 1h/1d): a
bounded on-demand recent-history fetch to fill gaps the warm memory cache cannot cover.

NEXT (Stage 3 — warm ELU): reduce per-eval CPU, all behind byte-identical signal tests: (a) memoize the pure hot
fns normalizeSymbol + resolveSignalMonitorReferenceBar; (b) aggregate INCREMENTALLY (advance only the new bar, do
not re-aggregate the whole 240-window per tick); (c) fix the completed-bars memo key (signalMonitorStreamCompletedBarsCache,
~9533) so an unchanged cell reuses its series instead of rebuilding — the key bumps on every aggregate tick so it
misses. Then re-run cpuprof.mjs warm: getRecent/aggregate/125xxx% must fall, ELU off 1.0.

REPO STATE: everything uncommitted on `main` (user directive: main, no branch). Dirty tree includes a large
pre-existing pile + this session's edits (signal-monitor.ts, signal-options-automation.ts, market-data-store.ts,
signal-monitor-local-bar-cache.ts, platform.ts, algo-gateway.ts, + pyrus frontend). 2 pre-existing test failures
(MTF-default requiredCount, position-fold golden) are from the dirty tree, NOT this work. Nothing committed.

## MISSION
The api-server event loop is pinned ~100% and paper trading is degraded (stale/frozen signals, "Contract
pending", mtf_not_aligned skips). Two root problems, both to be fixed WITHOUT accumulating large runtime state and
WITHOUT changing which signals fire/when:
  A. GC pressure from DB row-parse allocation -> cut DB read/WRITE VOLUME (fewer rows x columns x round-trips x
     cheaper types x less often). "Call only what's truly needed" — the specific columns, the most-recent row,
     the exact keys — never an entire dataset.
  B. Gapped indicator series freeze signals for stale-base symbols -> evaluate on a CONTIGUOUS bar series.

## PROVEN ROOT CAUSE (do not re-derive)
Live V8 CPU profile (15s, self-time % of busy CPU): **(garbage collector) 32.1%**, _parseRowAsArray 4.8%,
handleRawMessage 3.0%, toDate 1.9%, signal-monitor eval ~5%, stream conversion ~4%.
Live allocation profile (20s, **~9.1 MB/s of garbage**): **_parseRowAsArray 47.6% (86.6MB)** + mapFromDriverValue
3.3% + toDate 1.4% = **~52% of ALL heap allocation is deserializing DB rows**; then inputBars.map 9.3%, buffer
slice 6.6%, flow trades.flatMap 4.6%, evaluatePyrusSignalsSignals 2.1%, stockMinuteAggregateToSignalMonitorBar
2.1%, indicator arrays ~1.5%.
=> DB read/write VOLUME -> object/array per parsed row -> GC eats ~1/3 of CPU -> single main thread saturated.
Confirmed: fixing ONE input (flush cadence 300->1000ms; or the bar_cache reads) did NOT move ELU — the TOTAL
row-read volume across all hot tables still floods _parseRowAsArray. Must cut across all hot tables.

Measured live DB rates (reads/writes per sec): bar_cache 260r/2w (cold-start transient 675->109); STA
(signal_monitor_symbol_states) 133r/32w; signal_monitor_events 29r; shadow_position_marks 8r; execution_events 2r.

## STATUS (what is DONE / LIVE / IN-FLIGHT / QUEUED)
DONE + LIVE (reloaded, tested):
  - Algo-screen errant-IBKR cleanup: frontend "broker off" chips retired (codex, 10 files, typecheck green) +
    backend offline-pill / "Scan Universe - IBKR Client Portal" blocker fixed via algo-gateway.ts shadow-aware
    DISPLAY readiness (resolveAlgoShadowDisplayReadiness) used only on the cockpit path in
    signal-options-automation.ts buildAlgoDeploymentCockpitPayload. Unblocked creating shadow deployments.
  - codex bar_cache memory-first fix: warmed INTRADAY cells promote the just-evaluated series back into
    signalMonitorBackfilledBaseByCell (so the DB read leaves the hot path for 1m-15m); grouped backfill prefetch
    (killed the symbols x timeframes cross-product); invalidate promoted base on bar_cache row change; 1d still
    DB. 249/249 tests green. MEASURED: bar reads 115-192/s, ELU still 1.0 alone (STA+events reads still parse).
  - The 4 DB-volume cuts (codex, typecheck green; stream 40, db-demand 5, MTF-alignment 7 pass; 2 pre-existing
    failures in dirty signal-options-automation.ts unrelated: MTF-default requiredCount 2vs3, position-fold
    golden null fields): (1) STA persist dirty-key drops raw latestBarAt+status, uses a 5-min latestBarAt
    HEARTBEAT bucket (codex verified the signal-options worker DOES read STA latestBarAt/status for freshness, so
    heartbeat not raw-drop); identity writes stay immediate. (2) removed global STA read-cache bust on every
    persist -> scoped per-profile/timeframe invalidation of only written cells. (3) getSignalDirectionsForSymbolAsOf
    6 per-timeframe queries -> 1 SELECT DISTINCT ON (timeframe) ORDER BY timeframe, signal_at DESC, id DESC (real-
    row equivalence test added). (4) deleted dead getTrendDirectionsForSymbol. RELOADED; rate re-measure in
    flight at handoff time.
IN-FLIGHT: measuring STA writes 32->~7-10/s, STA reads 133->lower, events 29->~10-14/s, and whether
  _parseRowAsArray/GC/ELU move.
QUEUED (for fable):
  1. MIDD/gapped-series signal freeze (see section below) — HIGH impact on signal freshness.
  2. Broaden the DB-read minimal-fetch program to the remaining hot reads (column projection everywhere; read
     timestamps as EPOCH not Date to kill toDate ~2%; read numerics float8; verify bar read limit doesn't over-
     fetch past ~240).
  3. Signal-monitor eval allocation (~15% garbage): inputBars.map (bundle 125579), bucket aggregation
     (Array.from(grouped).sort().map, 125101), indicator new Array(n).fill(NaN) (92470) — reuse buffers / skip
     re-eval on unchanged dirtyKey. Higher risk (touches eval math) — gate behind byte-identical signal tests.
  4. Option-chain 60s backoff (bridge-era OPTION_UPSTREAM_BACKOFF_MS, fallback IBKR_BRIDGE_OPTIONS_BACKOFF_MS,
     platform.ts:11363): tripped by a LOCAL 12s timeout under ELU, no clear-on-success -> "Contract pending".
     Shorten + only back off on genuine upstream 429/5xx + clear-on-success. Separate, lower priority.

## STAGED PLAN FOR FABLE (apply ONE lever, verify, then next — do not stack)
Stage 1 (in flight): confirm the 4 DB cuts dropped STA/events rates + moved _parseRowAsArray/GC. If ELU is still
  pinned, that is EXPECTED until the remaining reads (bar cold-start tail, the eval allocation) are cut too.
Stage 2: MIDD/gapped-series fix (below). Verify signals unfreeze (bars_since_signal resets on real crossovers)
  with the byte-identical crossover test.
Stage 3: minimal-fetch pass on remaining hot reads (projection + epoch timestamps). Re-profile: toDate and
  mapFromDriverValue % should fall.
Stage 4: eval-allocation reuse (inputBars.map etc.), ONLY behind byte-identical signal fixtures.
Stage 5 (independent): option-chain backoff fix.
Between each: typecheck + targeted tests green, managed workflow restart, re-run BOTH profilers + per-table DB rate delta.

## STAGE 2 DETAIL — gapped indicator series freezes signals (MIDD + widespread)
Symptom: MIDD 1m signal stuck 5.9 days / 7228 bars old (bars_since_signal=7228) though the cell re-evaluates every
~2min (latest_bar_at fresh). PROVEN root cause: mergeCompletedBars (signal-monitor.ts:4375) unions the deep base
(signalMonitorBackfilledBaseByCell, from bar_cache) with the short live-stream edge BY TIMESTAMP into a Map, sorts,
slices to 240 — it does NOT fill the time gap. For a stale-base symbol the 240-bar window becomes [~230 base bars
ending yesterday 20:00] + [~few live bars now] with a ~21.5h HOLE; WMA/ATR/ADX/CHoCH over the discontinuity cannot
cross -> the signal latches and bars_since_signal climbs forever. MIDD bar_cache: 1m ends 2026-07-07 20:00, 5m
ends 2026-07-02, all source 'massive-history'. WHY base stale: (a) live 1m aggregates NEVER written to bar_cache
(liveAggregatePersistEnabled()=false, signal-monitor-local-bar-cache.ts:234/741, ~28.6k skips); (b) backfill
refreshes only ~64 cells/cycle (SIGNAL_MONITOR_BACKFILL_MAX_CELLS_PER_CYCLE, signal-monitor.ts:5105) while
thousands go overdue. BLAST RADIUS: any symbol whose base is stale vs the live edge — long-tail/less-liquid names,
esp. higher timeframes (same mechanism as 1h/1d STA 30-68min stale + the days-old tail); likely a large slice of
the 12,000 cells. FIX (DB-first, gapless, no standing memory): when base-end << live-edge-start, fetch ONLY the
missing gap bars (targeted recent-history read / Massive recent-aggregates for exactly that window) so the 240-bar
window is continuous — fixes MIDD and every gapped symbol. IDENTITY TEST: for a filled-gap symbol the crossovers
that fire must equal a from-scratch contiguous-history computation (we only unfreeze it, don't change signals).

## PER-QUERY "call only what's needed" ASSESSMENT (the DB-first program)
1. bar_cache read (market-data-store.ts:493 loadStoredMarketBars, batched :800): codex projected to 6 cols +
   float8; promote-from-stream leaves the hot path for 1m-15m. TODO: read starts_at as epoch not Date; verify
   expandStoredRowsLimit doesn't over-fetch past ~240.
2. STA persist WRITE (signal-monitor.ts:9284, dirty-key 9941): DONE — 5-min heartbeat, identity immediate.
3. STA latch prefetch READ (readStoredSignalMonitorSymbolStateMap, SELECT :6957): reads FULL rows it just wrote.
   TODO (DB-first): SELECT ONLY identity/latch columns for the exact dirty keys (not full rows), no memory map.
4. STA bulk READ (loadSignalMonitorActiveStateRows :14169, coalescer :14129): DONE — cache-bust guarded so the
   5s coalescer serves it; TODO project to only consumed columns.
5. events READ direction gate (getSignalDirectionsForSymbolAsOf :14895): DONE — 6->1 DISTINCT ON.
6. events READ metadata: TODO — use batched loadSignalMonitorEventMetadataBySignalKey (:2729) over the candidate
   batch (1 read/batch).
7. producer universe re-resolution (60s): optional — slow to ~5min / event-drive (listWatchlists TTL-cached, low
   DB impact).

## CONSTRAINTS / MUST-NOT (questioned, not dogma — the lead rejects blanket "must-stay")
- Preserve signal identity + timing + trading safety byte-identical. No universe shrink. Do NOT raise DB pool max
  (worsens single-thread parse). Prefer improving DB access over holding more state in RAM (lead's directive).
- Genuinely load-bearing (keep unless proven otherwise): the 15s DB backoffs (signalMonitorEventsReadDbBackoff,
  marketDataStoreBackoff) = thundering-herd guards; work-governor ORDERS circuit (trading safety); the 5s
  worker/position-tick exit loops (verify change-gated, don't slow); diagnostics DB-persist skip = anti-feedback.
- These were AUDIT "must-stays" that are actually optimizable but out of current scope: the 1s STA persist itself
  (STA is display/bootstrap/breadth only — the trade engine never reads it, comment 477-478), and the events gate
  (could be memory-indexed) — the lead chose DB-optimization over memory, so pursue minimal-fetch, not caching.

## VERIFICATION METHOD (exact)
- pnpm --filter @workspace/api-server run typecheck  (exit 0)
- targeted tests: pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor*.test.ts
  src/services/signal-options*.test.ts  (identity preserved). 2 KNOWN pre-existing failures (MTF-default,
  position-fold golden) are from the dirty tree, not this work.
- restart: use Replit's managed workflow action; poll http://127.0.0.1:8080/api/healthz -> 200.
- CPU profile: node <scratch>/cpuprof.mjs <apiPid> 15000   (target: (garbage collector) and _parseRowAsArray fall)
- ALLOC profile: node <scratch>/allocprof.mjs <apiPid> 20000  (target: _parseRowAsArray % and MB/s fall)
- per-table rate: delta of pg_stat_user_tables idx_scan / n_tup_ins over 20s (target: STA 32w->~7-10w, 133r->
  lower; events 29r->~10-14r). Note the DB is contended — heavy analytical scans (GROUP BY symbol over bar_cache)
  time out; keep probes light.
- apiPid + ELU/pool: .pyrus-runtime/flight-recorder/api-current.json (pid, apiPressure.inputs.eventLoopUtilization,
  dbPool*). At the time, the API restarted every few minutes (external Replit stops plus the now-retired agent signal reloads, NOT a crash/OOM
  loop: cgroup oom_kill=0, supervisor never health-kills). Profile a WARM process (uptime > a few min).

## PROFILING TOOLS (reusable, in the session scratchpad — copy into the repo if fable needs them)
cpuprof.mjs / allocprof.mjs: SIGUSR1 the pid to open the V8 inspector, connect via CDP over the global WebSocket,
run Profiler / HeapProfiler.startSampling, aggregate self-time / self-alloc by function. No app changes; works on
the live warm process. (No SIGUSR1 handler exists, so the inspector opens cleanly.)

## RULED OUT (do not chase)
- Frequent API restarts are NOT a crash/OOM/health-kill loop — external Replit SIGKILLs + agent reloads + ~6h
  microVM recycle (cgroup oom_kill=0; runDevApp.mjs never health-kills; verified).
- IBKR client throttles (requestsPerSecond=8, optionChainMaxConcurrency=1) do NOT leak onto Massive (instance-
  private, structurally isolated).
- Stream flush CADENCE is not the driver (300->1000ms did not move ELU).
- The scanner effectiveConcurrency=1 under ELU is a self-latch (platform.ts:1346 gate includes event-loop
  drivers) but is a victim/amplifier, not the generator.
