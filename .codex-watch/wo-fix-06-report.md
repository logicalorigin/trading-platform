# WO-FIX-06 Report

## Result

Stopped at the mandatory pre-check gate. I did not implement the display-path switch because source inspection found semantic gaps between the current full-state display snapshots and `listSignalOptionsStoredSignalStatesFast`.

## Pre-check Field Matrix

Observed display consumers:

- Cockpit SSE includes `cockpit` from `getAlgoDeploymentCockpit` in `fetchAlgoCockpitStreamPayload` (`artifacts/api-server/src/services/algo-cockpit-streams.ts:167-170`).
- Marketing shadow dashboard calls `getAlgoDeploymentCockpit` and passes through `cockpit.signals`, `cockpit.candidates`, `pipelineStages`, `attentionItems`, and related cockpit fields (`artifacts/api-server/src/services/marketing-shadow-dashboard.ts:554`, `:654-663`).
- `buildAlgoDeploymentCockpitPayload` renders `state.signals` directly and derives pipeline/diagnostics from `state.signals` (`artifacts/api-server/src/services/signal-options-automation.ts:13161-13184`, `:13252-13256`).
- Diagnostics render `signal.fresh` and `signal.status` counts (`artifacts/api-server/src/services/signal-options-automation.ts:11266-11272`, `:11351-11357`).

Snapshot field coverage:

| Snapshot field | Full display path source | Fast path coverage | Gate result |
|---|---|---|---|
| `profileId` | `state.profileId` in `buildSignalOptionsSignalSnapshot` | mapped from `row.profileId` | covered |
| `signalKey` | built from `profileId`, `symbol`, `timeframe`, `direction`, `signalAt` | same builder after mapped state; restored `signalAt` through event lookup | covered |
| `source` | event metadata `source`, fallback from `profileId` | same metadata lookup after mapped state | covered |
| `eventId` | event metadata | same metadata lookup | covered |
| `symbol` | normalized `state.symbol` | mapped from `row.symbol` | covered |
| `timeframe` | `state.timeframe` filtered to profile timeframe | mapped from profile `timeframe`; query filters same timeframe | covered |
| `direction` | `state.currentSignalDirection` | mapped from `row.currentSignalDirection`; query requires non-null | covered for current OK signals |
| `signalAt` | `state.currentSignalAt` / restored canonical event time through metadata path | maps `row.currentSignalAt`, then restores from event keys | covered |
| `signalPrice` | `state.currentSignalPrice` | mapped from `row.currentSignalPrice` | covered |
| `latestBarAt` | `state.latestBarAt` | mapped from `row.latestBarAt` | covered |
| `barsSinceSignal` | `state.barsSinceSignal` through `signalOptionsBarsSinceSignal` | mapped from `row.barsSinceSignal` | covered |
| `freshWindowBars` | signal-monitor profile `freshWindowBars` | same profile field | covered |
| `fresh` | full path uses `getSignalMonitorState` -> `stateToResponseForSnapshot` -> `stateToResponse`, which recomputes response freshness with `signalMonitorResponseFresh` from `status`, `direction`, `barsSinceSignal`, and profile window (`signal-monitor.ts:1215-1225`, `:1293-1302`) | fast path copies stored `row.fresh === true` into the mapped state (`signal-options-automation.ts:6012-6024`); existing signal-monitor latch code can set stored `fresh: false` while retaining a recent signal and bars age (`signal-monitor.ts:6762-6829`) | gap |
| `actionEligible` | derived by the shared snapshot builder from direction, signalAt, bars age, status, freshWindowBars, market/session gates | same builder after mapped state | covered for rows returned |
| `actionBlocker` | same shared actionability builder | same builder after mapped state | covered for rows returned |
| `status` | full path can include non-`ok` display snapshots after `getSignalMonitorState(... markNonCurrentStale: true)` relabels rows (`signal-monitor.ts:1315-1402`) | fast query pre-filters `status = "ok"` and `signalOptionsStoredStateCurrentForLane` drops non-current rows (`signal-options-automation.ts:5936-5943`, `:6025-6031`) | gap |
| `filterState` | event metadata filter state passed to the canonical snapshot builder; full path does not pass `state.filterState` there | same metadata lookup after mapped state | covered |
| `contractPreview` | added after snapshot creation for full view; summary sets `contractPreview: null` | same downstream preview/summary code if rows are returned | covered for rows returned |

## What / Why

The requested implementation would pass `preferStoredMonitorState: true` through the cockpit display path. That would reduce the read scope, but the mandatory equivalence pre-check fails:

1. `fresh` semantics differ. The full display path uses response freshness from `stateToResponse`, while the fast path preserves stored `row.fresh`. Source comments and code show stored `fresh` can be false for a latched signal even when bars age remains within the display freshness window.
2. `status`/blocked-signal visibility differs. The full path can return non-current/non-`ok` snapshots with display action blockers after stale relabeling. The fast path filters to `status = "ok"` and current rows before snapshot creation, so those display rows disappear rather than rendering as blocked/stale.

Because cockpit diagnostics and marketing payloads expose `signals`, signal freshness totals, and status counts, switching the read path would be a user-visible behavior change, not just a read-size reduction.

## Unified Diff Of Implementation HUNKS

No source or test hunks were applied. Implementation stopped at the required pre-check gate.

## Test Output

Not run. The mandatory pre-check failed before implementation/test edits, so there is no fix to verify.
