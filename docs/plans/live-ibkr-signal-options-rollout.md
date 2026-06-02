# Scoped Plan: Live IBKR Routing For Existing Signal-Options Algo

## Summary

- Keep the change to the existing signal-options automation path only.
- Target only live IBKR account `U24762790`.
- Do not change Replit startup, broker architecture, UI layout, strategy rules, scanner behavior, or paper/shadow behavior.
- Current blocker: signal-options is coded as shadow-only (`mode: "shadow"`, destination `shadow`, `brokerSubmission: false`), so live trading needs a small execution-mode addition rather than a config-only switch.

## Minimal Code Changes

- Extend the signal-options execution profile to support `mode: "shadow" | "live_ibkr"` while defaulting to `shadow`.
- Update account normalization so `signalOptions.mode === "shadow"` keeps using provider account `shadow`, while `live_ibkr` preserves `providerAccountId: "U24762790"`.
- In `signal-options-automation`, branch only at the final execution step:
  - existing shadow path remains unchanged;
  - live path converts the already-resolved candidate/order plan into existing `placeOrder` calls with `mode: "live"`, `confirm: true`, `accountId: "U24762790"`, long-option open intent, and existing full risk caps.
- Add exit routing for live positions using the same existing order service, with sell-to-close intent when stop/opposite-signal/overnight exit rules fire.
- Add idempotency checks before broker submission so the same signal or exit cannot submit duplicate live orders.
- Add env guards:
  - `SIGNAL_OPTIONS_LIVE_BROKER_EXECUTION_ENABLED=1`
  - `SIGNAL_OPTIONS_LIVE_BROKER_TARGET_ACCOUNT_ID=U24762790`
  - if either is missing or mismatched, live deployments scan but do not submit broker orders.

## Use Existing Interfaces

- Use existing `POST /api/algo/deployments` to create the live deployment; do not add a new endpoint unless implementation proves the existing endpoint cannot safely express it.
- Use existing `POST /api/algo/deployments/:deploymentId/enable` and `POST /api/algo/deployments/:deploymentId/pause` for activation and kill switch.
- Use existing `/api/readiness`, `/api/session`, `/api/accounts`, `/api/orders`, and `/api/algo/events` for validation and monitoring.
- Use the existing IBKR bridge/manual order service; do not add a broker adapter or multi-broker abstraction.

## Launch Steps

1. Confirm IB Gateway live mode is connected on `127.0.0.1:4001`, socket API enabled, Read-Only API disabled, and live market data active. IBKR docs identify these as required TWS/API settings and list IB Gateway live default port `4001`.
2. Set `SIGNAL_OPTIONS_LIVE_BROKER_EXECUTION_ENABLED=0` and `SIGNAL_OPTIONS_LIVE_BROKER_TARGET_ACCOUNT_ID=U24762790`.
3. Create a disabled live deployment from the existing signal-options config, with `mode: "live"`, `providerAccountId: "U24762790"`, and `config.signalOptions.mode: "live_ibkr"`.
4. Validate readiness and account targeting:
   - `/api/readiness`
   - `/api/session`
   - `/api/accounts`
   - `/api/algo/deployments?mode=live`
5. Turn on `SIGNAL_OPTIONS_LIVE_BROKER_EXECUTION_ENABLED=1`, restart normally, then enable the live deployment.
6. Monitor live events, orders, and account state. Pause immediately with the existing pause endpoint if any readiness, duplicate-order, wrong-account, or reconciliation issue appears.

## Test Plan

- Unit tests for profile parsing, account normalization, live env guard, live order payload construction, and duplicate prevention.
- Regression tests proving the current paper/shadow deployment still emits shadow events and never calls broker submission.
- Focused validation:
  - `pnpm --filter @workspace/api-server run typecheck`
  - `pnpm --filter @workspace/api-server run build`
  - targeted `signal-options-automation`, `automation`, and `order-gateway-readiness` tests
  - root `pnpm run typecheck` before handoff.

## Assumptions

- No manual approval step; fully automated live submission is expected.
- No canary cap; existing full risk caps are expected.
- No UI work beyond any tiny label/status fix required to avoid misrepresenting live/shadow mode.
- Source: IBKR TWS API docs for API settings, paper/live differences, and default ports: https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/
