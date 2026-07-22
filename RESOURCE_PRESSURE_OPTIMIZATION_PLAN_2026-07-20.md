# Resource Pressure Optimization Implementation Plan

Date: 2026-07-20

Status: Reviewed plan, implementation not started

Scope selected by the user:

1. Eliminate evaluator-cap thrashing.
2. Move pure signal calculations off the Node main event loop.
3. Replace fixed database admission with adaptive admission.
4. Remove accidental long-lived package-manager wrappers.
6. Reduce diagnostic-event amplification without losing canonical diagnostic information.

## Planning method

This plan follows `planning-and-task-breakdown` and Ponytail at level `full`.
Three Codex planning lanes inspected the relevant source. Three cross-domain
Codex reviewers then challenged each proposed architecture for up to three
doubt cycles. No code, test, build, browser, restart, process signal, or
runtime endpoint action was performed during those reviews.

## Observed baseline

These are observed facts, not estimates:

| Area | Baseline |
|---|---|
| CPU capacity | Effective cpuset is two CPUs. There is no CPU quota throttling. |
| Memory | Cgroup maximum is 16 GiB, with no swap and no OOM/high/max events during the audit. |
| API | About 1.8 to 2.0 GiB RSS, with the Node main thread providing most API CPU. |
| Evaluator churn | In a matched two-minute live window, cap evictions increased by 7,336 and absent seeds increased by exactly 7,336. |
| Evaluator size | Existing source measurement is about 86 KiB per 240-bar retained cell, before some forming-bar clone overhead. |
| Event loop | Live ELU ranged roughly 0.52 to 0.69 after warmup. |
| Database | Shared pool max is 12; background admission is hard-capped at 2. Old live diagnostics showed up to 20 queued background requests, about 5.959 seconds recent p95, and about 21 seconds max. |
| Diagnostics | A recent 11-minute sample contained 1,237 slow acquire/query records, mostly background work. The recorder batches writes but still projects and serializes individual slow events and also has lossy suppression/caps. |
| Wrappers | Internal long-lived pnpm wrappers account for about 368 MiB PSS. The outer artifact pnpm adds about 70 MiB PSS. Two uv wrappers add about 42 MiB observed PSS combined. |

## Non-negotiable invariants

- Signal values, direction, actionability, timestamps, source-integrity
  decisions, settings identity, persistence ownership, and observable SSE
  coalescing must not change.
- Auth, trading, risk, data-integrity, and provider-rate controls are outside
  this optimization and must not be weakened.
- The shared database pool, auth pool, and trading pool remain distinct.
- Replit remains the sole owner of the outer app lifecycle.
- No second app copy, sideport, launcher signal, or pid2 signal is allowed.
- Runtime verification uses the normal managed app and real data.
- Heavy tests, builds, typechecks, and captures are serialized.
- Before any memory-heavy command, `MemAvailable` must be at least 6 GiB and
  cgroup `memory.current` must be at most 10 GiB.
- Package, Vite, artifact, and IBKR-viewer files currently owned by another
  lane are not touched until ownership is explicitly clear.

## Rejected designs

The following ideas failed adversarial review and will not be implemented:

- Raising the fixed 4,096-cell cap blindly.
- Keeping 4,096 first-arriving cells forever and computing all overflow
  statelessly.
- Treating `capEvictions = 0` as proof that expensive recomputation stopped.
- Discarding an older worker result only because newer input arrived.
- Allowing background work to fill all 12 shared-pool slots while claiming
  future interactive requests remain protected.
- Treating one borrowed logical acquisition as one physical PostgreSQL open.
- Retrying an append or count delta and calling it exactly-once without a
  persisted identity.
- Dual-writing legacy and batched diagnostic events.
- Capturing or logging the complete uv environment.
- Reimplementing pnpm generically by interpreting arbitrary package scripts.
- Replacing short-lived build-time pnpm processes that do not contribute to
  steady-state pressure.
- Updating the Replit artifact command before all exact topology validators
  understand the new process tree.

## Final architecture decisions

### Signal evaluation

The fixed cell-count LRU becomes a worker-owned active-set cache governed by
measured bytes and measured saved compute, not access-order churn.

- An evaluation identity includes every discriminator that can alter prepared
  bars or mutable evaluator state: settings signature and revision, symbol,
  timeframe, closure mode, stability policy, provisional/live-edge policy,
  and source lineage.
- Durable producer/subscriber leases keep periodic work warm. One-shot callers
  receive a bounded warm lease so they do not reseed every polling cadence.
- Atomic census epochs include queued, running, fallback-pending, and
  commit-pending identities. Worker requests cannot pass an unacknowledged
  epoch.
- Residency is selected at generation boundaries by expected saved
  milliseconds per byte and per unit time. Selection includes exploration,
  deterministic tie-breaking, stable windows, and hysteresis.
- A conservative byte model includes retained JS graphs, forming clones,
  sender and worker copies, packed-transfer scratch, response DTOs, shadow
  work, and fallback snapshots. The shared 16-GiB cgroup is not treated as an
  API-only heap.
- Active identities that fit remain resident. Overflow is evaluated
  canonically in the worker without evicting a higher-value resident.
- If the common real-data working set cannot fit the reviewed byte envelope,
  a compact `pyrus-signals-core` evaluator becomes a prerequisite. The work is
  not declared complete by hiding steady full-series rebuilds behind a new
  counter.

One native `node:worker_threads` worker is used because the runtime has two
effective CPUs.

- The worker is the sole owner of resident evaluator instances.
- Every normal production pure-signal caller is inventoried and routed through
  one private adapter in worker-on mode.
- The main thread keeps existing aggregate coalescing, source-integrity
  preparation, accepted immutable snapshots, state materialization,
  persistence-owner election, and SSE coalescing.
- Sync fallback uses a cache-free canonical primitive. It never populates a
  duplicate main-thread incremental cache.
- Existing raw Set/Map coalescing remains the acceptance boundary. Work is
  byte-reserved before acceptance; rejected work remains owned by that
  coalescer and can be replaced by newer input.
- Execution is FIFO per mutable evaluation identity. A symbol/profile batch
  has a commit barrier so partial completion cannot change grouping or
  `evaluatedAt` semantics.
- Persistence uses the existing owner-election routine at commit time and
  validates current profile/settings generation.
- Dirty-revision rollback is compare-and-swap and cannot erase newer debt.
- Queue wait never launches duplicate computation. A calibrated execution
  hang terminates the worker generation before one serialized canonical
  fallback is allowed.
- Transfer is selected only after measuring structured clone against a fresh
  disposable packed copy. The authoritative fallback snapshot remains intact.

### Database admission

The background value `2` remains the normal base ceiling, not a permanent
maximum and not a guaranteed floor.

- Existing lane priority and aging remain unchanged.
- A true interactive reserve `R` applies to all shared-pool noninteractive
  work: `bulk + background opening/inFlight <= globalMax - R`.
- Borrowing is considered only after the existing selector has no runnable
  work and no interactive waiter exists.
- Borrow decisions occur atomically at dequeue.
- Current borrowed background occupancy is derived from total background
  occupancy above its base, rather than permanently attaching a borrowed
  label to a client.
- At most one borrowed logical acquisition attempt may be opening. This is not
  described as a physical connection-open guarantee.
- New interactive demand immediately stops lending. Existing SQL remains
  non-preemptible and drains normally.
- All scheduler and pool limits are resolved from validated configuration.
- `R=2` is a rollout candidate, not an assumption. It advances only if real
  burst and tail data support it.
- Every shared-pool acquisition path must be scheduler-accounted before the
  reserve can be called real. Auth and trading pools remain outside this
  arithmetic.

This design deliberately leaves `R` capacity unavailable to noninteractive
work. Full utilization and guaranteed capacity for future interactive
arrivals are mutually exclusive when active SQL cannot be preempted.

### Diagnostic records

Lossless means lossless relative to the current allowlisted, sanitized
canonical diagnostic occurrence. It does not mean retaining raw SQL
arguments, credentials, deliberately excluded stack data, or unbounded
evidence through disk-full, SIGKILL, or indefinitely slow storage.

- Every known in-repo reader is recorded in a consumer manifest and moved to
  one legacy/V2 decoder before the writer changes.
- Golden fixtures prove legacy and V2 decode to identical ordered canonical
  occurrences and identical aggregates.
- The listener synchronously projects an immutable, field-allowlisted record
  with current JSON normalization.
- Each occurrence receives a writer-instance ID, contiguous sequence, ingress
  target date, and stable identity before buffer admission.
- V2 batches use a family dictionary and one ordered occurrence array. Only
  truly immutable fields are hoisted.
- Ordering is exact inside one writer instance. Cross-instance timestamp ties
  are explicitly unordered.
- Slow-event V2 records use an exclusive per-writer file family. This avoids
  racing the existing general flight-recorder writer and avoids cross-process
  truncation.
- Each file owner uses an explicit offset, handles short writes, and may
  truncate only its own in-process partial write before retry.
- A crash-truncated final record is reported and ignored; crash recovery is
  not misdescribed as recovering lost payload.
- Batches are bounded by conservative UTF-8 byte estimate and occurrence
  count, then recursively split until each encoded record fits.
- Stable contiguous sequence ranges make complete retry duplicates
  detectable without storing every occurrence ID.
- No dual-write, per-family suppression, overflow-family collapse, or daily
  slow-event drop cap remains after V2 is enabled.
- Pending bytes, oldest age, sequence gaps, first/last missing sequence, and
  permanently lost count are explicit. Healthy-operation acceptance requires
  zero gaps and zero permanent loss.
- One shutdown coordinator stops ingress, writes the terminal shutdown event,
  drains the recorder, drains incident persistence, and then closes the DB
  within the existing forced-exit deadline. Crash flushing remains separate
  best effort.

Sustained storage slower than ingress creates an unavoidable choice between
application availability, bounded memory, and zero loss. This plan preserves
application availability, makes any gap explicit, and defines the zero-loss
acceptance boundary as healthy writable storage plus completed graceful
drain.

Incident database summaries move to one writer-level FIFO.

- Occurrence, resolve, reopen, severity, and status operations share one
  ordered operation stream.
- A batch groups repeated incident keys, replays each key's operations in
  order against one locked starting state, and writes one final mutation per
  incident.
- A small persisted writer-cursor table makes ambiguous retries idempotent.
- The cursor and all incident changes commit in one transaction.
- Acknowledgment removes only the committed captured operations.
- Projected in-memory state remains distinct from committed state.
- Cursor rows carry completion/last-seen metadata and are retained beyond the
  retry horizon, then cleaned conservatively.

### Runtime wrappers

Only accidental steady-state wrappers are removed.

- Explicit audited role launch specifications replace long-lived internal
  pnpm roles.
- Package scripts are parsed only to compare exact expected fingerprints and
  fail closed on drift; they are not interpreted as a generic launcher.
- API and IBKR retain short-lived `pnpm run build` inside one supervised
  shell/process group, followed by final `exec` of the exact Node leaf.
- The direct leaf receives every behavior-relevant package lifecycle
  environment delta that source/runtime characterization proves necessary;
  build-child environment is never assumed to propagate back to the shell.
- Package-script identity is checked before and immediately after build.
  Generated entry identity and Vite CLI realpath/stat identity are checked
  immediately before final exec/spawn.
- The supervised group must contain no unexpected build helper before final
  exec.
- Vite starts its resolved package-local CLI directly.
- Market command resolution and process-group/signal/exit logic is extracted
  once into an import-safe shared module. `runDevApp` reuses it and directly
  owns the resolved cargo/nix group.
- The market resolver returns and spawns an absolute realpath with verified
  stat identity rather than trusting a later PATH lookup.
- Environment-essential nix/cargo roles remain unless a measured direct
  binary path proves equivalent.
- Python dewrapping advances only if repeated PSS measurement exceeds noise.
- Each Python restart revalidates uv. Only simultaneous cold starts may share
  a reference-counted preparation; no result persists across later restarts.
- A project-keyed filesystem lock with PID/start-time ownership serializes uv
  mutation across briefly overlapping old/new supervisors.
- A synthetic non-secret comparison discovers every uv-changed environment
  key, including additions, changes, and removals. Unknown deltas fail closed.
  No full environment or secret hash is emitted.
- A dedicated side-effect-free probe validates `sys.executable`, `sys.prefix`,
  `sys.base_prefix`, and bounded `sys.path` provenance.
- Reusing an already healthy Python service requires socket, PID/start-time,
  cgroup, and interpreter attestation. An unattestable legacy reuse is
  explicitly excluded from dewrapper success claims.
- Direct Python launch preserves exact module arguments, cwd, lane variables,
  health, backoff, PID/start-time identity, and group shutdown.
- Existing hard-kill orphan limitations are a no-regression boundary, not a
  stronger claim.
- Direct-capable code and every exact topology consumer land first behind a
  versioned topology marker.
- The topology marker is emitted by the actual supervisor and bound to its
  PID, start time, cwd, cgroup, and role-spec fingerprint.
- The artifact command changes last, preserves shell-level `trap '' HUP` and
  every `dev:replit` environment assignment, then `exec`s `runDevApp`.
- Rollback changes the artifact command first.

## Dependency graph

```text
P0 baseline contracts and measurements
|
+-- S0 signal caller/cost instrumentation
|   -> S1 private adapter and identity/census model
|   -> S2 byte-budgeted residency
|   -> S3 native worker runtime
|   -> S4 async ordering and production routing
|   -> S5 shadow/on real-data gates
|
+-- DB0 shared-pool path proof and scheduler tests
|   -> DB1 reserve and adaptive borrowing
|   -> DB2 diagnostic propagation
|   -> DB3 real-data canary
|
+-- W0 launch/topology inventory and baseline
|   -> W1 internal Node wrapper removal
|   -> W2 Python uv dewrapper
|   -> W3 direct-capable validators
|   -> W4 artifact command cutover
|
+-- D0 reader manifest and golden codec
    -> D1 versioned batch writer
    -> D2 shutdown and durability accounting
    -> D3 idempotent incident operation batching
    -> D4 real-data canary
```

The signal, database, and internal-wrapper branches may be implemented in
parallel. Diagnostic writer work starts after DB scheduler code is stable
because both affect the same pressure evidence. The artifact cutover remains
blocked until the concurrent artifact/package owner releases those files.

## Task breakdown

### Task P0: Freeze matched-window measurement protocol

Description: Record exact warmup, duration, enabled-service, process-tree,
memory, ELU, DB-lane, diagnostic, and wrapper measurements used before and
after each rollout.

Acceptance criteria:

- The protocol uses the normal managed runtime and real data.
- No secret environment values or generated capture payloads are printed.
- Repeated PSS samples and matched traffic windows are comparable.

Verification: Review the protocol against the observed baseline above.

Dependencies: None.

Likely files: Active session handoff and this plan only.

Size: S.

### Task S0: Add behavior-neutral signal cost telemetry

Description: Time and count every preparation, evaluation, transport-ready,
and finalization phase, and inventory every production pure-signal caller.

Acceptance criteria:

- Counters distinguish retained append/replay/reseed and canonical full-series
  work.
- All current production caller sites are enumerated in a testable boundary.
- Existing signal outputs and cache behavior are unchanged.

Verification: Focused signal-monitor tests plus one matched real-data window.

Dependencies: P0.

Likely files:

- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-monitor-matrix-eval-cache.test.ts`
- `artifacts/api-server/src/services/runtime-flight-recorder.test.ts`

Size: M.

### Task S1: Create one private compact evaluation adapter

Description: Put canonical and incremental core invocation plus compact DTO
materialization behind one private adapter. Keep a cache-free canonical entry
for fallback.

Acceptance criteria:

- Existing outputs are byte/deep equal across canonical and incremental paths.
- Raw evaluator primitives are no longer callable from unclassified
  production sites.
- Cache-free fallback cannot create main-thread resident evaluator state.

Verification: Existing core parity tests and focused adapter tests.

Dependencies: S0.

Likely files:

- `artifacts/api-server/src/services/signal-monitor-evaluation-engine.ts`
- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-monitor-matrix-eval-cache.test.ts`

Size: M.

### Task S2: Replace rotating LRU with active leases and byte admission

Description: Add authoritative leases, warm leases, census epochs, a
conservative byte model, deterministic exploration/scoring, and hysteretic
generation-boundary residency.

Acceptance criteria:

- Cyclic access above the old 4,096 count does not cause one-for-one
  eviction/reseed.
- Inactive identities retire; shared and periodic identities remain warm.
- Retained plus transient accounting never exceeds the reviewed byte
  reservation.

Verification: Deterministic cache-policy tests, settings/closure/lineage
tests, and a real-data residency/memory checkpoint.

Dependencies: S1.

Likely files:

- `artifacts/api-server/src/services/signal-monitor-evaluation-engine.ts`
- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-monitor-matrix-eval-cache.test.ts`
- `lib/pyrus-signals-core/src/incremental.ts` only if the hard capacity gate
  proves compaction is required
- `lib/pyrus-signals-core/src/incremental.test.ts` only with the preceding file

Size: L if compact-core work is required; otherwise M.

### Task S3: Add one native worker runtime

Description: Add a separately built worker entry, one ordered protocol, byte
credit reservation, census barriers, request state machine, compact results,
failure circuit breaker, and cache-free fallback.

Acceptance criteria:

- Request, worker generation, census epoch, identity revision, and settlement
  are unambiguous.
- Error, exit, calibrated hang, and fallback settle accepted work exactly
  once without unresolved byte credits.
- Production build emits the worker module and off mode creates no worker.

Verification: Worker-like unit tests, focused build, and forced-failure tests.

Dependencies: S2.

Likely files:

- `artifacts/api-server/src/workers/signal-monitor-evaluation-worker.ts`
- `artifacts/api-server/src/services/signal-monitor-evaluation-runtime.ts`
- `artifacts/api-server/src/services/signal-monitor-evaluation-runtime.test.ts`
- `artifacts/api-server/build.mjs`

Size: M.

### Task S4: Integrate async evaluation without changing coalescing

Description: Route accepted post-coalescing work through the worker, serialize
per identity, preserve batch commit barriers, reuse owner election, and add
compare-and-swap dirty revision handling.

Acceptance criteria:

- Existing Set/Map coalescing and observable SSE grouping remain unchanged.
- Accepted work either commits internally in order or settles stale and
  requeues only current debt.
- Worker failure produces the exact canonical result for the accepted
  snapshot.

Verification: Stream, divergent-settings, persistence-owner, completed-bars,
and injected-failure tests.

Dependencies: S3.

Likely files:

- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-monitor-stream.test.ts`
- `artifacts/api-server/src/services/signal-monitor-stream-completed-bars-cache.test.ts`
- `artifacts/api-server/src/services/signal-monitor-matrix-eval-cache.test.ts`

Size: L.

### Task S5: Signal shadow and worker-on rollout

Description: Add temporary off/shadow/on controls and bounded shadow
sampling, then compare matched live windows.

Acceptance criteria:

- Shadow mismatches, matrix serve mismatches, and accepted/settled imbalance
  remain zero.
- Full-series evaluations and main-thread evaluation milliseconds materially
  fall; queue depth returns to zero within producer cadence.
- ELU/event-loop delay improve without more than 10 percent total cgroup
  memory regression or sustained total CPU regression.

Verification: Normal managed-runtime real-data windows and source-confirmed
flight-recorder fields.

Dependencies: S4.

Likely files:

- `artifacts/api-server/src/services/signal-monitor-evaluation-runtime.ts`
- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/api-server/src/services/runtime-flight-recorder.test.ts`

Size: S.

### Task DB0: Prove shared-pool accounting coverage

Description: Enumerate every shared-pool query/acquisition path and add tests
that fail if work bypasses admission accounting.

Acceptance criteria:

- Every shared-pool acquisition is accounted or explicitly rejected.
- Auth and trading pool paths remain separate.
- Opening and in-flight accounting restore exactly once on all terminal paths.

Verification: Admission and pool-diagnostics tests.

Dependencies: P0.

Likely files:

- `lib/db/src/index.ts`
- `lib/db/src/admission.ts`
- `lib/db/src/admission.test.ts`
- `lib/db/src/pool-diagnostics.test.ts`

Size: M.

### Task DB1: Implement true reserve and adaptive background borrowing

Description: Add validated reserve arithmetic, atomic dequeue borrowing,
derived occupancy, current-demand response, and causal metrics behind a
temporary default-off rollout control.

Acceptance criteria:

- Noninteractive opening plus in-flight never exceeds `globalMax - R`.
- Background can exceed its base ceiling when safe, while queued interactive
  work stops new borrowing.
- Randomized abort, timeout, acquire failure, release, and mixed-lane tests
  preserve all bounds and existing aging.

Verification: Deterministic and randomized scheduler tests for multiple
global/base/reserve configurations.

Dependencies: DB0.

Likely files:

- `lib/db/src/admission.ts`
- `lib/db/src/admission.test.ts`

Size: M.

### Task DB2: Propagate adaptive-admission diagnostics

Description: Expose base, effective, opening, in-flight, cumulative admission,
reserve denial, and interactive-wait-with-borrowing metrics without changing
legacy waiter meanings.

Acceptance criteria:

- Legacy raw-pool waiting semantics remain unchanged.
- New metrics distinguish logical acquisition attempts from physical opens.
- API pressure diagnostics can attribute interactive delay to borrowed
  occupancy.

Verification: Pool and API diagnostic pressure tests.

Dependencies: DB1.

Likely files:

- `lib/db/src/pool-diagnostics.test.ts`
- `artifacts/api-server/src/services/diagnostics-db-pressure.test.ts`
- `lib/db/src/admission.ts`

Size: S.

### Task DB3: Run adaptive-admission canary

Description: Enable the reviewed reserve only for one controlled real-data
window after a managed restart.

Acceptance criteria:

- Background queue depth and p95 fall materially from the observed baseline.
- Interactive p95/tail, rejection, raw-pool waiting, auth, and trading do not
  regress.
- PostgreSQL CPU/I/O and total connections remain within the pre-canary
  envelope.

Verification: Matched normal-runtime windows; no sideport.

Dependencies: DB2.

Likely files: No code file; active handoff receives evidence.

Size: S.

### Task W0: Freeze launch and topology contracts

Description: Inventory exact scripts, environment assignments, executable
resolution, process groups, HUP behavior, shutdown grace, listener ownership,
and every procfs topology consumer.

Acceptance criteria:

- Baseline records no secret values or stable secret hashes.
- Every topology consumer and exact legacy identity is listed.
- Direct role specifications fail closed on package/executable drift.

Verification: Source review and fixed process/runtime measurement protocol.

Dependencies: P0.

Likely files:

- `artifacts/pyrus/scripts/runDevApp.mjs`
- `artifacts/pyrus/scripts/runDevApp.test.mjs`
- `scripts/check-replit-startup-guards.mjs`
- `scripts/replit-process-authority.mjs`
- `scripts/diag/same-process-runtime-watch.mjs`

Size: M.

### Task W1: Remove internal Node pnpm residents

Description: Keep short-lived pnpm builds, final-exec API/IBKR leaves, direct
Vite, and extract/reuse the market lifecycle controller so `runDevApp`
directly owns the resolved group.

Acceptance criteria:

- No long-lived internal pnpm remains after readiness.
- Cwd, argv, build/start order, health gate, signal normalization, and
  service-specific grace match baseline.
- Package scripts and generated/resolved executable identities are rechecked
  at the final exec boundary, and no unexpected build-group member remains.
- Shutdown leaves no new orphan or duplicate listener.

Verification: Launcher, market worker, supervisor, startup guard, and real
process-tree tests.

Dependencies: W0.

Likely files:

- `artifacts/pyrus/scripts/runDevApp.mjs`
- `artifacts/pyrus/scripts/runDevApp.test.mjs`
- `scripts/run-market-data-worker.mjs`
- `scripts/run-market-data-worker.test.mjs`
- One new import-safe market lifecycle module if extraction is necessary

Size: M.

### Task W2: Remove uv residents if benefit clears the gate

Description: Measure repeatable PSS, characterize uv deltas safely, implement
per-restart validation with simultaneous-start coalescing only, then direct
spawn the two Python leaves.

Acceptance criteria:

- Unknown uv environment deltas or interpreter provenance fail closed.
- Added, changed, and removed environment keys plus Python runtime provenance
  are reproduced by a side-effect-free probe.
- Both lanes preserve independent failure/restart/cancellation behavior and
  complete one real request.
- Overlapping supervisors serialize uv preparation, and an already healthy
  reused service must pass ownership/interpreter attestation.
- Median recovered PSS exceeds measurement noise and no startup/shutdown
  regression appears.

Verification: Python-compute tests plus managed-runtime process/PSS evidence.

Dependencies: W0 and a positive PSS gate.

Likely files:

- `artifacts/api-server/src/services/python-compute.ts`
- `artifacts/api-server/src/services/python-compute.test.ts`

Size: M.

### Task W3: Land direct-capable exact topology validators

Description: Add a versioned exact topology marker and update every procfs
consumer to understand the direct topology without broadly accepting arbitrary
Node ancestry.

Acceptance criteria:

- Legacy and direct identities are accepted only under their exact marker.
- Cwd, cgroup, PID/start-time, socket ownership, and platform-rooted pid2
  checks remain fail closed.
- The selected topology marker is bound to the matching live supervisor
  identity and role-spec fingerprint.
- All known operational topology tools agree on the same tree.

Verification: Startup guard, authority, watcher, supervisor, allocation, and
performance fixture tests.

Dependencies: W1.

Likely files:

- `scripts/check-replit-startup-guards.mjs`
- `scripts/replit-process-authority.mjs`
- `scripts/replit-process-authority.test.mjs`
- `scripts/diag/same-process-runtime-watch.mjs`
- `scripts/diag/same-process-runtime-watch.test.mjs`

Size: M.

### Task W4: Cut over the artifact command last

Description: After concurrent ownership clears and W3 evidence passes, change
the artifact command to preserve shell `trap '' HUP`, reproduce every
`dev:replit` assignment, and exec the direct launcher.

Acceptance criteria:

- Final tree is `pid2 -> runDevApp -> service leader/leaf`.
- No long-lived artifact pnpm remains.
- Rollback is one artifact-command reversion followed by one owner-controlled
  managed restart.

Verification: Normal Replit restart, readiness, exact ancestry, HUP
inheritance, startup peak, steady PSS, and graceful shutdown.

Dependencies: W3 and explicit release of the concurrent artifact owner.

Likely files:

- `artifacts/pyrus/.replit-artifact/artifact.toml`

Size: S.

### Task D0: Add the reader manifest, codec, and golden fixtures

Description: Inventory all readers and add one canonical expander for legacy
records and V2 per-writer batch segments.

Acceptance criteria:

- Legacy and V2 fixtures expand to deep-equal canonical occurrences.
- Existing aggregate/report output is identical.
- Unknown record versions and overlapping nonidentical ranges fail visibly.

Verification: Decoder and market-open acceptance utility tests.

Dependencies: P0.

Likely files:

- `scripts/diag/market-open-acceptance-utils.mjs`
- `scripts/diag/market-open-acceptance-utils.test.mjs`
- `scripts/diag/market-open-acceptance.mjs`
- One codec/manifest module in `scripts/diag`

Size: M.

### Task D1: Implement V2 slow-event batching

Description: Add immutable ingress projection, range IDs, dictionary encoding,
recursive byte splitting, exclusive per-writer segment ownership, offset-safe
writes, retry, and conservation metrics.

Acceptance criteria:

- Encode/decode is deep-equal after nested source mutation.
- One batch serialization replaces per-occurrence serialization and healthy
  operation reports zero gaps/loss.
- Partial/error retry cannot duplicate or corrupt an acknowledged range.

Verification: Recorder tests covering mutation, Unicode/escaping, oversized
records, short writes, retry, duplicate ranges, and truncated tail.

Dependencies: D0.

Likely files:

- `artifacts/api-server/src/services/runtime-flight-recorder.ts`
- `artifacts/api-server/src/services/runtime-flight-recorder.test.ts`
- The codec module selected in D0

Size: L.

### Task D2: Coordinate graceful diagnostic shutdown

Description: Move terminal-event emission and recorder/incident drain into one
deadline-aware shutdown coordinator; keep crash handling isolated and best
effort.

Acceptance criteria:

- New diagnostic ingress stops before the final drain.
- Terminal shutdown evidence is included before recorder close.
- Completion is claimed only when drains finish inside the existing deadline.

Verification: Shutdown-order, timeout, in-flight-write, and crash-path tests.

Dependencies: D1.

Likely files:

- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/services/runtime-flight-recorder.ts`
- `artifacts/api-server/src/services/runtime-flight-recorder.test.ts`

Size: M.

### Task D3: Batch incident operations idempotently

Description: Add one writer FIFO, ordered per-key folding, committed/projected
state separation, a transactional writer cursor, and bounded cursor cleanup.

Acceptance criteria:

- Occurrence/resolve/reopen/severity/status ordering and
  `countOccurrence:false` exactly match current semantics.
- Ambiguous same-sequence retry does not increment twice.
- Failed or delayed batches cannot clear newer operations or expose a false
  committed state.

Verification: Write-hygiene and DB-pressure tests plus migration round-trip.

Dependencies: D2.

Likely files:

- `artifacts/api-server/src/services/diagnostics.ts`
- `artifacts/api-server/src/services/diagnostics-write-hygiene.test.ts`
- `artifacts/api-server/src/services/diagnostics-db-pressure.test.ts`
- `lib/db/src/schema/diagnostics.ts`
- One repository-standard migration file

Size: L.

### Task D4: Run diagnostic V2 canary

Description: Enable V2 without dual-write for one bounded real-data window
after all known readers are compatible.

Acceptance criteria:

- Observed equals decoded plus pending, with zero sequence gaps and permanent
  loss under healthy storage.
- Canonical fields/order and market-open aggregates match legacy behavior.
- Main-thread serialization time, write calls per occurrence, and bytes per
  occurrence materially decline.

Verification: Managed-runtime real data and decoder replay.

Dependencies: D3.

Likely files: No code file; active handoff receives evidence.

Size: S.

## Agent orchestration

Initial parallel implementation ownership:

| Worker | Model/profile | First assignment | Exclusive initial files |
|---|---|---|---|
| Signal worker | Current Codex vertical, high reasoning | S0, then S1 only after checkpoint | Signal-monitor telemetry/adapter files |
| Database worker | Current Codex vertical, high reasoning | DB0 and DB1 | `lib/db` admission files |
| Runtime wrapper worker | Current Codex vertical, high reasoning | W0 and W1 | `runDevApp` and market-launcher files |
| Root | Current Codex vertical | Coordination, memory gates, serialized validation, reconciliation | Plan and active handoff |

Workers receive Ponytail `full`, one-read/one-patch discipline, no git, no
runtime restart, no sideport, no process signaling, and explicit file
ownership. A worker must stop if it observes an unexpected concurrent change
in an owned file.

Diagnostic implementation begins after one worker slot is free. No worker may
touch `artifact.toml`, package files, Vite config, or IBKR-viewer files until
the concurrent owner is cleared.

## Audit protocol

Every implementation checkpoint receives a fresh cross-domain Codex audit:

1. The signal change is reviewed by the database/diagnostics specialist.
2. The database change is reviewed by the wrapper/lifecycle specialist.
3. The wrapper change is reviewed by the signal/runtime specialist.
4. Diagnostic changes are reviewed separately for codec fidelity and
   transaction/idempotency behavior.
5. Findings are reported first, ordered by severity, with file/line evidence.
6. Root classifies every finding as contract misread, valid/actionable, valid
   tradeoff, or noise.
7. Accepted findings return to the original owner for one bounded correction
   patch.
8. The final combined change receives the repository `/review` quality gate.

No worker self-approves its own implementation.

## Serialized verification plan

Before each test/build/typecheck:

```bash
awk '/MemAvailable:/ { print $2 }' /proc/meminfo
cat /sys/fs/cgroup/memory.current
```

Signal commands:

```bash
pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-matrix-eval-cache.test.ts
pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-evaluation-runtime.test.ts
pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-stream.test.ts src/services/signal-monitor-stream-completed-bars-cache.test.ts
pnpm --filter @workspace/pyrus-signals-core exec tsx --test src/incremental.test.ts src/incremental-last-bar-closed.test.ts src/index.test.ts
```

Database commands:

```bash
pnpm exec node --import tsx --test lib/db/src/admission.test.ts lib/db/src/pool-diagnostics.test.ts
pnpm exec node --import tsx --test artifacts/api-server/src/services/diagnostics-db-pressure.test.ts
```

Wrapper commands:

```bash
node --test artifacts/pyrus/scripts/runDevApp.test.mjs
node --test scripts/run-market-data-worker.test.mjs
node scripts/check-replit-startup-guards.mjs
node --test scripts/replit-process-authority.test.mjs
node --test scripts/diag/same-process-runtime-watch.test.mjs
pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/python-compute.test.ts
```

Diagnostic commands:

```bash
node --test scripts/diag/market-open-acceptance-utils.test.mjs
pnpm exec node --import tsx --test artifacts/api-server/src/services/runtime-flight-recorder.test.ts artifacts/api-server/src/services/diagnostics-write-hygiene.test.ts artifacts/api-server/src/services/diagnostics-db-pressure.test.ts
```

Final commands, still serialized:

```bash
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run build
```

Commands are confirmed against source/package definitions immediately before
execution. A broad build or typecheck is not started while another heavy
action is active.

## Checkpoints and rollback

### Checkpoint A: Measurement only

Human review confirms S0/P0 attribution before worker architecture proceeds.
Rollback is removal of telemetry only.

### Checkpoint B: Signal residency

Real data must show reduced normalized full-series work without memory
pressure. If the common active set does not fit, stop and implement compact
core state before worker-on. Do not restore rotating LRU behavior.

### Checkpoint C: Worker shadow

Shadow is bounded and short because it duplicates work. Any output, ordering,
ownership, queue, or fallback discrepancy blocks on mode.

### Checkpoint D: Database canary

Borrowing and diagnostic V2 are not enabled in the same first canary. Disable
borrowing and restart to roll back; no in-flight SQL is cancelled.

### Checkpoint E: Internal wrapper tree

The outer artifact pnpm remains during the first internal-wrapper canary.
Restore the previous internal launch path and use one managed restart to roll
back.

### Checkpoint F: Artifact topology

`artifact.toml` changes last and rolls back first. Validators never broadly
accept both topologies without the exact version marker.

### Checkpoint G: Diagnostic V2

The dual decoder remains. Rollback returns the writer to legacy records
without dual-writing. Incident cursor changes roll back only after pending
operations drain.

## Human review points

- Review measured signal cost attribution after S0.
- Review the byte budget and actual active-identity cardinality after S2.
- Review worker shadow parity and ordering before worker-on.
- Review the observed interactive burst/tail evidence before selecting `R`.
- Review uv PSS evidence before accepting W2 complexity.
- Confirm the concurrent artifact/package owner has released files before W4.
- Review the explicit diagnostic durability boundary before enabling V2.

## Definition of done

All selected work is complete only when:

- Rotating evaluator eviction/reseed no longer occurs in steady real data and
  normalized full-series work materially declines.
- Pure signal evaluation no longer normally blocks the API main event loop.
- Background DB queue pressure materially improves without interactive,
  auth, trading, or pool-bound regression.
- Accidental resident pnpm/uv wrappers are gone where equivalence and measured
  benefit were proven.
- V2 diagnostic records reconstruct every canonical occurrence under healthy
  storage, known readers remain correct, and amplification metrics improve.
- All targeted tests, typechecks, builds, cross-audits, and managed-runtime
  real-data gates pass.
- The active session handoff contains exact evidence, remaining tradeoffs, and
  rollback state.

## GSTACK REVIEW REPORT

| Run | Status | Findings absorbed |
|---|---|---|
| Three source-planning lanes | Complete | Signal, DB/diagnostics, and lifecycle source contracts |
| Doubt cycle 1 | Complete | Rejected stable-first cache, stale-result discard, full-pool lending, non-idempotent retry, and generic package-script execution |
| Doubt cycle 2 | Complete | Added explicit state ownership, true reserve, durability boundary, exact reader rollout, and staged topology cutover |
| Doubt cycle 3 | Complete | Added complete evaluator identity/lease protocol, scheduler bypass proof, exclusive diagnostic segments, ordered incident cursor, uv attestation, and supervisor-bound topology marker |
| Cross-model review | Skipped | Repository model-vertical rule requires explicit user authorization for another model family; Codex-only review was stated to the user |

VERDICT: READY FOR STAGED IMPLEMENTATION, NOT READY FOR ONE-SHOT ROLLOUT.

Unresolved gates are intentionally empirical rather than architectural:
signal active-set byte fit, interactive reserve `R`, repeatable uv PSS benefit,
healthy-storage diagnostic throughput, and release of concurrent artifact
ownership. Failure at a gate stops the dependent rollout rather than silently
weakening an invariant.
