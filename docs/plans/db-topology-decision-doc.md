# PYRUS DB Topology — Decision Document

Owner-facing decision document for restructuring database usage in the trading pipeline.
Repo state: main working tree, 2026-07-08. Every claim is file:line-cited from source; anything
not verified from source in this pass is explicitly labeled **unverified** or **inferred**.
File shorthand: unqualified paths are under `artifacts/api-server/src/services/`; `lib/db` =
`lib/db/src/index.ts`.

Decisions on the table:

- **Decision A** — wire the built-but-unused `dbTrading` reserved pool onto trading-critical call sites.
- **Decision B** — decouple `action_scan` from `signal_refresh` (action-first cadence).

---

## 0. Pool ground truth (verified)

| Fact | Value | Source |
|---|---|---|
| Shared pool max | **12** on helium (10 otherwise). Deliberate policy, NOT a provider cap — helium `max_connections=112`; binding constraint is single-thread result parsing on the event loop | `lib/db:194-217` (defaultPoolMax + rationale), `:238,249` |
| Shared pool statement_timeout | 15s default on helium (`DB_STATEMENT_TIMEOUT_MS` override) | `lib/db:230-237` |
| Idle-in-transaction kill | 10s (`DB_IDLE_TX_TIMEOUT_MS`) | `lib/db:242-245` |
| Reserved trading pool | `tradingPool`: max **3** (`DB_TRADING_POOL_MAX`), **statement_timeout 5s hardcoded**, `application_name=pyrus-api-trading`, lazy (0 connections until first query) | `lib/db:282-298` |
| Drizzle handle | `dbTrading` exported | `lib/db:494` |
| Consumers of `dbTrading`/`tradingPool` today | **Zero** — only the definition sites; no imports anywhere in `artifacts/` | rg, observed 2026-07-08 |
| Combined ceiling if wired | 12 + 3 = 15 connections; well under 112 | derived |
| Raw-pool nuance | `shadow-account.ts` imports BOTH drizzle `db` (`:29`) and the raw pg `pool` (`:30`); mark reads at `:3555,4796,4823,7106` bypass drizzle. A trading lane must cover both handles (both are exported from `lib/db`). | `shadow-account.ts:26-40` |

Runtime incidents motivating this doc (owner-provided, **not re-verified in this pass**):
pool 12/12 with waiters peaking at 93; worker scans timing out at 120s having done zero action
work; 825 shadow-write pool-acquire aborts.

---

## 1. DB call topology map

One in-process matrix **producer**, many **consumers**. Core pathology: the producer already
holds full signal state in memory (`signal-monitor.ts:10863-10886`), yet the trading worker
re-reads that state from Postgres at scan cadence through the shared 12-connection pool, in
series with (and ahead of) the actual trading work.

### 1.1 Matrix producer (signal evaluation + persist)

| Item | Detail | Source |
|---|---|---|
| Loop | `signal-monitor-evaluation-worker.ts`: 5s wakeup, advisory lock `1_930_514_021`, stream-driven eval, 100ms flush, history-fallback batches of 48 symbols | `:35-38` |
| In-memory state | Persistent per-environment server-owned matrix subscription (`signalMonitorServerOwnedProducers`); refresh 60s; explicitly the "keystone gap" fix so eval→persist runs with no browser open | `signal-monitor.ts:10863-10886, 10836, 10821-10834` |
| Persist mechanism | Coalescing single-flight scheduler per profile (`:9696`, pending-merge `:9648`, drain `:9721-9736`) → bulk `INSERT … ON CONFLICT (profileId,symbol,timeframe)` chunked at **1000 rows** (`:515`, loop `:9598`, upsert `:9603`) — full universe ≈ 12k rows (2000 symbols × 6 timeframes, `:9591-9596`) | `signal-monitor.ts` |
| Persist cadence | Scheduled from (a) stream-delta flush (1s/3s-idle timer `:486,490`, persist at `:10601-10606`) **but dirty-key-gated to bar cadence ≥1m** (`changedSignalMonitorMatrixStreamPersistStates` `:10125`, applied `:10578-10589`); (b) REST matrix evaluate (`:13784`); plus a 5-min freshness heartbeat (`:10102`) | `signal-monitor.ts` |
| Cache bust | Every persist invalidates the 5s state-rows cache for written (profileId,timeframe) cells (`:9614` → `:14326-14366`) | `signal-monitor.ts` |
| Also writes | Canonical signal events → `signal_monitor_events` (`:9365`, insert `:2394`/`:6622`, onConflictDoNothing) | `signal-monitor.ts` |
| Verdict | **Necessary.** Durable cross-process/cross-restart live view consumed by SSE bootstraps, /state route, worker/cockpit readers. Subscriber-path persist duplication was already de-duplicated (`:10572-10578` comment). Post-batching shape is fine. What's relic-shaped is consumers re-reading it in-process (1.2). | — |

Cache-coldness refinement (matters for sizing): 1m cells all complete at minute boundaries, so
persists arrive in per-minute bursts; the 5s TTL cache is cold immediately after each burst and
warm between. Foundation claim "worker reads land cold" is the burst-window case — mechanism
verified, exact cold-hit rate **unmeasured**.

### 1.2 Trading worker (signal_refresh + action_scan)

Worker loop `signal-options-worker.ts`: 5s wakeup (`:19`); one advisory lock `1_930_514_022`
per tick (`:20-21`, acquire `:709`); **maintenance runs first every tick** (`:718` →
`runShadowOptionMaintenance`); then **serial** per-deployment scans (`:726-764`). Per-deployment
cadence: `pollIntervalSeconds` default 60s (`:374`), forced to **5s whenever positions are open**
(`:45`, applied `:611-614`). Scan timeout 120s + 3s/position, cap 300s (`:39-43`). Action budget
60s / 4 items per scan (`:27-38`). Wake sources: timer + cockpit-change subscription (`:831-838`).

One scan (`runSignalOptionsShadowScan`, `signal-options-automation.ts:20233`) runs two phases
**serially — action work cannot start until the refresh read completes**:

| Phase | DB calls | Pool | Volume | Verdict |
|---|---|---|---|---|
| `signal_refresh` (`:20358-20400`) | `loadSignalOptionsMonitorState` (`:6267`) → **unscoped** `getSignalMonitorStoredState` (`:6294`,`:6312`) → `signal-monitor.ts:14601` → SELECT at `:14383-14397`: all active timeframes, **no symbol filter, no status filter, no LIMIT**; then `UPDATE algo_deployments` heartbeat (`:20392-20400`) | shared | ~12k rows per cold read, per deployment scan (up to every 5s with open positions) | **Relic-shaped** — same process's producer holds this in memory; scoped reader exists unused on this path (§2.4). The heartbeat UPDATE is necessary and tiny. |
| `action_scan` (`:20439+`) | Reads: tally-authority decision state (`:8060`, called `:20459/20726` → shadow_positions/orders SELECTs `:8397,8449,8456`) or ledger events (`:20470,20478`); `reconcileActivePositionsWithShadowLedger` (`:8604` → `recoverActivePositionsFromShadowLedger` `:7610` SELECTs shadow_positions `:7625` + shadow_orders `:7652`; `buildSignalOptionsShadowIndex` `:8387` SELECTs shadow_positions/orders/fills `:8397,8450,8457,8499`); canonical keys (`:20497`); seen signals (`:20520`). Writes: `algo_deployments` cursor UPDATEs (`:21202,21253`), `insertSignalOptionsEvent` (`:2421` execution_events + `:2484` seen-signal upsert) with full shadow cascade (§1.3) | shared | reads bounded by event limits / open-position counts; writes per action | **This IS the trading work.** Necessary — but serialized behind the refresh and competing with dashboards for the same 12 connections. |

`preferStoredMonitorState` (worker default true, `:20365-20366`) short-circuits only the live
re-eval/full-refresh (`:6366` before `:6398+`); it does **not** shrink the read — the stored-state
read is the same unscoped SELECT.

### 1.3 Shadow account writes (orders / fills / positions / marks / ledger)

All `shadow-account.ts`, shared pool. Cadence: event-driven per fill/exit/mark; mark refresh
batched (fixed 2026-07-08, in tree).

| Path | Call sites | Class | Verdict |
|---|---|---|---|
| Order placement `placeShadowOrder` (`:4521`) | dedup SELECTs `:4526,4550`; **TX `:4578`**: INSERT shadow_orders `:4579`, INSERT shadow_fills `:4606`, `upsertPositionForFill` `:5932/:5950/:5975`, **`recomputeShadowAccountFromLedger` `:4639` (4 SELECTs incl. SUM fold over shadow_fills `:14063-14101` + UPDATE shadow_accounts `:14118`) inside the held write TX**; read-back `:4644`; then `writeShadowBalanceSnapshot` INSERT `:3808` | TX + INSERT/UPDATE/SELECT | Necessary; trading-critical. The in-TX ledger recompute is the 5s-timeout hazard for Decision A (§3). |
| Exit events | mark-exit `recordSignalOptionsShadowMarkExit` `:4990` (guard SELECT `:5003`, dedup `:4965/:5018`, INSERT execution_events `:5087`, mirror `:5098`); maintenance exits `:5496,5673`; orphan reconcile `:5839` | INSERT | Necessary; trading-critical. |
| Position marks (batched) | `refreshShadowPositionMarks` (`:6134`) → `writeShadowPositionMarkBatch` (`:6067`): **TX `:6093`**, multi-row INSERT shadow_position_marks `:6094`, set-based `unnest` UPDATE shadow_positions `:6106` | TX | Necessary; today's fix; ideal trading-lane shape (bounded, set-based). |
| Automation mirror mark | `recordShadowAutomationMark` `:15895` (SELECT `:15921`, UPDATE `:15940`, INSERT `:15959`) + balance snapshot `:3808` | INSERT/UPDATE | Necessary (single-position quote-tick path). |
| Mark reads (raw `pool.query`) | `:3555` latest-marks, `:4796/:4823` peak marks (trailing stops), `:7106` baseline marks | SELECT | Necessary; trading-critical reads on the exit decision path. |
| Admin/backfill TXs | `:8073` replay-equity backfill, `:14325/:14438` range resets, `:14554` backtest fills | TX | Necessary but NOT hot-path; must **stay off** the trading pool (bulk deletes can exceed 5s). |

### 1.4 Position tick manager (quote-driven exits)

`signal-options-position-tick-manager.ts`: reconcile every **5s**, active-position snapshot TTL
15s (`:20-21`). Imports **no db/pool — types only** (`:3`); all DB access rides
`signal-options-automation.ts` helpers, i.e. the **shared pool today**. Exit path:
`drainQuoteQueue` (`:528`) → `manageSignalOptionsActivePositionQuote`
(`signal-options-automation.ts:14211`) → same `refreshActivePosition` (`:13481`) as the scan loop,
with `enforcementSource:"option_quote_tick"`. A single tick-exit cascades through
execution_events → seen-signals upsert → `placeShadowOrder` TX → balance snapshot (§1.3).
Verdict: necessary — this is the primary stop-enforcement path per e0286658; its write cascade is
the top Decision-A beneficiary.

### 1.5 Cockpit / marketing SSE + REST/dashboard reads (shared pool)

| Caller | DB per tick? | Cadence | Verdict |
|---|---|---|---|
| Marketing shadow-dashboard stream (`routes/marketing.ts:155` → `marketing-shadow-dashboard.ts:678`, tick `:747`) | **Yes** — ~11 sequential DB-backed service reads per tick (`:535-563`); code itself warns the cold fan-out "can occupy the entire shared DB pool" (`:531-534`); also re-fired by shadow/algo change events (`:790-799`) | 5s (`:38`) | **Duplicate cadence** — a change feed is already wired; the 5s poll is belt-and-suspenders on top of it. Top demand-reduction lever (§2.8). |
| Algo cockpit stream (`algo-cockpit-streams.ts:299`) | **Yes** — `getAlgoDeploymentCockpit` per tick + change re-fire (`:346`) | 5s (`:21`) | Same as above. |
| Signal-monitor matrix stream (`routes/signal-monitor.ts:171`) | No per tick (memory); DB **once per connect** (bootstrap `signal-monitor.ts:10400`, ~12k rows, 30s snapshot TTL `:10337`) | flush 1s/3s idle | Necessary (fresh tab has no producer memory). |
| Diagnostics stream (`routes/diagnostics.ts:337`) | No — in-memory pub/sub | 15s heartbeat | Fine. |
| Platform quotes/orders/execs SSE (`routes/platform.ts:1542,2875`) | No — provider-WS-fed memory broadcast | WS-driven | Fine. |
| `/signal-monitor/state` (`routes/signal-monitor.ts:317`) | Unscoped active-set read, ~12k rows ~10MB; 15s route cache (`:257`) + 5s rows cache | ~60s poll per tab | Heaviest REST read; display-only; keep but it must never share a lane with trading. |
| Other REST (breadth `:355`, events `:377`, account histories `routes/platform.ts:1786-2185`, bars `:2409,2554`, flow `:2808`) | Scoped / LIMIT-bounded | on demand | Fine. |

### 1.6 Diagnostics / flight recorder

Flight recorder: **filesystem only, no DB** (`runtime-flight-recorder.ts:81-82,168,206,221-239,537,708,919`).
Diagnostics DB writes: snapshot INSERT every 15s collector tick (`diagnostics.ts:3296/:3306`,
tick `:4518`, interval `:221`); event upsert coalesced 5min (`:3412,:518`); retention every 6h
(`:519,:4535-4539`); persist deliberately skippable under saturation (`:3371`). Verdict: fine —
small, already back-pressure-aware.

### 1.7 Backfill / ingest / overnight (shared pool)

| Worker | DB work | Cadence | Verdict |
|---|---|---|---|
| bar-cache ingest (`market-data-store.ts:1009,1123`) | INSERT…ON CONFLICT `bar_cache`, batch 5000 (`:79`) | event-driven per provider fetch | Necessary. |
| platform bars background persist (`platform.ts:9103-9146`) | queue cap 512, closed buckets only (`:11046-11051`), delegates to bar-cache write | event-driven | Necessary. |
| signal-monitor backfill reads | per-timeframe 5min→4h (`signal-monitor.ts:5234`), concurrency 3, 64 cells/cycle (`:5249,5254`) | periodic | Necessary. |
| breadth snapshots | INSERT every 5min (`signal-monitor.ts:2736,1973,2755`) | 5min | Fine. |
| overnight-spot worker (`overnight-spot-worker.ts:24-33`) | advisory lock `1_930_514_023`; delegates to `runOvernightSpotSignalScan` with `runActions:true` | 5s wake / 60s poll | Really a trading worker on an overnight schedule — include in Decision-A/B follow-ups, out of scope here. |
| retention scheduler (`snapshot-retention-scheduler.ts:16-18,68`) | bulk DELETEs | 6h | Keep OFF trading pool. |
| broker history schedulers (snaptrade/robinhood `:14/:19`) | account enumeration + refresh | 6h | Fine. |

---

## 2. Relic hunt ("old functions hanging on")

History anchor (verified from git): **e0286658** (2026-06-12) made the signal-options worker
maintenance-only — "matrix is the sole signal source": `scanEnabled` always false, no deployment
scans, no ticker signal refresh; stop enforcement moved to option-quote ticks (tick manager);
`requestSignalOptionsWorkerScanSoon` at zero references. **0dfa3376** (2026-06-23) is a
self-described "NOT a clean/logical commit" pre-reset dirty-tree snapshot that reintroduced the
scan architecture wholesale (`signal-options-worker.ts` had been -903 lines in e0286658). The
bridge-era scan design was never re-migrated to the matrix-first architecture — the owner's
suspicion is correct.

| # | Relic | Evidence | Verdict | Risk of acting |
|---|---|---|---|---|
| 2.1 | **Worker scan loop reintroduced without the maintenance-only gate.** `runDeployment` scans unconditionally; no `scanEnabled` gate; snapshot hardcodes `scanEnabled: true` | `signal-options-worker.ts:504,726-764,910`; e0286658 message | **Migrate** (Decision B): keep action work; demote the per-scan unscoped signal_refresh | Medium — entry candidates come from `evaluated.states`; replacement snapshot must be shape-equivalent (§4) |
| 2.2 | **Dead resource-pressure wire.** Dependency declared + default-wired, **never invoked**; `"resource_pressure"` outcome never assigned | `signal-options-worker.ts:71,440-441,55`; rg: 0 consumers | **Kill** (dependency, import, outcome member) | None — write-only; matches owner directive 2026-07-07 (`:760-761`) |
| 2.3 | **`requestSignalOptionsWorkerScanSoon` exported-dead** — 0 external call sites; the exact symbol e0286658 declared dead, resurrected by 0dfa3376 | `signal-options-worker.ts:932-934`; rg | **Kill the export.** Keep internal `requestRunSoon` (used by cockpit subscription `:831-838`) | None |
| 2.4 | **Duplicate stored-state readers.** Worker path uses the unscoped read (`signal-monitor.ts:14383-14397`: no symbol/status filter, no LIMIT); the scoped `listSignalOptionsStoredSignalStatesFast` (`signal-options-automation.ts:5917`, WHERE `status='ok'` + signal-bearing + universe `IN` + LIMIT 500, `:5949-5957`) is reachable **only** from the cockpit path (`:2859` via `:13034-13060`) | verified reads + rg | **Migrate** worker signal consumption to the scoped reader (or in-memory, §4); keep unscoped read for /state + SSE bootstrap where full-universe display is the point | Low-medium — scoped reader omits stale/unavailable rows, so worker summary counts change meaning; verify in §5 |
| 2.5 | **Scan-loop position work duplicates the tick manager.** Both call `refreshActivePosition` (`:13481`) — scan with `"automation_scan"`, tick manager with `"option_quote_tick"` (`:14211-14234`). e0286658 moved enforcement to quote ticks only; 0dfa3376 restored the scan copy | source reads | **Demote, don't delete**: scan-side position work becomes reconciliation + no-quote fallback | Medium — the scan path is the safety net when quote subscriptions drop; measure tick-manager coverage before reducing cadence |
| 2.6 | "bridge" naming (`fetchBridgeOptionQuoteSnapshots` `:119,14412,14837`) | verified | **Keep** — live IBKR option-quote plumbing, not scan-era bridge code | — |
| 2.7 | `preferStoredMonitorState` flag (`:2858,6366,6384,20365`) | verified | **Keep** — does what it claims (skips live re-eval); its problem is read scope (2.4), not the flag | — |
| 2.8 | **Marketing + algo-cockpit 5s DB polls over an existing change feed** — belt-and-suspenders duplicate cadence; marketing fan-out is ~11 reads/tick and self-documents the pool risk (`marketing-shadow-dashboard.ts:531-534`) | agent-verified | **Migrate** to event-driven emit (change feed already wired) or stretch the interval; biggest shared-pool demand lever outside the worker | Low — display-only surface |
| 2.9 | Maintenance-before-trading ordering on every 5s tick (`signal-options-worker.ts:718`) | verified | **Migrate** — own cadence (Decision B §4.4) | Low |

Not relics (checked because they looked like candidates): the producer persist path (already
dirty-key-gated + single-flight, §1.1); signal-monitor stored/bootstrap exports (all have live
callers); diagnostics DB writes (back-pressure-aware).

---

## 3. Decision A — trading-lane call-site enumeration

Statement-class key: the migrated site's worst-case statement duration is what matters against
`tradingPool`'s **hardcoded 5s statement_timeout** (`lib/db:295`). Rule: a `db.transaction` rides
one client — a TX moves to the trading pool **whole or not at all**; and `idle_in_transaction`
kill is 10s on both pools (`lib/db:242-245,297`).

| Call site | Statement class | Move? | 5s-timeout risk | TX concern |
|---|---|---|---|---|
| `placeShadowOrder` TX (`shadow-account.ts:4578-4641`: orders+fills INSERT, position upsert, **ledger recompute `:4639` = SUM fold over shadow_fills `:14101` + UPDATE**) | TX (write + read fold) | **Yes — this is the site the lane exists for** (every fill/exit) | **Real**: the fold scans the fills ledger and grows with history. Measure current p99 first (§5 step 0); if >1s, either bound the fold (incremental recompute) before migrating, or raise the trading-pool timeout — do NOT ship unmeasured | Whole TX moves; dedup SELECTs `:4526,4550` + read-back `:4644` move with it for ordering coherence |
| Mark batch TX (`:6067-6106`: multi-row INSERT + unnest UPDATE) | TX (set-based, bounded by open-position count) | **Yes** | Low — ms-scale by design | Whole TX moves |
| Exit event inserts (`:5087` + dedup `:4965/:5003`; maintenance `:5496,5673`; orphan `:5839`) | INSERT + guard SELECTs | **Yes** | Low | None |
| Automation mirror mark (`:15921,15940,15959`) + balance snapshot (`:3808`) | INSERT/UPDATE | **Yes** | Low | None |
| Peak/baseline mark reads (raw `pool.query` `:3555,4796,4823,7106` — trailing-stop inputs) | SELECT | **Yes** (they gate exits; a read-storm-starved trailing stop is the exact failure the lane prevents) | Low (indexed point reads — **inferred**, not EXPLAIN-verified) | Must switch handle `pool` → `tradingPool` (raw), not `db` → `dbTrading` |
| Tick-manager exit path (`signal-options-automation.ts:2421` execution_events insert, `:2484` seen-signal upsert, cascade → all rows above) | INSERT/upsert + cascade | **Yes** — covered transitively once shadow-account sites move; the two automation-file sites move too | Low | None |
| action_scan reconciliation reads (`:7625,7652,8397,8450,8457,8499`) | SELECT (multi, event-limit-bounded) | **Phase 2 / measure first** — read-heavy; on a 3-connection lane they could starve the exit writes the lane protects | Medium (row counts grow with ledger) | None |
| `algo_deployments` heartbeat/cursor UPDATEs (`:20392,21202,21253`) | UPDATE | Optional (tiny); fine either pool | None | None |
| Admin/backfill TXs (`:8073,14325,14438,14554`), retention DELETEs, /state reads, SSE fan-outs | bulk | **Never** — keep on shared pool | — | — |

Mechanics note: today every one of these resolves `db`/`pool` from `@workspace/db` at import.
The lowest-risk wiring is a module-local chooser in `shadow-account.ts` (+ the two
`signal-options-automation.ts` sites): `const tdb = TRADING_LANE_ENABLED ? dbTrading : db` (and
`tpool` likewise), so rollback is one env flip — no call-site rewrites.

---

## 4. Decision B — action-first design (minimal reorder)

**Problem (verified):** action work is serialized behind signal_refresh inside one scan
(`signal-options-automation.ts:20358` → `:20439`), scans are serialized per-deployment behind
maintenance on one 5s-wakeup lock (`signal-options-worker.ts:709-764`), and the refresh read is
the unscoped ~12k-row SELECT against the saturated shared pool. When it stalls, the 120s scan
timeout fires with zero action work done — exits/entries starve even though (a) the signal state
is already in process memory and (b) an equivalent scoped SQL reader exists unused.

**Minimal reorder — four moves, no new architecture:**

1. **Flip phase order in the scan.** Run `action_scan` first against the *previous/current
   stored* snapshot; run `signal_refresh` after, as next-tick prefetch. The scan already has the
   refresh-only mode (`skipActionWork`, `:20403`); add the complementary action-first path. The
   worker already has the resume mechanic for split work (`resumeActionWorkNextTick`,
   `signal-options-worker.ts:567-568,615-617`), and entry ordering already tolerates split phases
   (action cursor + signatures, `:20516-20560`).
2. **Snapshot source.** Near-term: the scoped reader `listSignalOptionsStoredSignalStatesFast`
   (`:5917`) — universe-filtered, single timeframe, `status='ok'`, signal-bearing rows only,
   LIMIT 500: exactly the actionable set. End-state: an in-process accessor over the producer's
   latched state (`signalMonitorServerOwnedProducers`, `signal-monitor.ts:10863-10886`) — zero DB
   reads on the action path.
3. **Staleness bound.** Rows change at bar cadence (≥1m); producer flush latency is ~100ms-1s
   (`signal-monitor-evaluation-worker.ts:37`; flush timers `signal-monitor.ts:486,490`). An
   action-first snapshot is therefore ≤ flush+read latency behind the matrix — sub-second in the
   common case — versus today's worst case of action work waiting up to the 120s timeout behind a
   stalled refresh. Freshness is re-validated per candidate anyway (fresh/currentSignalAt filters;
   seen-signal dedup `:20520`), so the actionability contract is unchanged. Bound it explicitly:
   reject snapshots older than one bar interval and fall back to the refresh-first order (rare).
4. **Maintenance off the tick path.** `runMaintenanceOnce` (`signal-options-worker.ts:718`) moves
   to its own cadence (60s default) or runs after deployment scans. Today every 5s tick pays a
   shadow-maintenance pass before any trading work.

**Relic removal this enables:** the per-scan unscoped refresh (2.1/2.4) demotes to a bar-cadence
background prefetch; scan-side position work (2.5) demotes to reconciliation/no-quote fallback,
restoring the e0286658 intent (tick manager = primary enforcement) without losing the safety net.

**Unchanged:** matrix remains the sole signal source; entry dedup (seen-signals, cursors,
signatures); the advisory lock; the manual scan route (`routes/automation.ts:386`) keeps
refresh-then-action for forced evaluation.

---

## 5. Sequenced plan (ranked by trading-outcome impact per unit risk)

Reload discipline per CLAUDE.md: backend changes ship via SIGUSR2 to the pid2-owned supervisor,
verified by `/api/healthz` 200 and grepping the live `dist/index.mjs`.

**Step 0 — Measure baselines (no code change; gates steps 3-4).**
Capture from pool diagnostics (`lib/db` instruments every query with `startedAtMs` →
`emitPostgresPoolDiagnostic`, `lib/db:300+`) and the flight recorder: p50/p99 of (a) the
worker's stored-state SELECT, (b) `placeShadowOrder` TX duration incl. ledger fold, (c) pool
acquire-wait distribution by caller. Verification: numbers in hand. Rollback: n/a.

**Step 1 — Relic kills (2.2, 2.3).** Delete the dead pressure wire and the dead export.
Impact: none at runtime (that's the point) — removes misleading structure before restructuring.
Verify: `pnpm --filter api-server` typecheck + worker tests. Rollback: git revert. Risk: ~zero.

**Step 2 — Decision B: maintenance off-tick + action-first reorder (§4.1-4.4).**
Highest trading impact per risk: exits/entries stop queueing behind the 12k-row read and the
maintenance pass; the 120s zero-action timeout class disappears structurally. Gate the reorder
behind one env flag (e.g. `SIGNAL_OPTIONS_ACTION_FIRST=1`) so rollback is an env flip + SIGUSR2.
Verify: existing scan/worker suites (`signal-options-automation.test.ts`,
`background-worker-pressure.test.ts`, worker tests — the suites e0286658 used); runtime probe:
worker snapshot (`getRuntimeSnapshot` fields `lastActiveScanPhase`, `lastScanOutcome`,
`lastScanDurationMs`) shows action phases completing inside budget with no
`timed_out_unsettled`; diagnostics show scan-tick DB reads dropped. Risk: medium (ordering
semantics); bounded by flag + cursor/signature resume mechanics already in place.

**Step 3 — Scoped reader for the (now background) refresh (2.4).**
Swap the worker-path unscoped `getSignalMonitorStoredState` for the scoped reader; keep unscoped
for /state + SSE bootstrap. Impact: removes the largest recurring read from the shared pool.
Verify: shape-parity unit test (summary counts: document that stale/unavailable tallies now come
from the scoped set — or read counts separately at low cadence); runtime: cold-read row counts in
diagnostics fall ~12k → ≤500. Rollback: branch-gate the old path. Risk: low-medium.

**Step 4 — Decision A: trading lane, phased (§3).**
A1: exit/mark/event writes + mark-batch TX + raw-pool mark reads → `dbTrading`/`tradingPool` via
the module-local chooser. A2: `placeShadowOrder` TX **only after** step-0 shows p99 fold time
comfortably <5s (else bound the fold first or raise `DB_TRADING_POOL_MAX`/timeout deliberately).
A3 (optional): reconciliation reads — only if A1/A2 telemetry shows lane headroom.
Verify: `pg_stat_activity` shows `application_name=pyrus-api-trading` rows; induce a dashboard
read storm (marketing stream + /state polls) and confirm zero trading-write acquire aborts;
shadow-account test suites green. Rollback: env flip (`TRADING_LANE_ENABLED=0`) + SIGUSR2.
Risk: medium, dominated by the 5s-timeout-vs-ledger-fold interaction — which step 0 de-risks.
Why after B: B removes the demand that causes today's starvation; A is the insurance layer that
makes trading writes immune to the next read storm. A1 can land in parallel with step 3 if the
825-abort incident recurs before B ships.

**Step 5 — In-memory snapshot accessor (end-state of §4.2).**
Expose the producer's latched state to the scan; action path does zero signal reads from DB.
Verify: action-phase DB read count = 0 in diagnostics; staleness assertion tests. Risk: higher
(coherence contract with the latch) — only worth it after steps 2-3 telemetry, may prove
unnecessary.

**Parallel demand track (not gated on A/B):** convert marketing + algo-cockpit 5s DB polls to
change-feed-driven emits (2.8). Biggest non-worker shared-pool relief; display-only risk.

---

## Appendix — unverified / inferred

- Live incident figures (12/12, waiters 93, 825 aborts, 120s zero-action timeouts): owner-provided
  runtime observations from 2026-07-08, not re-derived here.
- "~12k rows" = 2000 symbols × 6 timeframes per the persist-chunking comment
  (`signal-monitor.ts:9591-9596`) and cache comment (`:14284-14285`) — inferred scale.
- Mark-read latency "low" (§3): indexed point reads inferred from shape; not EXPLAIN-verified.
- Effective cache cold-hit rate for worker reads (§1.1 refinement): mechanism verified, rate
  unmeasured — step 0 measures it.
