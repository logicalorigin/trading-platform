# SnapTrade Capability Proof — 2026-07-02

Status: TEMPLATE — live testing not started. This file is the evidence record
required by `docs/plans/snaptrade-hosted-brokerage-integration-plan.md`
(Phase 3). Fill each item with dated, observed evidence only. Redact account
numbers. Never paste secrets, signatures, or raw credential payloads.

## Security Review (2026-07-02)

Independent 4-lens Claude review of the new auth + broker gating. Verdict:
auth core is sound (scrypt+salt, hashed session tokens, CSRF, AES-256-GCM
secret custody); safe to create the admin account. Fixes applied this session:

- [x] Broker/SnapTrade routes (incl. LIVE order submit) now require the
      `admin` role server-side (`requireAdmin`/`requireAdminCsrf`), not just a
      login. Test: non-admin session → 403 `admin_required`.
- [x] Session cookie `Secure` now set from request protocol
      (`x-forwarded-proto`), so the HTTPS Replit preview gets a Secure cookie
      (was gated on NODE_ENV → dev preview shipped a non-Secure cookie).
- [x] Rate limiting on `/auth/login` + `/auth/bootstrap` (per-IP + per-email /
      global fixed windows) — brute-force + scrypt CPU-DoS defense.
- [x] Bootstrap made atomic + single-use via a transaction-scoped Postgres
      advisory lock (was a non-atomic check-then-insert).
- [x] `users.role` default flipped `admin` → `member` (migration
      `20260702_users_role_default_member.sql`, applied to dev DB). Bootstrap
      still assigns `admin` explicitly.
- [x] `.env` / `.env.*` added to `.gitignore` (keeps `.env.example`).

STILL OPEN (must fix before automated live trading OR exposing a public URL):

- [ ] The legacy `/algo/*` automation subsystem (`routes/automation.ts`) is
      unauthenticated — create/enable/pause/flip-to-live have no auth. Separate
      lane; proper fix needs frontend CSRF plumbing. Not in the SnapTrade
      manual-order path, so not a blocker for the IBKR proof, but the single
      most severe finding for public exposure.
- [ ] Hardening backlog (non-blocking): login timing user-enumeration, bump
      scrypt work factor, don't rotate CSRF on read, tighten CORS from `*`,
      stop echoing internal 5xx detail to the browser.

## Preconditions

- [x] `SNAPTRADE_CLIENTID` + `SNAPTRADE_API_KEY` configured (observed present
      in API process env on 2026-07-02).
- [x] `PYRUS_CREDENTIAL_ENCRYPTION_KEY` configured 2026-07-02 (verified
      32-byte decode in API process env; value never logged).
- [x] Browser QA of header popover / SHARES ticket / non-admin Settings tab
      passed in mocked logged-out state 2026-07-02
      (`artifacts/pyrus/e2e/snaptrade-surfaces.browser-validation.spec.ts`,
      4/4). Admin-state QA pending auth bootstrap.
- [x] Proof lane chosen: in-app portal (user decision 2026-07-02).
- [x] SnapTrade DB migrations applied to live dev DB 2026-07-02
      (broker_user_scope, broker_account_execution_readiness,
      snaptrade_broker_provider) — verified via information_schema/pg_enum.
- [x] Fixed `credentialsReady` field-path bug that kept all SnapTrade action
      buttons disabled (see session handoff 2c909428).
- [x] `PYRUS_AUTH_BOOTSTRAP_TOKEN` set 2026-07-02 (verified in supervisor
      env).
- [x] Sign-in UI added 2026-07-02: `HeaderSessionStatus.jsx` header control
      with sign-in / first-time-setup (bootstrap) / sign-out. Browser QA
      passed (validation + wrong-credential 401 alert verified).
- [ ] First admin user created via in-app First-time setup (user action).
- [ ] Admin-state browser QA: Settings panel shows 'App credentials:
      configured', Register & Connect enabled; header shows 'Activate'.

## IBKR Proof Checklist (first target) — RESULT 2026-07-02

- [x] Connected IBKR through SnapTrade Connection Portal in-app, no IB
      Gateway/TWS. Registration + connection succeeded.
- [x] Exact SnapTrade brokerage slug observed: **INTERACTIVE-BROKERS-FLEX**.
- [x] Connection row: `broker_connections` id b4297b8e…, status `connected`,
      mode `live`, created 2026-07-02 17:08:11.
- [x] Connection capabilities observed:
      `{accounts, positions, snaptrade, snaptrade-brokerage:INTERACTIVE-BROKERS-FLEX, read-only}`.
- [x] Connection is **read-only** — capabilities include `read-only` and do
      NOT include `orders` / `executions` / `execution-ready`. The backend
      only stores execution capabilities when the connection is executable.
- [ ] Accounts: 0 synced as of 17:10 (IBKR Flex holdings can lag; data delay
      up to ~1 business day per SnapTrade support). Read-only monitoring may
      populate later; irrelevant to the trading gate.
- [x] **VERDICT — IBKR FAILS the real-order threshold via SnapTrade.**
      SnapTrade's only IBKR integration is the Flex reporting connector
      (read-only, delayed). It cannot place orders. This matches the plan's
      documented IBKR fail condition ("SnapTrade connection is Flex/
      reporting-only") and the security review's IBKR risk.

### Consequence

Per the plan's Product Decision #3, pivot the real-order proof to **E*TRADE**
through SnapTrade (OAuth; SnapTrade support lists full stock/option trading),
keeping the same SnapTrade architecture. IBKR-via-SnapTrade may still be kept
as a read-only monitoring connection if desired, but it is not a trading path.

## E*TRADE Fallback Checklist (only if IBKR fails threshold)

- [x] E*TRADE trading support verified LIVE against SnapTrade's partner-info
      API on 2026-07-02 (GET `/api/v1/snapTrade/partners` with our clientId):
      slug `ETRADE`, `enabled: true`, `allows_trading: true`,
      `maintenance_mode: false`, `is_degraded: false`. Same response confirms
      `INTERACTIVE-BROKERS-FLEX` has `allows_trading: false` (matches the IBKR
      verdict above). 15 of 36 allowed brokerages are trade-enabled, incl.
      `ETRADE` and `ALPACA-PAPER`.
- [x] Connect E*TRADE through SnapTrade OAuth — completed by user 2026-07-02.
      `broker_connections` row `5e7749b1-4a2a-40e3-9a55-ba2d67a6c9c5`, status
      `connected`, mode `live`, created 2026-07-02 17:44:07 UTC. Capabilities:
      `{accounts, positions, snaptrade, snaptrade-brokerage:ETRADE, orders,
      executions, execution-ready}` — includes `orders`/`executions`/
      `execution-ready`, does NOT include `read-only`. **Connection is
      TRADE-ENABLED — passes the gate IBKR failed.**
- [x] Accounts synced 2026-07-02 17:44 UTC: 3 `broker_accounts` rows (E*Trade
      RETIREMENT ROTH IRA, E*Trade GROWTH, E*Trade Rollover IRA), all USD,
      all with `execution-ready` capability and empty `execution_blockers`.
- [x] Account details, balances, stock positions, option positions, recent
      orders confirmed via live SnapTrade readback on 2026-07-02 22:40:45–
      22:40:49 UTC using `getSnapTradeAccountPortfolio` +
      `listSnapTradeRecentOrders`; SnapTrade account IDs redacted.
      - E*Trade Rollover IRA: USD cash/buying power/net liquidation 25.63 /
        25.63 / 25.63; 0 positions; 0 recent orders.
      - E*Trade GROWTH: USD cash/buying power/net liquidation 99.71 / 199.42 /
        99.71; 2 equity positions (`27887Q103`, `CAGR`), 0 options; 0
        recent orders.
      - E*Trade RETIREMENT ROTH IRA: USD cash/buying power/net liquidation
        7.98 / 7.98 / 11547.275; 9 positions total = 2 equities (`SIVEF`,
        `OPTX`) + 7 options (`BLDP 260821C00005000`,
        `OPTT 260821C00000500`, `NOK 260717C00012000`,
        `KWEB 260821C00040000`, `FRMI 260821C00005000`,
        `F 260918C00014000`, `TEM 260821C00060000`); 0 recent orders.
- [x] Trading access for stocks confirmed at the connection-capability level
      (execution-ready, no read-only). Options + live order placement still
      pending the proof order.
- [x] Supported order types and TIFs recorded (docs-sourced 2026-07-02 from
      SnapTrade support page "E-Trade", last updated 2026-06-16 — pending live
      confirmation): Place Trade Stock/ETF/Option; order types Market, Limit,
      StopLimit, StopLoss, Multi-Leg (multi-leg LIMIT orders require the
      `price_effect` field, CREDIT or DEBIT); TIF FOK, Day, GTC.
- [x] PYRUS SnapTrade equity path records local supported submit/impact enums:
      actions `BUY`/`SELL`; order types `Market`, `Limit`, `Stop`,
      `StopLimit`; TIFs `Day`, `GTC`, `FOK`, `IOC`; trading sessions
      `REGULAR`/`EXTENDED`; extended-hours validation requires `Limit`.
      Recent-order live readback returned zero rows, so no account-history row
      confirmed order type/TIF behavior.
- [ ] Client order id / idempotency behavior recorded: local submit validation
      accepts optional UUID `clientOrderId` and sends it as `client_order_id`;
      upstream duplicate/idempotency behavior remains unconfirmed without a
      submit.
- [ ] Paper/sandbox order if available; else tiny live order with explicit
      confirmation. Non-submitting prep attempted on 2026-07-02: account-
      scoped AAPL symbol lookup succeeded for E*Trade Rollover IRA (best match
      AAPL / Apple Inc. / NASDAQ / common stock), but SnapTrade `/trade/impact`
      returned HTTP 403 for the far-from-market `BUY 1 AAPL LIMIT 1.00 DAY`
      preview on all three E*TRADE accounts. No order was submitted; post-
      impact recent-order readback at 2026-07-02 22:44 UTC still returned 0
      orders on all three accounts.
- [ ] Status and fills reconciled. Pre-submit recent-order readback observed 0
      recent orders on all three E*TRADE accounts; OPEN/cancel/fill
      reconciliation still requires the gated live proof order.
- [x] Limitations recorded (single active connection, recent-order limits,
      webhook gaps, rate limits). Docs-sourced 2026-07-02 (pending live
      confirmation): a single E*TRADE account can only be connected once
      through SnapTrade — a new connection disables previous ones; no
      fractional shares (`allows_fractional_units: false`); extended hours
      7:00–9:30 AM and 4:00–8:00 PM ET are LIMIT + DAY orders only; quotes
      delayed 15 min; order history 30 days / 50 most recent orders;
      trade-executed webhook may not fire for limit orders not executed
      immediately; strict per-connection rate limits (SnapTrade adds custom
      throttling). Observed 2026-07-02: SnapTrade `/trade/impact` returned
      HTTP 403 for non-submitting impact previews on all three synced,
      execution-ready E*TRADE accounts.

### IBKR follow-up lead (recorded 2026-07-02)

SnapTrade's GLOBAL brokerage list (`GET /api/v1/brokerages`, unauthenticated)
shows a non-Flex `INTERACTIVE-BROKERS` integration with
`allows_trading: true` and `[read: OAUTH, trade: OAUTH]` authorization types.
Our partner-scoped `allowed_brokerages` (clientId-signed
`/snapTrade/partners` probe, same day) contains only
`INTERACTIVE-BROKERS-FLEX` (`allows_trading: false`). Inference (cause
unverified): the trade-capable IBKR OAuth integration exists at SnapTrade but
is not enabled for our clientId — likely gated by plan tier or manual
enablement. Action: ask SnapTrade support whether `INTERACTIVE-BROKERS`
(OAuth, trade) can be enabled for our client; if yes, IBKR live trading via
SnapTrade may be recoverable without the in-house IBKR OAuth build.

## Product Decisions For First Live Order

Decided by user 2026-07-02:

- First real-order fixture account: IBKR (pivot to fallback only if the IBKR
  connection is not trade-enabled).
- Maximum notional for first live order: $10.
- Order style for first live test: unfillable far-from-market limit order,
  verify OPEN status, then cancel. Fills proven in a later pass.
- Proof lane: in-app through the PYRUS Settings SnapTrade panel (not the
  external CLI). This makes browser QA of the panel and the
  `PYRUS_CREDENTIAL_ENCRYPTION_KEY` secret hard prerequisites.

## Evidence Log

- 2026-07-02: Template created; no live SnapTrade call has been made from
  this codebase or environment to date (all integration tests ran mocked).
- 2026-07-02 (session 62589e95): Live partner-info probe run from this
  environment using the same signing scheme as `snaptrade-readiness.ts`;
  E*TRADE confirmed trade-enabled for our clientId (see E*TRADE checklist).
- 2026-07-02 22:40 UTC: Live portfolio + recent-order readback succeeded for
  all three synced E*TRADE accounts. No recent orders were present.
- 2026-07-02 22:41 UTC: Account-scoped symbol search succeeded for AAPL,
  MSFT, and SPY on E*Trade Rollover IRA; AAPL best match was NASDAQ common
  stock.
- 2026-07-02 22:42 UTC: Non-submitting `/trade/impact` preview attempted for
  `BUY 1 AAPL LIMIT 1.00 DAY` on all three E*TRADE accounts; SnapTrade
  returned HTTP 403 each time. No order-submission route was called.
- 2026-07-02 22:44 UTC: Recent-order readback after the failed impact previews
  still returned 0 orders on all three E*TRADE accounts.
