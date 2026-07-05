# Codex Handoff — DB-pool saturation + 100% ELU (Workstream B)

**Self-contained.** Everything Codex needs to finish this is in this one file. Combines (A) the verified
root cause + remediation plan and (B) the unfinished work from the stopped root-cause workflow.

- Repo `/home/runner/workspace`, branch `main`. Backend: `artifacts/api-server` (built bundle
  `node dist/index.mjs`, NOT watch mode).
- Workstream **B — Algo/stat trading blockers** (lineage `f7ca877c`←`6329348a`).
- Investigation was **read-only**; no source changed yet.
- Companion (same content, plan-only): `SESSION_HANDOFF_LIVE_2026-07-02_db-pool-elu-saturation-rootcause-plan.md`.
  This handoff **subsumes** it — use this file.

---

## 0. TL;DR

The API main-thread event loop is pinned flat at **100% ELU**. node-postgres runs result-draining and
`client.release()` as callbacks on that same loop, so pooled clients are released far slower than the
remote PG finishes each statement → the `max:12` pool sits **12/12 checked out** while the acquire
queue grows. **The DB-pool "saturation" and the multi-second query/acquire times are symptoms of the
pegged loop — not slow SQL, not pglite, not a held transaction.** Fix = cut main-thread CPU + the query
storms feeding it. **Do NOT just raise `DB_POOL_MAX`** (more connections = more concurrent work on the
same pegged loop).

---

## 1. Status of the stopped workflow (`wf_cea9c417-bcc`)

| Phase | Status | Output |
|---|---|---|
| Observe (4 parallel live collectors) | ✅ done | pool identity, ELU driver, 65s live sampling, hot-path audit |
| Synthesize | ✅ done | root cause = **H1 event-loop starvation**, confidence high |
| **Verify (3 adversarial skeptics)** | 🔴 **stopped mid-run — 0 verdicts captured** | remaining work, see §4 |
| **Report (final consolidated)** | 🔴 **never ran** | remaining work, see §4 |

**Other workflows in the lineage (context, no action needed):**
- `wf_37ec1b98-56f` — original DB-pool root-cause, killed in Observe by a container reset. **Superseded**
  by `wf_cea9c417-bcc` (fully re-run). Nothing to salvage.
- `wf_be82c11e-172` — predecessor `6329348a` MTF-gate discovery. **Completed**; decision closed (§6).
- `wf_39bc9501-69a` — Workstream **A** (signal-scoring calibration), ~halfway. **Out of scope** for this
  handoff (different workstream).

---

## 2. Verified root cause — event-loop starvation (H1)

### OBSERVED (runtime)
- **Pool is checked-out-but-idle; DB is doing nothing.** 20/20 live `pg_stat_activity` samples over 65s
  (+ seed): **every** helium backend `wait_event=ClientRead`, **zero** `active`, **zero**
  `idle in transaction`, while app-side `dbPool.active` pinned at 12/12 and `waiting` grew 12→57.
- **Loop CPU-pegged on the main thread.** `/proc/<apiPid>/task`: MainThread pegged; the 4 `V8Worker`
  threads are V8's own GC/JIT (heap only ~13.5% used → ~1 core of young-gen **allocation churn**). No
  `worker_threads` run app code. ELU flat at 0.99996 (no variance).
- **Old worst-case ELU sink is OFF:** per-event `new Error().stack` capture on 0 of 94,762 recorded
  slow-query events (`DB_DIAGNOSTIC_CAPTURE_STACK` unset). Ruled out.

### OBSERVED (source)
- Saturated pool = the single shared `new Pool({max:12})` to `helium`
  (`lib/db/src/index.ts:228-250`; `defaultPoolMax()`=12 for hostname `helium`, `:194-206`). Package
  `@workspace/db`; `getPoolStats` imported into `artifacts/api-server/src/services/runtime-flight-recorder.ts:15`.
- `getPoolStats()` returns `active = total − idle` from node-postgres' **internal counters** (checked-out
  clients, regardless of in-flight SQL) and "takes no connection itself" (`lib/db/src/index.ts:485-495`).
- pglite (`@electric-sql/pglite`) is a **test-only** seam (`index.ts:417-422`) → **H2 refuted**.
- **H3 (hold-across-transaction) excluded:** zero `idle in transaction` in every sample; all 15
  `db.transaction()` bodies are DB-only (no broker/fetch/sleep/timer awaits inside); worker advisory
  locks use a **dedicated pg.Client outside the pool** (`advisory-lock.ts:31-46`).

### INFERRED (the one open link — see §4 P0)
*Which* JS frames dominate the 100% ELU is inferred from route knowledge + `/proc` CPU + the recorder
slow-query mix — **not yet from a captured CPU profile**. Dominant slow route drifts over time
(`/signal-monitor/events`, `flow/events` N+1, `/bars`, a live 151s `signal-quality-kpis` call),
consistent with **diffuse aggregate loop CPU** rather than one culprit line.

---

## 3. Because-chain (each link evidence-backed)
1. `apiPressure.level=high`, driven simultaneously by `db-pool 12/12` **and** `event-loop-utilization 100%`.
2. The db-pool driver measures node-postgres JS bookkeeping (checked-out clients), not server SQL.
3. The remote PG server runs **no** SQL while the pool is "saturated" (20/20 samples all `ClientRead`).
4. ⇒ the 12 clients are checked-out-but-idle at the protocol level (refutes slow-SQL and, with zero
   idle-in-transaction, refutes H3).
5. All app JS — including pg result-drain + `client.release()` + next-dispatch — runs on the single
   main loop, which is pegged flat at 100% ELU by CPU-bound request-path JS.
6. ⇒ release callbacks can't be scheduled promptly ⇒ clients stay checked out ⇒ pool pegs 12/12, waiters grow.
7. Demand amplifiers (`flow/events` per-bucket N+1; background mark-refresh N+1) make 12 connections
   insufficient and feed more parse/dispatch work back onto the loop → **self-amplifying**.

---

## 4. Remaining work from the stopped workflow (verification) — do these FIRST

The workflow stopped before adversarially confirming H1 and before the final report. Close it out:

### P0 — Confirm the mechanism (this is BOTH the workflow's missing verify step AND cheap insurance before edits)
Capture a ~10s main-thread **V8 CPU profile** of the live API process.
- **Success criterion:** the large majority of self-time is in JS request-path frames — pg result-row
  parsing, Zod `.parse`, `JSON.stringify`, `instrumentQuery` — with **no** synchronous DB/socket
  blocking. That confirms the loop is CPU-bound (releases simply aren't scheduled) and names the exact
  frames to trim (turns §5 P2 from inferred to measured).
- Capture options (pick per how the API is started — see §7): `node --cpu-prof` on a manual API start;
  or `kill -USR1 <apiPid>` to open the inspector, record 10s via DevTools/`node-inspect`; or a
  `clinic`/`0x` flame if available. **Avoid `SIGUSR2`** — that's the app's reload signal (§7).
- Zero-instrumentation corroborator already satisfied: the 20/20 `ClientRead` + zero-active +
  zero-idle-in-transaction fact only H1 explains once H3 is excluded.

### The finish-the-workflow checklist (what the aborted Verify + Report phases would have produced)
- [ ] Adversarial re-check #1 (live-runtime): re-sample pool + `pg_stat_activity`; confirm still
      12/12-checked-out with idle backends (contradicts nothing in H1).
- [ ] Adversarial re-check #2 (source-truth): re-read the acquire/release path + `max=12` and confirm
      release runs on the loop.
- [ ] Adversarial re-check #3 (alternative-cause): argue the strongest competitor (see §8 alternatives)
      and confirm it can't account for a sustained 12/12 with zero idle-in-transaction.
- [ ] Run P0 CPU profile → attach frames → write the final root-cause verdict with confidence.

---

## 5. Remediation plan (implement after P0)

> Every step verified at runtime: rebuild + reload (§7), then poll `apiPressure`/`dbPool`/ELU (§7).

### P1 — Collapse the demand amplifiers (lowest risk, most direct symptom relief)
1. **`artifacts/api-server/src/services/historical-flow-events.ts:744-761` — per-bucket N+1** on
   `GET /flow/events`. Confirmed present: `for (const window of windows) { … await db.select()… }` =
   one sequential pooled query **per time bucket** (~50–210 acquisitions/request; **live-dominant at
   81/95 slow acquisitions**). → Replace with a **single windowed query** (bucket in SQL, or one
   range-scan then bucket in JS). **Verify:** per-request acquisitions → 1; `dbPool.waiting` falls.
2. **`artifacts/api-server/src/services/shadow-account.ts:5792-5877` — background mark-refresh write
   N+1** (2+ pooled writes per open position, single-flighted). → Batch into one write. **Verify:**
   mark-refresh cycle issues 1 write; steady-state pool occupancy drops.

### P2 — Trim main-thread CPU on the dominant slow route (guided by the P0 profile)
3. **`artifacts/api-server/src/routes/signal-monitor.ts:319` — redundant hot-path revalidation.**
   Confirmed present: `const data = ListSignalMonitorEventsResponse.parse(…)` then `res.json(data)`
   (:326) runs Zod deep-validation over the **full** 2000-symbol array on every request. → Pass the
   already-typed service result straight to `res.json` (or validate in dev only). **Verify:**
   `/signal-monitor/events` p95 drops; ELU eases below 1.0.
4. Re-examine the synchronous **2000-symbol** scale (`SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT=2000`, eval
   concurrency 10, `services/signal-monitor.ts:493-497`) — paginate/stream instead of whole-universe?

### P3 — Structural / defense-in-depth (after P0–P2 measurements)
5. Offload heavy CPU (large-array Zod validation, JSON serialization, row parsing) off the request loop;
   cut the ~1-core young-gen GC churn (fewer short-lived hot-path allocations).
6. From the P0 per-route CPU attribution, settle whether the 151s `signal-quality-kpis` route or
   `GET /bars` (~6.3s) is a single dominant ELU consumer vs the diffuse signal-monitor firehose.

---

## 6. Constraints & guardrails
- **Trading behavior is out of scope.** The MTF-unanimity-gate question is **closed**: root cause was
  the hardcode in commit `0dfa337` (`signal-options-automation.ts:4496`); decision **do NOT revert**.
- **Keep the uncommitted `shadow-account.ts` read-cache version-split fix** (`shadowReadMarkRefreshVersion`,
  ~line 514; +192/−156 already in the tree) — complementary (cuts read-side ELU churn), not the root cause.
- **Do NOT raise `DB_POOL_MAX`** as "the fix" — it treats the symptom and adds loop work.
- Backend changes need **rebuild + reload** (§7) to verify at runtime; the web (Vite) hot-reloads on its own.

---

## 7. Runtime playbook (exact commands)
```bash
# Discover the live pids (they change on restart — never hardcode)
SUP=$(pgrep -f 'node ./scripts/runDevApp.mjs' | head -1)
APIPID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(".pyrus-runtime/flight-recorder/api-current.json","utf8")).pid)')

# Reload backend IN PLACE after a code change (rebuild+restart API child; preview stays attached)
kill -USR2 "$SUP"
curl -s http://127.0.0.1:8080/api/healthz    # expect {"status":"ok"}

# Poll pressure (ELU + pool) — the primary success metric
node -e 'const p=JSON.parse(require("fs").readFileSync(".pyrus-runtime/flight-recorder/api-current.json","utf8")).apiPressure;
console.log("level",p.level,"elu",p.inputs.eventLoopUtilization,"pool",p.inputs.dbPoolActive+"/"+p.inputs.dbPoolWaiting+"/"+p.inputs.dbPoolMax,"p95",p.inputs.apiP95LatencyMs)'

# DB-side truth (password embedded in the URL)
psql "postgresql://postgres:password@helium/heliumdb?sslmode=disable" -Atc \
 "select count(*) filter (where state='active'), count(*) filter (where wait_event='ClientRead'), count(*) filter (where state='idle in transaction'), count(*) from pg_stat_activity where backend_type='client backend' and pid<>pg_backend_pid();"
# cols: active | clientread | idle-in-txn | total   (baseline: 0 | ~12 | 0 | ~15  — DB idle while pool pegged)
```
Note: `helium/heliumdb` has `track_activities=off`, so `pg_stat_activity.query`/state text is blanked —
but `wait_event` is reliable. **Current baseline while writing this:** `level=high, elu=1, pool 12/10/12,
p95 4316ms`.

## 8. Evidence artifacts & remaining alternatives
- Live samples: `/tmp/claude-1000/-home-runner-workspace/2ce54b1d-119c-48be-bd5f-b86a42a841e4/scratchpad/`
  → `pgsa-states.txt`, `pgsa-active.txt`, `pgsa-byquery.txt`, `obsC-timeseries.txt`
  (⚠️ `/tmp` is ephemeral and container resets wipe it — treat as best-effort; the facts are in §2–§3).
- Workflow transcripts (if still present):
  `~/.claude/projects/-home-runner-workspace/2ce54b1d-119c-48be-bd5f-b86a42a841e4/subagents/workflows/wf_cea9c417-bcc/`
  (`journal.jsonl` + `agent-*.jsonl`).
- **Alternatives not fully excluded** (for the §4 skeptic step): (a) a bounded real H3 hold in
  `upsertUniverseCatalogRows` (`platform.ts:6247-6331`, per-row `await tx.insert().onConflictDoUpdate()`
  inside one tx) — contributes but can't sustain 12/12 with zero idle-in-transaction; (b) a single heavy
  endpoint (151s `signal-quality-kpis`, or `/bars`) dominating ELU rather than the signal-monitor
  firehose — the P0 CPU profile settles this.

> `lib/db/src/index.ts` paths above are **repo-root-relative and confirmed** (package `@workspace/db`;
> `export const pool = new Pool(...)` and `getPoolStats()` both defined there).

---

## 9. Codex re-verification addendum — 2026-07-02 ~19:25 UTC

Scope: read-only fact-finding. No app restart, no source edits, no staging/commit. `AGENT_CHAT` was
not used for this workstream.

### Updated facts
- Three verifier lanes completed: live-runtime, source-truth, and alternative-cause.
- P0 CPU profile captured against live API pid `67667`:
  `/tmp/pyrus-api-67667-2026-07-02T19-16-39-491Z.cpuprofile`.
- Current runtime no longer exactly matches the original 18:36-18:44 snapshot:
  `apiPressure.inputs.eventLoopUtilization` was `null` during verifier sampling, while event-loop delay
  remained high (~682-745ms p95) and the API main thread was CPU-hot (~82-86% of one core).
- `pg_stat_activity.state` is unreliable because `track_activities=off` reports state as `disabled`.
  Treat prior `state='active'` and `state='idle in transaction'` counts as weak evidence. `wait_event`
  remains useful, but current samples were mixed (`ClientRead` plus intermittent `DataFileRead`,
  `ClientWrite`, `DataFileWrite`, `WALSync`, `WALWrite`), not 100% `ClientRead`.
- Source still confirms the saturated pool identity: the single shared node-postgres pool to helium,
  max 12, with `getPoolStats()` reading pg-pool JS counters.
- Source still confirms pglite is test-only and advisory locks use a dedicated `pg.Client` outside the
  shared pool.
- Current source has stack capture guarded by `DB_DIAGNOSTIC_CAPTURE_STACK`, but the live bundle is
  stale relative to source: `artifacts/api-server/dist/index.mjs:57033-57057` unconditionally calls
  `new Error().stack`. The running process has no `DB_DIAGNOSTIC_CAPTURE_STACK` env set.
- Recorder evidence confirms runtime skew: 18:36-18:44 had `4802/4802` slow-query events with zero
  stacks and `8775/8775` slow-acquire events with zero stacks; 19:10-19:25 had `1402/1402` slow-query
  and `1678/1678` slow-acquire events with stacks.

### CPU profile top frames
Mapped from source map:
- `massive-stock-websocket.ts:521` via `getMassiveStockWebSocketDiagnostics` under
  `getSignalMonitorMatrixStreamStatus` / stream delta flush: ~1.9-2.2s self time.
- `stock-aggregate-stream.ts:720` per-symbol diagnostics mapping under the same stream-status path:
  ~1.5s self time.
- GC: ~1.3s.
- node-postgres `_parseRowAsArray` and Drizzle row mapping/timestamp decoding: ~0.9s combined.
- `signal-monitor.ts:4441-4669` stock-minute aggregation / merge path: several hundred ms.
- `shadow-account.ts:7480-7625` equity-history compaction/ledger filtering appears in the profile.

### Plan corrections
- H1 still survives as the mechanism class: main-loop CPU can delay pg result-drain/release callbacks,
  and raising `DB_POOL_MAX` remains the wrong fix.
- Confidence in the original "remote DB is doing nothing" wording is downgraded. Current evidence is
  mixed DB/runtime pressure, not a pure idle-DB case.
- The first runtime action should be to rebuild/reload so the guarded `diagnosticStack()` source is the
  code actually running, then re-measure stack volume, pool waiters, event-loop delay, and a fresh CPU
  profile.
- `historical-flow-events.ts:744-761` remains a fact-backed P1 demand cut: one DB query per bucket.
- `shadow-account.ts:5792-5877` remains a fact-backed P1/P2 demand cut, but batching should cover both
  DB writes and equity mark/quote resolution where practical.
- The `/signal-monitor/events` Zod parse exists, but it is paginated events, not a 2000-symbol matrix.
  Do not treat that parse as the first CPU fix unless a fresh post-rebuild profile shows it hot.
- Add a new P2 target from P0: signal-monitor stream-status/coverage diagnostics should not rebuild
  whole-universe websocket/aggregate diagnostics on every stream flush.

---

## 10. Post-rebuild verification — 2026-07-02 ~19:27 UTC

User rebuilt/reloaded the API. Live API pid changed to `79517`; health check returned `{"status":"ok"}`.
No source edits, app restarts, staging, commits, or chat-bus usage were performed by Codex during this
post-rebuild verification.

### Rebuild confirmation
- `artifacts/api-server/dist/index.mjs` timestamp: `2026-07-02 13:23:19 MDT`.
- Live bundle now includes the source guard:
  `diagnosticStack()` returns `[]` unless `DB_DIAGNOSTIC_CAPTURE_STACK` is set
  (`dist/index.mjs:57195-57220`).
- Running pid `79517` env has no `DB_DIAGNOSTIC_CAPTURE_STACK`.
- Current-pid recorder proof: `api-db-query-slow` `258/258` stacks empty,
  `api-db-pool-acquire-slow` `305/305` stacks empty.

### Post-rebuild pressure sample
Sample file: `/tmp/pyrus-post-rebuild-sample-20260702T192425Z.csv`.

Over 12 samples (~60s):
- `apiPressure.level`: high in all samples.
- `apiPressure.inputs.eventLoopUtilization`: `1` in all samples.
- `eventLoopDelayP95Ms`: `170.5-516.4ms`.
- pressure input pool: active `9-12`, waiting `0-7`, max `12`.
- top-level `dbPool`: active `6-12`, waiting `0-14`, max `12`.
- process CPU: `71.6-82.5%`.
- dominant slow route shifted from signal-options state to deployment cockpit.
- DB wait events were mixed but mostly `ClientRead`; intermittent `DataFileRead`, `ClientWrite`,
  `WALSync`, `WALWrite`, and one `transactionid` wait appeared.

### Fresh CPU profile
Profile: `/tmp/pyrus-api-post-rebuild-79517-2026-07-02T19-26-21-737Z.cpuprofile`.

Top mapped self-time frames:
- `stock-aggregate-stream.ts:693` `getStockAggregateStreamDiagnostics`: ~2278ms.
  Stack: `getSignalMonitorMatrixStreamStatus` -> `buildSignalMonitorMatrixStreamCoverage` ->
  `buildSignalMonitorMatrixStreamDeltaEvent` -> `emitSignalMonitorMatrixStreamAggregateDelta` ->
  `flushSignalMonitorMatrixStreamAggregates`.
- pg-protocol `parseDataRowMessage`: ~1124ms.
- node-postgres `_parseRowAsArray`: ~919ms.
- GC: ~725ms.
- `massive-stock-websocket.ts:99` `parseParam`: ~530ms, called from
  `getMassiveStockWebSocketDiagnostics`.
- `massive-stock-websocket.ts:521` `getMassiveStockWebSocketDiagnostics`: ~323ms.
- `signal-monitor.ts:9698` `queueSignalMonitorMatrixStreamAggregate`: ~123ms.
- `signal-monitor.ts:9035` `signalMonitorMatrixStreamTimeframesForSymbol`: ~115ms.

### Updated fix order
1. **First CPU fix:** stop building full stock-aggregate/Massive websocket diagnostics inside every
   signal-monitor matrix stream delta coverage object. `buildSignalMonitorMatrixStreamCoverage()`
   currently calls `getSignalMonitorMatrixStreamStatus()`, which calls
   `getStockAggregateStreamDiagnostics()`, which builds whole-universe `perSymbol` diagnostics and
   parses active Massive subscription params on the hot stream flush path. Use a cheap/cached stream
   status snapshot or a lightweight source-state helper for coverage.
2. **First DB-demand fix:** collapse `historical-flow-events.ts:744-761` per-bucket DB query loop.
3. **Second DB-demand fix:** batch/cap `shadow-account.ts:5792-5877` mark refresh work, including DB
   writes and equity mark/quote resolution where practical.
4. **Do not lead with `/signal-monitor/events` Zod removal** unless a later profile shows it hot.
   The post-rebuild profile did not surface it as a top frame.

---

## 11. First CPU fix implemented + runtime-verified — 2026-07-02 ~19:32 UTC

### Code changed
- `artifacts/api-server/src/services/signal-monitor.ts`
  - Added a lightweight `getSignalMonitorMatrixStreamCoverageStatus()` helper.
  - `buildSignalMonitorMatrixStreamCoverage()` now uses that helper instead of calling
    `getSignalMonitorMatrixStreamStatus()`.
  - Effect: signal-matrix delta/bootstrap coverage no longer calls
    `getStockAggregateStreamDiagnostics()` on the stream flush hot path.
  - Full stream-status events still use `getSignalMonitorMatrixStreamStatus()`, preserving existing
    status payload semantics where that full diagnostic snapshot is actually needed.
- `artifacts/api-server/src/services/signal-monitor-stream.test.ts`
  - Added a regression guard that coverage does not call full stream status or aggregate diagnostics.

### Validation
- Focused test:
  `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-stream.test.ts`
  → `28/28` passed.
- API typecheck:
  `pnpm --filter @workspace/api-server run typecheck` → passed.
- Backend reload through existing supervisor:
  supervisor pid `79485`, API pid `79517 -> 85774`, health `{"status":"ok"}`.

### Post-fix runtime sample
Sample file: `/tmp/pyrus-post-coverage-fix-sample-20260702T193003Z.csv`.

Over 8 samples (~40s, shortly after reload):
- `apiPressure.resourceLevel`: normal in all samples.
- `apiPressure.level`: normal/watch/high as ELU ramped, but no pool-waiting pressure in
  `apiPressure.inputs`.
- `apiPressure.inputs.dbPoolWaiting`: `0` in all samples.
- `eventLoopDelayP95Ms`: `50.8-118.7ms` (down from post-rebuild pre-fix `170.5-516.4ms`).
- `apiP95LatencyMs`: `122ms` in all samples (down from post-rebuild pre-fix `4508-5582ms`).
- Current-pid recorder stacks remained off: slow-query `94/94` stacks empty, slow-acquire `42/42`
  stacks empty.
- Top-level `dbPool.waiting` still briefly showed `12`, `7`, and `3` in individual heartbeat samples,
  so this is not a complete pool-demand fix.

### Post-fix CPU profile
Profile: `/tmp/pyrus-api-post-coverage-fix-85774-2026-07-02T19-31-22-174Z.cpuprofile`.

Result:
- The prior top frame `getStockAggregateStreamDiagnostics` is no longer in the top profile frames.
- Remaining top frames:
  - node-postgres `_parseRowAsArray`: ~1101ms.
  - GC: ~1044ms.
  - `signal-monitor.ts:562` `signalMonitorFilterStateOrNull` via `readSignalMonitorStateFresh`:
    ~776ms.
  - Massive websocket message handling: ~178ms.
  - repeated runtime/provider env resolution from signal-monitor stream bar reads: ~327ms combined.
  - signal-monitor stream queue/evaluation and bar aggregation remain present, but far below the old
    diagnostics hotspot.

### Next best fixes
1. Reduce DB result volume / row decode pressure. Current post-fix slow-query shapes are led by
   `bar_cache` reads, order reads, `bar_cache` inserts, and signal-monitor state inserts.
2. Collapse `historical-flow-events.ts:744-761` per-bucket query loop when `/flow/events` is active.
3. Batch/cap `shadow-account.ts:5792-5877` mark refresh work.
4. Investigate `signalMonitorFilterStateOrNull` / `readSignalMonitorStateFresh` CPU if the signal state
   route remains hot after DB-demand cuts.

---

## 12. User rebuild recheck — 2026-07-02 ~19:36 UTC

User rebuilt again. Live API pid changed to `89731`; health check returned `{"status":"ok"}`.

### Bundle/source confirmation
- `artifacts/api-server/dist/index.mjs` timestamp: `2026-07-02 13:33:06 MDT`.
- Dist confirms the intended hot-path split:
  - `getSignalMonitorMatrixStreamStatus()` still calls full `getStockAggregateStreamDiagnostics()`.
  - `buildSignalMonitorMatrixStreamCoverage()` now calls `getSignalMonitorMatrixStreamCoverageStatus()`,
    not full diagnostics.
- Focused regression still passed:
  `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-stream.test.ts`
  → `28/28`.

### Runtime recheck
Sample file: `/tmp/pyrus-check-rebuilt-coverage-fix-20260702T193401Z.csv`.
Profile: `/tmp/pyrus-api-recheck-coverage-fix-89731-2026-07-02T19-35-16-009Z.cpuprofile`.

Observed:
- Slow-query stacks: `0/115`; slow-acquire stacks: `0/202`.
- API health OK.
- `getStockAggregateStreamDiagnostics` did not appear in the top profile frames.
- Top frames shifted to GC, `normalizeSymbol` inside signal-monitor stream bar merging, pg row parsing,
  signal-monitor aggregate queue/timeframe lookup, and SSE serialization.
- Pressure was still high during the sample: ELU ~`0.985-1`, event-loop delay `171-367ms`,
  API p95 `4584-6397ms`, and dominant route `GET /algo/deployments/.../cockpit`.

Conclusion: the coverage-diagnostics hotspot fix is live and verified, but broader cockpit/algo DB and
signal-monitor pressure remains. Continue with DB-demand cuts and signal-monitor stream bar/normalization
work; do not spend more time on the old aggregate-diagnostics frame unless it reappears in a fresh profile.

---

## 13. Next targets executed — 2026-07-02 ~20:00 UTC

Scope: continue from Claude's report using current runtime evidence. No `AGENT_CHAT`, staging, commits,
startup config edits, or Replit control-plane actions.

### What Claude's report contributed
- Mechanism: shared helium `pg.Pool` saturation is caused/amplified by API main-loop ELU delaying pg
  result drain and client release; raising `DB_POOL_MAX` remains the wrong fix.
- Original demand targets: `/flow/events` bucket N+1 and shadow-account mark refresh N+1 remain
  fact-backed, but they were snapshot-specific. Current post-fix runtime did not show `/flow/events`
  as the active dominant route.
- Corrected lower-confidence item: `/signal-monitor/events` Zod parse exists, but it is paginated events,
  not a 2000-symbol matrix. Do not prioritize it without a fresh profile showing it hot.

### Code changed
- `artifacts/api-server/src/services/signal-monitor.ts`
  - Added a per-symbol, per-emit source-minute-bars memo around signal-matrix aggregate deltas.
  - `loadSignalMonitorStreamCompletedBars()` now reuses the merged/converted 1m source bars across
    same-depth timeframes in one synchronous symbol emit, avoiding repeated
    `getRecentStockMinuteAggregateHistory()`, `getCurrentStockMinuteAggregates()`,
    `mergeSignalMonitorStockMinuteAggregates()`, and aggregate-to-bar conversion for 2m/5m/15m/1h.
  - Added `symbolSet` and `timeframesBySymbol` derived indexes to `SignalMonitorMatrixStreamScope`.
    The hot aggregate path now uses a normalized-symbol lookup instead of `scope.symbols.includes()`
    plus per-call `scope.cells.filter(...)`.
  - `buildSignalMonitorServerOwnedProducerScope()` now delegates through
    `normalizeSignalMonitorMatrixStreamScope()` so server-owned synthetic scopes get the same indexes
    as UI scopes.
- `artifacts/api-server/src/services/signal-monitor-stream-completed-bars-cache.test.ts`
  - Added a regression proving same-depth stream timeframe loads reuse one source-minute-bars memo entry.
- `artifacts/api-server/src/services/signal-monitor-stream.test.ts`
  - Added a regression proving exact-cell scopes resolve per-symbol timeframes through the new index.

### Validation
- `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-stream-completed-bars-cache.test.ts`
  → `6/6` passed.
- `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-stream.test.ts`
  → `29/29` passed.
- `pnpm --filter @workspace/api-server run typecheck` → passed.
- Backend reload through existing supervisor:
  - after source-bars memo: API pid `89731 -> 98187`, health OK.
  - after scope-index fix: API pid `98187 -> 101642`, health OK.

### Runtime evidence
- Post source-bars memo sample:
  `/tmp/pyrus-post-source-bars-memo-sample-20260702T195254Z.csv`.
- Post source-bars memo profile:
  `/tmp/pyrus-api-post-source-bars-memo-98187-2026-07-02T19-54-12-541Z.cpuprofile`.
  - `getRecentStockMinuteAggregateHistory()` and `getCurrentStockMinuteAggregates()` moved down to
    trailing frames; old source-load/normalization pressure was reduced but not eliminated.
  - Pressure still ramped back to high: ELU near `1.0`, top-level pool waiters reappeared.
- Post scope-index sample:
  `/tmp/pyrus-post-scope-index-sample-20260702T195749Z.csv`.
- Post scope-index profile:
  `/tmp/pyrus-api-post-scope-index-101642-2026-07-02T19-59-00-224Z.cpuprofile`.
  - `queueSignalMonitorMatrixStreamAggregate` dropped to ~`38ms`.
  - `signalMonitorMatrixStreamTimeframesForNormalizedSymbol` was ~`45ms`.
  - Remaining top frames were DB row decode (`_parseRowAsArray` ~`1.7s`), Massive websocket handling
    (`handleRawMessage` ~`1.5s` combined), GC (~`0.77s`), and SSE serialization (~`0.45s`).
- The API child changed again after profiling (`101642 -> 104756`). Current raw slow-query evidence on
  pid `104756` showed background `bar_cache` reads/writes and `execution_events` reads:
  - set-based `bar_cache` read with context `{routeClass:"background", workloadFamily:"bar-cache-read"}`;
  - repeated `bar_cache` upserts with `workloadFamily:"bar-cache-write"`;
  - execution-event reads with null context.

### Current decision point
- Observed: the two signal-monitor CPU micro-cuts are live and verified, but the system is still not fixed.
- Observed: current pressure is dominated by DB row volume / DB row parsing and background `bar_cache`
  read/write work, not the old aggregate diagnostics or `/signal-monitor/events` parse.
- Observed conflict: `signal-monitor-local-bar-cache-persist.test.ts` explicitly asserts
  "flush persists pending bar_cache writes while API pressure is high". Therefore making local-bar-cache
  writes yield under pressure is a deliberate durability/policy change, not a safe silent fix.
- Next recommended work:
  1. Decide whether local-bar-cache live aggregate persistence should keep writing through during high
     pressure. If yes, optimize write/read shape; if no, change policy to requeue/defer under high
     `resourceLevel` with an explicit test update.
  2. If avoiding that policy change, inspect `execution_events` duplication and shadow/account stream
     DB reads next, since they are now visible route-tagged pool consumers.
  3. Keep Claude's `/flow/events` N+1 and shadow mark-refresh batching in the backlog, but do not lead
     with `/flow/events` unless it is active in the current recorder/profile window.

---

## 14. Claude pickup packet — prepared by Codex 2026-07-02 ~20:05 UTC

Use this section as the starting point when handing back to Claude. Do not use `AGENT_CHAT` for this
workstream; the user explicitly said there is no chat on this.

### Current state
- API health is OK after reloads. Latest observed child after the final checks: pid `104756`.
- Source edits are uncommitted and limited to:
  - `artifacts/api-server/src/services/signal-monitor.ts`
  - `artifacts/api-server/src/services/signal-monitor-stream.test.ts`
  - `artifacts/api-server/src/services/signal-monitor-stream-completed-bars-cache.test.ts`
  - this handoff file
- The broader worktree is very dirty with unrelated user/agent changes. Do not revert unrelated files.

### Codex changes to preserve
1. Hot signal-matrix coverage path:
   - `buildSignalMonitorMatrixStreamCoverage()` uses lightweight
     `getSignalMonitorMatrixStreamCoverageStatus()`.
   - This avoids full `getSignalMonitorMatrixStreamStatus()` /
     `getStockAggregateStreamDiagnostics()` on every delta coverage object.
2. Hot stream completed-bars path:
   - Added per-symbol, synchronous source-minute-bars memo around a signal-matrix aggregate emit.
   - This reuses the same merged/converted 1m source series across same-depth timeframes for that
     symbol instead of re-running source history/current aggregate merge for each timeframe.
3. Hot aggregate queue path:
   - `SignalMonitorMatrixStreamScope` now carries `symbolSet` and `timeframesBySymbol`.
   - Aggregate queue/eval paths use indexed normalized-symbol lookup instead of repeated array scans.
   - Server-owned producer scope now goes through `normalizeSignalMonitorMatrixStreamScope()` so it has
     the same indexes as UI scopes.

### Validation already run
- `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-stream-completed-bars-cache.test.ts`
  → passed, `6/6`.
- `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-stream.test.ts`
  → passed, `29/29`.
- `pnpm --filter @workspace/api-server run typecheck` → passed.
- `git diff --check -- artifacts/api-server/src/services/signal-monitor.ts artifacts/api-server/src/services/signal-monitor-stream.test.ts artifacts/api-server/src/services/signal-monitor-stream-completed-bars-cache.test.ts CODEX_HANDOFF_2026-07-02_db-pool-elu-saturation.md`
  → passed.

### Runtime artifacts to inspect first
- `/tmp/pyrus-post-source-bars-memo-sample-20260702T195254Z.csv`
- `/tmp/pyrus-api-post-source-bars-memo-98187-2026-07-02T19-54-12-541Z.cpuprofile`
- `/tmp/pyrus-post-scope-index-sample-20260702T195749Z.csv`
- `/tmp/pyrus-api-post-scope-index-101642-2026-07-02T19-59-00-224Z.cpuprofile`

### What changed after Codex fixes
- Old top frame `getStockAggregateStreamDiagnostics` stayed gone.
- Source-bar merge/current/history frames moved down after the source-minute-bars memo.
- Queue/timeframe lookup moved down after scope indexing:
  - `queueSignalMonitorMatrixStreamAggregate` ~`38ms` in the post-index profile.
  - `signalMonitorMatrixStreamTimeframesForNormalizedSymbol` ~`45ms`.
- The system is still not solved. Current top CPU/profile pressure is now:
  - DB row decoding (`_parseRowAsArray`);
  - Massive websocket handling / quote merge;
  - GC;
  - SSE serialization;
  - background `bar_cache` reads/writes in recorder slow-query events.

### Next recommended steps
1. Re-sample current pid before editing:
   - read `.pyrus-runtime/flight-recorder/api-current.json`;
   - group recent `api-db-query-slow` and `api-db-pool-acquire-slow` events for the current pid;
   - capture a fresh 10-12s CPU profile if the pid has changed materially.
2. Resolve the local-bar-cache persistence policy conflict before changing code:
   - `artifacts/api-server/src/services/signal-monitor-local-bar-cache-persist.test.ts` currently asserts
     `flush persists pending bar_cache writes while API pressure is high`.
   - If product/ops agrees durability can lag under pressure, change that test and make local-bar-cache
     persist requeue/defer while `getApiResourcePressureSnapshot().resourceLevel === "high"`.
   - If that policy must stand, optimize the `bar_cache` write/read shapes instead of adding pressure
     gating.
3. Inspect `execution_events` duplication and shadow/account stream DB reads:
   - current recorder evidence after pid `104756` showed execution-event reads and
     `GET /api/streams/accounts/shadow` as visible pool consumers.
4. Keep Claude's original DB-demand cuts in backlog, but do not lead with them unless current evidence
   supports them:
   - `/flow/events` bucket N+1 in `historical-flow-events.ts`;
   - shadow-account mark refresh batching/capping.
5. Do not spend more time on `/signal-monitor/events` Zod parse or old aggregate diagnostics unless a
   fresh profile puts them back near the top.

---

## 15. Claude audit of Codex's changes + recommendations — 2026-07-02 ~20:35 UTC

Read-only audit (5-lane workflow `wf_7b9b8983-49a` + direct verification). No source edits.

### Verdict on the three Codex changes: SOUND — approve, with one bounded regression
1. **Coverage-status split** — `source`/`eventCount`/`lastEventAt`/`lastEventAgeMs` are exactly
   equivalent (old `diagnostics.provider` IS `getPreferredStockAggregateStreamSource()`,
   `stock-aggregate-stream.ts:701`). **Regression:** `coverage.delayed` lost the
   `activeProvider === "massive-delayed-websocket"` OR-clause (`signal-monitor.ts:9398` vs old
   :9375-9377) — after a provider-config change while a delayed subscription is live, coverage says
   `delayed=false` until the next subscribe/unsubscribe churn. Bounded: no in-repo reader of
   `coverage.delayed` exists today, and the stream-status event (routes/signal-monitor.ts:222,227)
   keeps old semantics. Fix is one line if wanted.
2. **Source-minute-bars memo** — bar-for-bar equivalent to the old path; memo window is fully
   synchronous with the yield-await strictly outside the memo callback; no key collisions
   (`symbol:240` for 1m, `symbol:300` shared by 2m/5m/15m/1h — identical inputs by construction);
   `includeProvisional` bypass conservative-correct. Note: memo safety rests on the per-emit fresh
   Map + sync window, NOT the revision counter (which doesn't bump on forward/forming updates).
   Latent hazard: memo hits share bar-object references — any future in-place bar mutation corrupts
   shared state (no mutator exists today). `aggregateStockMinuteAggregatesForSignalMonitorBars` is
   now dead in production (kept only by an unconsumed test-internals export).
3. **Scope indexes + server-owned scope via normalize** — safe; the 2000-symbol cap provably never
   binds (sole caller pre-clamps at the same constant, signal-monitor.ts:10029-10043); symbol
   sorting is benign-positive (stable `symbolKey`); the delegation is actually REQUIRED since the
   rewritten matchers read `symbolSet`/`timeframesBySymbol`. Latent: empty/invalid `timeframes`
   would fall back to ALL 6 timeframes (unreachable via the guarded caller today).

Validation re-run: stream tests 29/29, bars-cache tests 6/6, local-bar-cache-persist 5/5,
typecheck PASS. Live dist (built 13:59:26 MDT) contains all three fixes; live pid 104756 started
13:59:43 MDT → the running API runs the audited code.

### Verdict on Codex's 5 recommendations (checked against pid-104756 evidence, 19:59-20:17Z)
1. Re-sample pid first — **supported** (pid ~18 min old; api-exit 143 at 19:33Z + 2 abrupt restarts).
2. bar_cache persistence policy — **supported and now THE dominant issue**: `insert into "bar_cache"`
   is the top slow-SQL family (1367 events / ~5.07M ms cumulative, max 25.9s); bar-cache READS
   dominate slow pool acquires (4532 / ~6.42M ms) while pool sits 12/12 with 13-34 waiters. Flush
   path has NO pressure gate (`signal-monitor-local-bar-cache.ts:1104-1160`); write-through under
   pressure is test-pinned (persist.test.ts:171-192). **Needs user decision** (durability vs shed).
3. execution_events + shadow stream — supported but second-order (~163 events / 0.66M ms ≈ 5-10% of
   bar-cache totals); sequence after the bar-cache decision.
4. Backlog /flow/events N+1 + mark-refresh batching — supported (zero flow_events slow events on
   current pid; shadow stream only 15 / 45K ms). Both N+1 shapes still exist in source.
5. Skip /signal-monitor/events Zod — supported (route absent from slow events + topRoutes). Caveat:
   the `signal_monitor_events` TABLE background load is real (147 / 533K ms) — separate concern.

Current dominant slow route: `GET /algo/deployments/<id>/signal-options/state` p95 16.3s; ELU still
0.96-1.0. Next action gate: the bar_cache write-through-under-pressure policy decision (rec 2).

---

## 16. Claude execution plan — 2026-07-02 ~20:45 UTC (user delegated: "you're in charge")

**Policy decision (rec 2): KEEP bar_cache write-through durability; optimize write/read SHAPE**
(batch/coalesce statements + acquisitions). Rationale: chronic pressure would turn a pressure-gate
into de-facto persistence disablement; shape fix attacks measured cost without semantics change.
Fallback if diagnosis shows shape already optimal: bounded-backlog pacing (explicit test update).

Plan: (1) parallel read-only diagnosis — fresh baseline, bar_cache write shape, bar_cache read
shape, signal-options/state route (p95 16.3s), execution_events + null-context SQL; (2) implement:
coverage.delayed restore via O(1) active-source accessor (NOT the diagnostics scan), dead-code
removal, bar_cache write+read shape fixes, route fix, execution_events fix if warranted;
(3) two reload checkpoints (SIGUSR2) with recorder-family verification vs baseline. All edits stay
uncommitted. Status/results will be appended here as §17.

---

## 17. Implementations landed (pre-reload) — 2026-07-02 ~21:40 UTC

Baseline (pid 104756, 20-min window): acquire-slow 403/min (bar-cache-read 230/min), query-slow
276/min (bar_cache INSERT 114/min #1), ELU 1.0 pinned, pool 12/12 waiting 6-26, p95 ~6.2s.
Artifacts: scratchpad/baseline-{pressure,slow-events,groups}-104756.*.

Changes (all uncommitted, tests 93/93 + typecheck clean post-merge):
1. **T2** — coverage.delayed restored via new O(1) `getActiveStockAggregateStreamSource()`
   (stock-aggregate-stream.ts ~692); dead `aggregateStockMinuteAggregatesForSignalMonitorBars`
   removed (signal-monitor.ts).
2. **bar_cache writes** — new `persistMarketDataBarsMixed` (market-data-store.ts ~1240-1440):
   flush now ONE chunked mixed-timeframe/source upsert (same conflict target), per-entry
   okByIndex requeue; `BAR_CACHE_WRITE_BATCH_SIZE` 100→5000. Flush fan-out + concurrency
   helpers removed (dead). Expected: bar-cache-write statements ~5-6x fewer.
3. **bar_cache reads** — `STORED_BARS_DELTA_SYMBOL_BATCH=64` for delta prefetch (was
   floor(480/limit)=1-2 symbols/query); full-read batch floor 1→8
   (signal-monitor-local-bar-cache.ts ~80, ~256, ~671). Expected: bar-cache-read acquisitions
   multi-x fewer.
4. **signal-options route** — reconcile reuses caller shadowIndex (fix A, ~6641/9897);
   normal-mode polls serve fresh 15s cached summary snapshot (fix C, ~10523); freshlyBuilt
   cold-build skip of the duplicate signal re-read, cache hits still refresh (fix B,
   ~10068/10466/10577/10621). ~23→~5-14 queries/request.
5. **execution_events** — deferred by evidence (index-covered; ~5% of bar_cache load).

Policy preserved: write-through under pressure (persist test 5/5), no pressure gating, flush
concurrency 1, requeue never drops bars. Next: SIGUSR2 reload + recorder-family verify vs baseline.
