# Runtime verification runbook — post-fix acceptance (task #8)

Execute after the FB2 chain + S3B-1 + EE-BLOAT land and the API is replaced
through Replit's managed workflow restart action (healthz 200; confirm markers
in `artifacts/api-server/dist/index.mjs`).
Run on a WARM process (≥10 min uptime); ideally repeat next market open (~07:30 MDT) for the
open-load acceptance.

## Baselines (2026-07-09, pre-fix @ market open, pid 325)

| Metric | Baseline | Post-fix midday (pid 88461, partial fixes) | Target |
|---|---|---|---|
| GC % of busy CPU (20s profile) | 32.6% | 9.1% (codex measure) | < 10% at open |
| _parseRowAsArray % of allocations | 50.7% | 8.8% | < 15% at open |
| busy% (CPU profile) | 95.8% | 88% | < 80% warm midday |
| old_space used | 1596 MB | — | < 1100 MB warm |
| DB pool waiters (sustained) | 28–65 | 0 idle / 47-55 cold-start | interactive wait p95 < 250ms (post-BUS) |
| auth_sessions max queue | 60s | — | < 1s (post-BUS) |
| bar_cache SELECT client-exec (morning firehose) | 9,380s | — | materially down after F1B |
| storedBarsCache hit/delta counts | 0 / 0 | — | non-zero (F1B split counters tell the story) |
| execution_events read max | ~9.4s | — | ms after reclaim runbook executes |

## Steps

1. Confirm only one managed launcher exists, use Replit's managed workflow
   restart action, then poll `http://127.0.0.1:8080/api/healthz` → 200. On
   2026-07-09 the retired signal-reload path correlated with an abrupt
   supervisor loss during open load (mechanism unverified; see the root-cause
   doc's instability appendix). Do not
   trust the run; investigate before proceeding.
2. Wait ≥10 min warm. Confirm commit markers in dist (grep one symbol per landed WO).
3. CPU profile: `node scripts/diag/cpu-profile-running-api.mjs <apiPid> 20000`
   (SIGUSR1 needs ~2s to open :9229 under load — run twice if ECONNREFUSED).
4. Allocation profile: `node <scratchpad>/alloc-profile-running-api.mjs <apiPid> 20000`
   (session addde099's scratchpad; recreate from the session handoff if the scratchpad rotated —
   CDP HeapProfiler.startSampling @65536).
5. Counters: `curl -s localhost:8080/api/diagnostics/runtime | <node filter>` →
   `providers.massive.localBarCache.storedBarsCache` (hit/miss/delta/invalidation SPLIT counters
   from F1B) + `storedBarsRead` + (post-BUS) `dbAdmission` per-lane gauges.
6. Firehose window: aggregate `api-events-<date>.jsonl` `api-db-query-slow` by shape for a 30-min
   window; compare vs the baseline table (script pattern in session addde099's transcript).
7. Flight recorder: heap sawtooth amplitude, pool waiter lines, `apiPressure.level`.
8. Write results into this file under "## Results"; deltas labeled observed; anything still red
   gets a named owner/next-WO.

## Results

### Midday warm run, ~11:30 MDT, pid 227106 (ALL landed fixes active; box also hosting 3 codex workers + 2 sibling sessions' rebuilds — NOT a clean-load comparison; the decisive run is tomorrow's open via scripts/diag/market-open-acceptance.mjs)

- Reload: SIGUSR2 clean, **supervisor survived (same pid 224378)** — the open-load kill correlation did not reproduce.
- CPU (20s): busy 93.7%, **GC 19.5%** (open baseline 32.6%), _parseRowAsArray 9.0% (was top at open).
- Alloc (20s): 11.3 MB/s sampled; old_space used **1209MB** (baseline 1596MB); heapUsed 1361MB (open: 2163MB).
  - _parseRowAsArray still 47% of allocation — expected: the two biggest read-demand fixes (EQH-1
    equity-history, EE-FIREHOSE) are authored but not landed (blocked on sibling WIP).
  - **#2 allocator = stableStringify3 (35MB/20s) + signatureForPayload (8.6MB)** — stream
    change-signature serialization from YESTERDAY's c712d759 (WO-P2-T7) across the SSE stream
    modules + marketing-shadow-dashboard. Not a today-regression; now the largest non-DB allocation
    target → follow-up candidate (cheaper signature/hash or incremental signature).
- **F1B split counters (first live reading — DECISIVE): invalidationFullCount 6319,
  invalidationDeltaDueCount 0** of 6915 events. Every genuinely-changed bar write lands AT/BELOW
  cached high-water (persist re-writes of just-closed bars + backfill revisions); the delta path is
  structurally unreachable under current write patterns, and hitCount remains 0 (starvation + full
  invalidation). Follow-up WO required: bounded re-read-from-changed-row invalidation or
  revision-tolerant cells (F1B's hypothesis (b), now measured).
- Admission gauges NOT found in /api/diagnostics/runtime tree — BUS-2 wiring gap (getPoolStats
  exposes dbPool.admission per BUS-1, but the runtime diagnostics route doesn't surface it). Small
  follow-up.
- Minor: lruCacheTouch visible at 1.5% CPU (F2A read-touch cost — acceptable); normalizeSymbol at
  2.1% despite the 1676d461 memo — check memo hit-rate at open.
