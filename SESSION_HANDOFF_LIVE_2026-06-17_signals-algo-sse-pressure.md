# SESSION HANDOFF (LIVE) — Signals/Algo: sparklines, errant pressure, DB-pool starvation, SSE migration

- **Date/time:** 2026-06-17 (afternoon MDT)
- **Session ID:** `d3be8676-affe-42f4-8351-992d88fb2199` (Claude Code)
- **CWD / repo:** `/home/runner/workspace`
- **Why this note:** container went into recovery mode; user is restarting. `~/.claude/plans/purrfect-tumbling-robin.md` is EPHEMERAL (wiped on reset) — durable content captured here in the repo.
- **⚠️ Restart caveat:** rebuild recompiles api-server from the working tree → activates **Fix #1 (good)** AND the **DB-pool agent's uncommitted changes** (incl. NEW migration `lib/db/migrations/20260617_option_chain_latest.sql` + `lib/db/src/schema/market-data.ts`). Confirm DB agent is at a safe checkpoint before restart.

## Original request → where it went
"Investigate why the signals-table sparklines aren't displaying + errors/stale data; root-cause each layer." Broadened to: signal **scan paused**, **algo monitor sidebar empty while STA table full**, **no algo events in header algo lane**.

## ✅ Fix #1 — DONE + VERIFIED (the only code change I shipped)
**File:** `artifacts/api-server/src/services/platform.ts` (uncommitted).
**Defect:** event-loop delay histogram (`monitorEventLoopDelay`, `:2708-2709`) was `.enable()`d once and **never `.reset()`** → `mean/max/p95` cumulative-since-boot → `eventLoopDelayP95Ms` (`:3411-3414`) pinned `resourceLevel:"high"` forever (errant pressure that admission-sheds the deferred `/api/bars` sparkline family).
**Change:** added a 10s windowed sampler (`readEventLoopDelayWindowMs` + `setInterval` + `eventLoopDelay.reset()`, `unref`'d) mirroring `ibkr-perf-capture.ts:132/147`; snapshot now reads `{ ...eventLoopDelayWindowMs }`.
**Verified:** typecheck clean (exit 0). 23-min watch: `elP95` decreased repeatedly (870→126, 30836→5502→2357, …) — impossible for a cumulative metric → windowing proven; at low real delay it correctly read `watch`/`normal` not stuck `high`. **Activates on restart** (already in working tree).

## Root-cause picture (verified)
The three symptoms are all **DB-pool starvation**, surfaced honestly once Fix #1 stopped the false "high":
- The signals/algo surfaces read the DB; under pool exhaustion their queries time out (`_DrizzleQueryError: Failed query: select … deployment_id, algo_run_id …` in the live console). `dbPool` seen at `active 12/12, waiting 33–90`.
- **STA table stays FULL** because it's fed by the **in-memory signal-matrix producer** (SSE), which never touches the pool.
- **Algo monitor sidebar / header algo lane / scan** go EMPTY because they're **DB-backed** (REST + a DB-polling "SSE").
- Bridge is OFF but that's **not** the cause (confirmed): bridge errors are `getaddrinfo ENOTFOUND …trycloudflare.com`, backed-off async noise. The signals pipeline fails on its OWN DB queries.
- Real load that jammed the pool started 06-16 (`api-db-pool-pressure` 0→423→1500+ across 06-15/16/17); the 06-14 `20d9865` change only made the failure *visible* (honest gray placeholder instead of a fake line).

## Findings on the user's "finish the SSE migration" (a) and "bound the backfill" (b)
- **(a) DO NOT migrate the algo surfaces to the cockpit SSE — it's FUTILE.** `/streams/algo/cockpit` (`routes/automation.ts:416`) bootstraps via `fetchAlgoCockpitPrimaryPayload` → `listExecutionEvents` (a **DB query**, `algo-cockpit-streams.ts:97,151`) and updates by **polling the DB**. So that "SSE" dies under pool jam just like the REST query. Only the signal-**matrix** producer is truly in-memory. **No change made.**
- **(b) backfill is ALREADY bounded — leave it.** `refreshSignalMonitorBackfilledBaseBars` (`signal-monitor.ts:~3593-3690`): `CONCURRENCY_LIMIT=3`, `MAX_CELLS_PER_CYCLE=64`, round-robin/most-overdue, `yieldSignalMonitorEventLoop()` between batches, single-flight, **skips at "high"**. It's an event-loop cost, not the pool hog (pool hog = algo/option-chain DB queries = DB agent's domain). Over-throttling would only hurt matrix freshness. **No change made.**
- **Therefore the lever for all three symptoms = relieve the DB pool** (DB-pool agent's in-flight option-chain/ingest work **+ Fix #1**). Once the pool frees, the existing DB reads succeed → sidebar/lane/scan repopulate.

## ⬜ #1 (TODO — the durable robustness fix): in-memory execution-event push bus
Make algo/execution events DB-pressure-independent like the STA table — stop polling the DB; push from memory.
**Plan:**
1. **Server event bus:** add an in-process emitter (e.g., `executionEventBus`) that fires whenever an execution/algo event is created/persisted (emit at the write sites that currently insert execution events — find via `rg 'insert.*executionEvents|executionEventsTable'`).
2. **SSE push, not poll:** change `subscribeAlgoCockpitSnapshots` / `/streams/algo/cockpit` to push from the bus (keep a single DB read for the initial bootstrap snapshot only; subsequent events come from the bus, no per-update DB poll). Ref the matrix producer pattern (`startSignalMonitorServerOwnedProducer` in `signal-monitor.ts`) as the in-memory-push template.
3. **Client renders from the stream:** in `PlatformShell.jsx`, capture the cockpit SSE events (`handleAlgoLiveEvents`, `:804`; bootstrap = first batch) into state and feed `algoEvents` to AppHeader (`:1081`→header lane), NotificationsDrawer (`:1136`), MobilePortfolioPulseSheet (`:1151`), preferring the streamed list, DB query as cold-start fallback. Sidebar (`PlatformAlgoMonitorSidebar.jsx:1110-1199`) is bigger — it has 5 DB queries (cockpit/automation/performance/events/positions); migrate its **events** first, the rest later.
**Risk/seq:** trading-critical + touches AppHeader interface; do when box is calm + DB agent landed; verify each step with a restart. **Acceptance:** sidebar/lane stay populated even when `dbPool.waiting` is high.

## ⬜ #2 (TODO — cheap legibility win): surface the real failure reason
Right now failures render as a bare gray placeholder / empty surface. Make them say WHY.
- **Sparkline cells:** `SignalsScreen.jsx:3983-3986` collapses a rejected `/bars/batch` item to bare `SIGNAL_SPARKLINE_FAILED`; the item carries a real `error` string (`routes/platform.ts:2345-2348`). Retain it and show it in the cell diag (`data-sparkline-source`/`DataIssueInlineIcon`, `~:1751/1860`).
- **Algo surfaces:** surface the `useListExecutionEvents` error/`isError` as a "data busy/timed out" affordance instead of silent empty.
- Client-only, low-risk, no backend load. NOT YET DONE.

## Coordination — DB-pool agent is MID-FLIGHT (do not collide)
Uncommitted (theirs): `automation.ts(+test)`, `option-metadata-store.ts`, `python-compute.ts`, `crates/market-data-worker/src/ingest.rs`, `lib/db/src/schema/market-data.ts`, NEW `lib/db/migrations/20260617_option_chain_latest.sql`, `PlatformApp.jsx`, `OperationsSignalTable.jsx(+test)`. My Fix #1 (`platform.ts`) does NOT overlap. Landed earlier by them: `6e35910 fix(algo): stop DB pool saturation from starving the algo page load`.

## Resume / next steps
1. After restart: verify Fix #1 — `.pyrus-runtime/flight-recorder/api-current.json` `resourceLevel` should track real recent event-loop delay (decays), not stuck `high`.
2. Verify symptoms recover as DB-pool agent's work + Fix #1 relieve the pool (sidebar/lane/scan refill via existing queries).
3. Implement **#2** (legibility) — small, safe.
4. Plan/stage **#1** (execution-event bus) when calm.
- Related memory: `[[working-style-audits-and-increments]]`, `[[option-chain-write-db-contention]]`, `[[signal-matrix-staleness-failure-modes]]`.
