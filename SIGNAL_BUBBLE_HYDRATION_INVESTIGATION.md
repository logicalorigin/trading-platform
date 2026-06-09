# Signal "Bubble" Hydration — Investigation, Fix Plan & Emit Architecture

**Date:** 2026-06-08
**Area:** Signal-matrix "bubbles" (symbol × timeframe cells) across the app — watchlist, signals page, algo/STA rows, algo monitor sidebar
**Status:** Root causes confirmed with live probes; phased fix designed, adversarially audited, and full `/autoplan` reviewed. Not yet implemented.

> **Audit status:** revised after an adversarial code-grounded review. Key corrections: (1) emit already exists (`evaluateSignalMonitorSymbolFromCompletedBars` + `insertSignalEventBestEffort` + eventKey dedupe) — Phase 3 *moves the trigger*, it does not build edge-detection or an in-memory cursor; the first draft named the wrong (read-only) function; (2) filtered signals aren't in `signalEvents`, so "emit all / client-filters" was dropped; (3) Phase 1.3 must **merge** matrix onto the breadth store, not replace it (universe-shrink regression); (4) Phase 1.1 must include `PlatformWatchlist:313`; (5) Phase 2 freshness softened (per-symbol cap; KPI = `status:ok`, not `fresh`); (6) 1m emit may not be an efficiency win without incremental indicators; (7) 2m+ bar-close = minute-aggregate rollup, not per-TF `streamHistoricalBars`.

## Symptom

Signal-matrix "bubbles" hydrate inconsistently: the same symbol shows a fresh bubble on one surface and a stale/empty one on another, and many bubbles are perpetually stale. This is **not one bug** — it's a systemic interaction, which is why it's been hard to pin down.

## Diagnosis (confirmed with live probes)

`GET /api/signal-monitor/state?environment=paper` returned **3000 states** (~500 symbols × 6 timeframes):

| | count | share |
|---|---|---|
| `status:"ok"` | 408 | 14% |
| `status:"stale"` | 2562 | **85%** |
| `status:"unavailable"` | 30 | 1% |
| `fresh:false` | 2922 | 97% |
| `cacheStatus` | — | `"miss"` |

Universe scope `__signalMonitorUniverseScope: "all_watchlists_plus_universe"`; `lastError`s are all bar-warmth (*"not warm enough for live-edge"*, *"No broker history bars available"*, *"No signal monitor state available"*).

### Root causes

**A. Server: the universe vastly exceeds what can be kept warm.** `evaluateSignalMonitorMatrix` (`services/signal-monitor.ts`) loads completed bars per cell and runs `evaluatePyrusSignalsSignals`, capped by resource pressure (`SIGNAL_MONITOR_MATRIX_PRESSURE_CAPS`: normal 40 / watch 16 / high 8 symbols per cycle) and gated on bar warmth. With ~500 symbols, **85% of cells report `status:"stale"` and the endpoint serves stored state with `cacheStatus:"miss"`** — the real staleness signal. (`fresh:false` at 97% is weaker — `fresh` is signal-recency, so many `fresh:false` cells are simply "up-to-date, no recent signal.") A defer-then-warm pattern that never catches up.

**B. Frontend: which bubbles look fresh depends on the surface** (the "inconsistent" complaint):
- **Two diverging sources.** Surfaces read `signalMatrixSnapshot.states` (matrix), but `PlatformWatchlist` *also* reads a separate store `signalMonitorStore` (`useSignalMonitorStateForSymbol`, `useSignalMonitorSnapshot`), **falls back to it**, and **blanks to `EMPTY_SIGNAL_STATES` on an environment-label mismatch** (`PlatformWatchlist.jsx:962-979`).
- **Divergent request scope + active-vs-passive.** SignalsScreen requests the universe and SignalsScreen/algo-sidebar *trigger* hydration; the watchlist only *reads*. Hydration activity is gated to `screen === "signals" || "algo"` (`PlatformApp.jsx:829-837`), so on the watchlist nothing re-freshens.
- **Warm-start flip.** `signalMatrixSnapshotCache.js:142-151` sets every cell `fresh:false` after 15 min.

Net: a bubble is fresh on whichever surface most recently evaluated that symbol, stale/empty elsewhere → reads as random inconsistency.

## Requirements (user-confirmed)

Full fix — **consistency** (same symbol = identical bubble on every surface) **and** **freshness** (on-screen bubbles prioritized over the universe), **equally** — plus an **event-driven emit/push** architecture: compute a cell only when its bar closes and push deltas, instead of a worker re-scanning the universe each poll (same monitoring footprint, far less redundant compute), with emission based on the pyrus indicator's discrete `signalEvents`.

Implementation intent confirmed on 2026-06-09: Phase 1 is not a cosmetic cleanup and not a watchlist-only patch. It must remove the structural reason surfaces can disagree. The app needs one real per-`symbol:timeframe` signal-bubble state model; watchlist, Signals, algo/STA rows, and sidebar must all render from that same merged source. Broad monitor state may remain only for breadth consumers and monitored-only row discovery. Tests are proof, not the fix. Any remaining surface-specific bubble derivation is a blocker, even if the UI appears visually correct.

Rest-of-plan intent confirmed on 2026-06-09: the end state is not nicer polling. The signal system should become a designed pipeline: **client truth** in Phase 1, **server truth/freshness correctness** in Phase 2, and **bar-close push delivery** in Phase 3. In a healthy app, bubble freshness and signal updates should come from bar-close deltas. Polling remains only for startup snapshot, reconnect catch-up, and emergency fallback. Every phase must remove a real root cause; no "bridge", "guardrail", or "good enough" plateau.

## Key enabling fact (corrected after audit)

The emit machinery **already exists** — only its *trigger* is wrong. `evaluateSignalMonitorSymbolFromCompletedBars` (`signal-monitor.ts:4573`, async) already computes signals AND **persists a deduped event** via `insertSignalEventBestEffort` (`:3840`), gated by `shouldPersistSignalMonitorStateEvent` (`:3865`, requires `fresh && barsSinceSignal===0 && !partialBar && lag<=MAX`), deduped by `buildSignalMonitorEventKey` + `.onConflictDoNothing()` (`:3800/3830`). So durable, restart-safe, dedupe-by-eventKey emission is done. Missing: it runs on the **poll trigger** instead of on bar close, and it isn't **pushed** to clients.

So Phase 3 is "**move the existing emit onto a bar-close trigger and SSE-push it**," NOT "build edge-detection + an in-memory cursor."

> ⚠️ Verified caveats: (1) `evaluateSignalMonitorMatrixStateFromCompletedBars` (4786) is a pure READER — do NOT trigger it for emit; use `...SymbolFromCompletedBars` (4573). (2) `streamHistoricalBars` is not a per-timeframe feed for all TFs — 2m and the 5m/15m/1h/1d buckets are **rolled up from 1m aggregates**; bar-close detection must hook the minute-aggregate rollup + `isCompletedBucket`. (3) `evaluateSignalMonitorMatrixSymbol` is at `:5867`.

---

## Phase 1 — Frontend consistency (ship first; highest value/effort, pure client)

Goal: identical bubble for a symbol on every surface; visible bubbles always requested regardless of active screen. Also restructures the client onto **one merged source**, the precondition for Phase 3.

1. **Collapse the watchlist onto the single matrix source.** `PlatformWatchlist.jsx`: remove the `useSignalMonitorSnapshot()`/`effectiveSignalStates` fallback (922-979) and the **environment-mismatch→EMPTY trap** (962-979); drive rows from one already-merged `signalMatrixBySymbol` map (1006-1035). **Must ship with line 313** — the per-row `useSignalMonitorStateForSymbol(item.sym)` read feeds the row sparkline status (327-342) and `priceValue` (361). Resolve same-key conflicts through one activity-aware merge rule, matching the server precedent: keep the current/matrix cell only when it is usable and at least as active as the poll/store value; do not let a genuinely staler matrix cell clobber a fresher stored state.
2. **Request set = UNION of rendered symbols, independent of screen.** `PlatformApp.jsx` (829-837): broaden the activity gate beyond `screen === "signals"||"algo"` to "any matrix-rendering surface mounted" (the watchlist is always on the shell). (3651-3685): always feed the visible union — `watchlist ∪ open positions ∪ signalsScreen (when mounted) ∪ selected sym` — into `prioritySymbols`. Add a trigger keyed on the watchlist/visible union so the existing `runSignalMatrixEvaluation`/`scheduleSignalMatrixEvaluation` loop runs on the watchlist too.
3. **Converge the store onto the matrix cache WITHOUT shrinking its breadth.** `PlatformApp.jsx:4788-4804`: `signalMonitorStateQuery` is environment-scoped and returns the **full ~3000-state universe**, consumed for breadth by `HeaderBroadcastScrollerStack` signal tape (`:1675`), `PortfolioPulseZone` (`:230`), `TradeWorkspaceChrome`/`TradeEquityPanel`. Do **not** repoint `publishSignalMonitorSnapshot` to `signalMatrixSnapshot.states` (the request union) — that would blank symbols shown in the header tape but not rendered. Instead merge visible matrix states over the universe poll with the same activity-aware rule from Phase 1.1. Phase 2 does **not** fix this — it changes server eval order, not client store breadth.
4. **Don't blank on warm-start.** `signalMatrixSnapshotCache.js` (113-159): keep real per-cell freshness instead of hard-flipping all to `fresh:false`; surface `cacheStatus:"warm-start-stale"` as a "reconnecting/warming" banner, not a per-bubble blank.

Reuse (no new logic except the one merge contract): `buildSignalMatrixSymbolSets`, `buildSignalMatrix{Request,ExactRequest}Plan`, `mergeSignalMatrixStates`, `buildSignalMatrixPendingStates`, `read/writeSignalMatrixSnapshotCache`, `publishSignalMonitorSnapshot`.

Risks: env paper/live cross-contamination (tag the cache by environment — already threaded at `4579`); **verify the other `useSignalMonitorSnapshot` consumers** keep universe breadth (the merge-not-replace mitigation). Ship 1.1–1.4 together — partial adoption regresses the watchlist row.

## Phase 2 — Server truth/freshness correctness for signal cells

Goal: the server exposes one honest cell truth model — evaluated, warming, unavailable, no-signal, error, and freshness age — with on-screen cells prioritized so they refresh first. This is not "prioritized polling as the destination"; it is the server-side correctness layer Phase 3 will push from.

> The cap `maxSymbols` is **per-symbol per cycle** (`high`=8) and the client poll floors at ~60s under high pressure, so a 30-symbol visible set takes ~4 cycles to rotate. Visible-first **reorders**, it cannot make 30 symbols fresh in one cycle. The right KPI is **`status:"ok"` + recent `lastEvaluatedAt`**, NOT `fresh:true` (a correctly-evaluated cell with no recent signal is `fresh:false` by design).

1. **Visible-first evaluation.** `signal-monitor.ts` `resolveSignalMonitorMatrixSymbols` (6761) / `resolveSignalMonitorEvaluationBatch` (2192): when the request carries explicit `cells`/`symbols` (the Phase-1 union), order those first so the cap budget is spent on on-screen cells before universe rotation. Same footprint — reorder, don't enlarge.
2. **Expose per-cell truth state.** Split this into two steps. Phase 2a can ship client-only: classify only known bar-warmth failures (`status:"stale"` plus a warmup/history `lastError`) as warming, and do not label every stale cell as warming because exact matrix probes can return `status:"stale"` with `lastError:null`. Phase 2b is the API contract change: `withSignalMonitorMatrixMetadata` (6225) keeps numeric `coverage.pendingSymbols`, then adds a bounded `pendingCells[]` list + normalized `warming:true` flag after OpenAPI/codegen. Frontend `signalMatrixScheduler.js` (`buildSignalMatrixPendingStates`): map server `warming` → the existing `"pending"` status so the bubble shows "warming" distinct from "no signal"/"error".

Risks: starves the off-screen tail (acceptable); bound `pendingCells[]`; keep the numeric `coverage.pendingSymbols` contract intact.

## Phase 3 — Bar-close emit/push as the normal signal path

Goal: compute a cell only when its bar closes and push deltas over SSE; one merged client store plus one server truth model means all surfaces stay consistent and fresh without normal signal polling. Polling remains only for startup snapshot, reconnect catch-up, and emergency fallback.

**Server — move the EXISTING emit onto a bar-close trigger:**
- **Trigger on bar close, not on poll.** Add `subscribeSignalMonitorCellStream(cells, onDelta)` driven by the minute-aggregate hook (replace the empty `subscribeMutableStockMinuteAggregates(symbols, () => {})` callback). On each minute aggregate, for each admitted `(symbol,timeframe)` whose bucket just **closed** (`isCompletedBucket` / the 2m+ rollup path in `signal-monitor-local-bar-cache.ts`, NOT a per-TF `streamHistoricalBars`), run **`evaluateSignalMonitorSymbolFromCompletedBars` (4573)** over the trailing window — it computes the level *and* persists the event. Reuse its `shouldPersistSignalMonitorStateEvent` gate; **no in-memory cursor** — the DB `eventKey` + `onConflictDoNothing` is the durable cursor, so restarts/reconnects can re-run the window safely (idempotent).
- **Emit population = the bubble's population.** `signalEvents` only contains `filterState.passes && actionable` events (pyrus `index.ts:1216`, `filtered:false` hardcoded `:1237`). The bubble already derives from this same set via `selectStableSignalMonitorSignalEvent`. Emit exactly this population; "emit all / let client filter" is impossible and would diverge from the bubble.
- **Provisional = level hint only, never a persisted event.** Today's emit refuses partial bars; keep it. A live-edge update may push an optimistic *level* delta (`provisional:true`, not written to `/signal-monitor/events`); only the completed-bar path persists/emits a real event. Avoids phantom-signal flicker / retract deltas.
- **Delta payload.** `{ symbol, timeframe, kind:"event"|"level", eventType?, direction, price?, ts, barIndex?, provisional }` **plus** the recomputed level snapshot (`currentSignalDirection, currentSignalAt, barsSinceSignal, fresh, status`) so the bubble stays a **level** (latest stable event) and the UI meaning is unchanged.
- **Catch-up on reconnect/gap.** Re-evaluate the trailing window for requested cells through the same `4573` path; eventKey dedupe makes it a safe backfill (emits gap events once, no dupes). This is the snapshot step of snapshot-then-delta.
- **Two distinct sets.** The *monitored bar-subscription set* (data-line cost) stays governed by the existing admission/work-planner (`subscribeMarketDataLeaseChanges`, `primeSignalMonitorMatrixStockAggregateStream`) and reports `pending`/`warming`. The *compute trigger* fires only for admitted cells on bucket close — no 500-symbol timer scan.
- **SSE route.** Add `GET /api/streams/signal-monitor/matrix?environment=&cells=` mirroring `/streams/options/chains`: `startSse(...)` → `writeEvent("snapshot", <bootstrap + window catch-up>)` → `writeEvent("ready", ...)` → `return subscribeSignalMonitorCellStream(cells, d => writeEvent("delta", d))`. Heartbeat / backpressure (`SSE_MAX_BUFFERED_CHUNKS`, drain→`write_backpressure_timeout`) / `lastEventId` inherited from `startSse`; coalesce latest-per-cell. **Keep the POST `/signal-monitor/matrix`** for bootstrap/fallback.
- **Cost honesty (1m).** The core is a stateless full recompute over `PYRUS_SIGNALS_SIGNAL_WARMUP_BARS=1000` bars per cell per close. On 1m this fires every 60s for *every admitted cell* — which can **exceed** today's capped poll, so the efficiency win does **not** universally hold on 1m. Either ship Phase 3 for ≥5m first (keep 1m on the poll), or land incremental-indicator state (rolling SMA/ATR/ADX → O(1)) before enabling 1m. The win is unambiguous for 5m/15m/1h/1d.

**Client:**
- `subscribeSignalMatrixStream(cells)` opens one `EventSource` for the Phase-1 union; `snapshot` (replace) / `delta` (merge via `mergeSignalMatrixStates`) → `setSignalMatrixSnapshot`, then merge onto the breadth store per Phase 1.3 (activity-aware visible overlay, don't shrink) → all surfaces consistent and live. Keep cache for warm boot; the 15-min stale flip becomes irrelevant. Fall back to the Phase-1/2 poll if `EventSource` is unavailable/errors past retry. Ship behind a flag, run SSE alongside the poll, diff before cutting over.

Risks: per-cell subscriptions exploding line usage (bounded by the same admission cap); provisional level-hints must never persist an event; SSE fan-out memory (coalesce + buffer cap); reconnect storms (`retry:5000` + backoff); 1m recompute cost.

## Critical files
- Frontend: `features/platform/PlatformApp.jsx` (829-837 activity gate, 3651-3685 symbol union, 4445-4592 plan/mutation, 4637-4647 trigger, 4788-4804 store source), `features/platform/PlatformWatchlist.jsx` (313, 922-979, 1006-1035), `features/platform/signalMatrixScheduler.js`, `features/signals/signalMatrixSnapshotCache.js`, `features/signals/signalsRowModel.js`.
- Backend: `services/signal-monitor.ts` (229 caps, 2192/6761 symbol resolution, **4573 emit driver**, 4786 read-only level, 3840/3865/3800 event persistence+dedupe, 6225-6310 coverage, ~3107 empty callback), `services/signal-monitor-local-bar-cache.ts` (rollup/`isCompletedBucket`), `services/bridge-streams.ts` (357 createPollingStream, 906 subscribeOptionChains), `routes/platform.ts` (1132 startSse, 2595 options-chains SSE), `routes/signal-monitor.ts`.
- Indicator: `lib/pyrus-signals-core/src/index.ts` (955 `evaluatePyrusSignalsSignals`, 1216/1237 filter guard, 133 warmup).

## Sequencing
1. **Phase 1 first** — fixes consistency with pure client changes and converges onto one merged store (precondition for Phase 3). Ship 1.1–1.4 together.
2. **Phase 2** — small server reorder + `pendingCells`; prioritizes on-screen freshness and makes "warming" legible.
3. **Phase 3** — the delivery-model correction; "move the existing emit to a bar-close trigger + add an SSE route mirroring options-chains." Behind a flag with polling as startup/reconnect/fallback only; ≥5m first, 1m after the incremental optimization. Once stable it largely replaces normal signal polling.

## Verification
- **Phase 1:** mount watchlist + signals + algo; for a shared symbol, assert the bubble (direction/status/`barsSinceSignal`) is identical across surfaces **at the same snapshot revision**; unit test watchlist-row state === matrix-grid state for the same key using the activity-aware merge rule; toggle paper↔live → re-request, not blank; cold-load with >15-min cache → no all-stale flash; confirm `HeaderBroadcastScrollerStack`/`PortfolioPulseZone` still show universe breadth; confirm sparkline data loading remains separate from chart hydration.
- **Phase 2:** force pressure `high` (cap 8), request a 30-symbol visible union; assert visible symbols are **rotated first** (before off-screen, across cycles) and `coverage.pendingCells` lists the not-yet-warm; KPI = `status:"ok"` share for visible symbols rises (do **not** assert a `fresh:true` rate).
- **Phase 3:** open the SSE stream for a ≥5m cell set, force a bucket close → `delta` (event + level) within one bar period, no 500-symbol re-scan; **restart server mid-stream + re-run window → NO duplicate event** in `/signal-monitor/events` (eventKey dedupe); kill mid-stream → reconnect re-sends `snapshot` (with catch-up) then resumes `delta` honoring `lastEventId`, gap signal appears once; bubble still renders as a **level**; load-test fan-out; monitored bar-subscription count unchanged; **measure 1m compute** vs capped-poll baseline before enabling 1m emit.
- `cd artifacts/pyrus && pnpm typecheck` and `cd artifacts/api-server && pnpm typecheck` after each phase.

## Implementation Readiness Audit (2026-06-09)

This addendum is the current source/runtime audit before implementation. Treat it as the handoff contract for the first coding pass.

### Current runtime baseline

Read-only probes against the registered Replit app port (`127.0.0.1:18747`) on 2026-06-09:

- `GET /api/healthz` returned `{"status":"ok"}`.
- `GET /api/signal-monitor/profile?environment=paper` returned enabled paper profile, timeframe `5m`, `maxSymbols:500`, scope `all_watchlists_plus_universe`, `lastError:null`.
- `GET /api/signal-monitor/state?environment=paper` returned HTTP 200, `stateSource:"database"`, `cacheStatus:"miss"`, 3000 states: `stale:2912`, `ok:63`, `unavailable:25`, `fresh:true:5`. This is worse than the 2026-06-08 baseline in the diagnosis table; the systemic issue still exists.
- Valid exact matrix probe: `POST /api/signal-monitor/matrix` with `symbols:["SPY","NVDA","AAPL"]`, `timeframes:["2m","5m","15m"]`, `clientRole:"test"`, `requestOrigin:"test"` returned HTTP 200, 9 states, all `status:"stale"`, `coverage.requestedSymbols:3`, `coverage.hydratedSymbols:3`, `coverage.pendingSymbols:0`, `sourceStrategy:"native_timeframes_live_retry_exact_backfill"`.
- Important probe correction: `requestOrigin:"audit"` is invalid. The generated schema currently allows only `startup`, `poll`, `manual`, `test`.

### Hard implementation boundaries

1. **Do not collapse per-timeframe bubbles into `useSignalMonitorStateForSymbol`.** `signalMonitorStore.js:109-174` keeps `snapshot.states`, but the symbol subscriber map intentionally collapses to one preferred state per symbol. That store can keep supporting `TradeWorkspaceChrome` and `TradeEquityPanel`, but signal bubbles need a per-`symbol:timeframe` map.
2. **Frontend merge precedence must be explicit.** `signalsRowModel.js:215-225` and `signalMatrixScheduler.js:814-857` use recency. That is not the same as the server hydration rule. Add/route through one source-aware merge helper where matrix/current cells win for the same `symbol:timeframe` only when usable and at least as active; do not depend on raw timestamp ordering alone.
3. **Server stored-state hydration already has a similar guard.** `hydrateSignalMonitorMatrixStatesFromStoredStates` keeps current matrix state when it is usable and at least as active as stored state (`signal-monitor.ts:6137-6192`). The frontend needs the same deterministic rule.
4. **Watchlist cleanup has two separate source leaks.** Remove the broad snapshot fallback at `PlatformWatchlist.jsx:958-979` and the per-row `useSignalMonitorStateForSymbol(item.sym)` fallback at `PlatformWatchlist.jsx:313-349`. Rows should derive bubble/signal row display from the same merged matrix state passed through `signalStatesByTimeframe` / `signalsRow`.
5. **Broaden both the activity gate and the trigger.** Changing `signalMatrixRouteRequestActive` at `PlatformApp.jsx:829-837` is not enough. The trigger at `PlatformApp.jsx:4637-4647` currently keys only off `signalsScreenMatrixSymbols`; add a watchlist/visible-union trigger or watchlist still passively reads old data.
6. **Do not shrink breadth consumers.** `publishSignalMonitorSnapshot` at `PlatformApp.jsx:4788-4804` should receive the full state universe with visible matrix cells merged over it. Replacing it with `signalMatrixSnapshot.states` will blank off-screen symbols used by header tape, portfolio pulse, and trade frame consumers.
7. **Warm-start should not falsify cell state.** `signalMatrixSnapshotCache.js:113-151` currently flips `fresh:false` after the warm-start fresh window. Preserve the real cell value and expose stale cache status separately so UI can show warming/reconnecting without making every bubble look stale.
8. **Phase 2 is an API contract change.** `SignalMonitorMatrixResponse.coverage` in `lib/api-zod/src/generated/api.ts:4976-4994` has numeric `pendingSymbols` only. Adding `pendingCells[]` / `warming:true` requires generated schema/client updates and frontend compatibility with the old numeric contract.
9. **Phase 3 needs an SSE helper extraction first.** `startSse` is private inside `routes/platform.ts:1132-1282`. A signal-monitor SSE route in `routes/signal-monitor.ts` should not copy it; extract a shared route utility, then mirror the options-chain stream pattern.
10. **The bar-close hook exists but is currently discarded.** `primeSignalMonitorMatrixStockAggregateStream` subscribes with `subscribeMutableStockMinuteAggregates(normalizedSymbols, () => {})` at `signal-monitor.ts:3107`. That is the later Phase 3 hook; Phase 1/2 should not depend on it.

### First implementation slice

Ship Phase 1 as one client-side slice with tests:

1. Add a source-aware, activity-aware matrix merge helper and tests.
   - Acceptance: for the same `symbol:timeframe`, a usable matrix/current state wins only when its activity timestamp (`currentSignalAt`, `lastEvaluatedAt`, `latestBarAt`) is at least as active as the poll/store state; a fresher poll/store state wins; unrelated poll states remain.
   - Likely files: `features/platform/signalMatrixScheduler.js`, `features/platform/watchlistModel.js`, `features/signals/signalsRowModel.js`, existing tests.
2. Wire `PlatformWatchlist` to the merged matrix source only.
   - Acceptance: no watchlist bubble/signal row path reads `useSignalMonitorStateForSymbol`; environment mismatch triggers re-request/warming, not an empty state wipe; row price uses runtime quote/snapshot data only, not `currentSignalPrice`; `buildWatchlistRows` may still use broad `signalStates` only to discover monitored-only rows.
   - Likely files: `PlatformWatchlist.jsx`, `PlatformWatchlist.test.mjs` or a focused extracted row model test.
3. Request the visible union outside Signals/algo.
   - Acceptance: watchlist-visible symbols enter `prioritySymbols` and trigger `runSignalMatrixEvaluation` without requiring `screen === "signals" || "algo"`.
   - Likely files: `PlatformApp.jsx`, `signalMatrixScheduler.test.mjs`.
4. Merge visible matrix cells over the broad signal-monitor state snapshot.
   - Acceptance: `useSignalMonitorSnapshot().states` keeps universe breadth while shared visible cells match `signalMatrixSnapshot.states`; `useSignalMonitorStateForSymbol` remains a best-single-state legacy subscriber.
   - Likely files: `PlatformApp.jsx`, `signalMonitorStore.js` tests if helper moves there.
5. Fix warm-start presentation.
   - Acceptance: cached cells older than 15 minutes keep their recorded `fresh/status/direction`; cache status reports `warm-start-stale`; no all-stale flash on cold load.
   - Likely files: `signalMatrixSnapshotCache.js`, `signalMatrixSnapshotCache.test.mjs`.
6. Preserve sparkline/chart separation.
   - Acceptance: watchlist/signals/algo sparklines continue to load/render as sparkline workloads (`market-sparklines`, `/api/bars/batch` with `responseShape:"sparkline"`, or runtime aggregate cache) and are not grouped into ResearchChartSurface/chart hydration. Signal state may color sparklines, but chart hydration must not become a dependency for sparkline rendering.
   - Likely files: `PlatformWatchlist.jsx`, `SignalsScreen.jsx`, `MarketDataSubscriptionProvider.jsx`, existing sparkline tests.

Do not start Phase 2 until Phase 1 proves identical bubbles for the same `symbol:timeframe` across watchlist, signals, algo rows, and sidebar at the same snapshot revision.

### Regression checks to add before calling this fixed

- Unit: frontend source-aware merge precedence.
- Unit: watchlist row display uses matrix `signalStatesByTimeframe`, not the one-state monitor store.
- Unit: monitored-only watchlist rows are still created from broad monitor states while their display uses the matrix map.
- Unit: watchlist row price does not fall back to signal `currentSignalPrice`.
- Unit: warm-start stale cache preserves real cell status.
- Unit: sparkline hydration stays in sparkline-specific query/runtime paths, not chart hydration.
- Unit: backend `withSignalMonitorMatrixMetadata` keeps numeric `pendingSymbols` and adds bounded `pendingCells` only after schema generation.
- Runtime: state endpoint still has broad universe count; exact visible matrix request hydrates requested cells first; shared cell values are identical across surfaces; sparklines render even when chart surfaces are inactive.

## Review of the Implementation Readiness Audit (2026-06-09)

Peer review of the addendum above. The four new load-bearing claims were re-verified against source — **all confirmed**:

| Claim | Verdict | Evidence |
|---|---|---|
| #1 `useSignalMonitorStateForSymbol` collapses to one state per symbol | ✅ confirmed | `signalMonitorStore.js`: `normalizedStates[symbol] = selectPreferredSignalMonitorState(...)`; `symbolListeners` keyed by symbol — all timeframes fold into one preferred state. Watchlist per-`symbol:timeframe` bubbles cannot ride this store. |
| #3 server guard `hydrateSignalMonitorMatrixStatesFromStoredStates` exists | ✅ confirmed | `signal-monitor.ts:6137`, used at `:6453` — a proven "keep current matrix if at least as active" precedent. |
| #8 Phase 2 is an API codegen contract change | ✅ confirmed | `lib/api-zod/src/generated/api.ts:4976-4994` `coverage` has numeric `pendingSymbols`/`hydratedSymbols`/`missingSymbols` only — no `pendingCells[]`/`warming`. |
| #9 `startSse` is private | ✅ confirmed | `routes/platform.ts:1132` `async function startSse(` — not exported; used by 9 internal stream routes. Needs extraction for a signal-monitor route. |

**Verdict:** the addendum is accurate and improves the plan. It confirms the prior corrections and adds four real refinements (most valuably #1). The first-slice breakdown with acceptance criteria + named tests is the right starting scope. Endorsed as implementation-ready for Phase 1.

### Three additional refinements (not caught in the addendum)

1. **Phase 2 "warming" UI can ship client-only first — before any codegen, but only for known warmup errors.** A cell that is `status:"stale"` with a bar-warmth `lastError` ("not warm enough…", "No broker history bars…") is distinguishable client-side. Do not classify every `status:"stale"` cell as warming: exact matrix probes can return stale cells with `lastError:null`. Split it: (a) client-derived warming for known warmup errors now, (b) `pendingCells[]` after codegen.
2. **Verify the `priceValue` source when removing the `:313` read.** Line 313 also feeds `priceValue` via `signalState?.currentSignalPrice` (boundary #4). The replacement must NOT pull price from signal state — price should come from the market-data / quote runtime store. Confirm a clean price source so the row price doesn't regress; this is arguably a latent bug being fixed (a signal's last price ≠ the live mark).
3. **Make the merge precedence "matrix wins if ≥ as active," not blunt "matrix always wins."** Boundary #2 ("matrix wins") and #3 (mirror the server's "at least as active" guard) are in slight tension. Prefer #3: a genuinely *staler* matrix cell should not clobber a fresher poll value. Adopt `hydrateSignalMonitorMatrixStatesFromStoredStates`'s "keep current matrix when usable and at least as active as stored" as the **single merge helper's contract**, identical on every surface — that exact-same-rule-everywhere property is what guarantees identical bubbles (slice step 1's acceptance test should encode this rule, not a timestamp comparison).

> Related user-visible symptom (separate trace): the watchlist sidebar **sparkline color** is signal-driven — blue=buy / red=sell (`signalSparklineModel.js:8-13`) — with a price-trend green/red fallback (`MicroSparkline`, `primitives.jsx:157-160`) used when no signal hydrates. So a sidebar showing **green/red instead of blue/red** is a visible symptom of the same hydration gap (`buildSignalSparklinePointColors` returns null → falls back to price color). Phase 1 should restore blue/red signal coloring there.

## Final Plan Review Addendum (2026-06-09)

This is the plan-eng-review + focused DevEx review pass. The strict gstack interactive gate could not run in this Codex mode because `AskUserQuestion` is unavailable, so decisions below are recommendations grounded in source evidence rather than hidden auto-decisions.

### Scope challenge

No scope reduction recommended for Phase 1. The production code touched by the bug is already spread across `PlatformApp.jsx`, `PlatformWatchlist.jsx`, `signalMatrixScheduler.js`, `watchlistModel.js`, `signalsRowModel.js`, `signalMatrixSnapshotCache.js`, and tests. That is more than a tiny patch, but it is not scope creep: those are the existing creator, merger, reader, and cache paths for the same state.

Phase 3 remains deliberately out of the first implementation slice. It spends the new-infrastructure budget on one justified thing only: extracting `startSse` from `routes/platform.ts` before adding a signal-monitor stream. Do not copy/paste the SSE helper.

### Architecture decisions locked

1. **Single merge contract:** use one source-aware, activity-aware helper everywhere frontend signal cells are merged. Mirror the server rule at `hydrateSignalMonitorMatrixStatesFromStoredStates`: current/matrix state wins only when usable and at least as active. This resolves the earlier conflict between "matrix always wins" and "do not clobber fresher stored state."
2. **Per-timeframe state only for bubbles:** never drive symbol x timeframe bubbles from `useSignalMonitorStateForSymbol`, because that subscriber collapses all timeframes to one preferred symbol state.
3. **Signal price is not live price:** removing the row-level signal subscriber must also remove `signalState.currentSignalPrice` as a watchlist price fallback. Use runtime quote/snapshot data; if no quote exists, show the existing no-price state instead of a stale signal price.
4. **Visible matrix request is shell-wide:** watchlist/open-position/selected-symbol cells must make the matrix request active even when `screen` is not `signals` or `algo`. The trigger must key off the visible union, not only `signalsScreenMatrixSymbols`.
5. **Breadth store remains broad:** `publishSignalMonitorSnapshot` still receives the full state endpoint universe, with visible matrix cells merged over it. Do not replace it with the matrix request subset.
6. **Sparklines stay separate from charts:** signal hydration may color sparklines, but sparkline data loading remains in `market-sparklines`, `/api/bars/batch` with `responseShape:"sparkline"`, or runtime aggregate cache. Do not route these through ResearchChartSurface or chart hydration.

### Data-flow target

```text
GET /signal-monitor/state (broad universe)
        |
        v
  activity-aware merge  <---  POST /signal-monitor/matrix (visible cells)
        |
        +--> signalMonitorSnapshot.states stays broad
        |
        +--> per-timeframe matrix map
              |
              +--> Watchlist bubbles/signal sort/signal-colored sparkline
              +--> Signals table cells
              +--> Algo/STA rows
              +--> Algo monitor sidebar
```

### Test coverage target

```text
merge helper
  |-- matrix usable and >= active -> matrix wins
  |-- matrix older than poll/store -> poll/store wins
  |-- pending vs real state -> real state wins
  |-- unrelated universe states remain

watchlist
  |-- no useSignalMonitorStateForSymbol for bubble/sparkline status
  |-- price never falls back to currentSignalPrice
  |-- env mismatch shows warming/re-request, not EMPTY_SIGNAL_STATES
  |-- signal sort reads same per-timeframe map as rendered bubbles

PlatformApp
  |-- watchlist/open-position/selected-symbol visible union activates request
  |-- visible-union revision triggers runSignalMatrixEvaluation
  |-- broad store remains broad after matrix overlay

cache/sparkline
  |-- warm-start-stale preserves real fresh/status/direction
  |-- sparkline query/runtime paths stay separate from chart hydration
```

### Focused DevEx/API review

- Phase 1 has no API contract change. Keep it client-only and validate with targeted frontend tests plus `pnpm --filter @workspace/pyrus run typecheck`.
- Phase 2b changes generated API types. Required sequence: edit `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen`, then run `pnpm run audit:api-codegen`.
- Backend helper coverage should use `__signalMonitorInternalsForTests.withSignalMonitorMatrixMetadata` / related internals instead of endpoint-level tests for every branch.
- Any new SSE route in Phase 3 should document its event names (`snapshot`, `ready`, `delta`, `error`) and payload shape near the route/client helper, because it will not be obvious from generated REST clients.

### Not in scope for Phase 1

- Adding the SSE stream.
- Changing signal-event semantics.
- Enabling 1m event-driven recompute.
- Expanding the signal monitor's data-line footprint.
- Combining sparklines with full chart hydration.
- Removing the broad state endpoint or legacy one-state symbol subscriber.

### Final implementation order

1. Build and test the shared activity-aware merge helper.
2. Route `signalsRowModel` and `watchlistModel` through that helper/comparator.
3. Remove watchlist broad snapshot fallback and row-level `useSignalMonitorStateForSymbol`.
4. Remove signal-price fallback from watchlist row price.
5. Activate/trigger matrix requests from the visible shell union.
6. Merge visible matrix cells over broad `signalMonitorStateQuery` before publishing the store.
7. Preserve warm-start state values and expose stale cache status separately.
8. Add sparkline separation regression tests.
9. Run targeted frontend tests, then Pyrus typecheck.

## Autoplan Review Addendum (2026-06-09)

This is the full `/autoplan` pass over the finalized signal-bubble plan: CEO/scope, design/UX, engineering, and DevEx/API. The strict AskUserQuestion gates are unavailable in this Codex host, so decisions below use the `/autoplan` six principles directly and are recorded instead of hidden behind an interactive tool call. The outside Codex CLI voice was attempted in read-only mode and failed before file access because its sandbox wrapper errored with `bwrap: Unexpected capabilities but not setuid, old file caps config?`; this run is therefore source-grounded single-reviewer mode with that degradation recorded.

### Plan summary

The correct first move is still Phase 1 only: make every surface read the same per-`symbol:timeframe` merged matrix state, keep the broad state universe for breadth consumers, and prioritize visible cells outside Signals/algo. Phase 2/3 stay sequenced behind that because they change API contracts and stream architecture.

Confirmed intent refinement: Phase 1 must make contradictory bubbles impossible by design, not merely less likely. If a surface still has an alternate bubble truth source after implementation, Phase 1 is not done. The rest of the plan must then remove the server and delivery roots: Phase 2 defines honest server cell state, and Phase 3 makes bar-close push the normal signal update path rather than repeated `/bars` polling.

### CEO review - strategy and scope

Premises checked:

| Premise | Verdict | Reason |
|---|---|---|
| Inconsistency is as important as freshness | Accepted | User-visible trust breaks when the same symbol shows different bubbles on different surfaces, even if the server is merely stale. |
| Phase 1 should ship before SSE | Accepted | One merged client source is a precondition for any stream; pushing deltas into split readers would preserve the bug. |
| We should not expand data-line footprint | Accepted | The bug is state selection and prioritization, not a license to monitor more symbols. |
| Phase 3 "emit" means move existing persisted event logic | Accepted | Source confirms eventKey dedupe and persistence already exist; the missing piece is bar-close trigger + push. |

What already exists: matrix planning (`buildSignalMatrixSymbolSets`, `buildSignalMatrixRequestPlan`), pending-state generation, warm-start cache, broad monitor snapshot publication, event persistence/dedupe, and options-chain SSE precedent. Do not rebuild these.

Dream state delta:

```text
CURRENT: split readers + poll-first universe + surface-specific staleness
PHASE 1: one merged client source + visible cells requested everywhere
12-MONTH IDEAL: snapshot-then-delta signal matrix stream with bar-close compute and poll fallback
```

Implementation alternatives:

| Approach | Decision | Why |
|---|---|---|
| Patch only watchlist fallback | Rejected | It would hide one symptom while Signals/algo/store merge rules still diverge. |
| Phase 1 full client consistency slice | Accepted | Smallest complete fix in the blast radius; no API contract change. |
| Jump directly to SSE | Rejected for Phase 1 | Adds route/util extraction and bar-close compute before readers are unified. |

Not in scope for Phase 1: SSE stream, 1m event-driven recompute, signal-event semantics changes, API `pendingCells`, broader symbol admission, chart hydration changes, and removal of broad monitor state consumers.

### Design review - user-visible states

Design completeness moves from 6/10 to 8/10 with these locked rules:

| Pass | Finding | Decision |
|---|---|---|
| Information hierarchy | Bubbles must mean the same thing everywhere before freshness metrics are emphasized. | Bubble direction/status/age are the primary read; cache/transport state is secondary. |
| Interaction states | `stale`, `warming`, `reconnecting`, `no signal`, and `error` must not collapse into one warning. | Normal after-hours or market-closed conditions render neutral/warming state, not warning. Warning is reserved for true backend/error states. |
| User journey | A cold load with old cache should not flash every bubble as stale. | Preserve recorded cell state and show a small warming/reconnecting surface-level indicator. |
| Specificity | Sparkline and chart loading could be conflated during implementation. | Keep sparkline data paths separate from chart hydration; signal state may color sparklines only after hydration. |
| Accessibility/responsive | No new layout is planned, but state labels need deterministic semantics. | Tests should assert state classification, not visual copy alone. |

### Engineering review - architecture and tests

ASCII data path:

```text
broad state poll -----------------------+
                                        v
visible matrix request -----> activity-aware merge helper
                                        |
              +-------------------------+------------------+
              |                         |                  |
      broad snapshot store       per-timeframe map     warm cache
              |                         |                  |
   tape/pulse/trade panels     bubbles/sort/sparkline   cold load
```

Failure modes registry:

| Failure mode | Severity | Guard |
|---|---:|---|
| Visible matrix subset replaces broad universe and blanks tape/pulse consumers | High | Merge visible cells over broad poll, never replace breadth store. |
| `useSignalMonitorStateForSymbol` remains in row display and collapses timeframes | High | Remove display/sparkline status dependency; test the row model/render path. |
| Removing row hook also removes monitored-only rows | Medium | Preserve `buildWatchlistRows` broad-state discovery for monitored-only rows only. |
| Signal `currentSignalPrice` remains a quote fallback | Medium | Price comes from runtime quote/snapshot only; stale signal price is not live price. |
| Watchlist broadens activity gate but not trigger key | High | Add visible-union-trigger test in `PlatformApp`/scheduler. |
| Warm-start cache mutates all cells to `fresh:false` | Medium | Preserve cell fields; expose cache status separately. |
| Sparkline workloads get grouped with full chart hydration | Medium | Regression test `market-sparklines` / `responseShape:"sparkline"` / aggregate-cache paths. |

Test plan artifact is embedded here because this is a repo-local plan doc. Run the focused frontend unit tests covering `watchlistModel`, `signalsRowModel`, `signalMatrixScheduler`, `signalMatrixSnapshotCache`, and `PlatformWatchlist`, then `pnpm --filter @workspace/pyrus run typecheck`. Phase 2 additionally requires OpenAPI codegen and `pnpm run audit:api-codegen`; Phase 3 additionally requires API typecheck and stream tests.

### DevEx/API review

Phase 1 has good developer experience if it stays client-only and uses existing helper modules. The main DX risk is hidden contract drift in Phase 2: adding `warming` / `pendingCells[]` must start in `lib/api-spec/openapi.yaml`, regenerate clients with `pnpm --filter @workspace/api-spec run codegen`, then run `pnpm run audit:api-codegen`. For Phase 3, document SSE event names and payloads near the route/client helper because generated REST clients will not describe stream semantics.

### Decision audit trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 1 | CEO | Ship Phase 1 before Phase 2/3 | Mechanical | Complete smallest blast radius | Split readers must be unified before prioritization or push can work. | Direct SSE first |
| 2 | CEO | Keep broad monitor universe and overlay visible matrix cells | Mechanical | Completeness | Breadth consumers still need off-screen states. | Replace store with matrix subset |
| 3 | Design | Treat after-hours/market-closed as neutral/warming, not warning | Mechanical | Explicit over clever | Warning should mean a real problem, not normal session timing. | Reuse warning for all stale states |
| 4 | Design | Keep sparklines separate from chart hydration | Mechanical | DRY | Existing sparkline-specific paths already exist and are cheaper. | Group sparklines with charts |
| 5 | Eng | Preserve monitored-only row discovery from broad states | Mechanical | Complete blast radius | Removing all broad state usage would regress legitimate watchlist rows. | Delete broad `signalStates` from row construction |
| 6 | Eng | Remove `currentSignalPrice` as row price fallback | Mechanical | Explicit over clever | A signal price is not a live quote. | Keep stale fallback |
| 7 | Eng | Use one source-aware activity merge helper | Mechanical | DRY | Multiple recency rules are the current root of inconsistent bubbles. | Keep ad hoc comparators |
| 8 | DX | Defer API `pendingCells` until codegen sequence | Mechanical | Bias toward action | Phase 1 needs no API contract change. | Mix generated-contract work into Phase 1 |
| 9 | DX | Extract shared SSE helper before signal stream route | Mechanical | DRY | `startSse` is private and copied SSE logic would become hard to maintain. | Copy private platform route helper |

### Autoplan final gate

Status: **DONE_WITH_CONCERNS**. Cleared for Phase 1 implementation with the guardrails above. Not cleared for Phase 2 or Phase 3 implementation in the same slice.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Status | Findings |
|---|---|---|---|---|
| Autoplan | `/autoplan` | Full CEO, design, eng, and DX pass | DONE_WITH_CONCERNS | Phase 1 cleared; added monitored-only row guard, neutral after-hours/warming state rule, decision trail, and outside-voice degradation note. |
| CEO Review | `/plan-ceo-review` via `/autoplan` | Product/scope | DONE_WITH_CONCERNS | Phase 1 held as first slice; Phase 2/3 explicitly deferred; no scope expansion accepted. |
| Design Review | `/plan-design-review` via `/autoplan` | User-visible state semantics | DONE_WITH_CONCERNS | Warning must not represent normal after-hours/warming; sparkline/chart separation locked. |
| Eng Review | `/plan-eng-review` | Architecture, data flow, tests, performance | DONE_WITH_CONCERNS | Merge contract conflict resolved; missing price-source, shared-helper, visible-trigger, and sparkline-separation requirements added. |
| DX Review | `/plan-devex-review` | API/codegen/test friction | DONE_WITH_CONCERNS | Phase 2 codegen sequence and Phase 3 SSE documentation/testability requirements added. |

Exit criteria before implementation: Phase 1 is approved for implementation; no open product decision blocks the client-side consistency slice. Do not begin Phase 2/3 work until Phase 1 proves identical bubbles for the same `symbol:timeframe` across watchlist, signals, algo rows, and sidebar at the same snapshot revision.
