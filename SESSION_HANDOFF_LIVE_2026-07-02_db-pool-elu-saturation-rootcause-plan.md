# LIVE Plan — DB-pool saturation + 100% ELU root cause & remediation

## ⇢ UPDATE 2026-07-03 eve (Claude session 54de3be2) — container replaced; observability landed; push BLOCKED on auth

**Incident:** Replit replaced the container at 19:15:18 MDT (second replacement of the evening;
first 18:14:45), preceded by two abrupt supervisor kills (18:45:29, 19:04:35). Flight recorder
classified them (`incidents.jsonl`: 2× `same-container-supervisor-abrupt` → `container-replaced`).
DB-pool saturation peaked 18:50–19:00 (788 slow/pressure events per 10 min, `bar_cache` selects
dominant). Cause inferred (unverified — no pre-crash memory data existed): aggregate memory/CPU
exhaustion; `api-memory-pressure` never fired, so no SINGLE process crossed its threshold.
Pre-crash Claude transcripts were lost (same as 2026-06-17); recovery = autosaved handoffs.

**New commit `378e4d3` `feat(observability)`** — append-only memory/ELU samples (4 files, +148):
- `api-memory-sample` every 30s in api-events JSONL: process memoryMb, /proc/meminfo system
  totals, eventLoopDelayP95Ms, eventLoopUtilization, dbPool. VERIFIED live via SIGUSR2 reload —
  samples flowing; 4 min post-restart already shows **ELU 0.90, loop p95 100ms, rss 1.78GB**.
- Supervisor heartbeat: per-child + supervisor RSS, system MemAvailable (loads on next Run).
- Isolated from the dirty tree via HEAD+my-edits index blobs (0 foreign lines; verified).

**Landing status:** branch = `28314c4(main)` + `87992ab` + `e8109c6` + `378e4d3`.
`git push origin` FAILED — no GitHub credentials in container (`gh` not logged in, no token,
no credential helper); `gitsafe-backup` rejects manual pushes (pre-receive hook). **User must
run `gh auth login` (via `! gh auth login` in a Claude session) or push from the Replit Git
pane.** Then: `git push -u origin perf/elu-loop-pressure-fixes && gh pr create` — suggested PR
title: "perf: event-loop pressure fixes + crash-attributable memory observability"; body should
cite the two ELU commits' verified wins and the 2026-07-03 container-replacement incident.

**P3 unchanged:** still discussion-first (user's standing instruction).

## ⇢ HANDOFF — READ FIRST (updated 2026-07-02 eve · Claude session 4a00ed36)

**Status:** two loop-pressure fixes DONE, verified, and **committed**. Re-architecture (P3) is
deferred for careful discussion before any code (user's explicit request).

**Committed — branch `perf/elu-loop-pressure-fixes` (off `main` `28314c4`, NOT pushed):**
- `87992ab` `perf(shadow-account)` — memoize the timezone formatter (`timeZoneParts` was building a
  new `Intl.DateTimeFormat` per call). Live re-profile confirmed **6.1% → 0.3%** main-thread self-time.
- `e8109c6` `perf(signal-monitor)` — drop unused jsonb `payload` from the `/signal-monitor/events`
  list read (openapi + service 11-col projection + regenerated api-zod/api-client-react + tests).
- Both isolated by hand from a **331-file, 3+-workstream dirty tree** (verified: branch delta = 7
  files only, **0 foreign markers**). `main` untouched; working tree still holds every other
  workstream's uncommitted work.

**Verified:** events suite **55/55** · api-server + pyrus typecheck clean (my files) · runtime
`GET /api/signal-monitor/events` → **200, no `payload` key** · app healthy.

**Root cause (P0, confirmed by live CPU profile — closes the earlier "not adversarially confirmed"
gap):** the main loop is **CPU-bound**; ~28% of self-time is node-postgres row parsing on the socket
callback → `client.release()` lags → the 12-slot pool stays checked out. **Raising `DB_POOL_MAX` is a
NON-fix.** (Detail in §1 + the "RESUME" section below.)

**NEXT / OPEN:**
1. **Decide push / PR** — branch is local only.
2. **P3 re-architecture** (the real remaining lever): stop parsing jsonb `payload` on the loop for the
   OTHER hot reads (`execution_events`, `signal_monitor_symbol_states`). Plan written:
   `docs/plans/2026-07-02-elu-p3-payload-jsonb-offload.md`. **User wants to discuss + detail carefully
   BEFORE any code.**
3. **Option B (short-TTL cache of the events read): EVALUATED → REJECTED** — the UI polls only every
   ~15s (a 2–3s TTL never hits) and FIX #2 already made the read cheap.
4. **Repeat FIX #2 on `execution_events`: BLOCKED** — the Algo audit UI (`algoAuditModel.js`,
   `algoHelpers.js`) actually reads that payload.

**GOTCHAS:** dirty tree = 3+ unfinished workstreams. **NEVER broad `git add`** — generated API files
carry multi-workstream regen; commit per-workstream via isolated hunks (patches used this session are
in the session scratchpad: `optionA-full2.patch`, `01-timezone.patch`).

---

- Workstream: **B — Algo/stat trading blockers** (resumed lineage `f7ca877c`←`6329348a`).
- Date: 2026-07-02 MT. Repo `/home/runner/workspace`, branch `main`. API child pid 501.
- Source of findings: root-cause workflow `wf_cea9c417-bcc` — 4 parallel live observers + synthesis
  (adversarial verify phase was **stopped before completing**, so H1 is corroborated by 4 independent
  observers + hard runtime evidence but is **not yet adversarially confirmed**; the one confirming
  check is named in P0 below).
- Evidence artifacts: `/tmp/claude-1000/-home-runner-workspace/2ce54b1d-119c-48be-bd5f-b86a42a841e4/scratchpad/`
  (`pgsa-*.txt`, `obsC-timeseries.txt`); live recorder `.pyrus-runtime/flight-recorder/api-current.json`.

---

## 1. Verified root cause — event-loop starvation (H1), NOT slow SQL, NOT pglite

The main-thread event loop is pinned flat at **100% ELU** by CPU-bound request-path JS. Because
node-postgres drains results and runs `client.release()` / next-query dispatch as callbacks **on that
same saturated loop**, checked-out clients are released far slower than the remote PG finishes each
statement — so the 12-slot pool stays 12/12 checked out while the acquire queue grows. **The pool
saturation and the multi-second "query"/acquire times are symptoms of the pegged loop, not DB latency.**

### Evidence (OBSERVED)
- **Runtime — the pool is checked-out-but-idle, DB is doing nothing:** 20/20 live `pg_stat_activity`
  samples over 65s (plus seed): **every** helium backend `wait_event=ClientRead`, **zero** `active`,
  **zero** `idle in transaction`, while app-side `dbPool.active` pinned at 12/12 and `waiting` grew
  12→57. (`obsC-timeseries.txt`)
- **Source — what the metric measures:** `getPoolStats()` returns `active = total − idle` from
  node-postgres' internal counters — i.e. clients **checked out**, regardless of in-flight SQL —
  and "takes no connection itself" (`lib/db/src/index.ts:485-495`). The pool is the single shared
  `new Pool({max:12})` to `helium` (`index.ts:228-250`; `defaultPoolMax()`=12 for hostname `helium`,
  `index.ts:194-206`). pglite is a **test-only** seam (`index.ts:417-422`) → **H2 refuted**.
- **Runtime — loop is CPU-pegged on the main thread:** `/proc/501/task` shows MainThread pegged; the
  4 `V8Worker` threads are V8's own GC/JIT (heap only ~13.5% used → high young-gen **allocation
  churn**, ~1 core). No `worker_threads` run app code. ELU flat at 0.99996 (no variance).
- **H3 (acquire-and-hold across a transaction) excluded:** zero `idle in transaction` in every sample;
  Observer D scanned all 15 `db.transaction()` bodies — none hold a client across broker/fetch/sleep/
  timer awaits; worker advisory locks use a **dedicated pg.Client outside the pool**
  (`advisory-lock.ts:31-46`).
- **The old worst-case ELU sink is OFF:** per-event `new Error().stack` capture carried on 0 of 94,762
  recorded slow-query events (`DB_DIAGNOSTIC_CAPTURE_STACK` unset) — ruled out as the current cause.

### The one INFERRED link (open)
*Which* JS frames dominate the 100% ELU is inferred from route knowledge + `/proc` per-thread CPU +
the recorder slow-query mix — **not yet from a captured CPU profile**. Dominant slow route drifts over
time (`GET /signal-monitor/events`, `flow/events` N+1, `GET /bars`, a live 151s `signal-quality-kpis`
call), consistent with **diffuse aggregate loop CPU** rather than one culprit line. P0 closes this.

---

## 2. Remediation plan (prioritized)

> Guardrail: pool saturation is a **symptom**. Raising `DB_POOL_MAX` is **NOT the fix** — more
> connections = more concurrent work fed back onto the same pegged loop. Every step below is verified
> at runtime via rebuild + `kill -USR2 "$(pgrep -f 'node ./scripts/runDevApp.mjs' | head -1)"`, then
> polling `api-current.json` for `apiPressure` + `dbPool` + `eventLoopUtilization`.

### P0 — Confirm the mechanism before changing code (cheap, do first)
Capture a ~10s main-thread **V8 CPU profile** of pid 501 (inspector attach read-only, or `--cpu-prof`
on next start). **Success:** majority of self-time is in JS request-path frames — pg row parsing, Zod
`.parse`, `JSON.stringify`, `instrumentQuery` — with **no** synchronous DB/socket blocking. This
confirms the loop is CPU-bound (releases simply aren't scheduled) and names the exact frames to trim,
turning the P2 targets from inferred to measured.

### P1 — Collapse the demand amplifiers (lowest risk, most direct symptom relief)
1. **`services/historical-flow-events.ts:744-761` — per-bucket N+1** on `GET /flow/events`.
   `for (const window of windows) { await db.select()… }` issues one sequential pooled query per time
   bucket (~50–210 acquisitions/request; **live-dominant at 81/95 slow acquisitions**). → Replace with
   a **single windowed query** (bucket in SQL, or one range-scan then bucket in JS). ~50–210
   acquisitions → 1.
   **Verify:** re-hit `/flow/events`; per-request acquisitions → 1; `dbPool.waiting` falls.
2. **`services/shadow-account.ts:5792-5877` — background mark-refresh write N+1** (2+ pooled writes per
   open position, single-flighted). → Batch into one write. (Complements the already-landed uncommitted
   read-cache version split, which cut the *read* side churn.)
   **Verify:** mark-refresh cycle issues 1 write; steady-state pool occupancy drops.

### P2 — Trim main-thread CPU on the dominant slow route (guided by P0 profile)
3. **`routes/signal-monitor.ts:319` — redundant hot-path whole-array revalidation.**
   `ListSignalMonitorEventsResponse.parse(...)` runs Zod deep-validation over the **full** 2000-symbol
   event array before `res.json`. → Pass the already-typed service result straight to `res.json`
   (or validate in dev only). Removes O(n) Zod work per request from the pegged loop.
   **Verify:** `GET /signal-monitor/events` p95 drops; ELU eases off 1.0.
4. Re-examine the **2000-symbol** signal-monitor scale on the hot path
   (`SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT=2000`, eval concurrency 10, `services/signal-monitor.ts:493-497`)
   — is whole-universe evaluation required synchronously, or can it be paginated/streamed?

### P3 — Structural / defense-in-depth (evaluate after P0–P2 measurements)
5. Offload heavy CPU (large-array Zod validation, JSON serialization, row parsing) off the request
   loop, and/or cut the ~1-core young-gen GC churn (fewer short-lived allocations in the hot path).
6. Attribute per-route CPU from the P0 profile: settle whether the 151s `signal-quality-kpis` route or
   `GET /bars` (6.3s) is a single dominant ELU consumer vs the diffuse signal-monitor firehose.

---

## 3. Constraints & context
- **Trading behavior is out of scope here.** The MTF-unanimity-gate question is **closed** — root cause
  was the hardcode in commit `0dfa337` (`signal-options-automation.ts:4496`); decision: **do NOT
  revert**. Do not touch it.
- **Keep the uncommitted `shadow-account.ts` read-cache version-split fix** (`shadowReadMarkRefreshVersion`,
  ~line 514; +192/−156 in the tree) — it is complementary (reduces read-side ELU churn), not part of
  the saturation root cause.
- Investigation was **read-only**; no source was modified by the workflow.

## 4. Open questions
- Exact top ELU frames / per-route CPU attribution → **P0 CPU profile** closes this.
- Adversarial-verify phase was stopped early — H1 is strongly evidenced but not skeptic-confirmed;
  P0 doubles as that confirmation.
- Is one heavy endpoint the ELU dominator, or is it genuinely diffuse aggregate load?

---

## 5. RESUME 2026-07-02 evening — P0 executed + first measured fix (Claude session 4a00ed36, resuming 2ce54b1d)

### P0 DONE — H1 CONFIRMED by a live CPU profile (was "not yet skeptic-confirmed")
- Tool: `node scripts/diag/cpu-profile-running-api.mjs <pid> <ms>` (already in repo; SIGUSR1→CDP→`.cpuprofile` + top self-time frames). Profile artifact: `.pyrus-runtime/api-cpu-544.cpuprofile`.
- Captured **46,397 samples / 13s** on live API child **pid 544** while driving **96 GET `/signal-monitor/events` (all HTTP 200)**. Runtime at capture: `eventLoopUtilization=0.908`, `eventLoopDelayP95Ms=151`, pool 9/12 active, 0 waiting (after-hours — high but below the peak 100%/57-waiting regime).
- Top self-time frames:
  - `_parseRowAsArray` **18.2%** (node-postgres row→array parse)
  - `(idle)` 14.4% · `(garbage collector)` 8.1%
  - `timeZoneParts` **6.1%** (OURS — `shadow-account.ts`)
  - `is` 5.7% (pg/drizzle driver) · buffer `slice` 1.8% · `normalizeJson` 1.7% (diagnostics) · `mapFromDriverValue` 1.4% · `normalizeSymbol` 1.1%
  - diffuse tail: `writeSseEvent2`/`signatureForPayload` ~2%, `aggregateStockMinuteBarsForTimeframe`, `readSignalMonitorStateFresh`, `getCurrentStockMinuteAggregates`, `loadSignalMonitorStreamSourceMinuteBars` (all signal-monitor/SSE).
- **Verdict:** loop is **CPU-bound** (only 14.4% idle; socket-read frames ≈4% — no synchronous DB/socket blocking). **~28% of self-time is DB result handling on the main thread** (`_parseRowAsArray`+driver map+parse+slices) → node-postgres parses results and runs `client.release()` as loop callbacks, so releases lag the remote DB → 12-slot pool stays checked out. **H1 mechanism verified.** Raising `DB_POOL_MAX` would add parse work to the same loop → confirmed NON-fix.

### Open questions from §4 — now answered by measurement
- **Diffuse, not one endpoint.** No single route frame dominates; the load is aggregate (pg parse + date + GC + signal-monitor/SSE tail).
- **P2 (route Zod revalidation) is NOT the lever.** 96×200 hits to `/signal-monitor/events` during the profile and `ListSignalMonitorEventsResponse.parse` never entered the top-25. The plan *inferred* it was O(n)-hot; measurement says it isn't. Deprioritized (minor cleanup at best). `routes/signal-monitor.ts:319` remains unmodified.

### FIX #1 APPLIED (measured, surgical, low-risk) — `timeZoneParts` Intl memoization
- `artifacts/api-server/src/services/shadow-account.ts` (~:11698): `timeZoneParts` built a **new `Intl.DateTimeFormat` every call** (most expensive V8/ICU op), called from 7 shadow mark/equity sites. Added a module-level `Map<timeZone,Intl.DateTimeFormat>` cache (`timeZonePartsFormatter`); behavior-preserving (same options/output; tz almost always the constant `America/New_York`).
- Validation: `pnpm --filter @workspace/api-server exec tsx --test src/services/shadow-account-latest-marks.test.ts shadow-account-recompute.test.ts shadow-account-read-cache.test.ts` → **19/19 pass**. (Full `typecheck` still fails on UNRELATED pre-existing errors — signal-quality-kpis-service/IBKR bridge — per §earlier notes.)
- Runtime CONFIRMED: rebuilt+reloaded via SIGUSR2 (supervisor 507 persisted; API child 544→19236; dist carries the fix, 4×). Re-profiled 19236 (45,469 samples, same `/signal-monitor/events` load): **`timeZoneParts` 6.1%→0.3% self-time**. The two runs had different idle levels (after-hours), so normalized to on-CPU/busy time: **~7.1%→~0.65% (≈11× reduction)**; control frame `_parseRowAsArray` held flat proportionally (~21%→~26% of busy time), isolating the effect to the fix. Profiles: `.pyrus-runtime/api-cpu-544.cpuprofile` (before) + `api-cpu-19236.cpuprofile` (after).

### Tree state clarifications (full-context restore)
- **P1.1 (`/flow/events` per-bucket N+1) is ALREADY fixed** in the uncommitted tree (`historical-flow-events.ts`: single range-scan + JS bucketing + removed a fire-and-forget persist write; test handles added; `historical-flow-events.test.ts` present). Do NOT re-apply.
- `services/signal-monitor.ts` (+249) is **Workstream A** (calibration) uncommitted work — hands off.
- shadow-account.ts read-cache version-split fix (`shadowReadMarkRefreshVersion`) still present.

### Revised remediation ordering (measured)
1. ✅ `timeZoneParts` memoization (6.1%, done — runtime confirm pending).
2. **Cut `_parseRowAsArray` volume (the 18% lever):** finish N+1 collapses (P1.1 flow done; audit shadow mark-refresh writes §P1.2) + narrow `db.select()` projections on the hottest reads (avoid full-row selects where columns unused). Higher effort/risk.
3. GC 8.1% falls out of (1)+(2). `normalizeJson` (diagnostics) 1.7% is a smaller follow-up.
4. P2 Zod revalidation: minor/optional (measurement deprioritized).
- Guardrail unchanged: **do NOT raise `DB_POOL_MAX`** (symptom).

### 18% lever (`_parseRowAsArray`) investigation — the safe wins are already in-tree
- **Profile can't name the query.** Attribution of the `.cpuprofile`: `_parseRowAsArray` is **100% under `handleDataRow ← _handleDataRow ← emit ← parse ← addChunk ← onStreamRead`** — node-postgres parses rows on the **socket-data callback**, decoupled from the `await query()` call site. This *proves the H1 mechanism* (parse runs as loop callbacks) but means CPU-stack attribution to a specific query is impossible. `pg_stat_statements` is **NOT installed** on the helium DB, so per-query row attribution isn't available either.
- **Route path already optimized.** `/signal-monitor/events` → `readSignalMonitorStateFresh` → `loadSignalMonitorActiveStateRows` (signal-monitor.ts:13213) is full-row `select()` **but TTL-cached (10s) + single-flighted**, so 96 route hits during the profile mostly served cache. `stateToResponse` consumes most state columns → **states read is NOT safely narrowable**.
- **The two biggest safe reductions are ALREADY applied (uncommitted):**
  - `market-data-store.ts` `loadStoredMarketBars` (:507-536) already projects the bar read to **6 columns (startsAt+OHLCV)** with an explicit comment citing `_parseRowAsArray`/`mapFromDriverValue`/"Six columns ≈ halves the parse/GC cost". File is uncommitted (+735/−202).
  - `historical-flow-events.ts` `/flow/events` N+1 already collapsed to a single range scan (uncommitted).
  - **My 18% profile was captured AFTER these** → it is the residual, not the pre-fix peak.
- **Residual is diffuse.** Remaining full-row reads (enumerated) are dominated by `signalMonitorSymbolStatesTable` (×7 sites, wide-consumed) + the automation worker's shadow/deployment/event reads in `signal-options-automation.ts` — none is a single obvious safe+high-volume narrowing, and without per-query attribution, picking one would be **guessing** (declined per fact-first).
- **Conclusion:** no further *single surgical* `_parseRowAsArray` win is available safely. To keep pushing the lever, next is either (a) **add query-level row-count attribution** (temporary instrument or install pg_stat_statements) → then narrow the true top residual read on evidence, or (b) **structural P3**: move row parsing / large-array Zod / JSON serialization off the main loop (worker thread / separate process) — the real lever for diffuse residual, needs its own plan. Tonight's net-new verified win = `timeZoneParts` (§FIX #1).

### Query-level row attribution (fact-first, per user) — RESULT
Temp `instrumentQuery` rows-by-SQL instrumentation (lib/db/src/index.ts; **reverted + reloaded clean afterward** — sentinel gone from source+dist) over ~45s of `/signal-monitor/events` load. Top reads by total rows parsed:

| rows | calls | rpc | table / status |
|---|---|---|---|
| 141,446 | 221 | 640 | `bar_cache` — ALREADY 6-col projected (optimal) |
| 111,992 | 1,192 | 94 | `signal_monitor_events` page read (**signal-monitor.ts:14192**) — full-row incl `payload`; **PER-REQUEST, not cached** |
| 73,576 | 106 | 694 | `signal_monitor_symbol_states` — cached + wide-consumed |
| 43,715 | 33 | 1325 | `option_contracts` — already 2-col |
| 43,263 | 12 | 3605 | `option_contracts` catalog — 10-col |
| 32,895 | 309 | 106 | `execution_events` (listDeploymentEvents) — full-row incl summary/payload |

Findings:
- **No further clean SAFE projection win.** bar_cache already minimal; the events/execution_events reads need `payload` (jsonb auto-parsed on the loop by node-pg); `eventToResponse` (signal-monitor.ts:1447) uses 12/15 cols so only 3 cheap cols (`event_key`,`created_at`,`updated_at`) are droppable → negligible since `payload` stays; states cached + wide-consumed.
- **Genuine remaining levers on the residual:**
  1. **(behavioral) short-TTL cache the `/signal-monitor/events` page read** (14192) — 1,192 identical calls / 112k rows in 45s; a 2–3s TTL keyed on full params (mirrors the existing 10s states-read cache) removes most of it. Cost: events list lags ≤ TTL. **NEEDS user freshness sign-off.**
  2. **(P3 structural) stop pulling `payload` jsonb into the loop on hot high-volume paths** — node-pg auto-parses jsonb→JS object per row on the main thread; that is the dominant residual cost. Lean projections + lazy/on-demand payload beat worker-thread offload (which re-serializes). NOTE: signal MATH is already offloaded to the python-compute lanes (`python-compute.ts`), so P3 here = DB payload parse/serialize, not compute.
- DECISION PENDING (user): cache the events read (freshness tradeoff) and/or the P3 payload-projection restructure.

### P3 plan drafted + preliminary consumer audit (done while user away)
- Plan: **`docs/plans/2026-07-02-elu-p3-payload-jsonb-offload.md`**. Confirms both event `payload`
  cols are `jsonb` (auto-`JSON.parse`d per row on the loop); rejects worker-thread offload of the
  same parse (re-serializes); options A (lazy/drop payload), B (`payload::text` passthrough — blocked
  on the `normalizeLegacyAlgoBranding` transform in `eventToResponse`), C (transferable Buffer), D
  (SQL aggregate).
- **Preliminary consumer audit → Option A looks viable:** no frontend file that references
  SignalMonitorEvent reads `.payload` off a list event (only an unrelated `error?.payload` in
  `PlatformApp.jsx:633`). If a full audit (object destructure / prop-drill / zod-required in the
  generated client) confirms it, **dropping `payload` from the `/signal-monitor/events` list
  response** is the biggest clean structural cut with **no freshness tradeoff** (unlike caching).
  Still an API-shape change → needs sign-off before implementing.
- App state: clean (instrumentation reverted from source+dist; temp file removed). Net product
  changes this session = `timeZoneParts` memoization (§FIX #1) + Option A payload drop (§FIX #2).

### FIX #2 IMPLEMENTED + verified — Option A: drop `payload` from `/signal-monitor/events` list (user-approved)
Evidence: attribution = 112k rows / 1,192 per-request calls, full-row incl **jsonb `payload`** (auto-`JSON.parse`d per row on the loop). Consumer audit confirmed: nothing reads list payload (frontend typecheck passes after removal).
- `lib/api-spec/openapi.yaml`: removed `payload` from `SignalMonitorEvent` (property + `required`); it is referenced ONLY by the list response → safe.
- `artifacts/api-server/src/services/signal-monitor.ts`: `eventToResponse` (1447) drops the `payload` line + param narrowed to `Pick<DbSignalMonitorEvent, …11>` + removed now-unused `normalizeLegacyAlgoBranding` import; `listSignalMonitorEvents` read (~14192) `.select()` → **11-column projection** (drops jsonb `payload` + `eventKey`/`createdAt`/`updatedAt`).
- Codegen (`pnpm --filter @workspace/api-spec run codegen`): `SignalMonitorEvent` type + zod no longer carry `payload`. ⚠️ codegen ALSO synced OTHER workstreams' pending openapi output (market-depth/streamBars removal, kpi, flow, optionChain) — expected dirty-tree; **commit per-workstream, never broad `git add`**. Mine: `signalMonitorEvent*.ts` + the `SignalMonitorEvent`/`ListSignalMonitorEventsResponse` blocks in `api.ts`.
- Test updates (brittle, not regressions): `signal-monitor-completed-bars.test.ts` — removed `payload: {}` from a mock; `.indexOf(".select()")` → `.indexOf(".select(")`.
- **Verified:** frontend typecheck PASS · api-server typecheck clean (my files) · events test **55/55** · zod dropped payload · **runtime: HTTP 200 with `payload` keys = 0** (lean events returned; regenerated zod accepts it). Perf: parse reduction by construction (jsonb payload no longer parsed for these 112k rows/1,192 calls); a clean before/after reprofile needs a busy window (the verify reprofile caught 66% idle).
- App running: API pid 46868, healthz 200.
