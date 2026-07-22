# Runtime Pressure, Ceiling, Retry, and Timeout Audit

Date: 2026-07-16  
Status: source repair complete; attached-runtime reload and post-fix soak pending

## Decision Rule

Every limit is classified by its owner and effect:

- Product semantics may limit a result only when the user or an external protocol defines the limit.
- A batch width may divide complete work, but may not truncate it.
- A resource guard may protect attributable finite capacity, but it must be observable and may not report skipped work as success or missing data.
- A cache may evict recomputable state, but it may not become the source of truth.
- A timeout may detach one caller or select one explicit fallback. It may not cancel shared work, advance freshness, or activate another hidden retry stack.
- A global pressure label is telemetry. The queue, provider, database lane, socket, or retained object that owns the capacity must own pacing.

## Observed Root-Cause Chain

This was not primarily a bad threshold. The thresholds amplified a workload ownership bug:

1. The configured Signal Monitor producer selected 2,000 symbols across six timeframes: 12,000 cells per sweep.
2. Producer reads/writes passed through a foreground completed-bars object cache sized for 3,072 entries. The working set therefore evicted itself deterministically during every sweep.
3. Repeated bar-cache reads, decode/allocation, and garbage collection drove DB demand and ELU/event-loop delay.
4. Global pressure state then paused or degraded unrelated readers, persistence, chart refresh, Flow hydration, SnapTrade, metadata, diagnostics, polling, and sparklines.
5. Several readers returned empty/null or suppressed writes under that label, which activated provider fallback and repeated hydration. The attempted relief therefore created more work.

The root repair bypasses the foreground object cache for the 12,000-cell producer while preserving durable/local caches, singleflight, and the 16,384-cell packed base. It also removes global pressure from data-truth decisions. Pressure remains observable; attributable queues own pacing.

## Why the Algo Banner Appeared

Observed facts:

- The attached API is running with `TRADING_MODE=live`.
- Startup intentionally seeds the canonical Signal Options deployment in `shadow`, not `live`.
- The old Algo client used the process execution mode as a deployment-inventory filter.
- The canonical `shadow` ledger exists, is owned by the founding admin, and the current active sessions are admin sessions.
- The two enabled shadow deployments are distinct products (`Pyrus Signals Options Shadow` and `Overnight Equities`), not duplicate seed rows.

Therefore the exact `Live Signal-Options Deployment Unavailable` card is deterministic old-client behavior: a valid shadow deployment is hidden because the process is live. It is not currently an authorization failure or missing seed.

Source now keeps one all-mode canonical inventory, prefers shadow only when no explicit focus exists, follows an explicitly selected live deployment, keys the cockpit stream to the focused deployment, defaults creation to shadow, and prevents a live/no-target stream frame from erasing shadow inventory. The attached runtime still serves the old bundle until the one sanctioned reload.

## Removed or Reassigned

| Rule | Root problem | Repair |
| --- | --- | --- |
| Signal readiness `64` cells/cycle | Arbitrary throughput ceiling; minute wakeups could turn cold readiness into hours. | Removed. Work uses short cooperative slices and continuously reschedules. |
| Signal retry history `64` bars | Different time coverage for every timeframe. | Replaced with the producer’s four-hour timeframe-specific history depth. |
| Signal Monitor profile `500` API/UI maximum | OpenAPI-generated validation rejected 501–2,000 before the service, while the producer and Algo UI advertised 2,000. | Raised the contract/UI maximum to the existing 2,000 service ceiling and regenerated clients; 2,000 remains an explicitly documented architecture ceiling. |
| Signal Options stored-state `.limit(500)` | The worker could never see actionable state 501, and a database failure was caught and cached as a fresh empty success. | Removed result truncation; universe predicates define the result. Read failures now reject and cannot populate the success cache. |
| Shadow mark fallback `.limit(1000)` theory | The scan can truncate a diagnostic valuation peak, but that field is not a trailing-stop enforcement input. The real restart bug merged lifetime/midpoint ledger peaks into an event position while retaining `executable_bid` provenance. | Reconciliation preserves a trusted event peak when executable-bid provenance exists. Reliable cold recovery still requires persisting bid plus provenance; widening the valuation scan would not repair it. |
| Producer use of 3,072-entry foreground bars cache | 12,000-cell cyclic cache thrash. | Producer bypasses only the foreground object cache; foreground joiners may still retain their result. |
| Signal cold-read ELU/admission gate | A symptom could strand readiness indefinitely. | Only explicit heap/RSS retained-memory protection can stop the backfill; DB admission paces queries. |
| Market-data-store/local-bar pressure empty returns | Fabricated missing data and amplified provider fallback. | Removed. Reads execute through their database lane; true query errors remain errors. |
| Option-chain degraded empty as HTTP/SSE/cache success | The tolerant automation result lost its debug health at a shared wrapper; provider failure/backoff became HTTP 200 with `contracts: []`, a freshly timestamped SSE snapshot, and an account cache entry with `error: null`. | The consumer boundary is strict: only provider-confirmed fresh empty is a valid empty result. Degraded empty throws an exposed typed 503, SSE does not advance freshness, and account Greeks retain last-good contracts with a non-null error. Tolerant automation keeps the debug-aware API. |
| Global 15-second market-store breaker for any DB error | Pool waits, statement timeouts, and deterministic query failures poisoned unrelated keys. | Breaker opens only for classified connection outages. Contention remains retryable locally; terminal/query-local errors are visible and do not open it. |
| Option metadata pressure read/write/mid-batch gates and local one-slot drop | Discarded valid metadata and duplicated shared DB admission. | Removed. Shared background DB admission is the pacing owner. |
| Flow manager/planner/observation pressure gates | Stale/empty universe state and retained writes waited on unrelated pressure ticks. | Removed. DB admission paces actual work; the next Flow observation triggers transient recovery. |
| Flow latest-only outage coalescing | Changed sequential EWMA, failure count, and cooldown semantics. | Replaced with a bounded compositional accumulator, transactional set-based recovery, row bisection/quarantine, and exact systemic-error classification. |
| Flow per-observation shared promises and class-42 bisection | Ignored promises accumulated adoption reactions during a long outage; schema/query SQL errors could recurse into 499 writes and quarantine every row. | Observation admission is synchronous and one explicit drain owns completion; SQL class 42 is terminal/systemic while row-local classes alone are bisected. |
| Stale chart background-refresh pressure gate | Served stale data and then disabled the only repair path. | Removed. Background enablement, request abort, quiet-session policy, and request ownership remain. |
| Flow historical-hydration pressure gate | Silently changed scanner evidence under unrelated resource state. | Removed. Local concurrency/provider/database owners remain. |
| SnapTrade pressure persistence/read/refresh gates | Fetched history could be discarded as zero-count success and stored equity could become a pressure-only 503. | Removed. Bulk DB admission paces writes; per-account outcomes report exact success/failure. |
| SnapTrade unconditional recovery retry | A review worker introduced a second broad retry stack. | Removed during root review. Scheduled failures stay explicit; read-time failure clears its freshness marker for a later caller-owned attempt. |
| Balance-snapshot select-then-insert race | Concurrent/restarted IBKR writers had no account/time uniqueness and created 6,856 duplicate keys with 22,636 excess rows; SnapTrade had the same unsafe shape even though no persisted duplicates were observed there. | Both writers lock their stable account row and perform existence check/insert in one transaction, safe before migration. A manual transactional migration archives ranked extras, removes only duplicates, and adds the natural-key index; reload does not pretend to run it. |
| Diagnostics pressure-capped reads/exports and pressure-skipped persistence | The system could erase the incident evidence needed to explain its own degradation. | Requested limits are semantic, not pressure-selected; DB admission owns persistence. |
| Client memory-pressure scheduler | High memory disabled sparklines, imposed 30s/60s signal poll floors, backed off all hydration, and even blocked work before the first sample. | Memory is telemetry in this path. Platform work caps are invariant; explicit provider backoff/startup/mutation guards remain. |
| IBKR work pressure as generic hydration pressure | Provider-specific IBKR backoff suppressed Massive, local-cache, Flow, and chart hydration. | Generic hydration is always available; only IBKR-owned classes inherit IBKR state. |
| Hidden Signal Matrix high-pressure task cap (`48`) | Direct planner callers still received one-fifth coverage under a global label. | Removed; planner capacity is invariant and explicit caller limits still rotate through complete work. |
| Signal Matrix/fallback symbol cap (`500`) | A stock-aggregate snapshot fanout budget truncated matrix truth, quote coverage, and fallback planning. | Matrix/fallback symbol coverage is uncapped and 240-cell work rotates to completion. The 500 budget is isolated to the stock-aggregate snapshot owner pending a paged/multiplexed history handoff. |
| Trade execution REST/SSE `limit=64` | Truncated the seven-day execution ledger. | Removed; the upstream source window was already seven days. |
| Algo freshness registry `64` entries | Deployment 65 looked stale and restarted REST polling. | Removed; the owning stream deletes lifecycle state explicitly. |
| Background bar persistence `128/512` queue/drop caps | Silent closed-bar loss caused repeated gap fills. | Semantic-key coalescing, typed retryable/terminal outcomes, same-key serialization, and visible counters. |
| Custom fetch internal retry stack | Combined with React Query into 10–15 physical attempts. | Transport no longer retries. React Query is the single policy owner and retries only tagged network/408/425/429/5xx failures, never timeout/cancel/unknown programming errors. |
| Cross-origin shared-fetch key | Heavy GETs with the same path on different API origins could coalesce and return the first origin’s response. | The producer key now includes canonical origin as well as path/query/request identity. |
| Shared-fetch creator-owned abort and queue-only timeout | One caller could cancel every waiter; queued work could begin after its deadline. | Ref-counted waiters, producer-owned controller, total deadline starts before queue, zero-waiter abort, and priority aging. |
| Diagnostics and Algo SSE promise chains | A slow client retained unbounded serialized work; Algo polls overlapped async authorization and advanced freshness too early. | One bounded writer per connection, one drain waiter, snapshot/heartbeat coalescing, visible overflow/drain-timeout/write-error reasons, awaited scoping, and live-before-freshness ordering. Socket errors can no longer masquerade as timeouts. |
| Process-local-only default seeds | Concurrent startup could create duplicates or publish a partial strategy/deployment. | Transaction-scoped PostgreSQL advisory locks and atomic canonical repair. Process singleflight is only an optimization. |

## `64` Classification

The number itself is not trusted; its effect is:

- Removed as product truncation: Signal readiness, Signal retry history, Trade execution activity, Algo freshness registry.
- Complete batching: stored-bar delta symbols and sparkline DB seed chunks process every chunk.
- Recomputable cache capacity: account live-content, formatter, timezone-validation, and research caches fall back to their source.
- Protocol/security/input shape: SHA-256 lengths, token/key material, bounded identifiers, telemetry strings, schema widths.
- Numerical convergence: 64 bisection iterations for implied volatility reaches floating-point precision; it is not a row/symbol ceiling.
- Still architectural: the historical per-contract browser stream pool defers after 64 active EventSources and uses REST fallback. `64` is not a provider ceiling. Deleting it would create unbounded sockets; the proper repair is a multiplexed stream with visible queue depth and no per-contract connection count as product semantics.

## Kept Finite-Capacity Guards

| Guard | Why it remains |
| --- | --- |
| Shared DB admission lanes and the configured PostgreSQL pool | They bound real connections and queue work instead of fabricating empty data. Runtime evidence showed result parsing/loop work, not proof that a larger pool is safe. |
| Route admission for deferred analytics on sustained heap/RSS/deep-pool saturation | It is explicit (`429/503`, headers, Retry-After), limited to lower-priority work, and keyed only to finite resources—not ELU or request latency. It needs inhibitor-surface integration, not threshold guessing. |
| Signal backfill heap/RSS retention guard | The backfill owns a large retained working set and trims its private evaluator state before pausing. Removing this can turn overload into OOM. |
| Options Flow concurrency/line reduction under sustained finite memory/pool pressure | It degrades its own retained workload but never drops to zero; ELU, latency, and automation pressure are ignored. |
| Bar persistence retry block on actual pool saturation/connection outage | It retains typed retryable work and listens to the attributable DB condition. Memory pressure cannot pause the queue consumer. |
| Provider timeouts, rate budgets, Retry-After, and IBKR socket/session guards | They belong to external I/O/protocol owners and are explicit. Caller cancellation no longer cancels other waiters. |
| Cache capacities | They are non-authoritative. Eviction/miss counters must be used to prove working-set mismatch before resizing. |

## Remaining Real Work

### Signal universe ceiling: 2,000 symbols

Read-only database facts show 30,773 active catalog listings and 5,946 optionable symbols, while both Signal Monitor profiles use `maxSymbols=2,000`. The system therefore omits roughly 3,946 eligible symbols before timeframe expansion.

Simply raising the number is unsafe: 5,946 × 6 = 35,676 cells, while the current packed base is 16,384 cells, the producer sweep is 12,000, and other caches/stream retention are smaller. The proper repair is a paged/sharded active set with priority classes, complete-cycle diagnostics, durable cursor/failure state, and an explicit truncation inhibitor. Until that architecture exists, `2,000` is a known product ceiling—not a provider limit.

### Gap-fill throughput and retry memory

The completed-bars gap worker processes eight cells per one-second cycle, so an 8,000-cell eligible gap set needs at least about 16.7 minutes even with no failures. Its last-attempt map holds 4,096 entries, smaller than the eligible set, and can forget an attempted cell before a full cycle. Replace fixed polling with a demand-aware DB-lane drain and per-cell typed failure state; do not merely raise `8` or `4,096`.

### Cache/stream working-set evidence

The packed producer base holds 16,384 cells, but the stream completed-bars cache holds 8,000. Session revisions or aligned closes can still create churn. Add bytes, miss reason, eviction reason, and full-cycle reuse diagnostics before changing capacity.

### Durable outage storage

Retryable bar writes, option metadata writes, and Flow observation state remain process-memory concerns during a long database outage. Flow is bounded to the configured active universe and exposes discard telemetry; bar/metadata durability still needs an atomic disk-backed outbox with startup replay, age/byte diagnostics, and a disk-full inhibitor. Another RAM entry-count cap is not the repair.

### Per-contract browser streams

Replace the 64-connection historical/option stream guard with one multiplexed transport and per-subscriber ref counting. Preserve the current explicit deferred/fallback state until multiplexing is available; unbounded EventSources are worse than a visible queue.

## Runtime Acceptance

Use only the PID-owned attached runtime and one sanctioned `SIGUSR2` reload. The post-fix watch must verify:

- the same supervisor PID remains alive and `/api/healthz` stays 200;
- the Algo page resolves the canonical shadow deployment despite API live mode;
- signal readiness progresses during ELU/watch observations;
- raw PostgreSQL waiters remain zero and admission queues drain;
- no persistence retry treadmill or silent pressure-only empty result appears;
- diagnostics uses one transport/initial snapshot and slow clients disconnect visibly;
- RSS/heap, ELU, event-loop delay, request p95, slow-query attribution, cache miss/eviction, and readiness progress are recorded as separate facts rather than collapsed into one pressure label.
