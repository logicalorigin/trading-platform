# DB Pool Admission Bus — design (2026-07-09, DRAFT pending caller census)

Owner: session addde099. Riley directive: attack the DB-waiter problem structurally — "combine the
line use, create a bus where things wait, or something." Status: mechanism designed; class
assignments await the caller census (workflow `wf_d46c26fe-e6a`, 8 slices over the 47 db-importing
API files + firehose cross-check).

## Problem (measured)

- Shared pg pool max 12 (DELIBERATE — the binding constraint is single-threaded result parsing on
  the event loop, `lib/db/src/index.ts:206-214`; raising it is explicitly rejected).
- Market open + cold-start warmup: `active 12/12, waiting 28-65` sustained. Firehose shows
  pool-wait ≥ execution across the board (22.1s waited / 3.5s executed on one sampled query):
  the system queues, it does not execute slowly.
- The queue is pg.Pool's FIFO: **no QoS**. A 60-second `auth_sessions` point-read queues behind
  1000-row bar_cache warmup reads and 61-second bar_cache batch inserts. Head-of-line blocking of
  interactive/trading traffic by bulk traffic is the entire waiter pathology; demand fixes (landed
  F3b, in-flight F1A/F2A/F4A/F1B) shrink the bulk, but nothing today PROTECTS the latency-critical
  classes when bulk spikes (open, cold start, backfill).

## Rejected shapes

- **Raise pool max** — rejected (parse-on-event-loop constraint; also Riley: no band-aids).
- **Hard partition into N pools** — partial precedent (`tradingPool`, being wired by the codex lane
  for `placeShadowOrder`), but fixed partitions idle slots one lane over while another queues, and
  migrating hundreds of call sites to explicit pool choices is high-touch. Keep `tradingPool` as
  the one HARD lane (trading correctness deserves physical isolation); do not multiply pools.

## Chosen shape: priority admission bus in front of the ONE shared pool

A scheduler wraps connection acquisition (`pool.connect` — drizzle and raw callers both funnel
through it; a held `db.transaction` naturally accounts as one in-flight slot for its lifetime).
Every acquisition carries a **lane** tag; the bus enforces per-lane in-flight caps and ordered
admission with aging. Bulk waits in OUR queue — cheap, observable, shed-able — instead of pg's
opaque FIFO; interactive jumps the line.

### Lane declaration: AsyncLocalStorage, not per-call-site edits

`lib/db` exports `runInDbLane(lane, fn)` backed by AsyncLocalStorage. Lanes are declared at the
~10 ENTRY POINTS, not at ~500 query sites:

- HTTP middleware: route-class map → `interactive` by default; heavy analytical routes → `bulk`.
- SSE stream producers: `interactive` (they hold user-visible freshness).
- Schedulers/intervals (signal universe evaluation, background persist, sync schedulers,
  retention, diagnostics): `bulk` or `background` at the tick wrapper.
- Automation execution path: stays on the hard `tradingPool` (unchanged by the bus).
- **Default lane when untagged: `interactive`** — fail-safe: an unclassified caller can never be
  starved by a misclassification; the census tells us which entry points to tag `bulk`.

### Lanes + caps (INITIAL numbers — final numbers set by census + one market-open observation)

| Lane | In-flight cap (of 12) | Queue timeout | Notes |
|---|---|---|---|
| interactive | up to 12 (uncapped) | 30s (existing acquire timeout) | auth, UI reads, SSE hydration |
| bulk | 6 | 30s | universe warmup reads, bar persist, sync jobs |
| background | 2 | 10s, **shed on timeout** | diagnostics writes, retention, telemetry |
| (hard) trading | tradingPool max 3 (separate) | 5s statement timeout | placeShadowOrder etc. |

Invariant: bulk + background in-flight ≤ 8 → ≥4 slots always reachable by interactive within one
statement completion. Aging: any queued acquisition older than 5s is admitted ahead of newer
higher-priority arrivals (starvation-proof).

### Observability (part of the deliverable, not optional)

Per-lane gauges (queued, inFlight, admitted, shed, maxWaitMs) exposed via
`getRuntimeDiagnostics()` and sampled into the flight recorder next to the existing `dbPool`
counters — the before/after for this work is "interactive p95 wait" and "auth_sessions max", not
just total waiters.

### Complements (census-gated)

- **Single-flight/coalescing** for identical concurrent read shapes the census finds duplicated
  (the bars resource cache and S6 2s cache already do this locally; generalize only where
  measured).
- **Micro-batching** where the census shows N-per-tick point reads against one table (e.g. if
  auth/session or account lookups arrive in bursts, one IN() read per 5ms window).

## Implementation plan (work orders, after census lands)

1. `WO-BUS-1` — `lib/db`: admission scheduler + AsyncLocalStorage lane context + per-lane
   diagnostics; unit tests incl. starvation/aging, cap enforcement, tx-holds-one-slot, default-lane
   safety. No caller changes; everything defaults `interactive` (behavior-neutral until lanes are
   tagged).
2. `WO-BUS-2` — entry-point tagging per the census assignment table (middleware map + scheduler
   wrappers), plus the census's shed-eligible background writers moved to `background`.
3. `WO-BUS-3` — census-identified coalescing/batching targets (each its own tiny WO).
4. Market-open acceptance: interactive p95 pool-wait < 250ms while bulk saturates its cap;
   auth_sessions max < 1s; zero shed of interactive/trading; waiter counts by lane in the flight
   recorder.

## Census findings → fix backlog (8/8 slices in, 2026-07-09 ~10:00 MDT; crosscheck pending)

Beyond lane tagging, the census surfaced discrete demand/coalescing fixes, each its own WO:

| WO | Target | Census evidence | Status |
|---|---|---|---|
| BUS-3a | Request-scope memoize `readAuthSessionFromToken` (auth.ts:303; fired 2x/request via app.ts middleware + route guard) | #1 queue victim (3,810s pool, max 60s, rows=1); halves auth reads | authored, dispatch on clean files |
| BUS-3b | Batch `upsertSymbolState` (signal-monitor.ts:7677) into windowed multi-row upserts | ~2,000-3,500 single-row upserts/min at open — the largest connection-acquisition count in the census | authored, queued behind F1B (same file) |
| BUS-3c | storage-health probe (storage-health.ts:102): background lane + cadence 4/min→1/5min + skip under pressure | held tx across 5 round trips as pure telemetry | fold into BUS-2 + cadence note for Riley |
| (EE-BLOAT D1+) | execution_events read shapes — ADD account.ts:6103 (buildRealPositionAttribution, 1000 jsonb rows on the interactive positions path) and signal-options-automation.ts:2242 (listDeploymentEvents family, 2.5k-10k full rows) to the target list | firehose #3 | EE-BLOAT WO dispatched (gated) |
| BUS-3d | readBoundedShadowFillsWithOrders 20k-row dashboard bundle (shadow-account.ts:3269; code comment names it the startup pool-saturation root cause) | ~4/min x 20k rows, ~1.7s each | needs design (projection vs incremental) — after review |
| BUS-3e | getAccountPositions ~5-query concurrent fanout per request (account.ts:6231) | per-request multi-slot burst | candidate, after BUS lanes measure |
| BUS-3f | storeActivities 25k-row ingest insert (snaptrade-account-history.ts:663) | pool-starving near open | bulk lane covers latency; chunking only if measured |

Lane-tagging table (BUS-2): census confirms the pre-filled rows; final table pasted after the
crosscheck agent returns the firehose mapping.

## RILEY DECISION ITEM (from the crosscheck's head-of-line analysis)

The #1 HOL risk is NOT fixable by lanes alone: user-initiated backtest/replay bulk transactions
(shadow-account.ts:14472/14607/14708/14829/15714) hold multi-table DELETE+INSERT locks across the
shadow_* tables; while held, live shadow trading writes (placeShadowOrder, automation events) and
every shadow dashboard read queue behind the LOCKS regardless of pool lane. Nothing today prevents
firing a backtest at market open. Options: (a) defer/queue backtest-replay mutations during RTH
open window (e.g. first 30 min), (b) chunk those transactions so locks release between chunks,
(c) accept the risk (user-initiated, rare). Needs your call — (a) is the cheap honest guard.

## Open items pending census

- Final lane assignment table (per entry point, with cadence/rows evidence).
- Cap numbers sanity-checked against measured per-lane concurrency demand.
- Coalescing/batching target list.
- Interaction note: cold-start warmup storm (universe priming) must be `bulk` — the census must
  identify every startup-prime call site so boot doesn't starve the first user request.
