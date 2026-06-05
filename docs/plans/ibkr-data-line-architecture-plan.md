# IBKR Data Line Architecture Plan

Status: planning reference, 2026-06-01

Coordination note: this file is intentionally documentation-only. The current worktree has overlapping in-flight changes in the IBKR bridge, admission, signal-options, line-usage, and UI settings areas, so runtime source changes should be coordinated before implementation.

## Problem Statement

The app is not limited by natural CPU or memory pressure in the observed failure mode. It is underusing available IBKR live market-data lines because contract discovery, quote subscription demand, scanner admission, and bridge subscription reconciliation are not organized around a single authoritative demand model.

The immediate symptom is that Signals to Actions can receive a fresh signal, but contract, quote, spread, and greeks columns remain empty or delayed. The broader symptom is that the flow scanner can report active work while IBKR option quote lines are idle or drifting between the API ledger and the Windows bridge.

## Observed Facts

- IBKR was connected and strict-ready during the diagnosis. The issue should not be treated as "IBKR disconnected" fallback behavior.
- STA rows such as `MSFT` and `AVAV` had `selectedContract=false`, `quote=false`, and `liquidity=false`.
- `signalOptions.activeLineCount=0` while STA needed option data. With no selected contract there is no provider contract id, so the bridge cannot open a live option quote line for that action.
- Signal-options requests were taking seconds, including an observed `7.735s` response, while active positions could have contracts but still show `hasQuote=false`.
- Related timeout events included `candidate_resolution_timeout` after `9000ms`, `worker_scan_timeout` after `120000ms`, and `position_mark_timeout` after `5000ms`.
- Flow scanner active/deep work can run with zero live line usage because it first performs expiration and option-chain metadata work. One observed state had `activeDeepScanCount=3`, `queuedDeepScanCount=3`, `admissionActiveLineCount=0`, `bridgeActiveLineCount=0`, and `idleButEligibleLineCount=200`.
- A later observed state had scanner symbols active and bridge active option subscriptions, but drift remained: API ledger `27`, bridge `51`, and `bridgeOnly=24`.
- Bridge lane latency was materially high in the failing path, including options metadata p95 around `15843ms`, historical p95 around `5926ms`, market subscriptions p95 around `5990ms`, and option quotes p95 around `8108ms`.
- Durable option-chain cache loading was failing on the `option_contracts` query, forcing too much contract metadata work into the hot path.
- Memory pressure labeling was misleading in at least one case: memory around 10 percent should not drive a "Pressure Watch" label.

Relevant code areas verified during diagnosis:

- `artifacts/api-server/src/services/platform.ts`: signal-options calls `batchOptionChains({ quoteHydration: "metadata" })` before it can select live candidate contracts, then calls live quote hydration.
- `artifacts/api-server/src/services/bridge-option-quote-stream.ts`: bridge quote snapshots admit market-data leases only after provider contract ids exist; retained snapshot demand can keep bridge subscriptions open after request completion.
- `artifacts/api-server/src/services/options-flow-scanner.ts`: scanner rotation runs batches via `requestScan`.
- `artifacts/api-server/src/services/platform.ts`: scanner defaults allow broad radar/concurrency, but the effective per-scan line budget can still resolve far below the bridge budget.

## Architecture Goals

1. Use available IBKR market-data lines continuously during regular trading hours unless an actual external limit, pacing error, or measured system bottleneck requires backing off.
2. Keep IBKR option live-line usage separate from Massive stock aggregate usage. Massive can help with broad stock data, but it does not solve option quote, spread, or greeks hydration.
3. Give STA and active/shadow positions deterministic priority. Once a signal is actionable, the algo area should not wait behind broad scanner work for line availability.
4. Replace arbitrary caps with dynamic control based on actual bridge budget, pacing errors, queue age, lane p95, event-loop/API health, and market session state.
5. Make API ledger and Windows bridge subscriptions converge quickly. Drift should be actionable state, not a passive diagnostic.
6. Make diagnostics precise: distinguish contract metadata discovery, planned demand, admitted API lines, bridge active lines, fresh quote events, and pressure drivers.

## Proposed Architecture

### 1. Central Live-Line Demand Controller

Introduce an API-side controller responsible for deciding the desired IBKR live subscription set. It can be a new `IbkrLiveLineDemandController` module or an equivalent boundary inside the existing admission/line-usage services, but it must be the single place that turns app needs into target live lines.

Inputs:

- STA candidate and automation demand.
- Active account and shadow account positions.
- Visible UI chart/watchlist demand.
- Flow scanner candidate horizon.
- Bridge diagnostics, line budget, pacing errors, queue age, and lane latency.
- API health signals such as event-loop delay and route p95.
- Market session state.

Outputs:

- Target option and equity live subscription set.
- Priority class per demand item.
- TTL/refresh policy per demand item.
- Reconciliation instructions for API-only and bridge-only drift.

Priority classes, highest first:

1. `execution` for order-priority and visible risk checks.
2. `signal-options` for STA contract, quote, spread, greeks, and liquidity work.
3. `shadow-account` for shadow positions and derived position marks.
4. `visible` for user-visible charts and tables.
5. `flow-scanner` for broad discovery and ranking.

The controller should target `bridgeBudget - hardReserve`, not a fixed low cap. `hardReserve` should cover execution-priority and visible emergency headroom. Signal-options should also have a minimum reserve, described below.

### 2. Dedicated STA Priority Lane

STA should have a protected demand lane so that fresh signals do not wait behind scanner metadata or broad flow scans.

Policy:

- Reserve 15 option lines for signal-options and active position marks, or `min(15, availableLines)` when fewer lines are available.
- If STA already has provider contract ids, live quote demand should preempt flow scanner demand immediately.
- If STA does not have provider contract ids, enqueue a high-priority contract-discovery task instead of waiting for broad scanner rotation.
- Active/shadow position marks share this lane because stale marks directly affect decision quality.

Expected result: after a fresh signal, STA either gets `selectedContract`, quote, spread, and greeks within the SLO, or displays an explicit no-contract/no-market-data reason.

### 3. Split Contract Metadata From Quote-Line Hydration

The current failure mode mixes slow option-chain metadata work with live quote subscription work. That makes "quotes warming" ambiguous and can leave live lines idle while metadata selection is still happening.

Required changes:

- Fix the durable option-chain cache query against `option_contracts` first. Contract metadata should be cached and warm for common radar/STA symbols.
- Represent contract discovery and live quote hydration as separate states.
- Let flow scanner precompute candidate contract sets for the current radar/horizon, so line fill does not wait on metadata every cycle.
- For STA, make contract discovery a high-priority job with its own timeout and reason code.

UI language should use "metadata selecting contracts" until provider contract ids exist. "Quotes warming" should only appear when provider contract ids exist and live subscriptions are pending or awaiting fresh ticks.

### 4. Flow Scanner Target-Fill Redesign

Flow scanner should fill remaining capacity after higher-priority demand is satisfied. It should not own the line budget, and it should not leave lines idle simply because it is busy doing metadata work.

Policy:

- Use the controller's remaining budget after `execution`, `signal-options`, `shadow-account`, and `visible` demand.
- Maintain a persistent rotating pool of option quote subscriptions with TTL/refresh, rather than request-scoped bursts.
- Keep candidate contracts ready from the metadata pipeline.
- Scale scanner width dynamically from actual conditions, not static UI or server caps.

When the bridge budget is 200 and higher-priority demand is light, the scanner should be allowed to use most of the remaining lines. A healthy system should not sit at 1, 2, 50, or any other arbitrary low active count unless there is a real limiting signal.

### 5. Bridge Subscription Reconciliation

Retained API demand and actual bridge subscriptions need a reconcile loop with explicit ownership.

Required behavior:

- API-active but bridge-missing lines are reopened or marked with a concrete bridge rejection/pacing reason.
- Bridge-active but API-released lines are cancelled after a short grace period unless another retained demand owns them.
- Drift diagnostics include owner class, age, desired state, bridge state, and last transition.
- Persistent drift is surfaced as a bug condition, not normal pressure.

Acceptance target: API ledger and bridge active subscriptions converge within the configured grace window.

### 6. Dynamic Limits Instead Of Arbitrary Caps

The app should start from the actual bridge market-data budget, then adapt.

Control inputs:

- Bridge-advertised market-data line budget.
- Current active bridge subscriptions by owner class.
- IBKR pacing/capacity errors.
- Bridge queue age and lane p95.
- API route p95 and event-loop delay.
- Memory pressure, but only when actual memory thresholds are crossed.
- Market session state and whether live data is expected.

Control policy:

- Default target active lines: `bridgeBudget - hardReserve`.
- STA reserve: 15 option lines unless actual available budget is lower.
- Flow scanner budget: all remaining non-reserved capacity.
- Reduce target only for measured constraints, then recover automatically when constraints clear.
- Remove or override UI caps such as concurrency `2` when they conflict with the controller's dynamic target.

Pressure labels must name the real driver. A "memory pressure watch" state should not appear when memory usage is normal.

### 7. Provider And Shadow Account Accounting

Shadow accounts and provider fallback need to be visible in the same demand model.

Required behavior:

- Shadow positions count as first-class `shadow-account` demand.
- Diagnostics show provider source separately from desired IBKR live demand.
- Massive stock aggregate fallback remains separate from IBKR option live lines.
- If a shadow position is using fallback/cached data, the UI should still show whether IBKR live quote demand is desired, active, rejected, or waiting on contract metadata.

## Implementation Phases

### Phase 0: Coordination And Guardrails

- Keep this architecture change separate from the live IBKR order-submission rollout.
- Do not modify Replit startup, helper launch, or desktop bridge upgrade flow as part of this work.
- Add read-only diagnostics and tests first where possible.
- Coordinate before editing files already touched by in-flight work, especially bridge stream, market-data admission, line usage, signal-options automation, and platform services.

### Phase 1: Contract Cache And Observability

- Fix the durable option-chain cache query failure against `option_contracts`.
- Add a regression test for loading cached option-chain contracts by underlying.
- Add explicit diagnostics for contract metadata state versus quote subscription state.
- Add route/log fields for candidate discovery duration, selected contract count, provider contract id count, and live quote hydration duration.

### Phase 2: Demand Controller Interface

- Define the demand item contract, priority classes, TTLs, and target subscription output.
- Add diagnostics that show planned demand before behavior changes.
- Reuse existing admission and bridge-stream primitives where possible.
- Preserve existing owner labels so current diagnostics continue to map to the new controller.

### Phase 3: STA Priority Demand

- Route STA selected contracts and active/shadow position marks through the priority lane.
- Enqueue high-priority contract discovery when a fresh signal lacks a selected contract.
- Preempt flow-scanner demand when STA has provider contract ids and needs fresh quote/spread/greeks.
- Add tests that prove signal-options demand gets admitted ahead of flow scanner demand.

### Phase 4: Flow Scanner Persistent Target Fill

- Change scanner quote use from request-scoped bursts to a persistent rotating pool.
- Fill remaining line capacity after reserves.
- Keep scanner metadata work from blocking live-line fill for already-known candidate contracts.
- Add health checks that flag active scanner work with zero line demand when eligible cached candidates exist.

### Phase 5: Bridge Reconciliation And Adaptive Control

- Add API-ledger versus bridge-active reconciliation.
- Cancel bridge-only subscriptions after grace unless re-owned.
- Reopen API-active bridge-missing subscriptions unless the bridge reports an actionable rejection.
- Make target line count adapt to measured bridge/API health and recover when clear.

### Phase 6: UI And Settings Cleanup

- Replace misleading "quotes warming" states when the system is still selecting metadata.
- Show planned, admitted, bridge-active, and fresh-event counts separately.
- Replace static concurrency caps in the flow popover/settings with controller-owned target policy.
- Ensure pressure labels show the actual pressure source and not normal memory usage.

## Acceptance Criteria

- With IBKR connected during regular trading hours, active bridge option subscriptions approach the controller target within 30 to 60 seconds once scanner candidates exist.
- The system does not remain below 50 active option lines unless diagnostics show a real bridge, IBKR pacing, market-session, or API-health constraint.
- A fresh STA signal receives selected contract, quote, spread, and greeks within 10 seconds, or shows an explicit no-contract/no-data reason.
- Active and shadow account positions receive fresh marks within their SLO and do not silently fall back to stale data.
- API-ledger and bridge-active subscription drift converges within the configured grace window.
- "Quotes warming" appears only when provider contract ids exist and live subscriptions are pending or awaiting fresh quote events.
- Memory pressure labels are not shown when memory usage is normal.
- Massive fallback usage is visible but never counted as IBKR option live-line usage.

## Test Plan

- Unit tests for demand priority ordering and reserve behavior.
- Unit tests for market-data admission when STA and scanner compete for lines.
- Unit tests for bridge retained-demand reconciliation and bridge-only cancellation.
- Regression test for option-chain durable cache loading from `option_contracts`.
- Integration smoke test against diagnostics endpoints with IBKR connected: verify planned, admitted, bridge-active, and drift counts.
- Browser QA for the flow popover and STA table labels using `?pyrusQa=safe`.

## Non-Goals

- Do not add or change live order submission in this architecture slice. That remains covered by `docs/plans/live-ibkr-signal-options-rollout.md`.
- Do not change Replit app startup, launcher sequence, or helper upgrade behavior.
- Do not remove Massive or stock aggregate fallback paths.
- Do not hide pressure states; make them accurate and driver-specific.
