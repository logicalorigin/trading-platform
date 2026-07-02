# LIVE Session Handoff — Session 2 completion via baseline ELU reduction

- Session ID: `2494701e-48fe-4689-af25-e3a47f0adf0b` (Claude Code)
- Date: 2026-07-01 MT
- CWD: `/home/runner/workspace`, branch `main`, HEAD `86ae9bc` (dirty multi-session tree)
- Workstream: complete session 2 (`019f1469…` startup/DB-latency) by REDUCING baseline API event-loop
  utilization so the options-flow scanner self-un-throttles (user chose this over relaxing the throttle).

## Verified context (fact-first)

- Session-2 DB-latency fixes HELD: pool waiters drained to 0, pressure `high`→`watch`, all targeted
  tests + API typecheck green (workflow `wf_36200981-b93`). 32-symbol-ceiling removal confirmed safe.
- The ONLY residual pressure driver is `api-event-loop-utilization`. Thresholds
  (`resource-pressure.ts`): watch ≥ **0.75**, high ≥ **0.90**. Warm baseline was ~0.80–0.83 → "watch".
- By intentional, TEST-ENCODED design (`options-flow-scanner-pressure.test.ts:87` "throttles on watch"),
  ELU-watch throttles the scanner to concurrency-1 / 32-line-budget → ~47min cycle → `freshSignalCount`
  16/2796 (`signal_options_signal_scan_degraded`). NOT a trade blocker (shadow gate keys on
  `resourceLevel`, normal; per-signal entry gating independent; deployed LUNR live+fresh).

## Change landed (uncommitted) — VERIFIED ROOT CAUSE + FIX

Root cause of the ~20-30% "shadow recompute churn" ELU contributor: `shadow-account.ts` used ONE global
`shadowReadCacheVersion`. `invalidateShadowReadCachesAfterBackgroundMarkRefresh` (mark ticks, every few
seconds for the open position) bumps that global version even though it only means to invalidate the
`SHADOW_MARK_REFRESH_CACHE_KEY_PREFIXES` keys. The store-guard (`withShadowReadCache`, was line ~848
`if (version === shadowReadCacheVersion)`) then DISCARDS the completed compute for NON-prefixed keys
(`equity-history:`, `dashboard:`) whenever a mark tick lands mid-compute (~0.5–1.1s equity-history) →
they re-miss on every read instead of caching for their 10s TTL → repeated ~1s rebuilds on the loop.

Fix (surgical version split) in `artifacts/api-server/src/services/shadow-account.ts`:
- Added `let shadowReadMarkRefreshVersion = 0;` (separate mark-refresh counter).
- `invalidateShadowReadCachesAfterBackgroundMarkRefresh` now bumps `shadowReadMarkRefreshVersion` (not
  the global `shadowReadCacheVersion`).
- `withShadowReadCache` captures `markRefreshVersion` + `markRefreshAffected =
  isShadowReadCacheKeyExpiredByMarkRefresh(key)`; store-guard now:
  `version === shadowReadCacheVersion && (!markRefreshAffected || markRefreshVersion === shadowReadMarkRefreshVersion)`.
  → mark ticks no longer discard equity-history/dashboard computes; prefixed keys (summary, etc.) still
  discarded (correct: their valuation changed).
- Full clear (`invalidateShadowFreshStateCache`) still bumps the global version → still discards all
  in-flight computes. Semantics preserved.

Tests: `shadow-account-read-cache.test.ts` — added 2 mid-compute regression tests (non-mark-affected
key keeps store; mark-affected key still discards). **12/12 pass.** API typecheck EXIT=0.

## Runtime verification — FIX PROVEN; ELU dominated by a DIFFERENT contributor

- Rebuilt + SIGUSR2 in-place reload; `shadowReadMarkRefreshVersion` confirmed in
  `artifacts/api-server/dist/index.mjs`. Health 200.
- A Replit **workflow-level supervisor restart** landed mid-sample (supervisor pid 1338→27446→ now,
  child →27478; incident `api-child-exit code=143`=SIGTERM, controlled recycle, not a crash). This
  cold-restarted the whole app mid-experiment.
- **DIRECT PROOF the shadow-churn fix works** (from `get_runtime_diagnostics` `api.shadowAccountReads.recent`,
  ~19:03): `equity-history:1D::ledger` now serves a RUN of `cache_hit` (cacheAge 598→1749→2811→4662ms)
  then one legit `cache_miss` at ~10.7s (its TTL) — i.e. it caches across mark ticks now instead of the
  prior every-3s miss thrash. `dashboard:fills-with-orders` also cache_hits. The targeted contributor is
  reduced. Keep this change.
- **BUT current live ELU is pinned ~0.95–1.0 (high) for a DIFFERENT reason:** cold-start signal-matrix
  bar hydration. `api.resourceCaches.bars`: `cacheHit:0, cacheMiss:1239, providerFetch:1383`,
  `hydrationBreakdown.byFamily.signal-matrix:1229` (near-priority, 100% miss). Readiness degradedReasons:
  `api-event-loop-utilization:high:100%`, `db-pool:high:12/12 active, 2 waiting`. The SCANNER is throttled
  and idle (`effectiveConcurrency:1, activeDeepScanCount:0`) — NOT the driver. So the dominant ELU cost is
  the #1 contributor (signal-matrix bar pipeline), which the shadow fix does not touch.
- Open question under watch (`bfhxfskqk`): is the high ELU a subsiding cold-flood (bars cache warms →
  ELU drops) or a STRUCTURAL floor (30s bars TTL vs slow full-universe matrix cycle → perpetual 100%
  bar misses keep ELU high regardless of the shadow fix)? `bars.cacheHit:0` after ~9min uptime hints
  structural.

## 0%-bar-cache-hit investigation (user-chosen) — ROOT CAUSE FOUND

CORRECTED (my rolling-`to` hypothesis was WRONG): `barsCache` key (`buildBarsCacheKey`, platform.ts:8795)
includes `to`, but `signalMonitorCompletedBarsQueryTo` (signal-monitor.ts:4056) BUCKET-ALIGNS `queryTo`
(floors to timeframe bucket / market date), so the key is stable within a bucket. Not a mis-key bug.

Real cause: the `signal-matrix` provider fetches are the signal-monitor PRODUCER BACKFILL
(`refreshSignalMonitorBackfilledBaseBars`, signal-monitor.ts:4934) cold-loading provider history
(`bypassPassiveSourceGate:true`, ~5024 `loadSignalMonitorCompletedBars`, ~6762 `getBars` family
`SIGNAL_MONITOR_BARS_FAMILY`) for "due" cells. Candidates are gated by matrix stream subscriber scope
(signal-monitor.ts:5067-5068), up to `SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT=500`. Cadence: worker every 5s
(`WORKER_WAKEUP_MS`), `MAX_CELLS_PER_CYCLE=64`, `BACKFILL_CONCURRENCY_LIMIT=3`, `MATRIX_BARS_LIMIT=240`.
~500 symbols × ~6 timeframes ≈ 3000 cells; one pass takes minutes while 1m buckets re-go-due every 60s
→ backfill perpetually chases a moving target during RTH → every cell read misses + re-fetches. entries
(1238) ≈ misses (1239), hits 0 = one-store-per-miss. This is the #1 ELU contributor / the structural floor.

Levers (all bigger than a cache tweak; NONE is a cheap in-scope cache fix):
- (a) Offload matrix bar backfill/eval off the main loop = **session 1's C1 worker-offload decision**.
- (b) Reduce backfill scope/rate (smaller active scope, fewer cells/cycle) — risks signal coverage/freshness.
- (c) Serve from stored bar_cache instead of provider fetches — but backfill is the producer's own supply
  (deliberately loads provider history), so this is a design change, not a config tweak.
Conclusion: ELU < 0.75 during active RTH requires the signal-matrix offload (session 1 C1) or a
coverage-scope reduction. The shadow-churn fix stays as a verified increment but cannot move the floor.

## Interpretation / decision pending

The shadow-churn fix is a correct, verified, low-risk session-2 increment — but it is almost certainly
INSUFFICIENT ALONE to pull steady-state ELU below the 0.75 watch threshold, because the dominant loop
cost is the signal-matrix bar hydration pipeline (contributor #1, ~35-45%). Cutting that is the real
lever to un-throttle the scanner — and it is the same signal-monitor/bar work that session 1's OPEN
worker-offload A/B/C decision covers. This is the scope boundary flagged when the user chose "reduce
baseline ELU."

## Next steps

1. Read `bfhxfskqk` result: cold-flood-subsiding vs structural floor. If it drops below 0.75 as bars
   warm, the shadow fix may suffice + a small lever. If pinned, escalate to the signal-matrix pipeline.
2. Bank the shadow-churn fix (verified). Decide with user whether to (a) attack contributor #1
   (signal-matrix bar hydration — larger, overlaps session 1's worker-offload) or (b) stop here and
   route the remaining ELU to session 1's A/B/C decision.
3. Keep Massive-only; do NOT relax the scanner ELU gate (user chose to reduce ELU, not change the gate).

## C1 lane (per AGENT_HANDOFF_TO_SESSION2_compute-offload.md) — indicator-snapshot memo LANDED

Reviewed the compute-offload handoff from session `f4ebf37d`. Reconciliation:
- Heavy matrix MATH is already offloaded to `pyrus_compute` (python) but only on the ON-DEMAND path
  (`resolveSignalMonitorMatrixPythonStates`); the streaming/backfill path runs on Node.
- Prod is a DEDICATED 2 vCPU/8 GiB VM — no idle core. The "unused core" lever is prod-only CORE ISOLATION
  (pin API→core0, compute→core1) — env-gated, NOT this session's lane.
- Un-offloadable ceiling = `bar_cache` DECODE (~15-32% on Node) — the `fix/bar-cache-*` worktrees' lane.
- The item explicitly handed to session 2: memoize `buildSignalMonitorIndicatorSnapshot`. DONE:

Change (uncommitted) in `signal-monitor.ts`: split the snapshot into a memoized signal-INDEPENDENT base
(`computeSignalMonitorIndicatorSnapshotBase` — the ×3 MTF `aggregatePyrusSignalsBarsForTimeframe`
re-aggregation, previously re-run every tick uncached) cached on (settingsSignature, symbol, timeframe) +
completed-bars fingerprint — mirroring the heavy-eval memo — with the live `filterState` attached fresh on
every call (never cached, since it can change on partial→stable transitions with unchanged OHLCV). New
`signalMonitorIndicatorSnapshotBaseCache` (+stats +reset wired into
`resetSignalMonitorMatrixHeavyEvaluationCache`). Call site passes symbol+timeframe. Exported for tests.
Tests in `signal-monitor-matrix-eval-cache.test.ts` (+2): base-cache hit in the real eval path, and a
direct memo-boundary test proving base reuse + parity while filterState stays live per signal. 7/7 pass.

Validation: `signal-monitor-matrix-eval-cache` 7/7; `signal-monitor-completed-bars` 54/54,
`-stream` 27/27, `-backfill-base` 10/10, `-preserve-bar-metadata` 3/3; API typecheck EXIT=0. Rebuilt +
SIGUSR2 reload, `signalMonitorIndicatorSnapshotBaseCache` present in dist bundle, health 200.

## Final state / caveats

- TWO verified increments landed (uncommitted, in the dirty tree): shadow read-cache version-split +
  indicator-snapshot memo. Both remove real per-tick loop work; both are ONE contributor each and cannot
  alone clear the RTH ELU floor (producer bar backfill).
- The env repeatedly cold-restarted the Replit WORKFLOW this session (supervisor pid 1338→27446→41885),
  so runtime ELU stayed high/cold (~0.94-1.0) and is NOT cleanly attributable — the memo/shadow benefits
  are proven by TESTS, not the churning ELU headline.
- Remaining C1 levers are OTHER lanes: route streaming/backfill matrix eval through python compute (big);
  `bar_cache` decode worker_thread (`fix/bar-cache-*`); prod-only core isolation.
- Changes are UNCOMMITTED per "commit only when asked". Recommend committing the 2 increments isolated
  from the pre-existing dirty tree when the user is ready.

## ELU / UI-FREEZING root cause (user report: "price/data streaming freezing") — VERIFIED

Symptom measured, NOT guessed:
- `/streams/quotes` SSE is NOT hard-frozen at steady ELU 0.95 (130+ events/16s, avg gap ~130ms, max 296ms).
- Event-loop BLOCK probe (healthz ping @250ms, 35s): p50=67ms, p90=233ms, p99=389ms, max=416ms, only ONE
  block >400ms. => NOT one big synchronous freeze; it is death-by-a-thousand-cuts — the loop is NEVER idle
  (a trivial healthz waits 67ms median), so every stream flush runs 100-400ms late → perceived freezing/stutter.

Root cause (source-verified, signal-monitor.ts):
- The producer BACKFILL runs `SIGNAL_MONITOR_BACKFILL_MAX_CELLS_PER_CYCLE=64` cells every 5s worker tick,
  each = bar_cache read + Node-thread decode + MTF aggregation.
- Its pressure back-off `shouldSkipSignalMonitorBackfillForPressure` (4858) returns `resourceLevel==="high"`,
  and the call site (4954-4955) passes `getApiResourcePressureSnapshot().resourceLevel` — the HARD resource
  level (memory/DB), which EXCLUDES event-loop utilization.
- Live: `level:"high"` is driven ENTIRELY by ELU 97%; `resourceLevel:"normal"`. So the backfill NEVER backs
  off while the loop is ELU-saturated → it keeps flooding the loop → starves interactive SSE/quote flushes.
- The bar_cache decode itself is already optimized (market-data-store.ts:505-518, 13→6 columns). The problem
  is the FAN-OUT volume (64 cells/cycle, universe-wide) with no ELU-aware pacing, not one heavy op.

Proposed fix (ELU-aware backfill pacing — NOT full skip): scale `MAX_CELLS_PER_CYCLE` down (and/or lengthen
the worker interval) when the ELU-inclusive headline `level` (not just `resourceLevel`) is watch/high, so the
loop gets gaps for stream flushes. Graceful degradation: keeps stored-bar augmentation alive (per session-2
next-step #4 caveat + existing "augmentation alive under high pressure" tests — MUST re-check those), just
paces coverage. Tradeoff: slower signal-matrix coverage/freshness vs. responsive UI. NEEDS user buy-in
(changes live signal-freshness behavior). Do NOT fully skip on ELU-high (ELU is ~high all RTH → would starve).

## LIVE CPU PROFILE — definitive loop attribution (74,279 samples / 20s, RTH)

Captured via SIGUSR1 inspector + hand-rolled CDP client (scratchpad/cpuprof.mjs). Self-time by function:
- 12.9% `barsToPyrusSignalsBarEntries` (signal-monitor.ts:5296) — completedBars→entries conversion, UNCACHED,
  re-run every eval per cell (called at :7096 BEFORE the heavy-eval memo, so even a heavy-eval hit still pays it).
- 11.0% `_parseRowAsArray` + 1.0% `mapFromDriverValue` = ~12% pg/drizzle ROW DECODE (the un-offloadable ceiling).
- 8.3% GC (churn from the above allocations).
- ~13-15% stock-minute-aggregate→signal-bar conversion/aggregation: `stockMinuteAggregateToSignalMonitorBar`
  (:4344), `aggregateStockMinuteBarsForTimeframe` (:4387), `aggregateStockMinuteAggregatesForSignalMonitorBars`
  (:4565), `getRecentStockMinuteAggregateHistory`, `loadSignalMonitorStreamCompletedBars` (:4615) + anon helpers.
- 3.7% `fingerprintSignalMonitorMatrixCompletedBars` + eval-memo machinery ~5%.
- 2.3% `buildQueryFromSourceParams` + 2.1% drizzle `is` = ~4% drizzle query build.
- 2.2% `handleRawMessage` = Massive websocket tick ingestion.
- 0.5% `writeSseEvent2` — SSE writing is TINY (streams are STARVED, not expensive) => confirms freeze = loop
  starvation, not stream cost.
- By file: 81.6% index.mjs (our code), 16.6% native (GC/V8/syscalls).

VALIDATES the two landed fixes: shadow-account/equity-history/dashboard funcs are ABSENT from top-35 (version
split killed the churn); `buildSignalMonitorIndicatorSnapshot` down to 0.5% (memo working).

Answer to "is pacing the backfill enough?": NO. Dominant cost is the PER-CYCLE re-conversion+re-aggregation+
re-decode of the universe's minute bars (on BOTH backfill AND stream-eval paths). Pacing cuts FREQUENCY but not
the per-cell cost. Ranked in-scope levers (by profile):
1. Memoize `barsToPyrusSignalsBarEntries` (12.9%, uncached, pure fn of completedBars) — same pattern as the
   indicator memo; biggest single win. (Check `signalMonitorStreamCompletedBarsCache` :7499 hit rate too.)
2. Cache/memoize the stock-aggregate→signal-bar conversion (~13%).
3. pg decode (~12%): already 6-col optimized; further = fewer reads (pace backfill) or worker_thread (other lane).
4. Pace the backfill (reduces frequency of ALL the above) — still valuable, but not the whole story.

## barsToPyrusSignalsBarEntries memo — VERIFIED design (workflow wf_bd854dd9-32f)

- Mutation sweep: ZERO in-place writes to completedBars/its bars across all 4 call sites (:7096,:7671,:8007,
  :8170) + mergeCompletedBars => `cloneRemovable=true`. Field enum: a content-memo would need 12-of-20 bar
  fields (sourceBar is a live ref read by resolveSignalMonitorSourceIntegrity :4209 + isSignalMonitorDelayedBar
  :5747 + .partial) — fragile.
- RECOMMENDED: identity-memo-after-clone-removal (safe=true, risk=medium). WeakMap<completedBars[], entries>
  keyed on ARRAY IDENTITY inside barsToPyrusSignalsBarEntries. PRECONDITION: remove
  `cloneCompletedBarsSnapshot` at readSignalMonitorCompletedBarsCache :6585/:6589 (return cached.value). Write
  clones at :6601 so real refreshes get new identity => auto-miss. No fragile fingerprint.
- Risk lives in the CLONE REMOVAL (shared cache), not the memo. GATE with parity test #4: Object.freeze the
  returned bars array in a test build, run 2 evals through the real read path, assert no consumer throws +
  byte-identical downstream signal output. Bonus: clone removal is itself a GC win.
- HONEST caveats: PARTIAL capture of the 12.9% (direct path + intra-resolve double-call; the matrix re-slice
  :11355 `cell.completedBars = bars.slice(-LIMIT)` still recomputes). VERIFY live CPU delta before committing.
- Implementation order if greenlit: (1) freeze/parity test first, (2) remove read clone, (3) WeakMap memo,
  (4) golden parity test, (5) rebuild + re-profile to confirm delta.

## Lane 4 (pg decode ~11% + GC ~8%) exploration
- Decode = pg `_parseRowAsArray` on STORED bar_cache reads (backfill/prefetch), db.execute raw SQL (:622 etc.).
  Already 6-col optimized. The ~13% aggregate conversion is SEPARATE (in-memory stock-aggregate-stream ring).
- Adjacent worktrees STALE (forked old main, far behind): `fix/bar-cache-rollup-churn` (caps aggregate rollup
  window), `fix/bar-cache-persist-drain` (bounds write concurrency). Their single perf commits need cherry-pick/
  rebase onto current main; NEITHER addresses the read decode. Repo has ZERO worker_threads (offload = new pattern).
- Levers: (1) pace backfill = fewer stored reads = less decode+conversion (in-process, overlaps pacing);
  (2) worker_thread read-owner (SharedArrayBuffer for numeric bars) = definitive but big/new; (3) pg binary mode
  = risky. Pacing captures much of lane 4 without new architecture; standalone worker-offload best deferred.

## barsToPyrusSignalsBarEntries memo + clone-removal — IMPLEMENTED (uncommitted), tests green

Per the verified design (identity-memo-after-clone-removal). Landed in signal-monitor.ts:
- Removed the read-hit clone in `readSignalMonitorCompletedBarsCache` (both `expiresAt`/`staleExpiresAt`
  branches now `return cached.value`) — gives the cached bars array a STABLE identity across per-cell
  re-evals; kept the write clone (fresh identity on refresh = auto memo-invalidation). Also a per-hit GC win.
- Added `signalMonitorBarEntriesMemo = new WeakMap<object, entries>()`; `barsToPyrusSignalsBarEntries`
  returns the memoized entries on array-identity hit, else computes + stores. Exported for tests.
- Tests (`signal-monitor-matrix-eval-cache.test.ts`, +3): same-identity → identical memoized reference;
  different array → deep-equal recompute (self-invalidating) with no cross-array sourceBar leak; frozen
  input bars + frozen entries never mutated (locks the clone-removal invariant).
Validation: eval-cache 10/10; regression signal-monitor-{completed-bars 54, stream 27, backfill-base 10,
preserve-bar-metadata 3, stream-completed-bars-cache 5} all pass; API typecheck EXIT=0. Rebuilt + reloaded,
`signalMonitorBarEntriesMemo` in dist bundle, health 200. RUNTIME PROFILE DELTA measurement in progress
(background b135epac8) — confirming barsToPyrusSignalsBarEntries drops from 12.9% (proves the memo hits live).

## ROOT CAUSE of the ELU (definitive, evidence-backed) — DISABLED SIGNAL-MONITOR CACHE TIER

Commit `66e4b5c` (Jun 12, "repair signal matrix state pipeline and remove UI pull-hydration") zeroed the whole
signal-monitor cache tier as a BLANKET measure during a STATE-MODEL staleness repair:
  RUNTIME_EVALUATION_CACHE 10s→0, MATRIX_CACHE 60s→0, MATRIX_STALE 5min→0, MATRIX_DEBOUNCE 2s→0,
  COMPLETED_BARS_CACHE 30s→0, COMPLETED_BARS_STALE 2min→0.
Per SESSION_HANDOFF_LIVE_2026-06-12_signal-matrix-state-regression.md "Root Cause Hypothesis": the staleness was
a STATE-MODEL problem (stale signal direction / barsSinceSignal / identity from stored rows + frontend merge),
NOT a bar-data problem. The completed-bars cache (raw IMMUTABLE OHLCV) was collateral, NOT implicated. The
pressure symptom (/signal-monitor/state 5-13s) already existed pre-disable; zeroing caches made it worse.

=> WHY the loop is pinned: with the completed-bars cache OFF, every 5s eval re-loads + re-decodes (~11%
_parseRowAsArray) + re-converts (12.9% barsToPyrusSignalsBarEntries) the whole universe from scratch. That is
the ELU saturation. It is a DISABLED CACHE, not a lack of awareness.

MY memo/clone-removal (landed) only captures intra-resolve dedup TODAY because the completed-bars cache is off
(TTL=0 → every eval gets a fresh array → no cross-eval memo hit). It becomes FULLY effective (captures the
12.9% + avoids the re-decode) the moment the completed-bars cache is re-enabled — it is the keystone.

PROPOSED ROOT-CAUSE FIX (safe, high value): re-enable ONLY `SIGNAL_MONITOR_COMPLETED_BARS_CACHE_TTL_MS`
(raw immutable bar data; conservative TTL e.g. 5-10s, well under the 1m bucket) — orthogonal to the state-model
staleness (bars immutable within a bucket, keyed on bucket-aligned queryTo, guarded by
shouldBypassSignalMonitorCompletedBarsCache / shouldRetrySignalMonitorCompletedBars). Do NOT re-enable the
eval/state caches (RUNTIME_EVALUATION/MATRIX) — those cache eval RESULTS the SSE-bootstrap model may
intentionally treat as non-canonical. PRECONDITION before flipping: verify the freshness guard busts the cache
the instant a new bar closes (else a cached read could miss a just-closed bar = signal staleness). Then rebuild
+ profile: expect barsToPyrusSignalsBarEntries + decode to drop and ELU to fall.

## Completed-bars cache re-enable — SAFETY VERDICT (workflow wf_055a24d4-eca)

- STATE-STALENESS (June bug): SAFE. orthogonalToStateStaleness=true, reintroductionRisk=none. Cache holds ONLY
  raw OHLCV; direction/barsSinceSignal/identity are FRESHLY recomputed each eval; June stale-state pipeline is
  a disjoint code path. Re-enabling cannot reintroduce it.
- BAR-FRESHNESS (separate, real): the read-guard `isSignalMonitorLatestBarAtExpectedEdge` (:6678) has a
  one-timeframe tolerance band (`latestBarAt >= expected - timeframeMs`), so a snapshot missing JUST the newest
  bar (provider delivery lag at bucket-open) passes as fresh and would be served for up to min(TTL, remaining
  bucket). Latent today (TTL=0 => re-fetch every eval). This SAME behavior existed pre-June at TTL=30s; June
  zeroed it as collateral. Bucket-aligned key is self-safe for 1m/2m/5m/15m/1d/quiet but NOT 1h (relies on the
  RTH net); the guard's tolerance band is the residual gap.
- Verification rec: re-enable COMPLETED_BARS TTL ONLY (not state/matrix caches), LOW end ~5000ms, STALE_TTL<=TTL,
  keep RTH net.
- OPTIONS: (A) re-enable at 5s — bounded <=5s bucket-open lag, simplest, smaller than pre-June 30s;
  (B) re-enable + tighten the cache-SERVE freshness to require the EXACT expected latest bar (keep write-accept
  tolerance) => cache misses only during the seconds of provider lag at bucket-open, then hits => perf win with
  ZERO added bar-lag (more code + its own test); (C) don't re-enable.

## Completed-bars cache RE-ENABLED with serve-strictness — IMPLEMENTED (uncommitted), tests green

Chose the fully-safe path (tighten serve-check, then re-enable). Landed in signal-monitor.ts:
- Re-enabled SIGNAL_MONITOR_COMPLETED_BARS_CACHE_TTL_MS 0→30_000 and STALE 0→30_000. Freshness is guaranteed
  NOT by the TTL but by the new serve-check, so TTL only controls re-fetch frequency (perf).
- Added SIGNAL_MONITOR_COMPLETED_BARS_SERVE_MARGIN_MS=2_000 and isSignalMonitorCachedCompletedBarsBarBehind:
  the SERVE gate (shouldBypassSignalMonitorCompletedBarsCache) now ALSO busts if
  `evaluatedAt - latestBarClose >= timeframe + 2s` (a newer completed bar must exist). ELAPSED-SINCE-LATEST is
  alignment-agnostic — correct for epoch-aligned (5m) AND session-offset (1h) bars, unlike the old queryTo
  one-timeframe tolerance that conflated phase-offset with staleness (the verification's high-severity gap).
  Quiet sessions short-circuit (no new bars). Write-accept (shouldRetrySignalMonitorCompletedBars) UNCHANGED, so
  eval still proceeds with best-available bars during provider delivery lag. Net: cache-served staleness bounded
  to <=2s (vs the old one-full-timeframe / up-to-1h exposure), while the cache hits for the rest of each bucket.
- Tests (eval-cache, +5): serve current-in-bucket (5m); refuse missing just-closed bar (5m); 2s delivery margin;
  alignment-agnostic 1h session-offset (serve mid-bucket / refuse after close); quiet-session never refuses.
Validation: eval-cache 15/15; regression signal-monitor-{completed-bars 54, stream 27, stream-completed-bars-cache
5, backfill-base 10, preserve-bar-metadata 4, stale-rescue 6} all pass; typecheck EXIT=0. Rebuilt+reloaded,
serve-guard + TTL=3e4 in dist bundle, health 200. RUNTIME PROFILE in progress (bk5flm2id) to confirm
barsToPyrusSignalsBarEntries + decode drop and ELU falls (the memo now hits cross-eval since the cache serves
stable arrays), signals fresh.

## Files touched this session
- `artifacts/api-server/src/services/shadow-account.ts` (version split — 4 edits)
- `artifacts/api-server/src/services/shadow-account-read-cache.test.ts` (+2 regression tests)
- `artifacts/api-server/src/services/signal-monitor.ts` (indicator-snapshot base memo; barsToEntries identity
  memo + read-clone removal)
- `artifacts/api-server/src/services/signal-monitor-matrix-eval-cache.test.ts` (+5 tests, +imports)
