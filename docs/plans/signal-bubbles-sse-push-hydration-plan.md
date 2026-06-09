# Signal Bubbles SSE Push Hydration Plan

Generated: 2026-06-09
Status: planning document, implementation not started in this session
Scope: make Signal Matrix bubble state hydrate through a backend push path fed by Massive stock aggregate data, with REST matrix evaluation retained as bootstrap and stale-stream fallback.

## Overview

Signal bubbles currently converge through `signalMonitorPublishedStates`, but the matrix hydration loop is still primarily a frontend polling mutation to `POST /signal-monitor/matrix`. The backend already has a stock aggregate SSE source, Massive-first provider selection, stream-bar Signal Matrix evaluation helpers, and a warm matrix aggregate subscription, but the matrix aggregate subscription callback is currently a no-op. The remaining work is to turn aggregate events into evaluated `SignalMonitorSymbolState` deltas on the server, stream those deltas to the browser, and merge them into the existing bubble state path used by Signals, watchlist, header, STA, and algo surfaces.

## Goal

All user-visible Signal bubble surfaces hydrate from a pushed Signal Matrix state stream whose market-data input is Massive stock aggregate data when Massive is configured. REST matrix polling remains available for initial bootstrap, historical fallback, daily bars, and stream-stale recovery, but should not be the primary ongoing hydration mechanism while the Signal Matrix stream is fresh.

## Non-Goals

- Do not evaluate Signals client-side from raw minute aggregates.
- Do not remove `POST /signal-monitor/matrix` until the pushed path is proven and fallback semantics are explicit.
- Do not treat neutral hydrated dots as pending or missing; neutral states remain legitimate hydrated states.
- Do not change Replit startup configuration, `.replit`, artifact startup scripts, or environment variables.
- Do not broaden into unrelated IBKR/account/platform dirty workstreams.

## Observed Facts

- `GET /streams/stocks/aggregates` already exists and streams stock minute aggregates over SSE.
- `POST /streams/stocks/aggregates/sessions/{sessionId}/symbols` can update an open aggregate stream session.
- `stock-aggregate-stream.ts` prefers `massive-websocket`, then `massive-delayed-websocket`, then `ibkr-websocket-derived`.
- `signal-monitor.ts` already imports `getCurrentStockMinuteAggregates` and `getRecentStockMinuteAggregateHistory`.
- `signal-monitor.ts` already implements `evaluateSignalMonitorMatrixStateFromStreamBars`.
- `primeSignalMonitorMatrixStockAggregateStream()` currently primes local bars and subscribes to mutable stock aggregates, but the aggregate callback is `() => {}`.
- `PlatformApp.jsx` still drives ongoing matrix hydration through `evaluateSignalMonitorMatrix` mutation and merges responses into `signalMatrixSnapshot`.
- `PlatformApp.jsx` publishes bubbles through `signalMonitorPublishedStates`, merging broad monitor states with matrix snapshot states.
- The existing frontend aggregate stream store is useful for charts/sparklines, but Signal bubbles need evaluated `SignalMonitorSymbolState` objects, so the backend should remain the canonical evaluator.

## Architecture Decisions

- Add a server-side Signal Matrix SSE stream instead of pushing raw aggregates to bubble components.
- Use Massive aggregate data as the primary input when configured; emit source/degraded diagnostics when Massive is unavailable or delayed.
- Keep REST matrix evaluation as bootstrap/fallback and as the canonical generated contract for non-stream reads.
- Stream evaluated state deltas into the existing `mergeSignalMatrixStates` path so every bubble surface benefits without separate per-surface logic.
- Use exact/visible cell priority for stream scope. Background universe hydration should be capped, rotated, and pressure-aware.
- Treat `1d` cells as bootstrap/periodic fallback cells unless a daily-bar event source is introduced; minute aggregate push does not naturally close daily bars every minute.

## Dependency Graph

```text
Massive stock aggregate stream
  -> backend stream-bar Signal Matrix evaluator
      -> Signal Matrix state delta bus
          -> /signal-monitor/matrix/stream SSE route
              -> frontend Signal Matrix stream hook
                  -> PlatformApp signalMatrixSnapshot merge
                      -> signalMonitorPublishedStates
                          -> Signals table, watchlist dots, header pellets, STA/algo SignalDots
```

## Task List

### Phase 1: Backend Push Foundation

## Task 1: Define The Signal Matrix Stream Contract

**Description:** Add a concrete stream payload shape for Signal Matrix bootstrap, state delta, status, and error events. This contract should represent evaluated state, not raw aggregate bars.

**Acceptance criteria:**
- [ ] Stream payload includes `states`, `timeframes`, `coverage`, `source`, `delayed`, `evaluatedAt`, and stream freshness metadata.
- [ ] Payload supports exact cells and broader symbol/timeframe scopes.
- [ ] OpenAPI documents `GET /signal-monitor/matrix/stream` and any mutable session update route.
- [ ] Contract clearly distinguishes neutral hydrated state, pending state, stale state, and stream error.

**Verification:**
- [ ] `pnpm run audit:api-codegen`
- [ ] `pnpm --filter @workspace/api-zod exec tsc -p tsconfig.json --noEmit`
- [ ] `pnpm --filter @workspace/api-client-react run typecheck`

**Dependencies:** None

**Files likely touched:**
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/**`
- `lib/api-client-react/src/generated/api.schemas.ts`

**Estimated scope:** M

## Task 2: Build The Backend Signal Matrix Push Evaluator

**Description:** Replace the no-op aggregate callback in the Signal Matrix aggregate subscription with a batched evaluator that consumes stock aggregate events and emits changed `SignalMonitorSymbolState` objects.

**Acceptance criteria:**
- [ ] Aggregate event for one symbol evaluates only that symbol's in-scope matrix cells.
- [ ] Evaluation uses existing `evaluateSignalMonitorMatrixStateFromStreamBars`.
- [ ] Work is debounced/coalesced so rapid aggregate bursts do not evaluate every cell on every tick.
- [ ] Valid `ok` and `stale` states persist best-effort through the existing matrix persistence helper.
- [ ] Source diagnostics identify Massive realtime, Massive delayed, or fallback provider.

**Verification:**
- [ ] New API unit test with mocked aggregate messages proves one-symbol delta evaluation.
- [ ] Existing `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-completed-bars.test.ts` passes.
- [ ] `pnpm --filter @workspace/api-server run typecheck`

**Dependencies:** Task 1

**Files likely touched:**
- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-monitor-stream.test.ts`
- possibly `artifacts/api-server/src/services/stock-aggregate-stream.ts`

**Estimated scope:** M

## Task 3: Add The Signal Matrix SSE Route

**Description:** Add `GET /signal-monitor/matrix/stream` and, if needed, a mutable stream session route for updating symbols/cells without reconnecting. Mirror the existing stock aggregate stream session pattern where practical.

**Acceptance criteria:**
- [ ] Stream emits an initial bootstrap snapshot after connect.
- [ ] Stream emits `state-delta` events when pushed aggregate evaluation changes cells.
- [ ] Stream emits `stream-status` with provider, source, delayed flag, event count, last event age, active scope size, skipped/truncated counts, and fallback state.
- [ ] Client disconnect cleans up subscriptions and timers.
- [ ] Route returns a structured unavailable/degraded event or HTTP problem when no provider is configured, per existing stream conventions.

**Verification:**
- [ ] Route/helper test covers bootstrap, delta, and cleanup.
- [ ] Manual `curl -N` smoke against 2-3 symbols shows events.
- [ ] `pnpm --filter @workspace/api-server run typecheck`

**Dependencies:** Task 2

**Files likely touched:**
- `artifacts/api-server/src/routes/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-monitor.ts`
- `lib/api-spec/openapi.yaml`

**Estimated scope:** M

### Checkpoint: Backend Push

- [ ] API focused tests pass.
- [ ] API typecheck passes.
- [ ] Direct SSE probe streams evaluated matrix states for a small Massive-backed symbol set.
- [ ] REST matrix endpoint still works as before.

### Phase 2: Frontend Stream Consumption

## Task 4: Add A Frontend Signal Matrix Stream Hook

**Description:** Add a frontend hook that opens the Signal Matrix SSE stream and exposes pushed states plus stream freshness diagnostics.

**Acceptance criteria:**
- [ ] Hook handles `bootstrap`, `state-delta`, `stream-status`, `ready`, and error/reconnect behavior.
- [ ] Hook merges incoming states with existing `mergeSignalMatrixStates`.
- [ ] Hook never converts neutral hydrated states into pending states.
- [ ] Hook reports stale/unavailable stream state so REST fallback can resume.

**Verification:**
- [ ] Frontend unit test covers bootstrap merge, delta merge, stale stream fallback signal, and neutral state handling.
- [ ] `pnpm --filter @workspace/pyrus run typecheck`

**Dependencies:** Task 3

**Files likely touched:**
- `artifacts/pyrus/src/features/platform/live-streams.ts` or a new Signal Matrix stream module
- `artifacts/pyrus/src/features/platform/live-streams.test.mjs`
- possibly `artifacts/pyrus/src/features/signals/signalMatrixStateMerge.js`

**Estimated scope:** M

## Task 5: Make Push Primary And Polling Fallback

**Description:** Wire `PlatformApp` so pushed Signal Matrix state hydrates `signalMatrixSnapshot`, while existing REST polling backs off when the stream is fresh and resumes when the stream is stale or unavailable.

**Acceptance criteria:**
- [ ] Stream state updates `signalMatrixSnapshot.states` and therefore `signalMonitorPublishedStates`.
- [ ] `/signal-monitor/matrix` polling does not run as the primary ongoing hydration path while the stream is fresh.
- [ ] Polling resumes when the stream is stale, unavailable, or EventSource is unsupported.
- [ ] Exact visible cells remain prioritized during bootstrap and fallback.
- [ ] Existing pending-cell reconciliation is preserved for REST fallback responses.

**Verification:**
- [ ] Existing Signals scheduler and hydration tests pass.
- [ ] Add focused test/source assertion that pushed state wins over older polled state.
- [ ] `pnpm --filter @workspace/pyrus run typecheck`

**Dependencies:** Task 4

**Files likely touched:**
- `artifacts/pyrus/src/features/platform/PlatformApp.jsx`
- `artifacts/pyrus/src/features/platform/signalMatrixScheduler.test.mjs`
- `artifacts/pyrus/src/features/signals/signalsMatrixHydration.test.mjs`

**Estimated scope:** M

## Task 6: Prove Every Bubble Surface Uses The Pushed State

**Description:** Verify Signals table cells, watchlist dots, header interval pellets, STA rows, and algo/sidebar `SignalDots` read from the same pushed state merge path.

**Acceptance criteria:**
- [ ] A pushed `SYMBOL:timeframe` state updates every mounted bubble surface for that symbol/timeframe.
- [ ] No bubble surface reads only narrow `signalMatrixSnapshot.states` when broad published state is available.
- [ ] Neutral hydrated bubbles render as `data-direction="none"`, not pending.
- [ ] Pending bubbles only appear for explicitly materialized pending exact cells.

**Verification:**
- [ ] `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/PlatformWatchlist.test.mjs src/features/platform/PlatformAlgoMonitorSidebar.test.mjs src/features/signals/signalsRowModel.test.mjs`
- [ ] Safe browser DOM audit shows visible Signals rows all hydrated, pending dots `0`, and stream diagnostics present.

**Dependencies:** Task 5

**Files likely touched:**
- Mostly tests
- Potential small prop wiring in `PlatformApp.jsx`, `PlatformWatchlist.jsx`, `HeaderBroadcastScrollerStack.jsx`, `OperationsSignalRow.jsx`

**Estimated scope:** S-M

### Checkpoint: Frontend Push

- [ ] Pyrus focused tests pass.
- [ ] Pyrus typecheck passes.
- [ ] Safe browser QA with `?pyrusQa=safe` proves fallback/UI stability.
- [ ] Non-safe stream probe proves EventSource deltas reach `signalMonitorPublishedStates`.

### Phase 3: Pressure, Rollout, And Final QA

## Task 7: Add Pressure-Aware Stream Scope Controls

**Description:** Ensure stream evaluation cannot explode into uncontrolled 500x6 work under pressure. Visible and exact cells should hydrate first; broader background symbols should be capped and rotated.

**Acceptance criteria:**
- [ ] Stream scope honors visible/exact cell priority.
- [ ] Background symbols are capped by existing pressure settings or explicit new stream caps.
- [ ] Stream status reports skipped/truncated/pending counts.
- [ ] Server pressure can slow or disable background stream work without breaking visible bubbles.

**Verification:**
- [ ] API tests cover capped scope and pressure behavior.
- [ ] Browser QA with a large watchlist shows visible bubbles hydrate first.

**Dependencies:** Task 5

**Files likely touched:**
- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/pyrus/src/features/platform/signalMatrixScheduler.js`
- pressure/cap tests

**Estimated scope:** M

## Task 8: Final Validation And Handoff

**Description:** Run the focused test/typecheck/browser validation suite and update the active handoff with facts, inferences, unknowns, and any remaining rollout caveats.

**Acceptance criteria:**
- [ ] Focused API and Pyrus tests pass.
- [ ] Pyrus/API/api-client/api-zod typechecks pass.
- [ ] Safe browser QA shows all mounted bubble surfaces hydrated.
- [ ] Approved live/full-app probe confirms stream source is Massive when Massive is configured.
- [ ] Handoff records exact stream counts, bubble hydration counts, fallback state, and remaining unknowns.

**Verification:**
- [ ] `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-completed-bars.test.ts src/services/signal-monitor-stream.test.ts`
- [ ] `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/watchlistModel.test.mjs src/features/platform/signalMatrixScheduler.test.mjs src/features/signals/signalsMatrixHydration.test.mjs src/features/signals/signalsRowModel.test.mjs src/features/platform/PlatformWatchlist.test.mjs src/features/platform/live-streams.test.mjs`
- [ ] `pnpm --filter @workspace/pyrus run typecheck`
- [ ] `pnpm --filter @workspace/api-server run typecheck`
- [ ] `pnpm --filter @workspace/api-client-react run typecheck`
- [ ] `pnpm --filter @workspace/api-zod exec tsc -p tsconfig.json --noEmit`
- [ ] Safe browser QA with `?pyrusQa=safe`
- [ ] Live stream probe only with explicit user approval

**Dependencies:** Tasks 1-7

**Files likely touched:**
- Handoff files
- QA artifact files under `output/playwright/`

**Estimated scope:** S

## Risks And Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Stream evaluator overworks 500x6 cells | High | Start with exact/visible scope, debounce aggregate bursts, add caps before broad background hydration. |
| Massive unavailable or delayed | Medium | Emit provider/degraded diagnostics and keep REST/IBKR fallback behavior explicit. |
| Frontend double-hydrates through polling and stream | Medium | Make stream freshness a clear gate for polling fallback. |
| Neutral hydrated dots still look missing | Medium | Keep state fix separate from visual semantic decision; prove `data-direction="none"` separately from pending/missing. |
| Daily timeframe does not update from minute stream | Low-Med | Keep `1d` on bootstrap/periodic fallback unless daily event source is added. |
| Broad dirty worktree causes accidental unrelated edits | High | Keep implementation scoped to Signal Matrix stream files and tests; do not revert unrelated changes. |

## Open Questions

- Should "all signal bubbles" mean all mounted/user-visible surfaces, or the entire background universe continuously?
- Should the stream hard-require Massive, or remain Massive-preferred with explicit fallback provider diagnostics?
- Should `1d` cells be excluded from live aggregate push and refreshed only by bootstrap/fallback, or should a daily-bar push source be added later?
- Should neutral hydrated bubbles become visually stronger, or is this plan limited to transport/hydration correctness?

## Suggested Goal Prompt

Use this prompt to resume implementation:

```text
Please create a goal to implement docs/plans/signal-bubbles-sse-push-hydration-plan.md. Start with Tasks 1-3 only: define the Signal Matrix stream contract, build the backend aggregate-driven Signal Matrix push evaluator, and add the Signal Matrix SSE route. Work fact-first from AGENTS.md and the plan, do not edit Replit startup/config files, do not touch unrelated dirty workstreams, keep /signal-monitor/matrix as bootstrap/fallback, and validate with the focused API tests/typechecks listed in the plan before updating SESSION_HANDOFF_CURRENT.md.
```
