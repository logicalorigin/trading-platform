# Runtime and database pressure — next work plan

**Date:** 2026-07-21  
**Session:** `019f860d-58af-7533-a688-412cb3562c21`  
**Status:** WP0/WP1 implemented and source-verified; WP2 awaits explicit app-reload and live-navigation approval  
**Execution style:** one work package at a time, with an evidence checkpoint before the next package

## Execution status — 2026-07-21

- **WP0 complete:** collision checks, baseline preservation, memory preflight, lifecycle constraints, and the edit boundary were completed. The temporary services-only edit boundary was removed after validation.
- **WP1 complete in source:** governed IBKR reads now report fixed-label queue/execution timings; the API heartbeat and full diagnostics expose the governor snapshot; real-account positions report bounded stage timings without changing execution order or fanout topology.
- **Verification:** the focused API suite passes 48/48, and scoped `git diff --check` passes. The no-I/O governor micro-test remains below the 5 ms average overhead ceiling.
- **Known repository gate:** the package typecheck still exits nonzero on unrelated pre-existing dirty-tree errors in signal settings, automation, option-quote fixtures, overnight execution, shadow-account tests, and diagnostics provenance. It reported no error in the new attribution implementation.
- **Not yet runtime-verified:** the Replit-owned app was not reloaded, no browser was opened, and no database or configuration state changed. WP2 remains a separate approval gate.

## Outcome

Complete the remaining runtime/database-pressure investigation without conflating intentional admission waiting with actual PostgreSQL pool exhaustion. The first deliverable is attribution, not tuning: explain where an uncached positions request spends its time, including broker-governor queue wait versus upstream execution. Subsequent work corrects pressure semantics, fills only newly observed workload-context gaps, and performs a separate read-only physical-space analysis off-hours.

Release remains **HOLD** for the unrelated credential, TypeScript/build, and signal-settings gates. Nothing in this plan clears those gates.

## Current evidence

### Observed

- The prior matched five-minute watch recorded `GET /api/positions` at `2277 ms` and the canonical `GET /api/accounts/:accountId/positions` route at `399 ms`.
- The `2277 ms` request did not overlap shared-pool pressure, admission waiting, a recorded slow PostgreSQL operation with positions context, or material event-loop pressure.
- The legacy route selected full account-position enrichment because it omitted `detail: "fast"`. The two lightweight frontend consumers were migrated to the canonical fast route with `liveQuotes: false`; the legacy compatibility endpoint remains intact.
- Before WP1, `getAccountPositionsUncached()` had untimed boundaries for universe resolution, upstream position reads, quote/open-date work, hydration, seven-way full-detail fanout, real-position attribution, rehydration, and response shaping. WP1 now instruments those boundaries in source without changing their order; runtime samples await WP2.
- IBKR account reads enter `runGovernedWork()` through the cache/singleflight bridge. Before WP1 the governor exposed occupancy/backoff state but not queue-wait or execution durations; WP1 now adds sanitized timing observations while preserving the account concurrency default of 2.
- The matched database watch showed only background admission queueing, with the background lane held at its intended in-flight cap of 2 while the shared pool had headroom. This was intentional admission throttling, not pool exhaustion.
- Separate current-process samples briefly reached actual application-pool saturation: `active=12`, `idle=0`, with admission waiting. No admission timeout, query error, or SQLSTATE `53300` server-exhaustion evidence was observed.
- Raw `pg-pool` waiter samples had `rawPoolWaiting=1` while idle capacity remained. This matches the library's asynchronous idle-client handoff and is not exhaustion.
- `getPoolStats()` correctly exposes raw and admission waiters separately, but also exposes their sum as `totalWaiting` (`lib/db/src/index.ts:763`). Diagnostics and resource-pressure callers currently use the combined value as if any waiter meant pool saturation (`artifacts/api-server/src/services/diagnostics.ts:811`, `artifacts/api-server/src/services/resource-pressure.ts:299`, `artifacts/api-server/src/services/runtime-flight-recorder.ts:1151`).
- Workload-family context already exists at several creator boundaries, including account page streams, market-data storage, and option-metadata storage. Historical context-free events cannot be reconstructed.
- At WP0 start, the main backend files required for later packages were already heavily modified in the shared worktree. `work-governor.ts` and `ibkr-account-bridge.ts` were clean before WP1; `account.ts`, diagnostics, pressure, recorder, and DB-pool files were already dirty. WP1 preserved that collision baseline and touched only the approved attribution surfaces.

### Inferred

- The old `2277 ms` request most likely spent its time in full enrichment, upstream broker work, or broker-governor waiting rather than in the shared PostgreSQL pool.
- Correcting the two lightweight consumers should remove that exact legacy full-detail request creator, but fresh authenticated runtime evidence is still required to measure the new behavior.
- A single combined `totalWaiting` gauge is useful as backlog telemetry but is not sufficient to label the application pool saturated or the PostgreSQL server exhausted.

### Unknown

- The dominant account-position stage and its p95 under uncached, authenticated runtime use.
- How much of an upstream position stage is governor queue wait versus provider execution.
- Whether the remaining context-free slow operations still occur after the recent creator-context fixes.
- Current physical table/index allocation, reusable space, bloat confidence, and off-hours WAL contributors. Older maintenance reports are evidence of prior states, not current truth.

## Scope boundaries

This plan does not:

- change the legacy positions endpoint contract;
- tune governor concurrency, DB lane caps, pool size, timeouts, or backoff thresholds before attribution;
- clear caches or mutate the database merely to create a slow sample;
- retroactively name historical context-free events;
- run `VACUUM`, `VACUUM FULL`, `REINDEX`, `CLUSTER`, `ANALYZE`, `DROP`, retention deletes, or schema/config changes;
- restart or signal the Replit-owned launcher from the shell;
- perform live browser navigation or side-effectful controls without explicit approval;
- broaden into the unrelated release gates.

## Dependency order

```text
WP0 preflight / collision check
              |
              v
WP1 positions + governor attribution (instrumentation only)
              |
              v
WP2 matched authenticated watch
       | queue wait | upstream execution | local enrichment |
       +------------+--------------------+------------------+
              measured root-cause branch only
              |
              v
WP3 pressure-semantics correction
              |
              v
WP4 fresh-event workload-family completion
              |
              v
WP5 off-hours read-only physical-space analysis
              |
              v
WP6 final matched watch and issue/handoff report
```

Do not begin a downstream package merely because its code is nearby. Each package closes with its own acceptance evidence and user checkpoint.

## Work packages

### WP0 — preflight and baseline freeze

**Purpose:** prevent shared-worktree collisions and preserve the comparison baseline.

**Tasks**

1. Re-read `.claude/skills/ponytail/SKILL.md` at level `full` immediately before any code edit.
2. Capture focused diffs for every proposed target and identify whether the intended function is already being edited. Do not overwrite or normalize unrelated changes.
3. Record the existing matched-watch identifiers/timestamps and the exact prior route samples in the session handoff.
4. Define one small targeted test command per intended source file. Before any broader test/build or capture processing, verify at least 6 GiB `MemAvailable` and cgroup `memory.current` at or below 10 GiB.
5. Confirm the app lifecycle path available at execution time. If no native restart action is exposed, stop at the runtime checkpoint and ask the user to use Replit Run/Stop controls.

**Acceptance**

- Every touched file has an ownership/collision note.
- No code, process, database, or configuration state changed during preflight.
- The baseline is durable even if recorder retention rolls forward.

### WP1 — bounded positions and work-governor attribution

**Purpose:** explain request time without changing execution order, concurrency, caching, failure handling, or endpoint behavior.

**Implementation contract**

1. Extend the existing governor path with a sanitized timing observation for each governed operation:
   - category and fixed operation label (`accounts`, `positions`, `executions`, or `orders`);
   - queue wait, execution duration, and total duration;
   - whether it actually queued;
   - outcome limited to success, failure, canceled, or backoff;
   - no account IDs, symbols, request payloads, raw error text, credentials, or SQL.
2. Keep `getWorkGovernorSnapshot()` backward compatible and add only bounded diagnostic fields needed to distinguish occupancy and recent/cumulative waiting. Use monotonic time for durations.
3. Add stage timing around the existing account-position boundaries without changing their sequence or `Promise.all` topology:
   - universe resolution;
   - upstream position read;
   - fast-path cached open-date/read scheduling;
   - equity and option quote children;
   - initial market hydration;
   - each full-detail fanout child (`orders`, `lots`, `greeks`, equity quotes, option quotes, Flex open dates, execution open dates) plus fanout wall time;
   - real-position attribution;
   - full rehydration;
   - response aggregation/shaping.
4. Emit one sanitized slow positions sample containing detail mode, `liveQuotes` boolean, counts, stage durations, and total duration. Initial recording policy: failures always; successes at or above 250 ms; at most one event per detail mode per 10 seconds with a suppressed count. Reuse the recorder's bounded/rate-limited pattern instead of adding synchronous logging.
5. Include the work-governor snapshot in the existing five-second API heartbeat and full runtime diagnostics. Keep compact diagnostics compact unless a consumer requirement is found.

**Likely files**

- `artifacts/api-server/src/services/work-governor.ts`
- `artifacts/api-server/src/services/ibkr-account-bridge.ts`
- `artifacts/api-server/src/services/account.ts`
- `artifacts/api-server/src/services/runtime-flight-recorder.ts`
- `artifacts/api-server/src/services/platform.ts`
- narrow co-located tests for the governor, account-position timing, recorder, and diagnostics projection

**Tests first**

- A second governed operation waits behind a held slot; the observation reports positive queue wait and does not include that time in execution duration.
- A canceled queued operation decrements queue state and reports canceled without running work.
- Cache/singleflight hits do not fabricate new governed executions.
- Parallel enrichment children retain parallelism; fanout wall time is near the slowest child, not the sum.
- Recorder output is rate-bounded, carries `suppressedCount`, and strips sensitive/oversized values.
- Existing result payloads and errors are byte/shape compatible.

**Acceptance**

- Targeted tests pass.
- No concurrency, cache TTL, backoff, endpoint, or generated-client contract changes.
- Instrumentation overhead is below 5 ms in a deterministic no-I/O micro-test and adds no synchronous filesystem write on the request path.
- A timing sample can distinguish governor queue wait from provider execution for a positions operation.

### WP2 — matched authenticated runtime watch and root-cause branch

**Purpose:** collect fresh evidence after the consumer migration and WP1 instrumentation.

**Approval gate:** app reload and live browser navigation require explicit user approval. Use the normal app URL; do not use safe-QA mode unless testing safe-QA itself.

**Method**

1. Load backend changes only through the Replit-owned workflow controls.
2. Confirm readiness with explicit health/UI selectors; do not use `networkidle`.
3. Run one five-minute watch under the same account/page workload used for the earlier comparison. Do not clear caches or trigger side-effectful controls.
4. Obtain at least three naturally uncached positions operations (the bridge TTL defaults to 2 seconds) and retain:
   - canonical route duration and status;
   - positions stage breakdown;
   - governor queue/execution split;
   - work-governor occupancy;
   - DB pool active/idle/raw/admission lane state;
   - event-loop delay/utilization;
   - overlapping slow DB/WAL waits and errors.
5. Compare against `2277 ms` legacy and `399 ms` canonical prior samples. Keep unmatched periods labeled as such.

**Decision rule**

- **Governor queue dominates:** trace the occupying operation mix and singleflight/cache behavior; propose a policy change separately. Do not raise concurrency in this package.
- **Provider execution dominates:** trace the source-confirmed broker request and timeout/retry path; do not blame local DB admission.
- **A local enrichment child dominates:** optimize only that measured child, preserving response semantics.
- **No stable dominant stage:** repeat one bounded matched watch and verify timing coverage before changing code.

**Acceptance**

- Stage wall time accounts for total service time within 10% or the unmeasured remainder is explicitly named.
- Queue wait and execution time are independently reported for every sampled uncached positions operation.
- No 5xx, request timeout, admission timeout, or new recorder failure occurs in the watch.
- The next optimization, if any, is tied to observed stage evidence.

### WP3 — correct operational pressure semantics

**Purpose:** make labels and controls describe the actual limiting layer.

**Classification contract**

| State | Required evidence | Meaning | Control effect |
| --- | --- | --- | --- |
| `admission_backlog` | `admissionWaiting > 0`, with lane breakdown | callers intentionally queued before the shared pool | telemetry/watch only; not named pool saturation and not a hard resource gate by itself |
| `app_pool_saturated` | `max > 0`, `active >= max`, `idle === 0` | all application-pool connections are checked out | may drive existing pool-pressure hysteresis; queue depth determines watch versus high |
| `raw_handoff_pending` | `rawPoolWaiting > 0` and `idle > 0` | asynchronous idle-client handoff snapshot | informational only |
| `raw_pool_blocked` | `rawPoolWaiting > 0`, `idle === 0`, and application pool full | callers reached `pg-pool` and are blocked | pool-pressure evidence |
| `server_connection_exhausted` | SQLSTATE `53300` or the connection-exhaustion gate | PostgreSQL server refused connections | separate error condition; never inferred from gauges alone |

**Tasks**

1. Add one pure classification helper at the DB diagnostics boundary and unit-test the table above.
2. Preserve existing numeric fields (`waiting`, `rawPoolWaiting`, `admissionWaiting`, `totalWaiting`) for compatibility; add explicit derived fields rather than redefining the old values.
3. Replace saturation labels/recorder event names and comments that currently equate `totalWaiting > 0` with exhaustion.
4. Feed actual application-pool saturation plus relevant queue depth into resource-pressure hysteresis. Expose admission backlog as a distinct driver with lane detail, not as hard pool exhaustion.
5. Preserve the collector's conservative load-shedding behavior initially under a correctly named `diagnosticsDbPoolHasBacklog`/busy predicate. Loosening when heavy diagnostic reads run is a separate measured policy decision.
6. Keep raw idle-handoff snapshots out of saturation incident counts.

**Likely files**

- `lib/db/src/index.ts` and `lib/db/src/pool-diagnostics.test.ts`
- `artifacts/api-server/src/services/diagnostics.ts`
- `artifacts/api-server/src/services/resource-pressure.ts`
- `artifacts/api-server/src/services/runtime-flight-recorder.ts`
- their existing pressure/recorder test files

**Acceptance**

- All five classification rows have positive and negative tests.
- Background admission waiting with pool headroom does not produce an `app_pool_saturated` event or hard pressure.
- `12/12`, zero idle, with a deep queue still reaches the existing high-pressure state after hysteresis.
- One raw waiter with idle capacity is labeled handoff-pending/informational.
- SQLSTATE `53300` remains independently visible.
- Existing conservative diagnostics read-skipping behavior is unchanged in this package.

### WP4 — complete workload attribution at creator paths

**Purpose:** make newly generated slow-operation evidence attributable without inventing historical labels.

**Tasks**

1. Re-inventory only context-free events produced after WP1-WP3 are loaded.
2. For each repeatable family, trace the timer, queue, stream, or request creator before editing.
3. Apply `runWithPostgresDiagnosticContext()` at that creator boundary, before enqueue/scheduling, and retain the existing DB lane. Do not add labels inside generic query helpers merely to make reports look complete.
4. Use stable, bounded workload-family names; never include account IDs, symbols, SQL, or payload-derived text.
5. Add an async-boundary test proving context survives the actual queue/timer/lazy-thenable shape and appears in the recorder.

**Acceptance**

- Every repeatable context-free family in the controlled watch is either attributed at its creator or documented as an unknown with evidence.
- Known account-page-stream, market-data-store, and option-metadata-store contexts remain intact.
- Historical context-free events remain labeled unknown; no retroactive guessing.

### WP5 — off-hours read-only physical-space and WAL analysis

**Purpose:** replace stale physical-space assumptions with current, low-impact evidence. This package produces a report, not remediation.

**Approval gate:** agree on an off-hours window before connecting. The probe must be read-only, use a short statement timeout/lock timeout, and stop if application pressure rises.

**Preflight**

- Confirm `MemAvailable >= 6 GiB`, cgroup `memory.current <= 10 GiB`, no broad build/capture processing, and no other maintenance lane is active.
- Confirm the exact database target from existing configuration without printing credentials.
- Set `default_transaction_read_only=on`, a bounded `statement_timeout`, `lock_timeout`, and a recognizable `application_name`.
- Treat old maintenance documents as historical evidence only. Their former process-control steps are superseded by current Replit lifecycle rules.

**Read-only inventory**

1. Database and top relation allocation: heap, indexes, TOAST/auxiliary bytes, and percentage of database size.
2. Table churn: estimated live/dead tuples, inserts/updates/deletes, HOT updates, vacuum/analyze timestamps, autovacuum counts, and stats reset time.
3. Index evidence: size, scan/read/fetch counts, invalid/duplicate definitions, and constraint ownership. Never call an index unused from `idx_scan=0` without reset age and source-reader proof.
4. Bloat confidence: begin with catalogs and existing extensions only. Do not create extensions. Run `pgstattuple_approx` only if already installed, targeted, and within the agreed timeout.
5. WAL overlap: bounded deltas from WAL/background-writer/checkpointer statistics plus sampled active wait events and sanitized query families. Do not print raw SQL or large captures.
6. Retention alignment: compare oldest/newest data and current policy for only the high-allocation families.

**Output**

- Current facts, inferences, and unknowns.
- Ranked candidates by recoverable bytes, operational pain, confidence, lock risk, and existing retention support.
- A separate remediation proposal for each candidate with backup, rollback, quiet-window, and verification requirements.

**Acceptance**

- No DDL, DML, vacuum/analyze, retention execution, config change, or app lifecycle action.
- Every reclaim estimate states its evidence and confidence.
- Any `VACUUM FULL`, `REINDEX`, `CLUSTER`, or `DROP` recommendation remains behind a new explicit user approval and maintenance runbook.

### WP6 — final matched watch and durable report

**Purpose:** verify the completed observability/semantics work and close this issue stream without misrepresenting release readiness.

**Measurement matrix**

| Signal | Before | After target |
| --- | --- | --- |
| Lightweight positions route | prior canonical sample `399 ms`; old legacy sample `2277 ms` | report p50/p95 and stage breakdown; no legacy lightweight creator |
| Governor | occupancy only | queue wait, execution time, outcome, and operation label |
| Admission backlog | folded into `totalWaiting` saturation language | separate lane-aware backlog signal |
| App-pool saturation | inferred among combined waiters | explicit full-occupancy/zero-idle classification |
| Raw waiter with idle capacity | could look like saturation | informational handoff-pending classification |
| Server exhaustion | not observed | remains based on `53300`/gate evidence only |
| Slow DB workload | some context-free events | repeatable new families attributed at creators or explicitly unknown |
| Physical space | historical/stale reports | current read-only, confidence-ranked inventory |

**Acceptance**

- Run one final matched five-minute watch using the same readiness and safety rules as WP2.
- Report route p50/p95, position stage p50/p95, governor queue/execution, seconds in each pool state, admission wait by lane, raw-handoff count, DB errors/timeouts, event-loop state, and WAL overlap.
- Update the issue report and active session handoff with observed/inferred/unknown sections.
- State explicitly that release remains HOLD until the unrelated gates are resolved.

## Failure modes and controls

| Failure mode | Control |
| --- | --- |
| Instrumentation changes behavior | Time existing calls in place; do not reorder awaits or change `Promise.all`; assert payload/error compatibility. |
| Telemetry becomes a write amplifier | Buffer asynchronously, threshold and rate-limit successful samples, carry suppressed counts, and bound cardinality/bytes. |
| Sensitive account/provider data leaks | Fixed labels and numeric counts only; recorder sanitization tests; no IDs, symbols, raw errors, SQL, or payloads. |
| Shared dirty-tree work is overwritten | Focused diff before every edit; stop on overlapping ownership; no cleanup of unrelated files. |
| Cache hides the slow path | Use naturally expired TTL and governed-operation evidence; never clear production caches merely to force a sample. |
| A label fix silently changes load policy | Keep backlog/busy and saturation predicates separate; preserve conservative diagnostics skip policy until separately measured. |
| A raw handoff is counted as exhaustion | Require zero idle/full occupancy for pool saturation; test raw waiter plus idle capacity explicitly. |
| Physical analysis adds pressure | Off-hours, read-only transaction, bounded timeouts, targeted catalog queries, and immediate stop on pressure. |
| Stale statistics drive destructive advice | Record stats reset, distinguish estimates from exact facts, and require source-reader/constraint evidence before index action. |
| Runtime validation uses the wrong process | Replit-owned reload only; confirm PID/readiness; never shell-launch or signal launcher/pid2. |

## Checkpoints requiring user direction

1. **Start checkpoint:** approve WP1 instrumentation only.
2. **Runtime checkpoint:** after targeted tests, approve Replit reload and normal-app authenticated navigation for WP2.
3. **Semantics checkpoint:** review WP2 evidence before WP3 changes any pressure/gating inputs.
4. **Off-hours checkpoint:** choose a read-only analysis window for WP5.
5. **Maintenance checkpoint:** any physical remediation is a new plan and explicit approval; it is not authorized here.

## Recommended first action

Start with WP0/WP1 only. This is the smallest reversible step that resolves the central unknown and prevents later tuning from being based on a combined or mislabeled pressure signal.
