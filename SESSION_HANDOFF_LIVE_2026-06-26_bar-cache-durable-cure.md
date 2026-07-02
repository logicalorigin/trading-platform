# LIVE Handoff — bar_cache surgery: Lever-2 durable cure (steps 2-3) — in flight

- Session ID: `26f290f6-b8f9-4e86-856f-53cdc7e31568` (Claude Code)
- Saved (MT): 2026-06-26 ~16:15 (active)
- Repo: `/home/runner/workspace` | Branch: `main` | HEAD `86ae9bc` (`fix(quotes): clamp future-dated ticks`)
- This LIVE note is the source of truth for THIS workstream. Predecessors:
  `SESSION_HANDOFF_LIVE_2026-06-23_bar-cache-freeze-fix.md`,
  `SESSION_HANDOFF_2026-06-25_1bca609a-...` (Option E origin),
  `docs/plans/lever-2-event-loop-offload-2026-06-25.md` (the 7-step durable plan).

## Workstream
Resume the "bar_cache surgery" the user dropped = **Lever-2 / Option E** DB-pool-pressure cure that freezes
live prices. Chosen lane (user, 2026-06-26): **build the DURABLE cure** = plan **step 2** (central DB workload
budget) + **step 3** (move background `bar_cache` writes off the API request/hot path). Read-only design first,
then implement once scoped + gate clears.

## Recovered lineage (how this was found)
- Dropped session = a 06-26 ~11:33 MDT multi-agent run, lead `codex-bar-cache-lead` + worker `event-loop-codex`,
  coordinating in `AGENT_CHAT_LIVE.jsonl`. It added the **A2** layer (DB diagnostic request/workload attribution),
  started a sanctioned reload, then assigned **B1** (post-reload verification) which never reported → the drop.
- Origin of Option E = session `1bca609a` (`claude-elu`/`claude-readset`, 06-25 eve).
- A parallel Codex recovery agent (`019f05f3`, 16:01) was already hunting the same thread.

## VERIFIED current state (observed)
- **App LIVE:** healthz 200; supervisor pid 488 (`runDevApp.mjs`, pid2-owned); API child pid 520 up since
  15:59 MDT. Reload via `kill -USR2 $(pgrep -f 'node ./scripts/runDevApp.mjs')` then poll `:8080/api/healthz`.
- **Both layers present + UNCOMMITTED in shared `main` tree:**
  - Option E: `artifacts/api-server/src/services/market-data-store.ts` (`onBarCacheRowsChanged` + delta-read
    `loadStoredMarketBarsForSymbolsSince`), `signal-monitor-local-bar-cache.ts` (bounded cross-cycle cache),
    `signal-monitor.ts` (reconcile), `signal-monitor-local-bar-cache-prefetch.test.ts`;
    `?? market-data-store-invalidation.test.ts`.
  - A2 attribution: `lib/db/src/index.ts` (AsyncLocalStorage `PostgresDiagnosticContext`),
    `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/services/runtime-flight-recorder.ts`;
    `?? lib/db/src/diagnostic-context.test.ts`.
- **B1 = DONE (I verified the dropped task):** A2 context fields populate live — a 16:09 MDT
  `api-db-pool-acquire-slow` event carries full `context` (`route`,`routeClass`,`requestFamily`,`workloadFamily`,
  `admissionAction`). **Aggregation of current build (pid 520, 4,582 slow-DB events / ~10 min):**
  **~87% background/no-context, p95 ~8.5s**; rest: `stream` (GET /api/streams/algo/cockpit) p95 4.2s,
  `active-screen` p95 10.1s, `deferred-analytics` p95 15.2s. → dominant remaining pressure = **background
  `bar_cache` DB work with no request context**. Freeze NOT cured (pool 12/12, ~31 waiting). Option E is interim.

## BLOCKER (observed)
- `pnpm --filter @workspace/api-server run typecheck` is **RED**, but from **FOREIGN WIP**, not bar-cache:
  `src/services/execution-decision-registry.test.ts` (untracked) imports `./broker-permission-copy` +
  `./execution-decision-registry` — a **concurrent LIVE agent** (signals/algo repair, session `019f05d5-e23a`)
  is mid-edit (modules created 16:09). Bar-cache surgery's own files are **tsc-clean**. ⇒ do NOT commit the
  shared tree until that clears; stage ONLY bar-cache + A2 files when landing (never `git add -A`).

## DESIGN DONE (workflow `wf_09b6f90b-c83`) — adversarial verdict: NOT APPROVED TO CODE
Full design + verdict: `docs/plans/lever-2-durable-cure-design-2026-06-26.md`. Two evidence-backed surprises:
1. **A2 attribution is silently BROKEN** — `runWithMarketDataStoreContext` (market-data-store.ts L83-94) +
   `runWithOptionMetadataContext` (option-metadata-store.ts L105-116) wrap a lazy drizzle thenable, so the query
   fires OUTSIDE the ALS scope → background bar_cache ops land null-context (0 `bar-cache-*` events in 204k slow
   events). One-line fix: `runWithPostgresDiagnosticContext(ctx, async () => fn())` on the background branch.
2. **Dominant bleeder is a READ, not a write** — `signal-monitor.ts:refreshSignalMonitorBackfilledBaseBars`
   (L4090-4192) per-cell O(retention) reads that bypass Option E's delta path. The persist queue (writer #2) is
   OFF by default. ⇒ plan step 3 ("move writes off") may not touch the 87% pressure. CONFLICT to resolve.
Adversarial must-fixes: priority inversion (reads vs writes); worker_thread != shared event loop (breaks
invalidation); out-of-process dispatch latency window; enumerate non-HTTP protected DB callers before the budget
(live-money throttle risk); tree is 399-files dirty (can't safely edit now); resolve Rust-vs-Node write owner.

## GUARDRAILS (do not violate)
- Do NOT raise the 12-conn pool cap (shared helium PG). Keep `bar_cache` a bounded ~90d cache. No `drizzle-kit push`.
- Rust market-data-worker does NOT own live bars (Node owns the bar lifecycle). Build ON TOP of Option E + A2;
  a step-3 worker write must keep `onBarCacheRowsChanged` invalidation correct (no stale cross-cycle cache).

## STEP A APPLIED (attribution fix) — validated, uncommitted, LIVE
- **Fix:** background branch of `runWithMarketDataStoreContext` (market-data-store.ts L83-101) +
  `runWithOptionMetadataContext` (option-metadata-store.ts L105-120) now `async () => fn()` so the lazy drizzle
  thenable resolves INSIDE the diagnostic scope (was firing the query post-scope → null-context).
- **Regression test:** `lib/db/src/diagnostic-context.test.ts` — new case proves buggy shape loses ctx (null),
  fixed shape preserves it (`bar-cache-read`). 2/2 green.
- **Validation:** lib/db test 2/2; market-data-store invalidation + bar-cache prefetch 12/12; api-server typecheck
  adds ZERO new errors (gate still red but from FOREIGN test files only — moved execution-decision-registry →
  snaptrade-readiness.test.ts "Invalid character"; tree still churning under concurrent agents → do NOT commit).
- **Live:** rebuilt in place via SIGUSR2, API child pid 50716, bundle 17:20. Measuring the relabeled flight-recorder.
- **NOT covered (deferred, contended file):** signal-monitor.ts direct `barCacheTable` read (~L12225) bypasses the
  store helper; tagging it needs an edit to signal-monitor.ts (touched 16:40 by a concurrent agent) → answer
  reads-vs-writes from slow-QUERY SQL instead for now.

## MEASUREMENT (pid 50716, post-fix, 120 slow-DB events) — fix works + reads-vs-writes ANSWERED
- Attribution restored: `bar-cache-read` (11) + `option-metadata-instrument/read/contract` (35) now appear (were 0
  pre-fix); null-context **87% → 37%**.
- **bar_cache pressure is READS, not writes:** 22 slow `SELECT bar_cache`, **0** slow bar_cache writes. ⇒ plan
  step 3 ("move writes off") was mis-aimed; the cure must target READS (Step D: route the producer backfill through
  Option E's batched/delta path) + the Step-2 workload budget.
- bar_cache is one of several hot tables: slow SELECTs also on `shadow_orders` (20), `option_contracts` (16),
  `execution_events` (10) ⇒ a bar_cache-only fix won't clear the pool; the workload budget (protect live reads from
  ALL background families) is the right durable lever.
- ~half the bar_cache reads still untagged (11 of 22) = the signal-monitor direct `barCacheTable` read bypassing the
  store helper (deferred; contended file).

## READS FIX (Step D) APPLIED — validated, uncommitted, LIVE
- **Fix:** `refreshSignalMonitorBackfilledBaseBars` (signal-monitor.ts ~L4207) now wraps its due-cell loop in
  `runWithSignalMonitorStoredBarsPrefetch({symbols: dueSymbols, timeframes: dueTimeframes, evaluatedAt, limit:
  SIGNAL_MONITOR_MATRIX_BARS_LIMIT})` — mirrors the matrix path at L9915. The per-cell `loadSignalMonitorCompletedBars`
  reads (→ loadSignalMonitorLocalBarCache → readStoredBars) now serve from one batched set-based prefetch instead of
  ~2 pooled connections/cell × up to 64 cells. `limit`/`evaluatedAt` set to match readStoredBars' prefetch-hit check
  (L815-820) or it silently falls through. Behavior-equal (proven fallback on miss/pressure).
- **Validation:** api-server typecheck **EXIT 0 / zero errors** (foreign gate went green); prefetch + invalidation
  tests 13/13; signal-monitor.ts adds zero new errors. Rebuilt live via SIGUSR2 → API child 59284, build 17:32.
- **GATE NOW GREEN** ⇒ Step A + reads-fix + Option E + A2 are committable (surgical per-file stage; user's call on
  commit/push — still uncommitted).

## ⚠️ MAJOR REFRAME (2026-06-26 PM, grounded in live runtime + 3 subagents)
- **The live PRICE freeze does NOT correlate with the DB pool (MEASURED).** 108 samples/3.5min: Massive prices
  stayed fresh (sub-1.3s, advancing) THROUGH the worst pool saturation (waiting=33, queries 8-20s). Massive feed is
  an in-memory websocket cache, decoupled from the DB (`getMassiveRealtimeSocketQuoteSnapshots`, no SQL). Freeze is
  intermittent but pool saturates constantly in-hours ⇒ pool is NOT the price-freeze cause. Likely cause = Massive
  **websocket** drop/latch (recent commits `recover the price stream…`, `clamp future-dated ticks` target it). ⇒
  the workload budget would NOT fix the price freeze; deprioritized.
- **DB pool IS a real (different) problem:** bursty saturation (waiting 30-129) where live `active-screen`/`stream`
  DB reads wait 11-16s behind an un-throttled per-symbol **N+1 universe scan** (instruments/option_contracts/
  flow_events/bar_cache, every ~30-40s) + `shadow_orders` wide-row `SELECT *` every ~2s. Helium itself is slow
  (2.5s queries even with idle lanes; pg_stat disabled, no pg_stat_statements → app instrumentation is the only view).
- **Event loop pegged 94%** largely from the **bars resource cache thrashing ~0% hits**: working set ~524×6≈3144 vs
  1024 cap + 30s TTL << 5min revisit → 3437 provider fetches (HTTP+parse+DB-upsert each) = CPU sink. This (not the
  pool) is the more likely SSE-delivery starvation path.

## BARS-CACHE FIX APPLIED (this session) — validated, uncommitted, LIVE
`artifacts/api-server/src/services/platform.ts`: (1) `BARS_CACHE_MAX_ENTRIES` 1024→4096 (env-overridable) — covers
the ~3144 working set, stops FIFO eviction-thrash; (2) new `BARS_CACHE_COMPLETED_TTL_MS` (env, 10min) + helper
`barsCacheTtlMsForInput(input,now)` — a request whose window ends at/before the current bar boundary returns
immutable CLOSED bars → caches 10min; live/forming edge keeps 30s. Keyed on data mutability, not caller → safe for
all consumers. Applied at the single write site (refreshBarsCache); staleExpiresAt preserves live behavior exactly.
- Helps AFTER-HOURS most (stable `to` → 5min revisits become FRESH hits → no provider re-fetch). In-hours `to`
  churn is genuinely-new windows (Agent 2 Fix A territory — local-cache short-circuit — NOT done, user picked Fix B).
- Validation: typecheck EXIT 0 zero new errors. Rebuilt live (SIGUSR2), maxEntries=4096 confirmed live; measuring
  hit-rate climb over ~8min (cold cache; hits appear on 2nd visit ~5min). Memory: cold heap 132MB, watch ≤ +~150MB.

## IN FLIGHT — workload-budget (Step 2) design
Workflow `wf_7b54be82-54a` (`db-workload-budget-design`): 6 read-only scouts AUDIT every off-request DB caller and
classify **protected (live-money: orders/fills/execution/positions/automation-control) vs sheddable** (the adversarial
must-fix #4 safety homework) → synthesize the budget spec (seam=lib/db instrumentPostgresPoolDiagnostics, reservation
model, PROTECTED_RESERVE sizing, permit lifecycle, source:'pool'-only, defer-never-drop, flag PYRUS_DB_WORKLOAD_BUDGET,
tests) → adversarial live-money safety verify. Output = a reviewable spec; NO code until reviewed + tree clean.

## NEXT STEPS (resume here)
0. **DONE:** Step A attribution fix + reads-fix (Step D) applied + validated + live. Uncommitted (gate green).
1. **Decide the lever with the user (evidence now says READS):** Step D (route `refreshSignalMonitorBackfilledBaseBars`
   through `runWithSignalMonitorStoredBarsPrefetch`) + Step 2 workload budget — NOT the write-relocation (step 3).
2. Before Step 2 budget: enumerate non-HTTP protected DB callers (adversarial must-fix #4) or they'd be throttled.
3. Tag the signal-monitor direct read (contended file) once the tree is released to fully attribute bar_cache reads.
4. Land Step A + Option E + A2 (surgical per-file stage, no push) once the foreign typecheck gate goes green
   (currently red on snaptrade-readiness.test.ts "Invalid character" — foreign WIP; tree still churning).
1. Review workflow `wf_09b6f90b-c83` output (design + adversarial verdict); fix any `mustFixBeforeCoding` holes.
2. Confirm the step-2/3 landing order + flag-gating with the user before editing the contended tree.
3. Implement smallest safe flag-gated cut first; rebuild via SIGUSR2; re-measure steady-state ELU / slow-DB /
   pool-waiting to prove relief of the 87% background pressure.
4. Land Option E + A2 (surgical per-file stage, no push) once the foreign typecheck gate goes green.
