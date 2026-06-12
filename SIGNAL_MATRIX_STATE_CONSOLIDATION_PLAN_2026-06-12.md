# Implementation Plan: Signal Matrix State Consolidation

- Created: 2026-06-12

## Progress

- [x] Task 0 — landed `66e4b5c` (in-flight regression slice, scoped to signal-matrix files; other slices' dirty files left untouched)
- [x] Task 1 — already complete inside the landed slice (all three producers gap-aware; tests existed)
- [x] Task 2 — landed `44d2a00` (identity-ranked preserve rule; latch recompute was already in the slice)
- [x] Task 3 — landed `44d2a00` (signal-monitor-actionability module; single fresh author; shared max-age constant)
- [x] Task 4 — landed `e540bff` (stale keeps identity in eval+persist; wire-side latch per SSE subscriber; actionEligible/actionBlocker on deltas + stored bootstrap and in the delta signature). DEVIATION: REST/openapi fields deferred — openapi.yaml and generated clients carry other slices' uncommitted changes; adding fields now would force a mixed-slice commit. Do the spec addition when those slices land (or fold into Task 12).
- [x] CHECKPOINT 1 — verified live post-rebuild (2026-06-12): `/state` in 0.18s with `stateSource: database`; 1,534/1,574 stale rows retain direction on the wire; SSE bootstrap carries `actionEligible`/`actionBlocker` (SPY/NVDA probe). User approved proceeding.
- [x] Task 5 — landed `1fe6990`. User-approved apply ran 2026-06-12: counts were already 0/0/0 — the fixed live producers (running since the rebuild) had self-healed the backlog (dry-run 119/475/0 measured ~20 min earlier). Live verify: 0 impossible rows across 3,000 states; 1,633/1,673 stale rows retain direction. Boot-pass reconciliation guards future drift.
- [x] Task 6 — landed `282100c`. STA trusts backend `actionEligible`/`actionBlocker` when present (pinned by test); local age inference kept as fallback ONLY for REST-sourced cells (REST spec fields still deferred — delete fallback + `STA_MAX_ACTIONABLE_BARS_SINCE_SIGNAL` in task 12 when the spec lands). Verified live: SSE bootstrap and deltas carry the fields.
- [x] Task 7 — landed `282100c`. Snapshot cache v2; v1 discarded + legacy key cleanup; warm-start states persist as action-ineligible (never replay prior-session eligibility).
- [x] CHECKPOINT 2 — frontend suites 90/90 + pyrus typecheck clean; additive phase, no display change.
- [x] Tasks 8-9 — landed `a19b3d4`. Merge collapsed to one ranking rule (identity > activity > rank > equivalence/object-reuse); deleted the frontend latch-merge, barsSinceSignal recompute, stale→ok rewrite, and the entire event→matrix-cell overlay. Display rule moved to `signalStateFreshness.js`: latched direction shows for status ok|stale. REST-fill safety: REST rows carry DB-latched identity since task 4, and the identity-first ranking means a directionless copy can never displace a directional cell anyway.
- [x] Task 10 — landed `a19b3d4`. Store prefers backend `actionEligible` over the old `fresh` heuristic; degraded-retention now tested.
- [x] Task 11 — verified ALREADY SATISFIED by the landed slice (`66e4b5c`): SignalsScreen runs platform-managed (`signalMonitorDataManagedByPlatform`, own REST queries disabled) and receives `signalMonitorPublishedStates` (PlatformApp:4668); one REST fetch total. Its `matrixHydrationPlan`/`SignalsHydrationStrip` are display-only coverage indicators (allowed); `/api/bars/batch` usage is sparkline-family only. The local re-merge inside `buildSignalsRows` is idempotent over the same inputs/preference function — no divergence path.
- [~] Task 12 — grep proofs pass (no bar-age arithmetic, no status rewrites, remaining `fresh:` writes are event-derived display objects/placeholders/args only); no orphaned exports. DEFERRED until other slices' openapi changes land: REST spec `actionEligible`/`actionBlocker` fields + codegen, deletion of the STA inference fallback (`STA_MAX_ACTIONABLE_BARS_SINCE_SIGNAL`, `staSignalAgeActionBlocker` in algoHelpers.js), and `fresh` wire deprecation.
- [~] CHECKPOINT 3 — suites: frontend 103/103, backend 58/58 + signal-options 15/15, both typechecks clean. Live API verified earlier (stale identity retained, actionability on SSE, 0 impossible rows). PENDING: browser QA of Signals/STA/watchlist (`?pyrusQa=safe`) — frontend changes are live via Vite dev; verify bubbles show latched stale signals, no table jumping, STA matches backend blockers.
- Scope: head of the data trace — ticker bars → signal evaluation → signal matrix state → Signals page/table → STA action rows. Options-selection internals are out of scope except where they consume matrix actionability.
- Companion evidence: `SESSION_HANDOFF_LIVE_2026-06-12_signal-matrix-state-regression.md` (in-flight slice this plan builds on).

## Context

One "signal state" object currently answers three different questions — *what did the latest evaluation find*, *what was the last real signal (latched memory)*, and *is it safe to act on* — and every layer rewrites its fields to mean what that layer needs:

- The backend latches direction in the DB (`applyStoredSignalDirectionLatch`, `signal-monitor.ts:3979`) but **erases it in transport**: stale cells null `direction`/`barsSinceSignal` (`signal-monitor.ts:4855-4860`) and directionless re-evals emit `direction: null`.
- The frontend compensates: its own latch (`preferSignalMatrixCellState`, commit `e507395`), a `stale→ok` status rewrite (`storedSignalMatrixStateForDisplay`, commit `8db5372`), three `fresh: false` overrides, and a duplicated `barsSinceSignal` recompute (`signalMatrixStateMerge.js:74-96` mirrors `signal-monitor.ts:4960-4979`).
- The backend mops its own spill with a 5-minute SQL seed job (`seedSignalMonitorDirectionsFromLatestEvents`, `signal-monitor.ts:6556`).
- `fresh` has ~9 authoring sites with 3 semantics; `actionEligible`/`actionBlocker` are computed independently in `signal-options-automation.ts:2200-2266` and `algoHelpers.js:595-705` (same threshold constant defined twice).
- `SignalsScreen.jsx` builds rows from its own REST queries while sidebars read the merged published store — the page and its bubbles can disagree for up to a poll interval.

Runtime evidence (handoff, observed 2026-06-12): 2,454/2,572 directional intraday DB rows undercount elapsed bars by >1 bar; 301 rows lag their canonical event; "1 bar / 38m" impossible cells reproduced.

**Outcome wanted:** backend is the sole author of signal-state semantics; the transported state always carries the latched signal; actionability is computed in exactly one place; the frontend becomes display-only with one trivial merge rule; the Signals page reads the same store as everything else.

## Architecture Decisions

1. **Field split, additive first.** Existing field names keep flowing during migration. New semantics:
   - `currentSignalDirection/At/Price` = latched signal memory — never nulled by staleness in any transport.
   - `status` = data-pipeline health only (`ok | stale | pending | error | unavailable`) — no longer implies anything about the signal fields.
   - `actionEligible: boolean` + `actionBlocker: string | null` = NEW, backend-computed in one function, emitted on SSE matrix states and REST state responses.
   - `barsSinceSignal` = always derived at emit time via the gap-aware helper; never copied stale from storage.
   - `fresh` = kept emitting as a deprecated alias (`actionEligible`-equivalent) until all consumers are migrated, then removed.
2. **One authoring function.** `buildSignalMonitorActionability({ state, profile, now })` in `signal-monitor.ts` (or a small shared module) owns the `freshWindowBars` rule and the max-actionable-bars rule. Every producer (JS eval, Python eval, SSE bootstrap, SSE delta, REST mapping, latch upsert) calls it. `signal-options-automation.ts` imports the same helper/constant for execution gating.
3. **Frontend trusts the wire.** After backend lands: delete the frontend latch, the recompute, the rewrites. Merge collapses to "newest `lastEvaluatedAt` wins per symbol:timeframe cell" because latching now happens before transport.
4. **Repair persisted state once, then delete the crutch.** Reconcile `signal_monitor_symbol_states` against canonical events (including non-null stale identity), then retire the 5-minute direction-seed job.
5. **In-flight work is the base.** The current dirty tree (runtime-fallback exclusion, `stateSource` plumbing, merge-churn fixes, removed UI pull-hydration callbacks) is prerequisite work, validated and landed first — not reverted.

## Task List

### Phase 0: Stabilize the base

**Task 0: Validate and land the in-flight regression slice (dirty working tree)**
- Description: The uncommitted changes implement runtime-fallback exclusion, `stateSource` on state/evaluate responses, merge churn reduction, and SSE-snapshot-as-base in `PlatformApp`. Land them as their own commit so this plan starts from a clean, attributable baseline.
- Acceptance criteria:
  - [ ] All focused suites in the handoff pass (commands in Verification below).
  - [ ] `pnpm --filter @workspace/pyrus typecheck` and `pnpm --filter @workspace/api-server typecheck` pass.
  - [ ] User approves the commit (working tree contains prior-session work; do not commit without explicit go-ahead).
- Dependencies: none. **Estimated scope: S** (validation + commit, no new code).

### Phase 1: Backend — single authoring of state semantics

**Task 1: Gap-aware `barsSinceSignal` in every producer**
- Description: `evaluateSignalMonitorSymbolFromCompletedBars` still counts bars by array index (`chartBars.length - 1 - signal.barIndex`), which undercounts on sparse/gappy feeds — the direct cause of "1 bar / 38 minutes" cells. Route every producer through `signalMonitorBarsSinceSignal(...)` (`signal-monitor.ts:4960`), including the Python path's max-merge.
- Acceptance criteria:
  - [ ] No producer computes bar age by array index.
  - [ ] New backend test: sparse 5m bars (e.g., 3 bars over 40 minutes) yields elapsed-time bar age, not index count.
  - [ ] 1d timeframe behavior unchanged (no intraday synthesis).
- Verification: `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-completed-bars.test.ts src/services/signal-monitor-stream.test.ts`
- Dependencies: Task 0. Files: `signal-monitor.ts`, `signal-monitor-completed-bars.test.ts`. **Scope: S**

**Task 2: Latch preserves identity only; preserve-ordering fix**
- Description: `applyStoredSignalDirectionLatch` (`:3979`) must keep signal identity (direction/at/price) but **recompute** derived fields (`barsSinceSignal`, `fresh`/actionability) from the advancing `latestBarAt` instead of carrying stale values. Fix `shouldPreserveExistingSignalMonitorSymbolState` so a row with a newer *real signal* cannot lose to a row with merely newer bar metadata (currently ordered by `max(currentSignalAt, latestBarAt)`).
- Acceptance criteria:
  - [ ] Latched no-signal re-eval: identity unchanged, `barsSinceSignal` advances with `latestBarAt`.
  - [ ] Incoming newer signal identity always replaces older identity regardless of bar metadata recency.
  - [ ] Tests cover: latch holds, opposite signal flips, derived fields recomputed.
- Verification: same backend suites as Task 1.
- Dependencies: Task 1. Files: `signal-monitor.ts` + tests. **Scope: S**

**Task 3: Single actionability author**
- Description: Add `buildSignalMonitorActionability({ direction, signalAt, barsSinceSignal, dataStatus, profile })` returning `{ actionEligible, actionBlocker, fresh }`. It owns the `freshWindowBars` rule (`:5105`, `:5398` collapse into it) and the max-actionable-bars rule (today `=1`, defined in `signal-options-automation.ts:226` and `algoHelpers.js:595`). All backend eval/mapping paths call it; `signal-options-automation.ts` imports it (or its constants) for `buildSignalOptionsSignalSnapshot` — delete the duplicate constant there.
- Acceptance criteria:
  - [ ] `rg "freshWindowBars"` shows exactly one comparison site authoring `fresh`.
  - [ ] `rg "MAX_ACTIONABLE_BARS_SINCE_SIGNAL"` shows one backend definition; signal-options imports it.
  - [ ] Existing signal-options behavior unchanged (its tests pass).
- Verification: backend suites + `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-options-automation.test.ts`
- Dependencies: Task 2. Files: `signal-monitor.ts`, `signal-options-automation.ts` + tests. **Scope: M**

**Task 4: Transport stops erasing the latch; emit actionability on the wire**
- Description: Remove the stale-nulling of `direction`/`barsSinceSignal` in eval/response paths (`:4855-4860`) and the `fresh:false`/null forcing in `stateToResponse`/`stateToResponseForSnapshot` (`:985-986, :1026-1027`). `status` alone reports staleness. Add `actionEligible`/`actionBlocker` to `SignalMonitorMatrixStreamState` (`:151`), SSE bootstrap/delta payloads, and the REST state response. Update `lib/api-spec/openapi.yaml` + regenerate `lib/api-zod` / `lib/api-client-react` (additive). Include the new fields in the delta signature (`:5838-5852`) so eligibility flips emit deltas.
- Acceptance criteria:
  - [ ] A stale cell on the wire keeps its latched direction/identity with `status: "stale"`, `actionEligible: false`, `actionBlocker: "data_stale"` (or similar).
  - [ ] Crossing the fresh window emits a state-delta (eligibility change is signature-visible).
  - [ ] `pnpm run audit:api-codegen` passes (no codegen drift).
  - [ ] Backend tests pin: no transport path ever nulls a latched direction.
- Verification: backend suites; `pnpm run audit:api-codegen`; live probe `curl '/api/signal-monitor/state?environment=paper'` → directional stale rows retain direction; SSE probe per handoff.
- Dependencies: Task 3. Files: `signal-monitor.ts`, `routes/signal-monitor.ts`, `lib/api-spec/openapi.yaml`, generated clients, tests. **Scope: M**

### Checkpoint 1 — Backend authoritative (after Tasks 1-4)
- [ ] All api-server signal-monitor + signal-options suites pass; `pnpm --filter @workspace/api-server typecheck` passes.
- [ ] Live probe: zero "impossible rows" by the elapsed-time-vs-`barsSinceSignal` check (the handoff's parser found 0 post-restart; must stay 0 with new semantics).
- [ ] Frontend still renders correctly with additive fields ignored (no FE change yet).
- [ ] Review with user before Phase 2 (trading-adjacent semantics now live on the wire).

### Phase 2: Persisted-state repair, then remove the crutch

**Task 5: Reconcile stored symbol states against canonical events; retire the seed job**
- Description: One-time (startup or script) reconciliation per `profile_id + symbol + timeframe`: if the stored row's signal identity lags the latest `signal_monitor_events` row (the 301-row class), adopt the event identity; recompute `barsSinceSignal` gap-aware; explicit 1d policy (no synthesis). Then delete `seedSignalMonitorDirectionsFromLatestEvents` (`:6556`) — subsumed because transport no longer erases and reconciliation repairs history.
- Acceptance criteria:
  - [ ] Post-reconciliation DB check: 0 rows where identity lags latest canonical event; 0 intraday rows undercounting elapsed bars by >1.
  - [ ] Seed-job code and its 5-minute timer removed; no references remain.
- Verification: targeted SQL checks from the handoff (CEG/ADCT classes); backend suites.
- Dependencies: Task 4. Files: `signal-monitor.ts`, possibly `scripts/`. **Scope: M**

### Phase 3: Frontend consumes backend truth (additive — no deletions yet)

**Task 6: STA and matrix consumers read `actionEligible`/`actionBlocker` from the wire**
- Description: Thread the new fields through `live-streams.ts` types and `PlatformApp` state. `buildStaSignalMatrixRows` (`algoHelpers.js:658-741`) uses backend `actionEligible`/`actionBlocker` when present (it already prefers explicit fields at `:698-705`); delete `STA_MAX_ACTIONABLE_BARS_SINCE_SIGNAL` and `staSignalAgeActionBlocker` once all states carry the fields.
- Acceptance criteria:
  - [ ] STA action gating comes from backend fields; no frontend age threshold remains.
  - [ ] `pnpm --filter @workspace/pyrus exec tsx --test src/screens/algo/algoHelpers.test.mjs src/screens/algo/OperationsSignalTable.test.mjs` passes with updated fixtures.
- Dependencies: Task 4 (wire fields exist). Files: `live-streams.ts`, `algoHelpers.js`, algo tests. **Scope: M**

**Task 7: Version the local matrix snapshot cache**
- Description: `signalMatrixSnapshotCache.js` persists v1 snapshots carrying old-semantics `barsSinceSignal`/`fresh`. Bump cache version so stale-semantics snapshots are discarded on first load after deploy.
- Acceptance criteria:
  - [ ] Old v1 cache entries are ignored/cleared; new entries carry the new fields.
- Verification: `pnpm --filter @workspace/pyrus exec tsx --test src/features/signals/signalMatrixSnapshotCache.test.mjs`
- Dependencies: Task 6. Files: `signalMatrixSnapshotCache.js` + test. **Scope: XS**

### Checkpoint 2 — Dual-running (after Tasks 6-7)
- [ ] STA rows' eligibility matches backend exactly (spot-check live: blocked rows show backend `actionBlocker`).
- [ ] Signals table + watchlist bubbles unchanged visually (additive phase must not alter display).
- [ ] All pyrus focused suites + typecheck pass.

### Phase 4: Delete the frontend compensations

**Task 8: Collapse the merge — delete frontend latch and recompute**
- Description: In `signalMatrixStateMerge.js`: delete `mergeDirectionalStateWithMetadata` (incl. `fresh:false` at `:162`), the latch branch in `preferSignalMatrixCellState` (`:211-221`), and `signalMatrixBarsSinceSignal` (`:74-96`). New rule: per cell, newest `lastEvaluatedAt` wins; equal → keep current object (preserves the churn fix). Rewrite `signalMatrixStateMerge.test.mjs` to pin the new contract (latch behavior is now asserted by backend tests instead — port the latch test *scenarios* to `signal-monitor` tests if not already covered by Task 2).
- Acceptance criteria:
  - [ ] No `barsSinceSignal` arithmetic anywhere in pyrus (`rg "timeframeMs|elapsedMs" src/features/signals` clean).
  - [ ] A directionless newer update no longer needs frontend latching — test proves backend state carries direction through.
- Verification: `pnpm --filter @workspace/pyrus exec tsx --test src/features/signals/signalMatrixStateMerge.test.mjs src/features/platform/signalMatrixScheduler.test.mjs`
- Dependencies: Tasks 4, 6, 7. Files: `signalMatrixStateMerge.js`, tests. **Scope: M**

**Task 9: Delete display rewrites and event-overlay state reconstruction**
- Description: Remove `storedSignalMatrixStateForDisplay` (`stale→ok` rewrite, `:259-280`) — display rule becomes: show latched direction whenever present; gray/age styling keys off `status` + `barsSinceSignal` directly. Shrink `signalMonitorEventToMatrixState`/`mergeSignalEventsIntoMatrixStates` (`:282-393`): events feed history rows only, never synthesize matrix cells (backend reconciliation in Task 5 made event-overlay hydration redundant). Keep `displayHydrationSource` only if diagnostics still read it.
- Acceptance criteria:
  - [ ] Frontend never writes `status`, `fresh`, `actionEligible`, or `barsSinceSignal` — `rg "fresh: false|status: \"ok\"" src/features/signals src/features/platform` clean (excluding tests).
  - [ ] Watchlist signal bubbles still show aged latched signals (UX preserved — verify against `PlatformWatchlist.test.mjs`).
- Verification: pyrus suites incl. `PlatformWatchlist.test.mjs`, `signalsRowModel.test.mjs`, `SignalsScreen.state-contract.test.mjs`.
- Dependencies: Task 8. Files: `signalMatrixStateMerge.js`, `watchlistModel.js`, tests. **Scope: M**

**Task 10: Simplify the store preference rules**
- Description: `selectPreferredSignalMonitorState` (`signalMonitorStore.js:30-52`): keep timeframe preference; replace the `fresh`-boolean preference with backend `actionEligible` (or drop it — newest activity suffices once semantics are clean). Keep the degraded-snapshot retention (`:113-125`) — it guards real stream backpressure, not state semantics.
- Acceptance criteria:
  - [ ] Store never inspects `fresh` once deprecated; degraded retention behavior unchanged (add a test — currently untested).
- Verification: `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/signalMonitorStore.test.mjs`
- Dependencies: Task 9. Files: `signalMonitorStore.js` + test. **Scope: S**

### Phase 5: One source of truth for the page

**Task 11: SignalsScreen reads the shared published states**
- Description: `SignalsScreen.jsx:3411-3416` builds rows from its own REST queries (`stateResponse`); switch row input to the same published matrix states the sidebars use (`signalMonitorPublishedStates` via the store/props), with REST kept only as bootstrap fill inside the existing PlatformApp merge. Remove remaining UI pull-hydration producers surfaced in the handoff (`priorityHydrationSymbols` / `matrixHydrationPlan` as fetch drivers; display-only coverage indicators may stay).
- Acceptance criteria:
  - [ ] Signals page rows and watchlist/STA bubbles derive from the same state array — no path where they can diverge for a poll interval.
  - [ ] No `/api/bars/batch` `signal-matrix` hydration triggered from the Signals screen while the matrix SSE is live.
  - [ ] `SignalsScreen.state-contract.test.mjs` updated to pin the single-source contract.
- Verification: pyrus suites; manual: open Signals page + watchlist, confirm same direction/age per symbol.
- Dependencies: Tasks 8-10. Files: `SignalsScreen.jsx`, `signalsRowModel.js`, `signalsMatrixHydration.js`, `PlatformApp.jsx`, tests. **Scope: L → execute as two commits if needed (row-source swap, then hydration removal)**

**Task 12: Deprecation sweep**
- Description: Once Tasks 6-11 are stable in use: remove `fresh` from frontend reads, mark it deprecated in the OpenAPI spec (keep emitting one more release), and delete any now-orphaned helpers/tests created only for the old semantics (orphans from THIS work only, per repo rules).
- Acceptance criteria:
  - [ ] `rg "\.fresh" artifacts/pyrus/src` → only deprecated-shim/test references or none.
  - [ ] `pnpm run deadcode` shows no new orphans from this work.
- Dependencies: Tasks 6-11. **Scope: S**

### Checkpoint 3 — Complete
- [ ] Full focused suite matrix (Verification below) green; both typechecks green; `pnpm run audit:api-codegen` green.
- [ ] Live QA (`?pyrusQa=safe`): no impossible cells, no table jumping at the ~60s mark, signals persist through directionless re-evals on 1m/2m.
- [ ] STA eligibility matches backend on a live sample.

## Verification (command reference)

Backend:
- `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-completed-bars.test.ts src/services/signal-monitor-stream.test.ts src/services/signal-monitor-diagnostics.test.ts`
- `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-options-automation.test.ts`
- `pnpm --filter @workspace/api-server typecheck`

Frontend:
- `pnpm --filter @workspace/pyrus exec tsx --test src/features/signals/signalMatrixStateMerge.test.mjs src/features/platform/signalMatrixScheduler.test.mjs`
- `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/PlatformWatchlist.test.mjs src/features/signals/signalsRowModel.test.mjs src/screens/SignalsScreen.state-contract.test.mjs`
- `pnpm --filter @workspace/pyrus exec tsx --test src/screens/algo/OperationsSignalTable.test.mjs src/screens/algo/algoHelpers.test.mjs`
- `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/signalMonitorStore.test.mjs src/features/signals/signalMatrixSnapshotCache.test.mjs`
- `pnpm --filter @workspace/pyrus typecheck`

Contract/runtime:
- `pnpm run audit:api-codegen`
- `curl '/api/signal-monitor/state?environment=paper'` — directional stale rows retain direction; `stateSource: "database"`
- SSE probe: `/api/signal-monitor/matrix/stream?...` bootstrap carries directional states with actionability fields
- Impossible-row parser check (elapsed-time vs `barsSinceSignal`) → must be 0

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Actionability semantics shift changes STA gating → options automation behavior | High | Phase boundaries: backend emits new fields additively (Checkpoint 1 user review) before any consumer switches; Task 6 swaps consumption only when values verified equal to old frontend derivation on live data |
| Stale cells now keep direction on the wire — a consumer may have relied on null-when-stale to hide signals | Med | Audit consumers of `currentSignalDirection` in Task 4 (`rg` across pyrus + api-server); preserve hide-behavior via `status` checks where intended |
| Old client / new server (or vice versa) during deploy | Med | All wire changes additive until Task 12; `fresh` keeps emitting; codegen audit gates drift |
| Local snapshot cache replays old-semantics state after deploy | Med | Task 7 cache version bump lands with/before Task 8 deletions |
| DB reconciliation (Task 5) rewrites trading-adjacent rows | Med | Dry-run mode first: log would-change rows; user reviews counts before write |
| In-flight dirty tree conflicts | Med | Task 0 lands it first; this plan's diffs build on it |
| `/signal-monitor/state` latency (p95 ~30-46s observed under pressure) makes live verification flaky | Low | Verify via SSE + DB checks when REST is slow; latency itself is a separate workstream |

## Open Questions (need user input before the affected task)

1. **Task 0:** OK to commit the in-flight regression slice as-is once its suites pass, or do you want to review that diff first?
2. **Task 4 naming:** new wire fields `actionEligible`/`actionBlocker` on matrix states match the existing STA field names — any preference to namespace them (e.g. `execution.*`) instead?
3. **Task 5:** run the persisted-state reconciliation as a one-time script you trigger, or automatically at API startup?
4. **Display policy (Task 9):** confirm latched signals should keep showing indefinitely (aged styling) until an opposite signal — that's current UX; the alternative is hiding after N bars.

## Parallelization

- Sequential spine: Task 0 → 1 → 2 → 3 → 4 → (5, 6, 7 parallel) → 8 → 9 → 10 → 11 → 12.
- Tasks 5, 6, 7 are independent of each other once Task 4 lands.
- Do not parallelize Phase 4 deletions with anything — each leaves the merge layer in a transitional state.
