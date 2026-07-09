# Signal-Monitor GC / Pool Saturation — Root-Cause Trace (2026-07-09)

Session `addde099` (resumed workstream from `f834d411` "Fable-B"). Directive from Riley: **no band-aid
fixes** — identify/trace the errant code and app behavior; relief must reduce demand at the source
(consistent with `lib/db/src/index.ts:206-213`).

Follows `docs/plans/signal-monitor-db-load-rootcause-2026-07-08.md`. Supersedes the "attack heap+pool
config" idea (rejected). The s3b gate result (`.codex-watch/wo-fb-s3b-decision.md`) folds in here.

## Live measurements (all OBSERVED, market open 2026-07-09, API pid 325)

- CPU profile (20s, 24,979 samples, `scripts/diag/cpu-profile-running-api.mjs`): busy 95.8%,
  **GC 32.6% of busy CPU**; next: resolveBucketStartMs 3.1%, handleRawMessage 3.1%,
  evaluatePyrusSignalsSignals 2.4%, resolveSignalMonitorReferenceBar 2.3%.
- Allocation sampling (20s, CDP HeapProfiler, scratchpad `alloc-profile-running-api.mjs`):
  **`_parseRowAsArray` (node-postgres row materialization) = 50.7% of ALL sampled allocation**;
  second cluster = signal materialization/eval (flushSignalMonitorMatrixStreamAggregates 40.5MB incl,
  evaluatePyrusSignalsSignals 17.8MB incl, stockMinuteAggregateToSignalMonitorBar 4.1MB self,
  signalMonitorMatrixStreamStateSignature 3.5MB self).
- Heap spaces (`process.report`): old_space used **1596MB** (retained live set), limit 2752MB;
  heapUsed sawtooth 1680↔2000MB (not a leak — GC thrash against the ceiling).
- DB pool: max 12, active 12, waiting 28→65. Slow-query firehose (api-events 2026-07-09, 41,856
  events): bar_cache SELECT 9,380s client-exec + bar_cache INSERT 8,903s ≈ **half the day's
  connection-seconds budget**; execution-events SELECT 8,460s; shadow_orders SELECT 5,283s; worst
  single query 311s; auth_sessions lookups queue up to 60s. Paired events show ~18.5s pool-wait on
  3.5s execution (queue-dominated).
- pg_stat_activity: bar_cache reads pinned IO:DataFileRead 2-3.5s; one shadow_orders full-row select
  **15s in Client:ClientWrite** then **19s `idle in transaction (aborted)`**.
- Live incident: pid 325 died ~14:00Z with **no exit event** (fatal-abort pattern); the whole
  supervisor tree was replaced abruptly at 14:00:03Z and again 14:03:04Z (`previous-run-classified:
  supervisor abrupt`, `/tmp/pyrus/pyrus-dev-lifecycle-8080.jsonl`); replacement API re-inflated to
  1.9GB RSS in <3 min. Kill mechanism UNVERIFIED (no dmesg; candidates: tree OOM kill, pid2 recycle,
  manual Run). Current supervisor is pid2-owned; preview attached; web/api 200.

## Verified causal chain

1. **Read-demand root — universe evaluation re-reads warmup windows from bar_cache every cycle.**
   Query = `loadStoredMarketBars` (`market-data-store.ts:493`, select `:528-550` — matches the
   pg_stat_activity string exactly). Dominant caller: `readStoredBars`
   (`signal-monitor-local-bar-cache.ts:993`) ← `loadSignalMonitorLocalBarCache(:1431)` ←
   `evaluateSignalMonitorSymbol` (`signal-monitor.ts:8352`) ← `evaluateSymbolsInBatches(:13017)` ←
   `evaluateSignalMonitor(:16034)`. limit = `PYRUS_SIGNALS_SIGNAL_WARMUP_BARS` = **1000 rows/read**;
   fan-out up to 2000 symbols × 3 DB-hitting timeframes (15m/1h/1d; 1m/2m/5m served from memory) ×
   2 sources → **millions of row materializations per cycle** = the 50.7% allocator.
   WHY the caches don't stop it (observed; CORRECTED 2026-07-09 ~09:10 MDT):
   - the in-memory cache holds raw 1m bars only, so it structurally cannot satisfy limit=1000 for
     15m/1h/1d — those cells hit the DB every cycle;
   - ~~the universe completed-bars cache key includes `queryTo`, which advances with every bar
     close → universe-wide invalidation each minute~~ **DISPROVEN by WO-FB2-F1A**
     (`.codex-watch/wo-fb2-f1a-report.md`): `signalMonitorCompletedBarsQueryTo`
     (signal-monitor.ts:4340-4359) already quantizes to the TIMEFRAME bucket — 15m re-keys per
     15 min, 1d per market date. The per-minute-churn claim from the trace pass was wrong. The
     remaining candidate mechanisms for the sustained re-reads: the completed-bars cache's 30s TTL
     (an entry for a 15m cell expires ~30× per bucket — TTL, not key churn, forces the refetch)
     and the cross-cycle stored-bars layer's zero reuse (hit 0 / delta 0 — WO-FB2-F1B is
     dissecting that with split counters). Cause UNVERIFIED until F1B's diagnosis lands;
   - non-batched reads (retry/gap/direct) bypass the batch prefetch and fall to the single-symbol
     query. Runtime counters exist to quantify the split:
     `storedBarsPrefetchFallbackNoPrefetchCount` / `...MismatchCount`
     (`signal-monitor-local-bar-cache.ts:1515-1517`) — pull these next (UNKNOWN split today).

2. **Retention root — ~1.6GB retained by three overlapping bar caches** (makes every major GC
   expensive; the GC 32.6% is high-allocation × large-live-set):
   - `minuteBarsBySymbol` (`signal-monitor-local-bar-cache.ts:156`): raw 1m bars, **120h retention**
     (`DEFAULT_MEMORY_RETENTION_MS`, line 68), time-pruned only, NO count cap → ~0.6-1.2GB.
   - `storedBarsCrossCycleCache` (`:138`): LRU 30,000 cells × up to 1000 bars → ~1GB realistic.
   - `signalMonitorBackfilledBaseByCell` (`signal-monitor.ts:5485`): **UNBOUNDED** (only per-row
     delete `:5903` + full clear `:12962`) → ~640MB at today's ~8k cells; grows with universe.
   The irony is the finding: the app retains ~1.6GB of bars yet still re-reads millions of rows per
   cycle — the resident caches hold the wrong shape (raw 1m) for the reads that hurt (15m/1h/1d).

3. **Churn root — per-flush materialization + from-scratch indicator math.**
   - Per cell per 1s flush, even on 100% cache hit: stable-filter + map (two fresh 240-arrays,
     `signal-monitor.ts:9350-9353`), `fingerprintSignalMonitorMatrixCompletedBars` (240 temp arrays,
     `:9223-9248`, NOT memoized), `signalMonitorMatrixStreamStateSignature` (fresh object +
     JSON.stringify per state per subscriber, `:10688-10713` via `:10838`). ~12,000 cells × 60
     flush/min ≈ **720k cell-materializations/min per subscriber**.
   - `evaluatePyrusSignalsSignals` (`lib/pyrus-signals-core/src/index.ts:1149`) rebuilds **~15+
     full-length arrays from scratch per new completed bar** — no incremental path (`:1164-1200`);
     StdDev does `values.slice` per index = O(n·period) throwaway windows (`:559`); bands coerce
     through `toFixed(6)` strings (`:1168-1177`). **s3b thesis CONFIRMED at source.**
   - The `a876dd01` content-identity cache prevents re-load/merge only — explicitly NOT the
     downstream eval (`signal-monitor.ts:9032-9034`, `:10496-10497`).

4. **Trading-lane root — unbounded full-row orders materialization inside the write tx, on the
   shared pool.** `recomputeShadowAccountFromLedger` (`shadow-account.ts:14232-14237`) selects EVERY
   order ever filled for the account — full rows incl. jsonb `payload`/`optionContract`, no LIMIT,
   no date bound — inside the `placeShadowOrder` transaction (`:4647` → `:4708`), once per automation
   execution event → O(n) rows per fill, O(n²) per session. The reserved
   **`tradingPool`/`dbTrading` is dead code** — defined (`lib/db/src/index.ts:282,494`) but imported
   nowhere — so trading writes compete in the shared max-12 pool with the bar-read storm and inherit
   its 15s statement_timeout. Failure mechanics (observed + firehose-consistent): saturated loop →
   Postgres blocked in ClientWrite ~15s → statement_timeout (57014) → tx aborted → rollback queued
   behind the busy loop → aborted connection holds a slot → waiters pile up.

5. **Feedback loop** (each link above measured): row flood → allocation → GC (expensive due to
   retained set) → loop saturation → sockets not drained → ClientWrite stalls + timeouts + aborted
   tx → pool pinned → waiters 28-65 → everything queues (auth 60s) → and under open load the process
   climbs to the heap ceiling → fatal abort / tree kill → restart → caches re-prime → repeat.

## Fix directions (demand-reducing, no config bumps — each needs sign-off before dispatch)

- **F1 — kill the universe re-read storm** (attacks the 50.7% allocator):
  a) give the universe completed-bars cache the content-identity key (port of `a876dd01`);
  b) serve 15m warmup by rolling up from the in-memory 1m bars (120h covers 15m×~500; 1h/1d still DB);
  c) audit whether warmup=1000 is semantically required per timeframe vs actual indicator lookback —
     SIGNAL-IDENTITY RISK: needs byte-identical parity fixtures like s3b;
  d) first, pull the prefetch-fallback counters to quantify the fallback split (5-min check).
- **F2 — shrink the retained set** (attacks GC cost): LRU-bound `signalMonitorBackfilledBaseByCell`;
  share bar-array references across the three caches (they already partially share); justify or
  reduce the 120h 1m retention. Gap-fill semantics → regression tests required.
- **F3 — fix the trading lane** (attacks aborted-tx + tail latency; most isolated): wire
  `dbTrading`/tradingPool into `placeShadowOrder`; replace the unbounded full-row orders select with
  projected columns or incremental account state (O(n²)→O(1) per event).
- **F4 — stop the per-flush churn**: WeakMap-memoize fingerprint + signature on bars-array identity
  (same pattern as `barsToPyrusSignalsBarEntries:6526`); then **s3b incremental aggregation**
  (justified by the gate AND confirmed from-scratch at source) behind byte-identical fixtures.

Ranked by leverage: F1 (dominant demand) → F2 (GC cost) → F3 (correctness + trading isolation) →
F4 (steady churn; includes the original s3b WO with sharp anchors).

## Instability appendix (added ~10:55 MDT): the supervisor tree-kills

NINE `same-container-supervisor-abrupt` incidents 14:00:03Z → 15:02:48Z (every 5-12 min), then
QUIET (none in the following ~50 min). Facts: (a) system memory was healthy right before the first
kill (5.3-5.9GB available at 13:58-13:59 heartbeats) → NOT a system-wide OOM; (b) heartbeats go
silent in each kill window → whole-tree death, pid2 respawn ~10s later; (c) the 14:35:58Z kill is
2s after this session's SIGUSR2 in-place reload (which triggers an in-supervisor `pnpm build` —
CPU/memory spike under load); (d) the churn window exactly overlaps peak multi-agent activity
(QA campaign 13:44-14:29, fix shards 15:07+, monitors) + peak app thrash; kills stopped as landed
fixes reduced pressure and agent load fell. CANDIDATE mechanisms (all unverified — no kernel log
access): platform resource-killer on per-tree CPU/mem spikes (build during load), cgroup pid/memory
ceilings under many concurrent node processes, or an untracked shell-launched supervisor takeover.
GUARD ADDED: the verification runbook now records the supervisor pid before SIGUSR2 and requires
the SAME pid alive after — a changed pid means the reload killed the tree. If churn recurs in the
calmer post-fix regime, instrument then (watch `/tmp/pyrus/pyrus-dev-lifecycle-8080.jsonl` +
process counts at kill moments).

## Provenance

Live probes: this session inline (CPU/alloc profiles, pg_stat_activity, firehose aggregation,
lifecycle log). Source traces: workflow `wf_e1e132c6-00f` (4 readers, 300k tokens, full structured
results in `/tmp/claude-1000/-home-runner-workspace/addde099-628b-4ac6-bc1b-04197cb22d86/tasks/wthh3z1jm.output`
and the workflow journal). Unknowns explicitly carried: prefetch-fallback split (counters named
above), supervisor tree-kill mechanism, live cache hit-rates
(`getSignalMonitorStreamCompletedBarsCacheStats` / `getSignalMonitorMatrixHeavyEvaluationCacheStats`,
`signal-monitor.ts:9205,9298`).
