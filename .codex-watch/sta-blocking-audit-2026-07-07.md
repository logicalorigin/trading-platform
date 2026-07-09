# STA blocking-reason audit — 2026-07-07

Auditor: read-only source + read-only SQL + read-only live probes. Nothing was edited except this report.
Live context at audit time: 2026-07-07 ~19:11Z (Tue 15:11 ET, **regular US market hours open**). API pressure **high** (ELU 100%, DB pool 12/12 + 8–10 waiting, dominant-route p95 13037 ms, 1 long automation scan) — observed from `.pyrus-runtime/flight-recorder/api-current.json`.

Legend: **observed** = from command/source/SQL/live output; **inferred** = connected from evidence; **unverified** = not confirmed.

---

## 0. TL;DR — answer to "which blocking reasons should not be there"

1. **VESTIGIAL (the clear one): the "Gateway" / broker-readiness block.** The whole operations screen carries a permanently-active "Gateway" halt + an attention warning *"Broker account readiness is blocking scans … Start or repair the IBKR account/order bridge"* + cockpit `scanDisabledReason`/`enableDisabledReason` = *"IBKR Client Portal is not configured for live broker order execution."* This fires **unconditionally** because `getAlgoGatewayReadiness()` returns `ready:false` / `ibkr_not_configured` — the **retired IBKR datapath** — and it is applied even to the **shadow** deployment, which never touches a broker gateway. It cannot be turned off (renders `FORCED`). This is bridge-era copy that commit `6862f759` ("retire bridge-era copy from attention warnings") did **not** fully remove.

2. **STALE-under-pressure (transient): "Action deferred" + pinned per-row reasons.** Under the current sustained high pressure the automation scan defers heavy work (`skipActionWork`→`heavyWorkDeferred`). While deferred: (a) every fresh signal shell renders **"Action deferred"** (`contractSelectionStatus:"deferred"`), and (b) previously-emitted per-row reasons (e.g. `mtf_not_aligned`) are **not refreshed** and get **pinned** by the candidate merge, so a row can show an old skip reason that no longer reflects the live matrix. Latches until one clean (non-deferred) scan cycle runs.

3. **NOT the culprit (suspicions refuted):**
   - The **freshness "STALE"/"Aged" label is recomputed correctly** for display (bar-window semantics) — it does **not** read the automation-owned stored `fresh` column. So even though 3116/3118 stored rows are `fresh=false`, the STA display re-derives fresh from bar age and shows FRESH correctly. (This was the prime stale-state suspect; refuted.)
   - The **route cache** (`f2b8286f`) only serves `/signal-monitor/state` + `/breadth-history`; the STA path (`/signal-options/state`, `/cockpit`) does not flow through it.
   - `ibkr_bridge_required` (diagnostics.ts) is a diagnostics-event code, **not** a per-row STA reason.

---

## 1. What the STA table is, and every blocking-reason source

**Surface.** The STA ("Signal-options Table / operations") view:
- Table rows: `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx` (`ln`) → per-row `OperationsSignalRow.jsx`. Rows are built **one per signal**: `OperationsSignalTable.jsx:1477` `sourceRows = (signals||[]).map(signal => { candidate = findSignalOptionsCandidateForSignal(candidates, signal); … })`.
- Screen-level gating (same operations screen): GateLadder (`GateLadder.jsx`), HaltStrip (`HaltStrip.jsx`), attention strip (`OperationsAttentionStrip.jsx`), KPI strip (`OperationsKpiStrip.jsx`).

**Data source.** `AlgoScreen.jsx`:
- `signalOptionsStateQuery = useGetSignalOptionsAutomationState(deploymentId)` → GET `/api/algo/deployments/:id/signal-options/state` (`routes/automation.ts:291`).
- `cockpitQuery = useGetAlgoDeploymentCockpit(...)` → GET `/api/algo/deployments/:id/cockpit` (`routes/automation.ts:307`).
- Merged client-side by `resolveStableStaActionSnapshot` (`algoHelpers.js:524`) → `signalOptionsCandidates`, `signalOptionsSignals`. `signalMatrixStates` (full matrix) supplies per-symbol timeframe dots only.
- Server env is fixed: `CANONICAL_SIGNAL_ENVIRONMENT = "shadow"` (`signal-monitor.ts:560`), so the STA reads the **shadow/5m** signal-monitor profile (fresh_window_bars = 8). (SQL-observed: two profiles exist — `live/15m fw=3`, `shadow/5m fw=8`.)

### Reason → UI → API field → server computation → state source

| Reason (as displayed) | UI file:line | API/response field | Server compute (file:line) | Underlying state |
|---|---|---|---|---|
| Freshness `FRESH`/`STALE`; `Aged` pill | `algoHelpers.js:1279` `signalFreshnessLabel`; `OperationsSignalRow.jsx:913` | `signal.fresh` | **recomputed** `signalMonitorResponseFresh` → `signalMonitorFresh` (`signal-monitor.ts:1207,1286`; `signal-monitor-actionability.ts:42`) | bar-window age of `barsSinceSignal` vs `freshWindowBars`; **not** stored `fresh` col |
| `No Signal` / `Market Closed` / `Data Stale` / `Market Idle` / `Signal Too Old` | `algoHelpers.js:1325` `signalActionBlockerLabel`; `1259` `isMarketIdleSignalRecord` | `signal.actionBlocker` | **recomputed** `buildSignalMonitorActionability` (`signal-monitor-actionability.ts:54`; `signal-monitor.ts:1246`) | `barsSinceSignal`, `status`, `isSignalMonitorQuietMarketSessionNow()` |
| Gate/blocker: `Mtf Not Aligned`, `Missing Bid Ask`, `Premium Budget Too Small`, `No Expiration In Dte Window`, `Same Direction Position Open`, `Inverse Put Blocked`, `Option Expiration Backoff`, `After Hours Option Entry Blocked`, `Candidate Resolution Failed`, … | `algoHelpers.js:1320` `candidateBlockerLabel`; `2085` `resolveCandidateGateDisplay`; row `OperationsSignalRow.jsx:546,839` | `candidate.reason` (+`contractSelectionReason`) | `evaluateSignalOptionsEntryGate` (`signal-options-automation.ts:5191`), liquidity/risk/contract gates (various `reason:` emits `signal-options-automation.ts:3904…15045`); persisted as `emitSkippedCandidate` events + `signal_options_seen_signals` | signal_options events + `signal_options_seen_signals` (durable); merged onto live shells by `mergeSignalOptionsCandidate` (`:6299`) |
| `Action deferred` / stage "Deferred" | `OperationsSignalRow.jsx:530,855` | `candidate.contractSelectionStatus="deferred"` | `signalOptionsCandidateShellContractSelectionStatus` (`:5499`) → scan/worker `heavyWorkDeferred`/`lastHeavyWorkDeferred` | in-memory scan-state + worker-state (pressure) |
| `Blocked` / `skipped` stage; `Mismatch`/`Event only` sync | `OperationsSignalRow.jsx:546,558,2119` | `candidate.actionStatus`/`status`/`syncStatus` | dashboard candidate builder (durable) | signal_options events / shadow ledger |
| Screen-level **"Gateway"** halt / "Broker account readiness is blocking scans" / `scanDisabledReason` | `algoHelpers.js:3835,3941` `deriveSignalOptionsHaltControlStatus`; attention item id `gateway-readiness` | `cockpit.readiness.{ready,message,scanDisabledReason}`, `attentionItems[]` | `buildAlgoDeploymentCockpitPayload` (`:12415`), `buildCockpitAttention` (`:9906`), `resolveAlgoGatewayReadiness` (`algo-gateway.ts:38`) | IBKR gateway readiness signals (retired) |
| Screen-level `Daily loss halt`, `Trading allowance exhausted`, `Resource load` | `algoHelpers.js:3942,3945`; attention `:9937,9950` | `risk.*`, `kpis.*`, pressure | `buildCockpitAttention` | risk ledger / pressure |

---

## 2. Verdict per reason

### 2a. Freshness label (`FRESH`/`STALE`/`Aged`) — **CORRECT (display), suspicion refuted**
- **Observed.** `stateToResponse` recomputes the response `fresh` from **bar-window** age: `signal-monitor.ts:1286` `fresh: signalMonitorResponseFresh({status, direction, barsSinceSignal, freshWindowBars})`. Comment `:1284-1285`: *"Stored fresh = arrival/trigger semantics for automation; response fresh = bar-window display semantics for REST/SSE UI surfaces."* The STA path reaches this: `listSignalOptionsSignalSnapshots` default branch → `getSignalMonitorState` → `stateToResponseForSnapshot` (`markNonCurrentStale:true`, `:12600/13600`) → `stateToResponse`. In `buildSignalOptionsSignalSnapshot` (`:2510`) `input.state.fresh` is therefore the **already-recomputed** value, not the raw column.
- **Observed SQL (the trap avoided).** Raw stored `signal_monitor_symbol_states.fresh` is `false` on **3116 of 3118** shadow/5m `status=ok` directional rows (99.9%). Two same-bar rows disagree in the raw column: `GLD bars=0 fresh=true` vs `LHX bars=0 fresh=false`. The raw column is decoupled/false-negative by design (commit `3e6e000b`; regression test asserts a row with stored `fresh:false, bars:2, fw:3, status:ok` yields display `fresh:true`).
- **Consequence.** For the 3 currently-in-window shadow rows (`GLD` sell bars0, `LHX` sell bars0, `DELL` buy bars5), display recomputes all three to **FRESH / actionable** — the raw false-negative does **not** reach the STA freshness label.
- **Caveat (inferred).** Display `barsSinceSignal`/`latestBarAt` are the last-evaluated stored values (not advanced to wall-clock); a lane that stops refreshing is caught by `markNonCurrentStale`/`isSignalMonitorStateCurrentForLane` and relabeled `idle/stale` (`fresh:false`, `market_idle`/`data_stale`, `signal-monitor.ts:1339-1388`). That relabel is correct, but it depends on the currency check firing under pressure.

### 2b. `actionBlocker` (No Signal / Market Closed / Data Stale / Market Idle / Signal Too Old) — **CORRECT**
- **Observed.** Recomputed every read in `buildSignalMonitorActionability` (`signal-monitor-actionability.ts:54-79`): `no_signal` (no direction/signalAt), `market_closed` (`isSignalMonitorQuietMarketSessionNow`), `data_stale`/`market_idle` (status≠ok, `signalMonitorActionBlockerForStatus`), `signal_age_unavailable` (bars null), `signal_too_old` (bars > 8 = `SIGNAL_MONITOR_MAX_ACTIONABLE_BARS_SINCE_SIGNAL`).
- Market is open now, so `market_closed`/`market_idle` should not fire on current lanes (**observed** ET 15:11). No staleness found in this path.

### 2c. Per-row gate reasons — `mtf_not_aligned` etc. — **CORRECT logic, but STALE-pinnable under pressure**
- **Observed.** `mtf_not_aligned` is a live confluence gate: `evaluateSignalOptionsEntryGate` (`:5230-5236`) fires when MTF enabled + all required frames present + `mtfMatches < requiredMtfCount`, evaluated against the **live** per-timeframe matrix directions (`selectSignalOptionsMtfFramesFromMatrix`). Not vestigial. `after_hours_option_entry_blocked` (`:14811`) is a live options-RTH gate keyed to the selected contract's session — also correct.
- **Observed SQL.** `signal_options_seen_signals`: 275 rows, dominated by `mtf_not_aligned` (**244/275 = 89%**), then `after_hours_option_entry_blocked` (11), `no_expiration_in_dte_window` (9), `same_direction_position_open` (5), `missing_bid_ask` (2), `candidate_resolution_failed`/`premium_budget_too_small`/`inverse_put_blocked`/`option_expiration_backoff` (1 each). All 3 current in-window symbols (`GLD/DELL/LHX`) have a durable `mtf_not_aligned` row.
- **STALE mechanism (observed in code).** `mergeSignalOptionsCandidate` (`:6309-6316`): for a merged `status="skipped"` candidate, `reason = durable.reason ?? shell.reason` — the **durable skip reason wins** over the fresh shell's `reason:null`. So a signal that is currently fresh+actionable can still render `Mtf Not Aligned` from a prior scan. It only refreshes when the worker runs a **non-deferred** action scan (see 2e). Under sustained pressure that refresh stalls → the pinned reason goes stale.
- **Restart-drift signal (observed SQL).** Many seen-signals rows have `occurred_at` = 2026-07-06 06:2x (yesterday) but `created_at` = 2026-07-07 18:xx (today) — i.e. day-old events recorded as "seen" today, consistent with the durable store being repopulated from stale events after an API restart. This is the seen-signals vs in-memory drift (suspect #4): the durable `signal_options_seen_signals` survives restarts and can carry reasons authored against a prior session's matrix.

### 2d. Screen-level "Gateway" / broker-readiness block — **VESTIGIAL (primary "should-not-be-there")**
- **Observed live.** `GET /api/readiness` → `brokerTradingReadiness: {status:"blocked", ready:false, reason:"broker_not_configured", checks.configured:false}`.
- **Observed source.** `resolveAlgoGatewayReadiness` (`algo-gateway.ts:38-53`) returns `ready:false, reason:"ibkr_not_configured", message:"IBKR Client Portal is not configured for live broker order execution."` when the (retired) IBKR portal is unconfigured. This is the **first** branch, so it wins over `market_session_quiet`.
- **Surfaced three ways (observed):**
  1. Cockpit `readiness.scanDisabledReason` / `enableDisabledReason` = the IBKR message (`signal-options-automation.ts:12419-12420`, `= readiness.ready ? null : readiness.message`).
  2. Attention strip warning (`buildCockpitAttention:9906-9921`): summary *"Broker account readiness is blocking scans."*, detail = IBKR message, action *"Start or repair the IBKR account/order bridge before running signal-options scans."* — **bridge-era copy**. Also inflates fleet `activeBlockers` KPI (`:12409`).
  3. GateLadder "Gateway" control (`algoHelpers.js:3835-3853`): `gatewayNotReady = readiness.ready === false` (`:3941`) → `active` (`:3951`); reasons list is entirely bridge-era (`ibkr_not_configured`, `bridge_health_unavailable`, `bridge_unavailable`, `gateway_socket_disconnected`, `gateway_login_required`, …). When the user disables it, it renders **`FORCED`** (`:3954`) — it cannot be turned off.
- **Why vestigial (inferred, well-supported).** The IBKR datapath was retired; the STA/operations deployment executes as **shadow** (`buildSignalOptionsActionMapping` → `executionMode:"shadow"`, `brokerSubmission:false`, `:2560-2562`) and never uses the broker gateway. Yet `getAlgoGatewayReadiness()` (a global IBKR check) gates the shadow operations view unconditionally. **Not a hard server block:** shadow scans keep running (seen-signals `created_at` today, up to 18:52Z), so this is a **display/gate-ladder** vestige, not an execution stop — but it is exactly a "trading-blocked" reason the owner would read as wrong.

### 2e. `Action deferred` (pressure) — **STALE / latched under sustained pressure**
- **Observed live.** Pressure is high right now; `scannerPressure` reports 1 long automation scan.
- **Observed source.** `signalOptionsCandidateShellContractSelectionStatus` (`:5499-5507`) returns `"deferred"` when `scanState.heavyWorkDeferred` **or** `workerState.lastHeavyWorkDeferred`. A deferred scan returns early with `candidateCount:0` and sets `heavyWorkDeferred:true` (`:19175-19194`); a normal scan clears it (`:19211-19214`). Under **sustained** pressure the clear never runs, so `lastHeavyWorkDeferred` **latches** and every un-refreshed shell shows **"Action deferred"**, while durable reasons (2c) stop refreshing.
- **Verdict.** Correct as a momentary state, but **sticky/latched** while pressure persists → reads as a standing block the market conditions don't justify.

### 2f. Suspicions explicitly cleared
- **Route cache (f2b8286f) — CORRECT/irrelevant.** `signalMonitorStateCache` (15s) and `signalMonitorBreadthHistoryCache` (5s) live in `routes/signal-monitor.ts` and serve only `/signal-monitor/state` + `/breadth-history` (TTL-only, comment `:250-252` "server-side trading reads the producer state directly, never this HTTP route"). STA uses `/signal-options/state` + `/cockpit`, which build via `getSignalMonitorState` directly — **not** through that cache.
- **`ibkr_bridge_required` — not an STA reason.** Only `services/diagnostics.ts:1798` (a diagnostics event code). It does not appear on any STA candidate/signal/attention path.
- **Reconcile-on-startup off — confirmed.** `PYRUS_SIGNAL_MONITOR_STATE_RECONCILE_ON_STARTUP` gated in `signalMonitorStateReconciliationOnStartupEnabled` (`signal-monitor.ts:11431`); default logs "skipped on startup". Stored-state repair does not run on boot — this is why the raw `fresh` column stays 99.9% false, but per 2a that column is not on the display path.

### 2g. Client retention (7fcf8b50) — minor staleness vector, by design
- **Observed.** The automation-state query does **not** set `placeholderData: retainPreviousData` (only `deploymentsQuery` `:573` and `ledgerPositionsQuery` `:667` do). But react-query keeps last-good `data` on error, and `resolveStableStaActionSnapshot` (`:539-579`) drops failed/transient sources and can fall back to empty. Under 429 shedding the STA either holds the **last-good snapshot** (up to `gcTime` 30s) or renders empty — so during shed windows the per-row reasons shown may be up to ~15–30s stale. Intentional flicker-avoidance, not a defect, but worth noting given current shedding.

---

## 3. Direct answer to the owner

The blocking reasons most likely being seen "wrongly":

- **#1 — a rule that should no longer exist (vestigial): the "Gateway"/broker-readiness block.** It is driven entirely by the **retired IBKR Client Portal** readiness check (`ibkr_not_configured`), applied to a shadow deployment that never touches a broker. It shows up as the red **"Gateway" halt (FORCED, un-disable-able)**, the attention warning *"Broker account readiness is blocking scans / Start or repair the IBKR account/order bridge"*, and the cockpit `scanDisabledReason`. This is **not old state and not a cache** — it is a live gate keyed to a retired datapath. Evidence: live `/api/readiness` `broker_not_configured`; `algo-gateway.ts:38-53`; `buildCockpitAttention:9906`; `algoHelpers.js:3835-3955`.

- **#2 — stale state, only while under pressure: "Action deferred" + pinned per-row skip reasons.** The API is under sustained high pressure now; the scan defers heavy work and (a) shows **"Action deferred"** on fresh signals and (b) **pins** the last scan's `mtf_not_aligned`/other reasons via the candidate merge, so a currently-actionable row can still read blocked. This clears itself the moment one non-deferred scan cycle completes. Evidence: `:5499`, `:19175`, `:6309`; flight-recorder pressure=high.

- **What is NOT wrong:** the FRESH/STALE freshness label is recomputed correctly for display (the 99.9%-false stored `fresh` column is automation-trigger-only and never reaches the STA label), and `mtf_not_aligned` itself is a legitimate live confluence gate (89% of all skips) — correct in substance, only stale in timing under pressure.

---

## 4. Minimal-fix recommendations (ranked; not implemented)

1. **Stop gating the shadow operations view on IBKR gateway readiness (kills the vestigial "Gateway" block).**
   - In `buildAlgoDeploymentCockpitPayload` (`signal-options-automation.ts:12415-12421`) and `buildCockpitAttention` (`:9906`): skip the `readiness.ready===false` scan-block/attention when the deployment executes as shadow (`brokerSubmission:false` / `executionMode:"shadow"`), or gate on a data-readiness signal instead of broker gateway readiness. Frontend `algoHelpers.js:3940-3955`: don't force the `gatewayReadiness` control active for shadow. Retire the "IBKR account/order bridge" copy at `:9920` (finishes what `6862f759` started). Risk: low; display + gate-ladder only.

2. **Don't render pressure-`deferred` as a per-row block; show a "scan paused (load)" banner instead.**
   - `signalOptionsCandidateShellContractSelectionStatus` (`:5499`): when deferred, keep shells `pending` and surface deferral once at the strip level, not as a per-row "Action deferred". Or add a short TTL to `lastHeavyWorkDeferred` so it can't latch. Risk: low–medium.

3. **Age-out pinned skip reasons in the merge.**
   - `mergeSignalOptionsCandidate` (`:6309-6316`): drop the durable `reason` when the live shell's `signalAt`/bar is newer than the durable candidate's last timeline entry (i.e., don't let a stale skip reason survive a fresh bar). Risk: medium (semantic).

4. **Reduce restart-drift in the seen-signals store.**
   - Investigate why day-old events (`occurred_at` 07-06) are re-inserted as seen today after restart (observed drift). Ensure the in-memory recent-skips buffer rehydrates from the durable store on boot so display and dedup agree. Risk: medium; behavior-sensitive — confirm intent before changing.

5. **(Optional) Enable stored-state reconcile or stop persisting the false-negative `fresh`.**
   - Not required for display (2a), but the 99.9%-false stored `fresh` column is a footgun for anything that reads it raw (worker/shadow-scan via `preferStoredMonitorState`). Either run reconcile (`PYRUS_SIGNAL_MONITOR_STATE_RECONCILE_ON_STARTUP=1`) or have the trigger path also use recomputed freshness. Risk: touches the automation trigger — verify against the `3e6e000b` intent first.
