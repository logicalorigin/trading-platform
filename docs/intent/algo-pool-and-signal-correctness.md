# Intent: Algo DB-Pool & Signal Correctness Campaign

_Confirmed 2026-06-18 via /interview-me (session a890231f). Combined two threads: DB connection-pool exhaustion and stream-driven signal correctness._

> Status note (2026-06-19): this is the campaign intent and ordered checklist,
> not the current implementation ledger. Several fixes from this campaign landed
> afterward; verify the current source, migrations, and commit history before
> treating any checklist item below as still open or already deployed.

## Outcome
One ordered campaign — **DB-pool demand reduction first, then stream-driven signal correctness** — so the connection pool never exceeds its budget (eliminating the "Signal-Options Deployment Unavailable" empty state) and passive/stream signals are honest, current, and correctly anchored.

## Why now
The algo page intermittently shows "Unavailable" and stale / mis-anchored signals because the 12-connection pool saturates and the passive (broker-off, stream-driven) signal pipeline isn't honest. Both undermine trust in a lean, broker-independent setup.

## Guiding principle (from the independent audit)
**≤1 DB connection per logical step, and zero connections held idle across I/O.** Reduce demand — do NOT raise the pool cap (max=12 is a deliberate policy).

## Constraints / how
- Live trading infra: execute **one fix at a time, verified (typecheck + tests)**.
- **Confirm before each live-DB migration or audited-file change** (package.json dev scripts, schema). `pnpm run audit:replit-startup` guards startup/dev-script rules.
- Don't restart the dev server unasked. Broker (IBKR) stays OFF intentionally (to expose hidden front-half dependencies).

## Ordered fix checklist

### DB-pool root
1. **GEX refresh 25-way → single bulk insert.** `gex-universe-refresh.ts:20-21` (`GEX_UNIVERSE_ENQUEUE_CONCURRENCY=25`), `~:1212-1223` (Promise.all enqueue), `~:1277` (`enqueueMarketDataJob`). Collapse 25 concurrent inserts → one bulk insert (≤1 conn). Fallback: concurrency 25→8, MAX 50→10.
2. **Correct `execution_events` index → `(deployment_id, event_type, occurred_at)`.** The slow query (`signal-options-automation.ts:2020-2027`) filters `event_type LIKE 'signal_options_%'` → Parallel Seq Scan of ~849k rows (15–23s) pinning a connection. The earlier `(deployment_id, occurred_at)` index is UNUSED — drop it. Keep stats fresh (autovacuum never ran on this table; manual ANALYZE applied 16:23Z). **(live-DB migration — confirm first)**
3. **Release the advisory-lock connection before broker/maintenance I/O.** `signal-options-worker.ts:71`, `overnight-spot-worker.ts:198`, `signal-monitor-evaluation-worker.ts:174` hold a pooled connection in a txn IDLE across all maintenance I/O (top contention; up to 3/12 pinned). Release before I/O (or use a lock that doesn't pin a pool connection).
4. **Shared coalesced cockpit SSE poller.** `algo-cockpit-streams.ts:152` (5-way Promise.all) runs PER subscriber (`:193`/`:281`, route `automation.ts:466`) → 5×N connections for N tabs. Add one shared poller per (mode, deploymentId) fanned to all subscribers (5N→5); also collapse the 5-way toward fewer queries.
5. **shadow-index 3-way → one CTE.** `signal-options-automation.ts:6256` (3 parallel selects: orders/fills/positions) → single CTE keyed on eventIds + accountId='shadow'.

### Signals (stream-driven correctness)
6. **Remove the deprecated bar-eval scan worker.** Delete `signal-monitor-evaluation-worker.ts` + the `PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED` flag (`api-server/package.json:7`, `isSignalMonitorBarEvaluationEnabled` at `signal-monitor.ts:5753`) + the now-pointless passive-source 503 gate (`signal-monitor.ts:4929`) + index.ts wiring. Make the passive/stream path always-on. The stream emits signals via SSE push at **bar-close or mid-bar per the Pyrus indicator settings** (`bosConfirmation` close/wicks, linked to algo controls). **(touches audited package.json — confirm first)**
7. **Dynamic staleness model** — replace the sticky persisted `fresh` flag (`signalStateFreshness.js:38`, `signal-monitor-actionability.ts:33`, `algoHelpers.js:733`):
   - **Primary (feed-relative):** stale iff a newer COMPLETED bar exists for (symbol, timeframe) than the one evaluated (`latest_bar_at` behind the newest bar). Self-corrects for market hours; per-timeframe; grace ≤1 forming bar.
   - **Secondary (heartbeat):** session-active AND no push within `cadence × N` (cadence from indicator mode: bar-close = bar duration; mid-bar = intrabar push interval). Catches a dead stream.
   - **Never stale when no bar is due** (market closed / no newer bar). N = small grace (~1–2 bars) to avoid flicker.
   - **OPEN DEPENDENCY:** is session/RTH state per symbol already exposed? Decides frontend-only vs backend feed.
8. **Move % → fire-bar close.** `resolveSignalMove` (`algoHelpers.js:1202-1236`) uses `current_signal_price`, which is a STRUCTURAL ATR-offset level (`lib/pyrus-signals-core/src/index.ts:1217`), NOT the fire price — distorts the %. Anchor to the fire-**bar close** per `bosConfirmation` (close/wicks). Events carry `close`; live matrix states do NOT — add a fire-bar-close field to `signal_monitor_symbol_states` + the matrix payload.

## Success criteria
- Pool `waiting` stays 0 under load (algo-page load + GEX refresh).
- No "Signal-Options Deployment Unavailable".
- Slow `execution_events` query fast via the correct index.
- Nothing renders "fresh" while stale; higher timeframes stay current via stream re-eval.
- Move % = move since the fire bar.

## Out of scope (for now)
Layer-2 "paper" identifier/route renames (`/algo/signal-options/default-paper-deployment`, its operationId, `…PaperDeployment` function names); deployment split (options vs overnight-equities into separate rows); raising the pool max; turning the broker on; watchlist-sidebar sparkline timeframe wiring.

## Key corrections from the independent audit (do not repeat)
- The slow query has an `event_type LIKE` predicate; the right index is `(deployment_id, event_type, occurred_at)`. The `(deployment_id, occurred_at)` index already added is **unused**.
- Pool steady-state is **bimodal** (~2/12 idle ↔ 12/0 saturated), not a flat 10/12 (that was a stale snapshot).
- `/api/diagnostics/runtime` dbPool numbers are a **stale sampled snapshot** — use `getPoolStats()` / the flight-recorder for ground truth.
- `current_signal_price` is **structural** (ATR offset), not a stale carried-over price.
- The pool-12 "provider hard cap" is **unverified** (server `max_connections=112`; 12 is code policy).

## Already completed this session
- paper→shadow env rename + migration (enum, ~50 source files, regenerated clients); signal universe restored (668 symbols); deployment renamed "…Shadow".
- Live MTF STA filter (hide non-aligned rows, draft-driven).
- Cockpit-KPI flap fixes: gate re-keyed `.level`→`.resourceLevel`; degraded payload no longer mislabeled `phase:"full"`.

## Status
Fix #1 (GEX bulk insert) in progress. Fixes #2 and #6 require explicit confirmation before applying (live-DB / audited file).
