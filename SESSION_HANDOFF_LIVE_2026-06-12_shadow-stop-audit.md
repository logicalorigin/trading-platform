# Live Session Handoff - Shadow Stop Audit

- Session ID: `pending-shadow-stop-audit`
- Saved (MT): `2026-06-12 12:08:44 MDT`
- Saved (UTC): `2026-06-12T18:08:44Z`
- CWD: `/home/runner/workspace`
- User request: check whether trailing stops and stop losses are being properly applied in the shadow account.

## Scope

- Investigation plus authorized source fix after the user replied "please proceed."
- No Replit startup config, env vars, artifacts, or control-plane state were changed.
- No direct SQL/database mutation commands were run. After the patch was loaded by the running background process, the live worker created normal shadow sell orders/events for CRM and CIEN hard-stop exits.
- Existing worktree was already broadly dirty. Pre-existing unrelated edits in `artifacts/api-server/src/services/signal-options-automation.ts`, `artifacts/api-server/src/services/signal-options-automation.test.ts`, and handoff files were not reverted.

## Observed Facts

- Active paper shadow signal-options deployment:
  - ID `7e2e4e6f-749f-4e65-a011-87d3559a23b0`
  - Name `Pyrus Signals Options Shadow Paper`
  - Enabled `true`
  - Provider account `shadow`
  - Exit policy in DB includes `hardStopPct: -30`, `trailActivationPct: 35`, `progressiveTrailEnabled: true`, and runner trail steps.
- Source trace:
  - `artifacts/api-server/src/services/signal-options-exit-policy.ts` computes `hard_stop` when `markPrice <= hardStopPrice` and `runner_trail_stop` when the active trailing stop has taken over.
  - `artifacts/api-server/src/services/signal-options-automation.ts` primary active-position refresh emits `signal_options_shadow_exit` for any `stop.exitReason`, including `hard_stop` and `runner_trail_stop`, when the option session is live and the exit quote is eligible.
  - `artifacts/api-server/src/services/signal-options-automation.ts` loads deployment events with a deployment-wide limit, then filters to `signal_options_` events. This means unrelated event types can crowd out all Signal Options runtime events before state reconstruction.
  - `reconcileActivePositionsWithShadowLedger` returns immediately when event-derived positions are empty, so the shadow ledger cannot repopulate active positions after the recent Signal Options event window is lost.
  - `artifacts/api-server/src/services/shadow-account.ts` mark-refresh enforcement path only accepts `runner_trail_stop`; it returns without exit for `hard_stop`.
  - `artifacts/api-server/src/services/overnight-spot-execution.ts` treats prior blocked overnight-spot rows as non-terminal for duplicate checks while `runActions=true`, so repeated blocked plans can keep inserting `overnight_spot_signal_blocked` rows.
- Recent database evidence:
  - Last 14 days exit event counts: `runner_trail_stop` 16, `hard_stop` 4, `early_invalidation` 2, `opposite_signal` 7, `overnight_risk_exit` 2.
  - Every recent `signal_options_shadow_exit` event had a matching shadow sell order: 0 missing mirrored orders.
  - Current open shadow option positions at audit time:
    - `AIP`: average cost `16.63`, mark `18.60`, hard-stop state OK.
    - `CIEN`: average cost `4.80`, mark `2.90`, current active profile hard stop `3.36`, breached under current profile.
    - `CRM`: average cost `1.86`, mark `0.06`, current active profile hard stop `1.30`, breached.
  - CRM and CIEN had fresh `shadow_position_marks` from `option_quote` around `2026-06-12T17:14Z`, but no corresponding `signal_options_shadow_exit` for hard-stop breach.
  - Since the CRM/CIEN entries on `2026-06-11`, more than 92k newer execution events were written for the same deployment.
  - Since `2026-06-11T18:00Z`, the deployment had `85,617` `overnight_spot_signal_blocked` rows and only `153` `signal_options_shadow_mark` rows.
  - The latest 2,500 execution events for the deployment were all `overnight_spot_signal_blocked`; therefore the Signal Options runtime event filter saw zero Signal Options events.
  - The deployment has `overnightSpot.enabled: true`, `executionMode: "shadow"`, `worker.pollIntervalSeconds: 60`, and many blocked rows with blocker `overnight_spot_quote_required`.
  - Direct exported state-reader check:
    - `listSignalOptionsAutomationState({ deploymentId, view: "full", cacheMode: "bypass" })`
    - Result: `activeCount: 0`, `eventCount: 0`, `candidateCount: 11`.
- Focused validation:
  - `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-options-automation.test.ts` passed 15/15.
  - One-off executable stop calculation with `tunedSignalOptionsExecutionProfile` returned:
    - CRM-like hard case: hard stop `1.3`, active stop `hard_stop`, `exitReason: hard_stop`.
    - Runner case: trail stop `3.4`, active stop `trailing_stop`, `exitReason: runner_trail_stop`.
  - Test search found no existing coverage for hard-stop mark-refresh enforcement, active-position reconstruction under unrelated deployment-event flood, or duplicate suppression for blocked overnight-spot scans.

## Conclusion

- Initial conclusion: trailing stops were being applied and mirrored in the shadow ledger when triggered, but stop losses were only partially applied.
- Root causes:
  - The shared stop calculator and primary Signal Options automation path could emit and mirror `hard_stop` exits.
  - The shadow account mark-refresh enforcement path only accepted `runner_trail_stop`, so positions could remain open when only the shadow mark refresh observed a hard-stop breach.
  - Primary automation could lose sight of open Signal Options positions because it event-sourced active positions from a deployment-wide recent-event window that was flooded by unrelated overnight-spot blocked events.
  - The durable shadow ledger had open option positions, but the reconciliation helper returned empty when event-derived positions were empty, so it could not rebuild active positions from ledger rows.
  - Overnight spot blocked-plan events were repeatedly inserted for the same deployment/client-order id, creating the event flood.

## Fixes Applied

- `artifacts/api-server/src/services/shadow-account.ts`
  - `recordSignalOptionsShadowMarkExit` now records the actual stop reason.
  - `computeSignalOptionsShadowMarkExitDecision` accepts both `hard_stop` and `runner_trail_stop`.
  - Mark-refresh enforcement now exits for hard stops and runner trails, and returns the actual exit reason.
- `artifacts/api-server/src/services/signal-options-automation.ts`
  - `listDeploymentEvents` filters SQL by `signal_options_%` before applying the event limit.
  - Active-position reconciliation now recovers open positions from durable `shadow_positions`/automation-order ledger rows and merges them with event-derived positions.
  - State/count/list/scan paths pass the deployment id into ledger recovery.
- `artifacts/api-server/src/services/overnight-spot-execution.ts`
  - Repeated blocked overnight-spot plans are deduped for 30 minutes when the client-order id and blocker codes match.
  - Dedupe happens after planning so a formerly blocked signal can still become executable if blockers clear.
- Added focused regression tests:
  - `artifacts/api-server/src/services/shadow-account-signal-options-stops.test.ts`
  - `artifacts/api-server/src/services/signal-options-event-window.test.ts`
  - `artifacts/api-server/src/services/signal-options-ledger-recovery.test.ts`
  - `artifacts/api-server/src/services/overnight-spot-execution.test.ts`

## Post-Fix Evidence

- Focused tests passed:
  - `pnpm --filter @workspace/api-server exec tsx --test src/services/shadow-account-signal-options-stops.test.ts src/services/signal-options-event-window.test.ts src/services/signal-options-ledger-recovery.test.ts src/services/overnight-spot-execution.test.ts src/services/signal-options-automation.test.ts`
  - Result: 22/22 tests passed.
- API typecheck passed:
  - `pnpm --filter @workspace/api-server run typecheck`
- Scoped whitespace check passed:
  - `git diff --check -- artifacts/api-server/src/services/shadow-account.ts artifacts/api-server/src/services/signal-options-automation.ts artifacts/api-server/src/services/overnight-spot-execution.ts artifacts/api-server/src/services/shadow-account-signal-options-stops.test.ts artifacts/api-server/src/services/signal-options-event-window.test.ts artifacts/api-server/src/services/signal-options-ledger-recovery.test.ts artifacts/api-server/src/services/overnight-spot-execution.test.ts`
- Live shadow ledger after the patch:
  - `AIP` remained open.
  - `CRM` closed at `2026-06-12 17:57:29.822+00` through a `signal_options_shadow_exit` event with reason `hard_stop`, enforcement source `shadow_mark`, exit price `0.02`, mark price `0.025`.
  - `CIEN` closed at `2026-06-12 17:57:30.207+00` through a `signal_options_shadow_exit` event with reason `hard_stop`, enforcement source `shadow_mark`, exit price `1.19`, mark price `2.9`.
  - Matching shadow sell orders were present for both CRM and CIEN with run source `shadow_mark` and reason `hard_stop`.
- Live state reader after query filtering plus ledger recovery:
  - `activeCount: 1`
  - Active position: `AIP`, entry `16.63`, quantity `1`, last mark `19.5`, opened at `2026-06-08T14:52:31.691Z`.
  - `candidateCount: 75`.

## Remaining Notes

- The overnight-spot event flood is throttled, not fully eliminated. If product intent is to keep overnight spot separate from Signal Options deployments, the deployment configuration should be cleaned up in a separate approved change.
- The fix was validated with focused tests and typecheck. Full-app browser QA was not run because this task is backend trading behavior and the Replit startup instructions say to use targeted validation for routine work.
