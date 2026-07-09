# WO-14 Missed-Trades Post-Mortem - 2026-07-07 RTH

Investigation-only report for `claude-lead` session `f68a9158`. No code changes, commits, restarts, or app control-plane actions were performed. The only write is this requested report.

## Scope And Evidence Rules

- Strict RTH window checked: `2026-07-07T13:30:00Z` through `2026-07-07T20:00:00Z`.
- Lead-compatible hourly bucket window checked: `2026-07-07T13:00:00Z` through `2026-07-07T20:00:00Z`, because the established hourly series includes the 13:00Z bucket.
- DB queries used `cd lib/db && node -e`, `pg`, `$DATABASE_URL`, `set statement_timeout = 12000`, and indexed predicates (`emitted_at` / `occurred_at`, plus deployment-scoped `execution_events` for signal-options rows).
- Relevant schemas:
  - `signal_monitor_events`: `lib/db/src/schema/signal-monitor.ts:106-143`; useful indexed columns include `signal_at`, `emitted_at`, `symbol`, `timeframe`, `direction`.
  - `execution_events`: `lib/db/src/schema/automation.ts:77-137`; deployment+occurred partial index for `event_type LIKE 'signal_options_%'` is at lines 120-122.
  - `signal_options_seen_signals`: `lib/db/src/schema/automation.ts:182-224`; deployment+occurred and deployment+reason indexes at lines 215-223.

## Funnel

Hourly funnel, `2026-07-07T13:00:00Z` <= time < `2026-07-07T20:00:00Z`.

| Hour UTC | Raw monitor signals, all sources | Raw `pyrus-signals` | Evaluated (`seen_signals`) | Never-evaluated gap | MTF not aligned (seen) | Candidates created | Candidate skipped events | Shadow entries | Shadow exits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 13:00 | 612 | 404 | 17 | 595 | 15 | 8 | 24 | 0 | 4 |
| 14:00 | 458 | 393 | 0 | 458 | 0 | 0 | 1 | 0 | 2 |
| 15:00 | 431 | 401 | 9 | 422 | 9 | 3 | 23 | 1 | 0 |
| 16:00 | 459 | 407 | 6 | 453 | 3 | 4 | 37 | 1 | 1 |
| 17:00 | 210 | 189 | 2 | 208 | 2 | 1 | 5 | 0 | 0 |
| 18:00 | 331 | 285 | 1 | 330 | 1 | 2 | 2 | 1 | 0 |
| 19:00 | 282 | 280 | 19 | 263 | 18 | 5 | 33 | 0 | 0 |
| **Total** | **2,783** | **2,359** | **54** | **2,729** | **48** | **23** | **125** | **3** | **7** |

Strict RTH totals (`13:30Z-20:00Z`): raw all-source monitor emissions `2,432`, raw `pyrus-signals` emissions `2,081`, evaluated `37`. The lead-compatible 13:00Z bucket total matches the established evaluated count (`54` in 13-19Z buckets; the earlier note's "57 total" includes rows outside this 13-20Z bucket set).

Interpretation:

- Observed: raw buy/sell monitor emissions continued every hour, including the dead hours.
- Observed: the automation evaluated only 54/2,783 raw all-source monitor emissions in the 13-20Z bucket window, leaving a 2,729-row raw-to-evaluated gap.
- Inferred: today's primary drought was not absence of upstream signals. It was the automation worker failing to keep up / shedding entry work under resource pressure, then MTF rejecting most evaluated candidates.

## Candidate-Skip Histogram

Deployment scoped to `7e2e4e6f-749f-4e65-a011-87d3559a23b0` (`Pyrus Signals Options Shadow`) to use the signal-options partial index.

| Skip reason | Count |
|---|---:|
| `mtf_not_aligned` | 105 |
| `position_mark_timeout` | 10 |
| `position_mark_unavailable` | 3 |
| `no_expiration_in_dte_window` | 3 |
| `option_chain_stale` | 1 |
| `same_direction_position_open` | 1 |
| `missing_bid_ask` | 1 |
| `after_hours_option_entry_blocked` | 1 |

Hourly skip reasons:

- 13:00Z: `mtf_not_aligned` 21, `after_hours_option_entry_blocked` 1, `missing_bid_ask` 1, `position_mark_timeout` 1.
- 14:00Z: `position_mark_unavailable` 1.
- 15:00Z: `mtf_not_aligned` 18, `position_mark_timeout` 4, `position_mark_unavailable` 1.
- 16:00Z: `mtf_not_aligned` 29, `position_mark_timeout` 5, `no_expiration_in_dte_window` 2, `same_direction_position_open` 1.
- 17:00Z: `mtf_not_aligned` 5.
- 18:00Z: `mtf_not_aligned` 1, `position_mark_unavailable` 1.
- 19:00Z: `mtf_not_aligned` 31, `option_chain_stale` 1, `no_expiration_in_dte_window` 1.

MTF detail: all 105 `mtf_not_aligned` skip payloads had `entryGate.requiredMtfCount = 3`. Of those, 27 had `entryGate.mtfMatches = 2` and would have passed a 2-of-3 confluence policy; 78 had only 1 match.

## Dead Hours

### 14:00Z

Verified cause: worker/resource-pressure outage, not absence of raw signals.

- Observed raw emissions: 458 all-source raw monitor signals, 393 `pyrus-signals`, but 0 `signal_options_seen_signals`, 0 candidates, 0 entries.
- Flight recorder observed no API lifecycle restart in 14:00Z, but severe DB/resource pressure:
  - `api-db-pool-pressure`: 59 samples, max waiting 43, first sample `2026-07-07T14:00:38.366Z` had `waiting=40`, `total=12`, `idle=0`, `active=12`; last sample `14:59:13.315Z` still had `waiting=8`.
  - Diagnostic skips in 14:00Z included `signal_options_signal_scan_degraded` 177, `automation.latest_scan_age_ms` 160, `signal_options_scan_stale` 148, `signal_options_worker_failure` 119, `automation.failure_count` 119, all persisted-skipped with `reason="resource-pressure-high"`.
- Source correlation:
  - `automation.failure_count` is a diagnostic metric at `artifacts/api-server/src/services/diagnostics.ts:432-439`.
  - It is sourced from worker runtime deployment counters, not a durable event table: `diagnostics.ts:2303-2316`.
  - Worker failures increment in the worker catch block at `artifacts/api-server/src/services/signal-options-worker.ts:557-579`.

### 17:00Z

Verified cause: restart churn plus DB/resource pressure; raw signals were present.

- Observed raw emissions: 210 all-source, 189 `pyrus-signals`, but only 2 evaluated rows, 1 candidate, 0 entries.
- Flight recorder lifecycle events in/near 17:00Z:
  - Starts: `17:04:18.022`, `17:14:12.546`, `17:16:49.772`, `17:26:19.801`, `17:26:50.789`, `17:33:01.156`, `17:33:22.383`.
  - Shutdowns/exits: `17:16:35.757` shutdown start, `17:16:40.758` forced, `17:16:40.759` exit 143; `17:26:37.365` shutdown start, `17:26:38.664` exit 143; `17:32:45.904` shutdown start, `17:32:51.032` exit 143.
- 17:00Z diagnostic counts included `same-container-supervisor-abrupt` 1123, `api-child-exit` 283, `container-replaced` 177, `resource_pressure.db_pool_waiting` 115, `automation.failure_count` 115, `signal_options_worker_failure` 113, and `signal_options_scan_long_running` 90.
- DB pressure still active: 81 pool-pressure samples, max waiting 33, active 12/12.

### 18:00Z

Verified cause: worker failure / long-running scans under DB pressure, with less restart churn than 17:00Z.

- Observed raw emissions: 331 all-source, 285 `pyrus-signals`, but only 1 evaluated row; 2 candidates and 1 entry did happen, so this hour was near-dead rather than fully dead.
- Lifecycle events: restart at `18:17:31.452`; shutdown/start cycle at `18:45:29.689` -> `18:45:43.268`; shutdown/start cycle at `18:51:31.246` -> `18:51:45.639`.
- 18:00Z diagnostic counts: `signal_options_worker_failure` 142, `signal_options_scan_long_running` 142, `automation.failure_count` 142, `resource_pressure.db_pool_waiting` 129, `api.p95_latency_ms` 116.
- DB pressure: 75 pool-pressure samples, max waiting 36, active 12/12.

### 19:00Z

Verified partial recovery of evaluation throughput, but still pressure/restart affected and MTF-gated.

- Observed raw emissions: 282 all-source, 280 `pyrus-signals`, evaluated 19, candidates 5, entries 0.
- Lifecycle: starts at `19:16:00.185`, `19:41:54.475`, `19:53:04.253`, `19:53:50.831`; forced exits at `19:52:54.096` and `19:53:41.702`.
- Diagnostics: `same-container-supervisor-abrupt` 532, `resource_pressure.db_pool_waiting` 165, `automation.failure_count` 156, `signal_options_worker_failure` 155, `signal_options_scan_long_running` 132.
- MTF remained dominant: 31 of 33 candidate skips were `mtf_not_aligned`.

## Pressure Gating Versus Absence Of Signals

Verified:

- Raw monitor signals were present every hour. Absence of upstream signals is ruled out for 14:00Z, 17:00Z, 18:00Z, and 19:00Z.
- Worker entry work is explicitly gated under hard resource pressure:
  - `signal-options-worker.ts:694` reads `dependencies.getResourcePressure()`.
  - `signal-options-worker.ts:740` sets `skipEntryWork = isApiResourcePressureHardBlock(pressure)`.
  - `resource-pressure.ts:603-607` defines hard block as `snapshot.hardResourceLevel === "high"`.
  - `signal-options-automation.ts:19736-19747` returns before heavy entry work when `input.skipEntryWork === true`, marking `heavyWorkDeferred`.
- This gate is not a "watch" gate. `resource-pressure.ts:594-607` explicitly says it gates on finite-resource `hardResourceLevel`, not display/resource pressure from event-loop latency alone.

Not fully verified:

- I did not find a persisted per-scan `skipEntryWork=true` flag for each dead-hour scan in DB. The check that would confirm exact activation windows is a runtime worker snapshot or durable worker-run metadata containing `lastHeavyWorkDeferred`/`hardResourceLevel` per scan. The source and flight recorder strongly support activation, but the exact per-scan gate state is not durably proven here.

## MTF Gate Provenance

Current code/config:

- Current code has a config knob and honors it:
  - `signal-options-automation.ts:5315-5323`: `requiredSignalOptionsMtfCount(value, mtfDirections)` clamps `Math.round(configured)` to the frame count; if config is absent it defaults to unanimity.
  - `signal-options-automation.ts:5380-5383`: fallback gate is `{ enabled: true, requiredCount: 2 }`.
  - `signal-options-automation.ts:5397-5414`: gate compares `mtfMatches < requiredMtfCount` and pushes `mtf_not_aligned`.
  - `signal-options-automation.ts:9025-9032`: profile update patch path includes `entryGate.mtfAlignment`.
- Runtime config for deployment `7e2e4e6f-749f-4e65-a011-87d3559a23b0`:
  - `config.signalOptions.entryGate.mtfAlignment.enabled = true`
  - `timeframes = ["2m","5m","15m"]`
  - `requiredCount = 3`
  - `entryHaltControls.mtfAlignmentEnabled = true`

Jul 2 handoff provenance:

- `SESSION_HANDOFF_2026-07-02_6329348a-b3cd-44cd-ab36-d632f0b53239.md:1300-1302` diagnosed a prior hardcoded unanimity behavior and showed 2-of-3 candidates would have passed the configured gate.
- `SESSION_HANDOFF_2026-07-02_6329348a-b3cd-44cd-ab36-d632f0b53239.md:1317-1320` left the decision open and warned not to revert without confirmation.
- `SESSION_HANDOFF_2026-07-02_f7ca877c-57f9-427f-bdcf-0470c27ba8c9.md:497` records the follow-up decision as resolved: "the MTF unanimity gate should not be reverted."

Verdict:

- The user's confirmed Jul 2 intent, as recorded in the handoff, was to keep unanimity.
- The current system has a config knob (`signalOptions.entryGate.mtfAlignment.requiredCount`), and today's deployment is configured to require 3-of-3. This is no longer the old hardcode; it is policy/config.

## Ranked Recovery Levers For Today

1. **Fix DB/resource-pressure and worker long-scan failures** - highest verified recovery for the raw-to-evaluated gap. Evidence: 2,729 raw 13-20Z signals were never evaluated; dead hours had raw emissions but stale scans, worker failures, DB pool pressure, and restart churn. This would recover the largest denominator.
2. **Stop API restart/supervisor churn** - high verified recovery for 17:00Z and parts of 18-19Z. Evidence: multiple `api-flight-recorder-start`, forced shutdown, `api-child-exit`, `container-replaced`, and `same-container-supervisor-abrupt` diagnostics during the low-evaluation window.
3. **Change MTF policy from 3-of-3 to 2-of-3** - policy change, not bug fix. Evidence: 105 `mtf_not_aligned` skips, 27 with 2/3 agreement. This would recover some evaluated candidates after the denominator problem is fixed, but it conflicts with the Jul 2 recorded decision to keep unanimity.
4. **Improve position mark/quote reliability** - smaller verified recovery. Evidence: 10 `position_mark_timeout`, 3 `position_mark_unavailable`, 1 `option_chain_stale`, 1 `missing_bid_ask`. Material, but much smaller than MTF skips or never-evaluated raw signals.

## Unknowns / Follow-Up Checks

- Exact per-scan `skipEntryWork=true` activation windows are not durably proven. Confirm with worker runtime snapshots or by adding durable scan metadata in a future code change.
- The scanner-cycle estimate (755 symbols, batch 4, 15s, approx 47 minutes) explains poor coverage, but this report did not re-query scanner runtime config beyond source/log correlation.
- The source of supervisor/container replacement churn was not root-caused here; flight recorder proves it happened.
