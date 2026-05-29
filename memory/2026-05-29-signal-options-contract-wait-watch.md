# Signal Options Contract Wait Watch - 2026-05-29

## Watch Window

- Sampler file: `/tmp/pyrus-algo-contract-watch-2026-05-29-1548.jsonl`
- Window: `2026-05-29T15:49:03.081Z` to `2026-05-29T15:54:03.080Z`
- Samples: 31
- Selected deployment: `Pyrus Signals Options Shadow Paper`
  (`7e2e4e6f-749f-4e65-a011-87d3559a23b0`)

## What Was Observed

- Current visible cockpit candidates were not blocked by `no_contract_for_strike_slot`.
- During the watch, `currentContractBlockedSamples` was 0.
- Recent successful entries prove contract resolution can work:
  - `SQQQ shadow CALL 37.5 2026-06-05 x10`, option-chain resolution ~10.7s.
  - `HOOD shadow CALL 89 2026-06-05 x3`, option-chain resolution ~12.5s.
  - `RBLX shadow CALL 46 2026-06-05 x7`, option-chain resolution ~18.8s.
  - `RTX shadow CALL 175 2026-06-05 x3`, option-chain resolution ~43.1s.
- The contract stage stayed in a waiting state because the current candidates had
  no selected contract event yet, not because an explicit contract miss was
  emitted.
- The app restarted during the watch. The newer process picked up the previous
  scanner-line patch; line usage briefly reached 72 scanner lines, confirming the
  scanner-line fix can admit scanner leases after restart.

## Current Blocking Pattern

The cockpit payload after the restart reported:

- `scan_universe` running in `action_scan`.
- `heavyWorkDeferred: true`.
- Detail: `fresh signals updated; action work deferred by resource pressure`.
- Resource pressure level: `watch`.
- `contract_selected`: waiting with 0 selected contracts.
- Two current mapped candidates were still waiting for action processing.
- Mark health showed 4 open shadow option positions:
  - 1 stale mark.
  - 3 unmarked positions.
  - 578 historical mark failures.

Diagnostics also showed:

- Automation worker scan duration reached ~143.5s.
- API diagnostics were critical for latency:
  - API p95 latency ~5.8s.
  - `/signal-monitor/matrix` p95 ~21.8s.
  - `/accounts/shadow/positions` p95 ~16.0s.
  - `/accounts/shadow/risk` p95 ~15.5s.
- IBKR itself was healthy and live.
- Final line usage: 26 active visible lines, 0 scanner lines, line drift
  `api_active_bridge_missing`.

## Root Cause Hypothesis

The user-facing "waiting on a contract" state is misleading. The system has
fresh mapped candidates, but the worker has not reached or completed contract
selection for them.

The worker is spending long periods in signal refresh and action work while open
position marks are stale/unavailable. The cockpit then renders the downstream
`contract_selected` stage as waiting because no contract-selection event exists
yet.

This is not currently an explicit `no_contract_for_strike_slot` failure for the
fresh candidates.

## Code Areas

- `artifacts/api-server/src/services/signal-options-automation.ts`
  - Worker scan/action flow processes signal refresh, position refresh, then
    signal candidates.
  - `buildCockpitPipeline` renders `contract_selected` as waiting whenever no
    selected contract exists, even if upstream scan/action work is still running
    or deferred.
  - The scan stage detail uses `heavyWorkDeferred` and reports resource pressure,
    but the observed `watch` pressure means the deferral may be action-budget or
    slow work rather than a hard pressure block.

## Recommended Fix

1. Update cockpit pipeline details so `contract_selected` does not imply a
   contract lookup failed while `scan_universe` is still running/deferred.
2. Add worker/action diagnostics that distinguish resource-pressure deferral from
   action-budget exhaustion.
3. Audit the action work ordering so stale position-mark refreshes cannot
   indefinitely starve fresh signal contract selection. If entries must remain
   halted while marks are degraded, emit an explicit `position_mark_feed_degraded`
   candidate skip instead of leaving candidates as bare `candidate` rows.

## Status

DONE_WITH_CONCERNS. The live cause was identified, but no code patch was applied
in this watch pass.
