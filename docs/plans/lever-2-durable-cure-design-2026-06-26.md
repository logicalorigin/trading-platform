# Lever-2 / Option E — Durable Cure Design (Steps 2 & 3) + Adversarial Verdict

Date: 2026-06-26 · Author: bar_cache surgery resume (session 26f290f6) · Status: **DESIGN — NOT APPROVED TO CODE**
Source: read-only design workflow `wf_09b6f90b-c83` (6 scouts + synthesis + adversarial verify; 85 source-grounded findings).
Companion to: `docs/plans/lever-2-event-loop-offload-2026-06-25.md`.

## TL;DR (read this first)

The adversarial verifier returned **approved=false, confidence=high**. Two evidence-backed surprises reshape the plan:

1. **The A2 attribution is silently BROKEN, not just unenforced.** `market-data-store.ts:runWithMarketDataStoreContext`
   (L83-94) and `option-metadata-store.ts:runWithOptionMetadataContext` (L105-116) wrap a *lazy drizzle thenable*:
   `als.run(ctx, () => db.insert(...).returning())` builds the builder synchronously, the ALS scope exits, and the
   caller's `await` fires `pool.query()` **outside** the scope → every background bar_cache op lands **null-context**.
   Empirically: across 204,077 slow-DB events, **zero** `bar-cache-*` workloadFamily events exist; `bar_cache`,
   `option_contracts`, `instruments` dominate the **null** bucket. So "87% no-context" is partly a tagging bug.
   **One-line fix:** `runWithPostgresDiagnosticContext(ctx, async () => fn())` on the background branch only.

2. **The dominant background bleeder is a READ path, and the "persist queue" is OFF by default.** The heaviest
   background pool consumer is the producer READ backfill `signal-monitor.ts:refreshSignalMonitorBackfilledBaseBars`
   (L4090-4192) calling `loadSignalMonitorCompletedBars` **per cell** (L4159) — O(retention) single-symbol reads that
   **bypass Option E's batched/delta path** entirely. The named persist queue (writer #2) early-returns unless
   `PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES` is set (it is not). ⇒ "move writes off the API"
   (plan step 3 as written) **may not touch the 87% pressure** — that pressure is reads.

**Conflict to resolve (plan-as-written vs runtime evidence):** plan step 3 says *move writes*; the evidence says
*reads dominate*. CLAUDE.md requires surfacing this and getting the user's call on which wins.

## Recommended sequence (revised by the adversarial findings)

1. **Step A — fix the attribution (do first; lowest risk).** The one-line lazy-thenable fix + a regression test +
   tag the unwrapped background timer workers with a stable `workloadFamily`. No behavior change, just honest labels.
   Then SIGUSR2 + measure: the flight-recorder will show the TRUE reads-vs-writes split per family — converting
   theory into proof before any architectural move.
2. **DECIDE the fork (user):** target the **reads** (Step D: route `refreshSignalMonitorBackfilledBaseBars` through
   Option E's batched delta path) vs the **writes** (Step C: relocate `platform.ts:getBaseBarsImpl` L10514). Evidence
   currently favors reads.
3. **Step B — central DB workload budget**, but only AFTER enumerating every non-HTTP protected DB caller (see risks).
4. **Step C / D** per the fork, each flag-gated, each with the invalidation regression harness rewritten if writes move.

All of the above is **blocked from coding right now** by must-fix #5 below (tree is 399-files dirty / multi-agent;
typecheck red on foreign WIP). Land only after the tree is released and the gate is green.

---

## Adversarial verdict — `approved: false` (confidence: high)

**Must fix before coding:**
1. **Priority inversion** — Step C relocates writer #1 (fire-and-forget, does NOT block `/bars`), while the proven
   dominant bleeder is the Step-D producer READ backfill (marked "optional"). The headline cure may miss the 87%.
   Decide Step B+D vs Step C first.
2. **§3c option-2 is technically wrong** — a Node `worker_thread` does NOT share the API event loop / module state,
   so the in-process `onBarCacheRowsChanged` registry would be a separate instance and the main-thread subscriber
   (`signal-monitor-local-bar-cache.ts:561`) would never fire → silently stale live-money/charting bars. Only
   *same-thread async deferral* preserves native dispatch.
3. **§3c option-1 latency window** — out-of-process commit → change-feed-back → dispatch adds an eventual-consistency
   gap absent today (dispatch is synchronous with the write). Below-high-water corrections serve stale bars during it.
   Quantify/bound before relying on it.
4. **Enumerate non-HTTP protected DB callers before Step B** — the universal pool seam defaults null-context to
   *background*; any order/execution worker or off-request stream producer carries null and would be throttled as
   sheddable → **live-money regression**. Step B is NOT independently shippable until this is done.
5. **Collision check unmet** — all cited seam files (`platform.ts`, `signal-monitor.ts`, `market-data-store.ts`,
   `option-metadata-store.ts`, `signal-monitor-local-bar-cache.ts`, `shadow-account.ts`, `lib/db/src/index.ts`) are
   currently uncommitted-dirty (399 modified files). Only the two foreign-WIP files were cleared; the real edit
   targets are all in-flight. Execute only after the tree is released and the gate is green.
6. **Resolve the durable `stock_bars` write-owner fork** — the reserved `market_data_ingest_jobs` `stock_bars` kind
   routes to the **Rust** worker, which the guardrail forbids from owning live bar writes. Do not silently pick it.

**Correctness risks:** out-of-process write never fires in-process invalidation → stale bars; null→background
mis-throttles non-HTTP protected paths; a worker upsert that drops the `setWhere` skip-guard regresses write-amp +
invalidation precision; a job payload omitting `sourceName` breaks the cache `baseKey` → dispatch silently no-ops.

**Weak seams:** `await admitDbWorkload` taxes 100% of queries incl. protected (a microtask on the hottest path);
"DEFER never DROP" background writes need a bounded/coalesced backlog or risk unbounded memory under saturation;
Step A ships with no flag yet changes async timing on a hot helper that Step B's labels depend on.

---

## Full design (verbatim from the synthesis agent)

### 1. Problem restated + B1 evidence + what must change
~87% of slow-DB events (5,616/6,312 for pid 520) carry null diagnostic context, p95 ≈ 8.5s. The hard 12-conn helium
pool is the contended resource; background bar_cache work races foreground/live reads with no reservation. (Two
surprises above.) Order: (Step 4 prereq) fix the context loss + tag background workers; (Step 2) class-aware budget
reserving pool capacity for protected/live, generalizing the two existing partial throttles
(`signal-monitor.ts:runSignalMonitorBackgroundDbRead`, `signal-monitor-local-bar-cache.ts:shouldDeferBarCacheDbForPressure`);
(Step 3) move durable background write execution off the hot path without severing `onBarCacheRowsChanged`.

### 2. Step 2 — Central DB workload budget
- **Primary enforcement seam (universal):** `lib/db/src/index.ts:instrumentPostgresPoolDiagnostics` (L347-407) —
  `queryablePool.query` (L355) + `queryablePool.connect` (L356-404) are already patched and already call
  `getPostgresDiagnosticContext()`. `drizzle(pool)` (L417) means `client === pool` in prod, so this is a singular
  acquire point. Insert `await admitDbWorkload(getPostgresDiagnosticContext())` as the first line of each wrapper;
  release in the same then/catch/finally that emits the diagnostic (no permit leak on throw/reject).
- **Classification seam:** `market-data-store.ts:runWithMarketDataStoreContext` already tags
  `bar-cache-read/-write/-instrument`; HTTP requests carry `routeClass` from `app.ts:192-211`. Budget reads these —
  **after Step 4 makes them non-null at acquire time.**
- **Budget model (reservation):** protected families (`protected-execution`, `protected-position`,
  `automation-control`, `active-screen`, `live-data`, `stream`) bypass; background families acquire from a semaphore
  admitting only while `getPoolStats().active < (max − PROTECTED_RESERVE)` (read inline via `index.ts:getPoolStats`
  L485-495, NOT the 15s-cached snapshot). Generalize `createSignalMonitorBackgroundDbGate` (L3959-3985) into this and
  have `runSignalMonitorBackgroundDbRead` delegate (don't stack two gates).
- **Under saturation:** protected proceeds unconditionally; background waits in the gate's own queue; background reads
  may shed to memory-only (compose with, don't double-apply, `shouldDeferBarCacheDbForPressure`); background writes
  must DEFER never DROP. Gate only `source:'pool'` acquires, not `source:'client'` (transaction re-entrancy →
  deadlock). Record gate wait time as a new metric (A2 acquire duration starts at `originalConnect` and hides it).

### 3. Step 3 — Move background bar_cache writes off the request/hot path
- **Primary target:** `platform.ts:getBaseBarsImpl` L10514 `void persistMarketDataBars(...)` — replace with an
  enqueue of `{symbol,timeframe,source,closedBars}`; removes the no-context background write from every background
  `getBars` caller at once.
- **Writer #2 redirect (when enabled):** `signal-monitor-local-bar-cache.ts:flushPendingPersistBars` L1118 — already
  dedupe+batch+bounded-concurrency; only the DB execution location moves. Off by default → not the volume to chase.
- **Enqueue infra:** `market-data-ingest.ts:enqueueMarketDataJob(s)` into `market_data_ingest_jobs` (already coalesces
  via dedupe key + onConflictDoUpdate); `MarketDataIngestJobKind` reserves `stock_bars`. **DECISION REQUIRED:** that
  queue is consumed by the Rust worker (guardrail forbids it owning live bar writes) → use a Node worker_thread /
  in-process async queue, or make the live-bar vs durable-backfill ownership boundary explicit.
- **Dedupe/retention ownership:** worker must reproduce exactly
  `onConflictDoUpdate({target:[instrumentId,timeframe,source,startsAt], setWhere: barCacheRowChangedPredicate})
  .returning({symbol,timeframe,startsAt})` (L929-956). The `setWhere` skip-guard is load-bearing twice (write-amp +
  invalidation precision). Account for `ensureStoreInstrument` extra round-trips. Retention stays in
  `crates/market-data-worker/src/retention.rs` (DELETE-only ~90d/730d). Worker must not DELETE within-read-window rows.
- **Invalidation across a process boundary — TOP RISK:** `onBarCacheRowsChanged`/`dispatchBarCacheChanges`
  (`market-data-store.ts:859-885`) is in-process no-IPC; correctness holds *because the API is the sole writer*.
  A worker upsert elsewhere never fires the listener → stale bars below a cached cell's high-water. Mitigation:
  (1) in-process keeps owning dispatch (worker ships `BarCacheChange[]` back incl. `sourceName` — NOT in RETURNING,
  injected at dispatch L960-965 — or the `baseKey` won't match), or (2) writes stay same-thread (async deferral).
  Rewrite `market-data-store-invalidation.test.ts` + `signal-monitor-local-bar-cache-prefetch.test.ts` Test 5 to drive
  the change-feed if writes relocate. NB: "CompactBar" from the plan doc does not exist; the live wire contract is
  `BarCacheChange {symbol,timeframe,sourceName,startsAtMs}`.

### 4. Attribution fix (makes Step 2 actionable)
1. **Lazy-thenable fix:** background branch of `runWithMarketDataStoreContext` (L83-94) +
   `runWithOptionMetadataContext` (L105-116) → `runWithPostgresDiagnosticContext(ctx, async () => fn())`. Leave the
   request branch unchanged. Restores `bar-cache-*` + `option-metadata-*` tags with zero call-site changes.
2. **Tag unwrapped background workers** (stable enumerable `workloadFamily`, no free-form strings):
   `signal-monitor-evaluation-worker.ts` (runOnce L757-850, flushStreamEvaluations) = `signal-monitor-eval`;
   `signal-monitor.ts` breadth timer (L1864-1873), producer (L8799), direct `barCacheTable` read L11823;
   `shadow-account.ts` reconcile timers (L6607-6613, L7011-7027); plus signal-options/overnight/snapshot-retention/
   historical-flow/options-flow-scanner/optionability-verifier/market-data-ingest/retention/gex-universe/diagnostics
   timers. Acquire-slow events carry no SQL → attribution recoverable only by tagging the seam.

### 5. Incremental landing order
Step A (attribution, no flag, lowest risk; needs a new lazy-thenable test — `diagnostic-context.test.ts` L9-34 uses
the already-working async shape and won't catch the regression) → Step B (`PYRUS_DB_WORKLOAD_BUDGET`, default off) →
Step C (`PYRUS_BAR_CACHE_WRITE_OFFLOAD`, default off, in-process dispatch retained) → Step D (optional: route producer
backfill through `runWithSignalMonitorStoredBarsPrefetch`). Re-measure the same B1 instruments each step.

### 6. Risks / confirm before coding
(1) Which process owns durable `stock_bars` writes (Rust forbidden → Node worker_thread / in-process). (2) Is Step 3
even the right lever vs Step B+D — heaviest consumer is the producer READ backfill, and writer #1 is already
fire-and-forget. (3) `PROTECTED_RESERVE` sizing (~10 dashboard shadow sub-reads). Plus: null=background only safe
while every protected path is HTTP-served (enumerate non-HTTP protected callers); budget waits sit under
`statement_timeout`=15s / `connectionTimeoutMillis`=30s; `getApiResourcePressureCaps` is currently inert;
`signal-monitor.ts:8827` LATERAL read bypasses the store helper (covered by the universal pool seam, not the store
seam); `PYRUS_SIGNAL_MONITOR_STORED_BARS_CACHE_MAX_CELLS=0` disables the cache + its subscription.
