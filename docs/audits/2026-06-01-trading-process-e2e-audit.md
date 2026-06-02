# Trading Process End-to-End Audit

Date: 2026-06-01

Scope: audit the existing Signal Options trading process for bugs, errors, and live-IBKR readiness gaps. This report is read-only planning output; it does not change trading behavior.

Related plan: `docs/plans/live-ibkr-signal-options-rollout.md`

## Bottom Line

Do not enable the live Signal Options deployment yet.

The broker connection can report trading-ready, and the manual order gateway has useful safety rails, but the algo path is still shadow-first. The current code resolves signals, contracts, quotes, risk gates, and shadow order plans, then records shadow events. It does not submit live IBKR orders from the Signal Options automation path.

## What Was Checked

| Area | Status | Notes |
| --- | --- | --- |
| Signal ingestion and action eligibility | Pass with gaps noted | Covered by Signal Options tests and worker tests. |
| Contract selection and liquidity gates | Pass | Handles 0DTE default exclusion, bid/ask, spread, fresh quote, and frozen data rejection. |
| Risk and session gates | Pass | Daily loss, open-symbol cap, position-mark halt, and post-close option-session blocks are covered. |
| Manual broker order gateway | Pass | Live mutations require explicit confirmation and gateway readiness. |
| Automated live broker dispatch | Blocked | Signal Options automation does not call `placeOrder` or `submitRawOrders`. |
| Live deployment account targeting | Blocked | UI creation and current runtime live deployment still target `shadow`. |
| Live order idempotency and reconciliation | Blocked | No automated live order ledger/reconciliation exists yet. |
| UI audit visibility | Improved | Audit progression is now grouped into the STA table row format. |
| Runtime readiness | Not ready | `/api/readiness` reported app readiness `not_ready` from diagnostics down / API child exit, while broker trading readiness was `ready`. |

## Findings

### 1. Automated Signal Options Execution Is Still Shadow-Only

Severity: blocker

Evidence:

- `artifacts/api-server/src/services/signal-options-automation.ts:1540` builds the action mapping with `executionMode: "shadow"`, `destinationAccountId: "shadow"`, and `brokerSubmission: false`.
- `artifacts/api-server/src/services/signal-options-automation.ts:8411` through `:8660` resolves the candidate and inserts `SIGNAL_OPTIONS_ENTRY_EVENT`; it does not call the broker order service.
- `artifacts/api-server/src/services/signal-options-worker.ts:451` through `:458` wires enabled Signal Options deployments to `runSignalOptionsShadowScan`.
- Repo search found live order methods in platform/IBKR services, but not in `signal-options-automation.ts`.

Impact: creating or enabling a live deployment will not move the algo to real IBKR execution. At best it continues to record shadow entries; if a partial live branch is added without separating events, it risks mixing live state into shadow accounting.

Required fix: add a final execution branch after the existing candidate/order-plan gates. Keep the existing shadow branch unchanged. The live branch must call the existing order service with `mode: "live"`, `confirm: true`, the target account, and explicit idempotency.

### 2. Live Deployment Account Targeting Still Points To Shadow

Severity: blocker

Evidence:

- `artifacts/pyrus/src/screens/AlgoScreen.jsx:1490` through `:1507` posts new deployments with `providerAccountId: "shadow"` and `executionAccountId: "shadow"` regardless of the selected environment.
- Runtime read-only check on `GET /api/algo/deployments?mode=live` returned one disabled live deployment with `providerAccountId: "shadow"`.
- Recent runtime events included `deployment_account_normalized` with summary `Routed Pyrus Signals Options Live to the Shadow account`.
- The account normalization helper now preserves non-shadow account ids when `mode === "live"`, but existing rows and the UI create flow still need repair.

Impact: even after adding live order submission, the current live deployment and UI path would not reliably target the real IBKR account.

Required fix: make live deployment creation require the intended real account id, store that id on the deployment, and add a repair/migration for the existing disabled live deployment before enabling it.

### 3. Shadow Ledger And Dashboard Assumptions Would Misclassify Live Trades

Severity: high

Evidence:

- `insertSignalOptionsEvent` mirrors every entry/exit/mark event into the Shadow account ledger when the event type is `signal_options_shadow_entry`, `signal_options_shadow_exit`, or `signal_options_shadow_mark` (`artifacts/api-server/src/services/signal-options-automation.ts:1396` through `:1423`).
- Rule adherence still has an explicit `shadow_only_execution` rule and treats `brokerSubmission: true` as a violation (`artifacts/api-server/src/services/signal-options-automation.ts:6273` through `:6367`).
- Performance is built from shadow trade diagnostics (`artifacts/api-server/src/services/signal-options-automation.ts:6570` through `:6604`).

Impact: live order events need their own event semantics and broker reconciliation fields. Reusing the shadow event types for live fills would make the UI and performance panels misleading.

Required fix: split event semantics before live enablement. Either introduce live-specific event types or add an explicit execution mode that prevents live entries/exits from being mirrored into the shadow ledger.

### 4. Live Idempotency And Broker Reconciliation Are Missing

Severity: high

Evidence:

- Active Signal Options positions are derived from execution events and shadow ledger reconciliation (`artifacts/api-server/src/services/signal-options-automation.ts:3881` and `:12713` through `:12723`).
- The IBKR bridge transmits orders directly once called (`artifacts/ibkr-bridge/src/tws-provider.ts:4118` through `:4139`).
- The manual order gateway has readiness/confirmation checks, but the automated Signal Options path has no candidate-id-to-broker-order ledger because it does not submit orders yet.

Impact: a naive live order branch could duplicate entries after worker retry, process restart, network timeout, or delayed broker acknowledgment.

Required fix: add an automated order ledger keyed by deployment id, candidate id, side, and lifecycle stage. Reconcile submitted, filled, partial, canceled, and rejected states against IBKR open orders/executions before submitting another order for the same signal or exit.

### 5. Current Runtime Is Not Clean Enough For Live Enablement

Severity: high

Evidence from read-only runtime checks:

- `GET /api/healthz`: HTTP 200, `status: ok`.
- `GET /api/readiness`: liveness `ok`, broker trading readiness `ready`, app readiness `not_ready`.
- Readiness degraded reasons included `diagnostics_down`, `api-latency:watch:1201 ms`, and `api-child-exit`.
- `GET /api/diagnostics/runtime`: IBKR connected and authenticated, selected account present.

Impact: broker readiness alone is insufficient. Do not enable live algo execution while app readiness is not ready.

Required fix: clear diagnostics readiness and API child-exit issues before live rollout, then re-run the readiness checks immediately before enabling.

## Controls That Already Look Solid

- Live manual order mutations require explicit confirmation before gateway checks.
- Gateway disconnected blocks live order mutation paths.
- Live preview is allowed without submitting.
- Signal Options liquidity checks reject stale/frozen quote paths.
- Option entries and opposite-signal exits are blocked outside the live option session.
- Paper Signal Options deployments normalize to shadow, while live-mode normalization can preserve a real provider account id when the deployment is created correctly.

## Minimal Backlog Before Real IBKR

1. Add explicit Signal Options execution mode: default `shadow`, live opt-in `live_ibkr`.
2. Fix live deployment creation so live deployments require and preserve the target real IBKR account id.
3. Repair the existing disabled live deployment away from `shadow` only after the target account is confirmed.
4. Add the live execution branch at the final post-gate step; do not change scanner rules, signal rules, or paper behavior.
5. Add live entry and exit order payload builders with existing risk caps and current option contract metadata.
6. Add live env guards:
   - `SIGNAL_OPTIONS_LIVE_BROKER_EXECUTION_ENABLED=1`
   - `SIGNAL_OPTIONS_LIVE_BROKER_TARGET_ACCOUNT_ID=<real account id>`
7. Add automated order idempotency and broker reconciliation before any live submit.
8. Split live vs shadow event semantics so live trades do not mirror into the shadow ledger.
9. Update dashboard/performance labels so live state cannot be read as shadow-only state.
10. Re-run focused tests, typechecks, build, and runtime readiness before enabling.

## Validation Run

Passed:

- `pnpm --dir artifacts/api-server exec tsx --test src/services/signal-options-automation.test.ts`
- `pnpm --dir artifacts/api-server exec tsx --test src/services/signal-options-worker.test.ts src/services/order-gateway-readiness.test.ts`
- `pnpm --dir artifacts/api-server exec tsx --test src/services/account-orders.test.ts src/services/account-positions.test.ts src/services/ibkr-bridge-runtime.test.ts`
- `pnpm --dir artifacts/api-server exec tsx --test src/services/automation.test.ts`
- `pnpm --dir artifacts/pyrus exec node --import tsx --test src/screens/algo/AlgoAuditPanel.test.js src/screens/algo/OperationsSignalRow.test.js src/screens/algo/algoHelpers.test.js`
- `pnpm --dir artifacts/api-server exec tsc --noEmit --pretty false`
- `pnpm --dir artifacts/pyrus exec tsc --noEmit --pretty false`
- `pnpm --dir artifacts/api-server run build`

Runtime checks were read-only GET requests only. No orders, deployment enables, pauses, profile updates, or shadow scans were triggered.
