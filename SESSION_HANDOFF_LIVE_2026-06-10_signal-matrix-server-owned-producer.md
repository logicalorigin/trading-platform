# Live Session Handoff — Signal Matrix Server-Owned Producer (Phase 1)

- Last Updated (MT): `2026-06-10 (in progress)`
- Session ID: `pending` (Claude Code; container has no ~/.codex)
- CWD: `/home/runner/workspace`
- Branch: `main`
- Status: IMPLEMENTATION — grounding phase

## User Request

Build the Phase 1 producer for the ticker→signal→STA pipeline: make the live signal-matrix
producer (evaluate Massive bar-close ticks → persist canonical signalMonitorEventsTable rows)
run **server-side, independent of any UI SSE client**. Today it only runs per-connected
subscriber scope and bails when `signalMonitorMatrixStreamSubscribers.size === 0`.

This is the keystone gap from session `claude:e3f9c442…`
(SESSION_HANDOFF_LIVE_2026-06-10_signals-stale-sta-table-investigation.md). The frontend SSE
consumer is already committed (c1c651f). Goal: drop the heavy Step-0 REST stopgap
(PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED) once the server-owned producer is in.

## Keystone (verified in current code)

- `emitSignalMonitorMatrixStreamAggregateDelta` (signal-monitor.ts:6153) evaluates + persists,
  but returns early at :6160 when no subscribers; eval/persist loop is per-subscriber-scope (:6169-6233).
- `queueSignalMonitorMatrixStreamAggregate` (:6284) also bails at :6288 when no subscribers.
- Persist otherwise only via REST matrix endpoint (:8183, cached) + flag-gated worker.

## Plan (forward)

1. Ground: scope type, subscriber lifecycle, Massive subscription wiring, monitored universe/profile.
2. Add a server-owned matrix scope (monitored universe) that participates in eval+persist
   without a UI client; keep delta PUSH gated on real subscribers.
3. Tests: bar-close persists canonical events with zero UI subscribers; delta still pushes to clients.
4. Validate: api-server typecheck + build + unit tests; `pnpm run audit:replit-startup` if dev script touched.
5. Once verified, retire Step-0 flag + demote REST poll (separate slice).

## Grounding findings (verified)

- TWO aggregate consumers: (1) matrix/STA producer `emitSignalMonitorMatrixStreamAggregateDelta`
  (signal-monitor.ts:6153) — gated on UI subscribers (THE keystone); (2) signal-options-worker
  `syncStreamSignalEvaluator` (signal-options-worker.ts:1081) — deployment-driven, flag-gated,
  already server-owned. Fix targets (1) only.
- A "subscriber" = {id, scope, profile, onEvent, lastStateSignatures} (signal-monitor.ts:221).
  Eval+persist loop iterates subscribers; persists CHANGED states per-profile (:6204-6233).
- `signalMonitorMatrixStockAggregateSymbols` (:3352) already unions ALL subscriber scopes →
  registering a server-owned subscriber auto-includes its symbols in the Massive subscription.
- Keepalive: `primeSignalMonitorMatrixStockAggregateStream` (:3364) subscribes + sets a release
  timer (KEEPALIVE_MS=5min, :330) that unsubscribes unless re-primed. Server-owned producer must
  re-prime on an interval to stay alive.
- Persist path: `persistSignalMonitorMatrixStatesBestEffort` (:5727) → upsertSymbolState +
  persistSignalMonitorMatrixStateEventBestEffort (writes signalMonitorEventsTable, the canonical rows).

## DECISION (user): universe = enabled profile universe, reuse REST matrix caps/truncation.

## Design (synthetic server-owned subscriber)

1. Resolve enabled signal-monitor profile universe per environment (capped, same truncation as REST).
2. Register a server-owned subscriber: scope = {universe symbols, all timeframes}, onEvent = no-op.
   → existing loop evaluates + persists on bar-close with no UI client; real clients still push.
3. Server-owned keepalive interval re-primes the Massive subscription for the universe.
4. Gate on isStockAggregateStreamingAvailable(); start at boot near startSignalMonitorLocalBarCacheWarmup.
5. Tests: bar-close persists canonical rows with ZERO UI subscribers; real subscriber still gets delta.

## IMPLEMENTED (2026-06-10) — Phase 1 server-owned producer

Files:
- `artifacts/api-server/src/services/signal-monitor.ts`: added server-owned producer block
  (after `createSignalMonitorMatrixStreamSubscriptionForTests`):
  - `buildSignalMonitorServerOwnedProducerScope` — capped, normalized universe scope (exactCells:false).
  - `registerSignalMonitorServerOwnedProducer` — registers a synthetic subscriber with no-op onEvent;
    re-primes on unchanged universe to defeat the idle keepalive release.
  - `refreshSignalMonitorServerOwnedProducers` — per enabled profile: resolve universe
    (`resolveSignalMonitorProfileUniverse`, ensureWatchlist:false), cap to
    `cappedSignalMonitorEvaluationProfile().profile.maxSymbols` (≤500), build scope, register.
    Gated on `isStockAggregateStreamingAvailable()`; drops producers for disabled environments.
  - `startSignalMonitorServerOwnedProducer` — initial refresh + 60s keepalive interval (unref'd).
  - `resetSignalMonitorMatrixStreamForTests` also clears the producer map.
  - Exposed `buildSignalMonitorServerOwnedProducerScope` + `registerSignalMonitorServerOwnedProducer`
    in `__signalMonitorInternalsForTests`.
- `artifacts/api-server/src/index.ts`: import + call `startSignalMonitorServerOwnedProducer()`
  at boot, right after `startSignalMonitorLocalBarCacheWarmup()`.
- `artifacts/api-server/src/services/signal-monitor-stream.test.ts`: 3 new tests
  (scope normalization; eval runs with NO UI subscriber = keystone fixed; still bails when nothing registered).

Mechanism: synthetic server-owned subscriber → existing eval+persist loop runs per bar-close tick
with zero UI clients; real client deltas still only push to real subscribers; persistence is
idempotent so overlap with a connected client is harmless.

## VALIDATION (this session — unit-level, NOT yet live-runtime)
- `pnpm --filter @workspace/api-server run typecheck` = EXIT 0.
- `signal-monitor-stream.test.ts` = 8/8 pass (incl. 3 new).
- `pnpm --filter @workspace/api-server run build` = ok.
- signal-monitor*/signal-options* suites = 46/46 pass.
- NOT done: live runtime probe (stale-ratio drop with no browser open; canonical events written
  while no client connected). Needs a Replit restart + probe to confirm end-to-end.

## LIVE RUNTIME CHECK (2026-06-10 ~21:54Z, MARKET CLOSED) — partial

Observed (API on :8080, freshly rebuilt dist with the producer):
- NO BOOT REGRESSION: API boots cleanly with the producer wired; restarts repeatedly (dev
  watcher / iteration) and comes up healthy + evaluating each time (e.g. pid 25807 up 42s).
- Pipeline ALIVE: latest canonical events signalAt 21:45–21:50Z (minutes old) — vs the original
  broken baseline's ~19h-stale latest event. signal-monitor state: 3000 total, ok ~950–964,
  stale ~2025 (≈67%, vs the broken 90%); profile.lastEvaluatedAt advances ~every 20s.
- SSE route /api/signal-monitor/matrix/stream serves a bootstrap event.

NOT proven (be honest):
- Cannot ISOLATE the server-owned producer's contribution: the flag-on stopgap is also active,
  AND market is closed so there are no live Massive ticks — the event-driven producer is
  dormant/streaming-gated after hours. The fresh events above are attributable to the stopgap +
  REST/matrix eval, not provably to the new producer.
- The clean isolation experiment must run DURING MARKET HOURS:
  1. Set PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED off (revert dev script) + restart.
  2. With NO browser open, watch /api/signal-monitor/events — if signalAt keeps advancing with
     zero UI clients and flag off, the server-owned producer is PROVEN. Then retire the flag + demote poll.
- Secrets note: the running process env exposes live Massive/API credentials; NOT recorded here.

## NEXT (follow-up slices, not done)
1. Live-verify: restart API, confirm canonical events written with NO browser open + stale ratio drops.
2. Retire Step-0 stopgap: remove `PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED=true` from
   api-server `dev` script ONCE producer is live-verified (run `pnpm run audit:replit-startup` after).
3. Phase 2: demote frontend REST matrix poll to fallback/reconnect only (currently additive/double-load).
4. Commit in coherent slices (producer + tests; then flag retire; then poll demotion).

## COMMITTED (2026-06-10 ~19:55 MDT) — branch `fix/signal-bubble-hydration-latch-producer`

- Commit `e507395` "fix(signals): latch signal-matrix direction + server-owned producer" landed the
  latch + direction-seed + server-owned producer + eval event-loop yield + matrix/stream 204 as one
  coherent slice (7 files: signal-monitor.ts, index.ts, routes/signal-monitor.ts, the two new test
  files, signalMatrixStateMerge.js + its test). Design-audit + infra churn deliberately left out of tree.
- NOTE: `PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED` was NOT in the tree (package.json unmodified) —
  the Step-0 flag stopgap is already absent; nothing to retire on that front.
- Validation at commit time: api-server + pyrus typecheck clean; signal-monitor-completed-bars 28/28,
  signal-monitor-stream 8/8, signalMatrixStateMerge 8/8.

## Status / Next

- Phase 1 producer COMMITTED + unit-validated. NOT live-verified (committed 2026-06-10 ~19:55 MDT,
  market CLOSED). Remaining open item = the market-hours isolation experiment below.
- LIVE-VERIFY (next open, 7:30 AM MDT): with NO browser open, watch /api/signal-monitor/events —
  signalAt should keep advancing with zero UI clients (producer proven), and the 1m/2m/5m
  null-direction stale counts should collapse as the latch + seed hydrate cells.
- THEN: Phase 2 — demote frontend REST matrix poll to fallback/reconnect only (still additive/double-load).
