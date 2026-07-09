# Fix report: signal-monitor DB demand + write-churn cuts (work-order B) — 2026-07-07

Worker: Claude subagent in the `codex-worker` role. Files touched (only):
`artifacts/api-server/src/services/signal-monitor.ts`,
`artifacts/api-server/src/services/signal-monitor-stream.test.ts` (B3 tests appended),
`artifacts/api-server/src/services/signal-monitor-db-demand.test.ts` (new, B1/B2/B4 tests).
Nothing committed or staged. Sibling WIP hunks in signal-monitor.ts (events-cache lane) untouched —
verified the sibling's events read (`select id, profileId, environment…`, now SM:13832) is a
different function from every block I edited. `signal-universe-ranking.ts` NOT touched (see B1
decision). `signal-monitor-evaluation-worker.ts` NOT touched (see B4 decision).

## Status summary (as requested by lead)

| Item | Status | Net effect |
|---|---|---|
| B1 universe-expansion JOIN memo | DONE | JOIN drops from ~1 read/5-9s to ≤1 read/5min per limit key (>99% cut of the 32.3M+6.2M tuples/day) |
| B2 event_key dedup N+1 → 1 batch read | DONE | 1 events read per persist flush instead of 1 per directional cell (~95% of 18,991 slow reads/day) |
| B3 subscriber persist gating | DONE | Browser-open no longer widens the write set; persists gate on the tight dirty-key, SSE unchanged |
| B4 profile heartbeat | DONE | Profile UPDATE + cockpit notify: per eval batch (~7.8/min) → ≤1/min/profile + error transitions (~87% cut); `.returning()` KEPT (callers use it) |

---

## B1 (census S1): memoize the universe-expansion JOIN

**Change** — `loadSignalMonitorCatalogExpansionSymbols` (now SM:3938) delegates its DB read to a new
`loadSignalMonitorCatalogExpansionRows(limit)` (SM:3879) behind a module-level TTL memo
(`signalMonitorCatalogExpansionMemo`, TTL `SIGNAL_MONITOR_CATALOG_EXPANSION_MEMO_TTL_MS = 5 min`,
SM:3854). `invalidateSignalMonitorCatalogExpansionMemo` (SM:3863) + hit/miss stats exported via
`__signalMonitorInternalsForTests`. Expired entries are pruned on write so a wobbling limit cannot
grow the map.

**Decision rationale (the order gave a choice; I deviated from the literal key with cause)**
- *TTL (≥5 min) over explicit invalidation from the ranking-refresh hook.* The order preferred the
  hook "if clean". The import direction is clean (no cycle), but the hook is NOT sufficient: the
  JOIN's inputs are `universe_catalog_listings` (catalog edits/optionability verification, mutated
  outside signal-universe-ranking.ts) AND `signal_universe_rankings` (30-min refresh). A
  refresh-completion hook covers only the second input; catalog changes would serve stale rows until
  the next refresh (up to 30 min — worse than the 5-min TTL). The TTL bounds BOTH inputs, needs no
  cross-module edit, and is directly testable. This satisfies "TTL >= 5 min" from the order verbatim.
- *Memo key = effective query limit (`maxSymbols + seedSymbols.length`), not
  (maxSymbols, seed-signature).* Observed from source: the query's WHERE/JOIN/ORDER BY never
  reference the seed *values* — the seeds only influence `.limit(...)`. So the result set is a pure
  function of (table state, limit). Keying by seed signature would be strictly worse: same
  correctness, but any flow-universe churn (seeds come from `getOptionsFlowUniverse()`, recomputed
  per call) would defeat the memo. The seed prepend + `resolveSymbolUniverse` dedup/cap still run
  fresh on every call, so seed changes are reflected instantly in the returned symbols; only the
  catalog rows are cached. This is a wider cut than the ordered design with identical output.
- *Empty-rankings fallback preserved*: the leftJoin + `excluded_reason is null` (passes for unmatched
  rows) is inside the memoized query, unchanged; test exercises exactly this path (empty tables).

**Behavior deltas (bounded, inherent to any memo here)**: a catalog/ranking change can be served up
to 5 min stale (was: next call). `rankedAt` in the return rides the cached rows, so it can also lag
≤5 min. Both are far inside the 30-min refresh cadence the census used to justify the memo.

**Test evidence** — `signal-monitor-db-demand.test.ts`:
`B1: catalog expansion JOIN is memoized per effective limit and re-reads after invalidation` — call
twice → misses +1 then +0 / hits +1, identical results, fallback keeps seeds; invalidate → misses +1.
PASS (run log below).

**Reduction (estimated from census cadence)** — was re-run every ~5-9 s while a rotation is
mid-flight (≈9.6k-17k executions/day; 26,099 slow events/day; 32.3M + 6.2M tuples/day seq-scanned).
Now ≤ 12/hour per distinct limit key (≈288/day; live limit keys are a small handful — one per
profile maxSymbols + seed count). **>97-99% reduction**, matching the census S1 target.

**Reviewer check**:
```
pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor-db-demand.test.ts
```

## B2 (census S2): batch the event_key dedup lookup (N+1)

**Change** —
- New `readSignalMonitorEventSignalAtByKeys(eventKeys)` (SM:6821): the exact
  `select event_key, signal_at … where event_key in (…)` extracted from
  `resolveStoredSignalMonitorSignalAt`, with a module-level query counter as the test spy.
- `resolveStoredSignalMonitorSignalAt` (SM:6844) gains an optional
  `prefetchedEventSignalAtByKey` param (SM:6856); when present it skips its own read. Resolution
  loop (first matching key in `resolveSignalMonitorEventLookupKeys` order wins) is unchanged.
- `resolveSignalMonitorSymbolStateUpsert`'s existing `prefetched` param extended with
  `eventSignalAtByKey?: Map<string, Date>` (SM:6621) and passed through.
- `persistSignalMonitorMatrixStatesBestEffort`: pre-pass (SM:8999) collects
  `resolveSignalMonitorEventLookupKeys` for ALL directional states up front — via a new shared
  helper `resolveSignalMonitorPersistCellDirectionSignalAt` (SM:8939) so the pre-pass and the
  per-cell loop derive (direction, signalAt) from the SAME trusted-identity rule (the loop's inline
  copy was replaced by the helper call; byte-identical logic, single source of truth) — then runs ONE
  `inArray` read and hands the Map to every cell's upsert via `prefetched`.

**Behavior identity argument** — per cell, the recomputed `eventKeys` are a subset of the batched
union (same inputs → same keys), the map contains exactly the DB's `signal_at` per key (null
signal_at rows are skipped by both paths — old code's `if (signalAt)` did the same), and the
first-hit-wins iteration is untouched. Un-prefetched callers (`upsertSymbolState` per-symbol path)
still execute their own single query.

**Test evidence** — `signal-monitor-db-demand.test.ts`:
`B2: event-anchor resolution is identical via prefetched map (0 reads) and per-cell query (1 read)`
— seeds a real `signal_monitor_events` row (PGlite, real SQL), asserts prefetched path issues 0
events reads, query path issues exactly 1, both resolve the identical anchored `signalAt`. PASS.
The flush-level "persist N cells → 1 events query" is additionally covered end-to-end by the
existing `server-owned producer persists direction flips through the canonical path`
(signal-monitor-stream.test.ts) which drives the full persist loop against the test DB — it passes
with the batch pre-pass in place.

**Reduction** — one events read per flush instead of one per directional cell: ~95% of the 18,991
slow reads/day + 68,971 idx scans (census S2 estimate; exact factor = directional cells per flush).
Param-cap note: ≤~4 keys/cell × ≤12k cells stays under Postgres' 65,535 bind params; a `ponytail:`
comment at the pre-pass names the ceiling and the chunking upgrade path.

**Reviewer check**:
```
pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor-db-demand.test.ts
pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor-stream.test.ts
```

## B3 (census S4/D1): stop browser-open write amplification

**Change** — in `emitSignalMonitorMatrixStreamAggregateDelta`, the real-subscriber branch
(SM:10067) now filters its persist set through
`changedSignalMonitorMatrixStreamPersistStates(subscriber, latchedStates)` — the SAME tight
persist dirty-key (symbol/tf/latestBarAt/currentSignalAt/direction/status) the producer branch uses
— instead of reusing the display-signature `changedStates`. SSE delivery is untouched: `onEvent`
still fires from the display-signature set. Added a small enqueue spy
(`signalMonitorPersistScheduleCallCount/StateCount`, SM:9216) on
`schedulePersistSignalMonitorMatrixStatesBestEffort` so tests observe the enqueue decision directly.

**Decision rationale (the order gave a choice)** — took the ordered-preferred gate (filter through
the persist dirty-key), NOT skip-when-producer-exists. Scope evidence for why the skip is riskier:
a subscriber's scope is client-supplied (`normalizeSignalMonitorMatrixStreamScope` accepts arbitrary
symbols/timeframes/exact cells) while the producer's scope is built from
`buildSignalMonitorServerOwnedProducerScope` over the profile universe — so producer scope does NOT
provably cover every subscriber's wider scope (e.g. a symbol recently dropped from the ranked
universe but still watched by a client). I therefore cannot state "producer scope always covers
env-wide"; the dirty-key filter is both safer and sufficient.

**Mutation-order safety note** — `changedSignalMonitorMatrixStreamPersistStates` also writes
`subscriber.lastStates`. In the subscriber branch it now runs after
`changedSignalMonitorMatrixStreamStates` (which set `lastStates` to display states); it overwrites
the changed keys with latched (pre-display) states. This is behavior-neutral for the next-emit latch:
the display transform (`withSignalMonitorMatrixStreamActionability`) only adds
`fresh/actionEligible/actionBlocker/trendDirection`, none of which
`latchSignalMonitorMatrixStreamState` reads (it reads only signal-identity fields + filterState +
barsSinceSignal, identical between the two shapes).

**Test evidence** — `signal-monitor-stream.test.ts`, two new tests:
- `B3: subscriber SSE delta persists only durability-relevant changes` — real subscriber on a test
  DB: baseline emit → SSE delivered + 1 state enqueued; display-only change (mfe moved) → SSE
  DELIVERED, **0** persist enqueued; latestBarAt advance → SSE delivered + 1 persist enqueued.
- `subscriber persist gating filters by the persist dirty-key, not the display signature` — source
  assertion pinning the gate (same style as the existing producer-branch source test).
Both PASS (isolated run below). Run status of the full file: see Gates.

**Test-harness fix found en route (documented for the reviewer)** — the first draft of the B3 DB
test wedged the suite: it let `withTestDb` close the PGlite instance (and restore the real `db`)
while the un-awaited persist drain from the emits was still mid-flight, and the suite runs with
`--test-timeout=0`. Root-cause fix, not a sleep: new bounded internals helper
`waitForSignalMonitorPersistIdleForTests` (signal-monitor.ts, next to
`schedulePersistSignalMonitorMatrixStatesBestEffort`) polls
`signalMonitorPersistInFlight`/`signalMonitorPersistPending` until idle (10 s cap); the test awaits
it before unsubscribe/cleanup. This mirrors what the existing producer-flip DB test achieves by
polling for its persisted rows before returning.

**Reduction** — subscriber-driven persists now fire only on durability-relevant transitions
(≈ once per bar per cell) instead of on every display delta (mfe/mae/latestBarClose move with every
aggregate tick). For a ticking 1m cell that is roughly per-tick → per-minute. Large cut of the
154,071 updates/day on `signal_monitor_symbol_states` whenever a browser is open (census S4/D1);
exact factor depends on tick rate per bar.

**Reviewer check**:
```
pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor-stream.test.ts
```

## B4 (census S8): profile heartbeat on transition + 1/min

**FRESHNESS-WINDOW MATH (hard constraint, verified from source before choosing the interval)**
- `signalMonitorEvaluationWindowMs(tf) = max(TIMEFRAME_MS[tf] * 6, 30 min)` for intraday
  (`1d`: `max(6d, 4d) = 6d`) — SM (function `signalMonitorEvaluationWindowMs`, pre-edit ~5841).
  Shortest timeframe `1m`: `max(60_000 × 6, 1_800_000) = 1_800_000 ms = 30 min`.
  A 60 s heartbeat keeps the persisted timestamp ≤60 s stale → **60 s = 1/30th (3.3%) of the
  tightest window**. Comfortably inside; 60 s chosen.
- Stronger: the constraint does not even bind this write. `isSignalMonitorStateCurrentForLane`
  (pre-edit SM:5870, checked at SM:1329, and in both fresh-read paths) reads
  `state.lastEvaluatedAt` from `DbSignalMonitorSymbolState` — the SYMBOL-STATE rows written by the
  state persist paths (untouched by B4). The PROFILE row's `last_evaluated_at` (the one B4 gates)
  feeds only `resolveSignalMonitorSnapshotEvaluatedAt(responseStates, profile.lastEvaluatedAt)`
  (now SM:13701) — and there it is merely the FALLBACK when no response state carries a timestamp;
  any real state row wins. So the gated write can never flip a lane stale; worst case is a ≤60 s
  stale snapshot-header timestamp on an empty-universe snapshot.

**Change** — `updateSignalMonitorProfileEvaluationMetadata` (SM:11798) now short-circuits (returns
`input.profile`, no UPDATE, no `notifyAlgoCockpitChanged`) unless
`shouldWriteSignalMonitorProfileEvaluationMetadata` (SM:11769) says: (a) `lastError` differs from
the last WRITTEN value (or no write recorded yet — first eval always writes), or (b) ≥60 s
(`SIGNAL_MONITOR_PROFILE_HEARTBEAT_MS`, SM:11760) since the last written `lastEvaluatedAt` for that
profile (in-memory per-profile maps, as permitted by the order). The in-memory record updates ONLY
after a successful UPDATE, so a thrown write self-heals on the next call. All three callers
(WK:447, SM evaluate-universe, SM evaluate-matrix) route through this single function — no caller
edits needed (worker file untouched).

**`.returning()` decision (order: drop if nothing uses it — verified callers)** — KEPT. Two of the
three callers use the returned row: `evaluateSignalMonitorProfileUniverse` and the matrix evaluator
both do `profileToResponse(updatedProfile)` + `updatedProfile.freshWindowBars`. Only the worker
discards it. On a skipped write the function returns `input.profile`, which carries identical config
(freshWindowBars etc.) with an at-most-60 s-stale `lastEvaluatedAt` — same staleness bound as above.

**Test evidence** — `signal-monitor-db-demand.test.ts`:
- `B4: heartbeat gate — write on first eval, at most 1/min, immediate on error transition` (pure
  unit: first-eval writes; +5 s and +59.999 s skip; +60 s writes; error transition inside the window
  writes). PASS.
- `B4: profile metadata UPDATE fires once per 60s and on error transition` (real UPDATE against the
  test DB: repeated no-change evals within 60 s → 1 write [DB row still at t0 after +5 s call];
  +65 s → heartbeat write; error transition at +66 s → immediate write with persisted lastError).
  PASS.

**Reduction** — was unconditional per eval batch (~7.8/min per census; 1,262 updates/day on a 2-row
table + a cockpit notify fan-out each). Now ≤1/min/profile + error transitions: **~87% cut** of
writes AND of the `notifyAlgoCockpitChanged` fan-out (census S8 estimate).

**Reviewer check**:
```
pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor-db-demand.test.ts
```

## Gates (commands run, outputs)

```
$ pnpm --filter @workspace/api-server run typecheck
> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit
(exit 0, no diagnostics)

$ pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor-db-demand.test.ts
✔ B1: catalog expansion JOIN is memoized per effective limit and re-reads after invalidation
✔ B2: event-anchor resolution is identical via prefetched map (0 reads) and per-cell query (1 read)
✔ B4: heartbeat gate — write on first eval, at most 1/min, immediate on error transition
✔ B4: profile metadata UPDATE fires once per 60s and on error transition
ℹ tests 4  ℹ pass 4  ℹ fail 0

$ pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor-completed-bars.test.ts
ℹ tests 55  ℹ pass 55  ℹ fail 0

$ pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor-breadth-history.test.ts
ℹ tests 5  ℹ pass 5  ℹ fail 0

$ pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor-reconcile-minimal-readset.test.ts
ℹ tests 11  ℹ pass 11  ℹ fail 0

$ pnpm --filter @workspace/api-server run typecheck   # re-run after the persist-idle waiter was added
(exit 0, no diagnostics)

$ pnpm --filter @workspace/api-server exec tsx --test --test-force-exit \
    --test-name-pattern "B3|persist gating filters" src/services/signal-monitor-stream.test.ts
✔ B3: subscriber SSE delta persists only durability-relevant changes (28199ms)
✔ subscriber persist gating filters by the persist dirty-key, not the display signature (0.7ms)
ℹ tests 2  ℹ pass 2  ℹ fail 0   (exit 0)

$ pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor-stream.test.ts
ℹ tests 40  ℹ pass 40  ℹ fail 0   (exit 0)
```

Pre-existing failures from sibling WIP: none encountered in the gate files above.

## Gaps
- **DB-call reductions are cadence-derived estimates** (census constants + code inspection), not
  live-measured: no app restart/reload was permitted by the order, so no flight-recorder
  before/after. The census's own follow-up (pg_stat re-probe after landing) is the confirming check.
- **B1 staleness window**: catalog/ranking edits can be served up to 5 min stale from the memo
  (inherent to the ordered TTL design; bounded and documented above).
- **B4 in-memory heartbeat state resets on process restart** — first eval after a restart always
  writes (the maps are empty), so restarts err toward writing, never toward staleness. 22
  restarts/day (census) adds ≤22 extra writes/profile/day — negligible.
- **B3 exact write-reduction factor unmeasured** — depends on per-bar tick rate; the mechanism
  (display-tick persists eliminated) is test-proven, the daily magnitude is an estimate.
- The B2 flush-level single-query claim is asserted at the unit seam (0 reads prefetched / 1 read
  un-prefetched) plus the end-to-end producer-flip DB test; there is no per-flush query-count
  assertion wrapping the entire `persistSignalMonitorMatrixStatesBestEffort` (would need a
  statement-level spy on the drizzle client; the enqueue/counter seams made this unnecessary).
