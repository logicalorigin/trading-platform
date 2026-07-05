# SnapTrade Hosted Brokerage Integration Plan

Last updated: 2026-07-01

## Status

Active implementation plan.

This document updates the SnapTrade portion of the broker integration plan for
PYRUS. It keeps the automation-first contract from
`docs/decisions/ADR-002-automation-first-broker-scope-permission.md`, but makes
SnapTrade the immediate hosted, no-local-install integration path.

## Confirmed Intent

PYRUS is a web app. Each user has their own PYRUS account and should connect
their own brokerage account without downloading IB Gateway, TWS, a desktop
helper, or any other local component.

SnapTrade is the interim broker connection framework and should become the
shape of the future multi-tenant broker connection system. Each PYRUS user maps
to one SnapTrade user. Each user's SnapTrade user owns that user's brokerage
connections and account references.

The full threshold is:

- user can connect a brokerage through PYRUS using SnapTrade Connection Portal;
- PYRUS can list connected accounts and monitor account positions;
- PYRUS can submit real orders for a connected account;
- PYRUS can reconcile order status, fills, rejects, and account state after
  submission;
- the full flow works without IB Gateway or TWS running.

Read-only account linking is useful as an internal checkpoint, but it is not a
customer launch threshold. Public/general-user launch stays blocked until real
order submission and reconciliation work through PYRUS for at least one
SnapTrade-backed brokerage.

## Current Source Facts

Sources reviewed on 2026-07-01:

- SnapTrade Getting Started: `https://docs.snaptrade.com/docs/getting-started`
- SnapTrade interactive demo:
  `https://docs.snaptrade.com/demo/getting-started`
- SnapTrade request signatures:
  `https://docs.snaptrade.com/docs/request-signatures`
- SnapTrade Connection Portal API:
  `https://docs.snaptrade.com/reference/Authentication/Authentication_loginSnapTradeUser`
- SnapTrade trading guide:
  `https://docs.snaptrade.com/docs/trading-with-snaptrade`
- SnapTrade brokerage support table:
  `https://support.snaptrade.com/SnapTrade-Brokerage-Integrations-f83946a714a84c3caf599f6a945f0ead`
- SnapTrade IBKR support page:
  `https://support.snaptrade.com/Interactive-Brokers-74f633af77614a3ebbd748123e9178c8?pvs=21`
- SnapTrade E*TRADE support page:
  `https://support.snaptrade.com/E-Trade-830ffc2d25154ae3aa536d9859de7386?pvs=21`

Observed facts from the docs:

- SnapTrade Commercial integration uses app-level `clientId` and `consumerKey`.
- A SnapTrade user has a `userId` and `userSecret`.
- SnapTrade recommends one SnapTrade user per end user.
- `userSecret` is sensitive and must stay server-side.
- SnapTrade Connection Portal is generated server-side for a specific user.
- Connection Portal supports `connectionType`.
- Default Connection Portal behavior is read-only.
- `connectionType=trade` requests trading access.
- `connectionType=trade-if-available` requests trading access when the
  brokerage supports it, and otherwise allows read-only fallback.
- SnapTrade trading requires a trading-enabled connection, selected account,
  order payload, application-side validation, submission, and execution-status
  monitoring.
- The public brokerage support table lists Interactive Brokers as
  `INTERACTIVE-BROKERS-FLEX`, status generally available, auth type API key,
  holdings cache expiry 24hr, and a data delay of up to one business day.
- The public brokerage support table lists E*TRADE as `ETRADE`, status generally
  available, auth type OAuth, stock/ETF/option trading support, common order
  types, recent orders, positions, balances, and client order id support.

Inference:

- IBKR remains the business-first target, but SnapTrade's current IBKR support
  may not satisfy the full PYRUS threshold if it is Flex/delayed-data oriented
  or cannot place real orders. We need to test IBKR first and make that fact
  explicit.
- E*TRADE is the best immediate proof/fallback broker inside SnapTrade because
  the user has an account and SnapTrade's support page explicitly lists stock
  and option trade support.

Unknown until live fixture testing:

- Whether the specific IBKR account can create a SnapTrade trade-enabled
  connection.
- Whether IBKR through SnapTrade can submit real orders.
- Whether IBKR through SnapTrade can provide position freshness acceptable for
  PYRUS account monitoring.
- Which SnapTrade order status endpoint/webhook combination gives enough
  reconciliation fidelity for automation.
- Whether SnapTrade's account-level capability data is complete enough, or
  whether PYRUS needs a curated brokerage capability overlay.

## Current Repo Baseline

Observed in the repo on 2026-07-01:

- `lib/db/migrations/20260626_snaptrade_user_credentials.sql` creates
  `snaptrade_user_credentials`.
- `lib/db/src/schema/snaptrade.ts` defines
  `snapTradeUserCredentialsTable`.
- `artifacts/api-server/src/services/snaptrade-user-registration.ts`
  registers the current PYRUS user with SnapTrade.
- `artifacts/api-server/src/services/snaptrade-user-custody.ts` derives the
  SnapTrade user id from immutable app user id and stores encrypted user
  secrets.
- `artifacts/api-server/src/services/snaptrade-readiness.ts` checks app-level
  SnapTrade configuration/readiness and signs direct API requests.
- `artifacts/api-server/src/services/snaptrade-connection-portal.ts` generates
  a SnapTrade Connection Portal URL and defaults to
  `trade-if-available`.
- `artifacts/api-server/src/routes/broker-execution.ts` exposes:
  - `GET /api/broker-execution/snaptrade/readiness`
  - `POST /api/broker-execution/snaptrade/users/current`
  - `POST /api/broker-execution/snaptrade/connection-portal`
- The route layer requires auth and CSRF for mutations.
- `lib/api-spec/openapi.yaml`, `lib/api-zod`, and `lib/api-client-react`
  already include generated SnapTrade readiness, registration, and Connection
  Portal contracts.
- `lib/db/src/schema/broker.ts` already has `broker_connections` and
  `broker_accounts`.
- `lib/db/src/schema/trading.ts` already has `order_requests`,
  `broker_orders`, `execution_fills`, `position_lots`, and
  `balance_snapshots`.

Validation already observed for the current backend foundation:

```text
pnpm --filter @workspace/api-server exec tsx --test \
  src/services/snaptrade-connection-portal.test.ts \
  src/services/snaptrade-user-registration.test.ts \
  src/services/snaptrade-user-custody.test.ts \
  src/services/snaptrade-readiness.test.ts \
  src/routes/broker-execution.test.ts

pnpm run audit:api-codegen
pnpm run audit:env
pnpm --filter @workspace/api-server run typecheck
```

## Product Decisions

1. SnapTrade is the immediate hosted brokerage framework.
2. IBKR is still first focus, but not an assumption.
3. If IBKR through SnapTrade cannot submit real orders, continue SnapTrade
   implementation with E*TRADE as the proof broker.
4. Request `trade-if-available` when generating Connection Portal URLs.
5. A read-only fallback connection is allowed for internal diagnostics only.
6. A read-only fallback connection must not satisfy the customer launch gate.
7. Keep the implementation broker-generic. Do not build an IBKR-only SnapTrade
   path.
8. Keep SnapTrade behind PYRUS-owned broker adapter contracts so SnapTrade can
   support additional brokerages later without rewriting order/account surfaces.
9. Use PYRUS market data for platform research, charts, signals, and order UI
   context unless SnapTrade/broker-specific validation requires broker data.
10. Live terminal orders require explicit per-order confirmation.
11. Automated strategy orders require account-level activation, caps, kill
    switches, freshness gates, and reconciliation gates.
12. Public user launch is blocked until real orders work end to end.

## Architecture Shape

```text
PYRUS user
  -> authenticated app session
  -> SnapTrade user registration
  -> encrypted SnapTrade userSecret custody
  -> SnapTrade Connection Portal URL
  -> brokerage-authenticated connection
  -> SnapTrade connections/accounts sync
  -> PYRUS broker_connections / broker_accounts
  -> account capability map
  -> positions / balances / orders sync
  -> order preview / validation
  -> order submission
  -> order status and fill reconciliation
  -> account state refresh
```

The SnapTrade adapter should map SnapTrade data into the existing broker and
trading tables instead of creating a parallel trading model.

Proposed adapter boundary:

```ts
interface BrokerAdapter {
  provider: "snaptrade" | "ibkr" | string;
  listConnections(userContext): Promise<BrokerConnectionSnapshot[]>;
  listAccounts(connectionContext): Promise<BrokerAccountSnapshot[]>;
  listPositions(accountContext): Promise<BrokerPositionSnapshot[]>;
  listBalances(accountContext): Promise<BrokerBalanceSnapshot[]>;
  listOrders(accountContext): Promise<BrokerOrderSnapshot[]>;
  listExecutions(accountContext): Promise<BrokerExecutionSnapshot[]>;
  getCapabilities(accountContext): Promise<BrokerAccountCapabilityMap>;
  validateOrder(intent): Promise<OrderValidationResult>;
  placeOrder(intent): Promise<BrokerOrderSnapshot>;
  cancelOrder(intent): Promise<BrokerOrderSnapshot | BrokerCancelResult>;
  replaceOrder(intent): Promise<BrokerOrderSnapshot>;
}
```

SnapTrade should be a provider adapter. IBKR and E*TRADE should be underlying
brokerages inside the SnapTrade adapter, represented as account-native
capabilities, not separate route families.

## Data Model Plan

Use existing tables where possible:

- `snaptrade_user_credentials`: per-PYRUS-user SnapTrade user id and encrypted
  user secret.
- `broker_connections`: one row per connected brokerage connection.
- `broker_accounts`: one row per brokerage account under a connection.
- `balance_snapshots`: account balance snapshots.
- `position_lots`: normalized account positions.
- `order_requests`: PYRUS canonical order intents and idempotency.
- `broker_orders`: broker order ids and normalized order state.
- `execution_fills`: fills/executions.

Likely required additions or metadata fields:

- provider value `snaptrade`.
- provider brokerage slug, for example `INTERACTIVE-BROKERS-FLEX` or `ETRADE`.
- SnapTrade connection id.
- SnapTrade account id.
- connection permission state: `read`, `trade`, `trade_if_available`,
  `trade_enabled`, `read_only_fallback`, `disabled`, `reauth_required`.
- account environment: `live`, `paper`, `sandbox`, `unknown`.
- capability map JSON with observed asset classes, order types, TIFs,
  cancel/replace support, idempotency support, order-status source, position
  freshness source, and last verified time.
- last successful sync timestamps for connections, accounts, balances,
  positions, orders, and executions.
- provider raw payload storage where useful, always redacted.
- audit event linkage for connection, reconnect, order submission, and
  reconciliation decisions.

Migration rule:

- Do not create a SnapTrade-only account model unless the existing
  `broker_connections` and `broker_accounts` tables cannot represent a needed
  fact.
- If a fact is SnapTrade-specific but needed for reconciliation, store it in
  provider metadata or a small provider-extension table keyed by the normalized
  broker connection/account id.

## Phase 0: Backend Foundation

Status: mostly complete.

Scope:

- Register each authenticated PYRUS user as a SnapTrade user.
- Store SnapTrade `userSecret` encrypted server-side only.
- Add readiness endpoint for app and user state.
- Generate Connection Portal URL for the current user.
- Default portal generation to `trade-if-available`.
- Sanitize errors and responses so secrets never reach the browser or logs.

Acceptance:

- unauthenticated SnapTrade routes cannot call SnapTrade;
- mutation routes require CSRF;
- registration is idempotent for the same PYRUS user;
- user secret is encrypted at rest;
- Connection Portal request signs correctly;
- Connection Portal response includes only safe metadata and short-lived URL;
- tests, codegen audit, env audit, and API server typecheck pass.

Remaining Phase 0 cleanup:

- Confirm route naming is final before frontend code depends on it.
- Confirm env names are documented in `.env.example` and production secret
  docs.
- Add a short operator runbook for rotating app-level SnapTrade credentials and
  per-user SnapTrade secrets.

## Phase 1: Internal Connect UX

Goal:

Build the first PYRUS UI that lets an internal/admin user connect a brokerage
through SnapTrade, without opening the flow to all users.

Tasks:

1. Add a visible-but-internal SnapTrade state to the broker/account settings
   surface.
2. Gate the UI by role and feature flag.
3. Show readiness states from
   `GET /api/broker-execution/snaptrade/readiness`.
4. If the current user is not registered with SnapTrade, call
   `POST /api/broker-execution/snaptrade/users/current`.
5. Generate a portal URL with
   `POST /api/broker-execution/snaptrade/connection-portal`.
6. Default `connectionType` to `trade-if-available`.
7. Allow an operator-only broker slug override so we can test:
   - `INTERACTIVE-BROKERS-FLEX` first;
   - `ETRADE` as the fallback proof broker;
   - paper/sandbox brokerages when useful.
8. Open the portal in a browser-safe flow.
9. After portal close/return, poll connection/account sync status.
10. Persist enough UI state to recover after page refresh.
11. Add UI tests for missing auth, missing CSRF, missing SnapTrade config,
    registered user, and portal generation success/failure.

Acceptance:

- internal user can launch SnapTrade Connection Portal from PYRUS;
- non-internal user cannot see or trigger the flow;
- route responses do not leak `consumerKey`, `userSecret`, `clientId`, or
  account numbers;
- user can retry after portal close or failure;
- read-only fallback is labeled as blocked for trading, not success.

Verification:

```text
pnpm --filter @workspace/api-server exec tsx --test src/routes/broker-execution.test.ts
pnpm --filter @workspace/pyrus test -- <targeted SnapTrade UI tests>
pnpm --filter @workspace/pyrus run typecheck
```

## Phase 2: Connection And Account Sync

Goal:

After the user completes Connection Portal, PYRUS should discover SnapTrade
connections/accounts and persist normalized broker records.

Tasks:

1. Add SnapTrade service methods for:
   - list user connections;
   - list accounts for a connection;
   - get account details;
   - get balances;
   - get equity positions;
   - get option positions;
   - get recent orders if supported;
   - get account activities/executions if supported.
2. Add tests with fixture payloads for connected, read-only, trade-enabled,
   disabled, and reauth-required states.
3. Map SnapTrade connection id to `broker_connections`.
4. Map SnapTrade account id to `broker_accounts`.
5. Store brokerage slug and display name.
6. Store status and permission state.
7. Normalize connection environment into `live`, `paper`, `sandbox`, or
   `unknown`.
8. Preserve raw provider payload only in redacted provider metadata.
9. Add a manual sync route for internal users.
10. Add a background or on-demand sync path for post-portal completion.
11. Ensure sync is scoped to the authenticated app user.
12. Add query helpers that refuse to load another user's SnapTrade credentials
    or connected accounts.

Acceptance:

- after a completed portal flow, PYRUS stores the connected brokerage
  connection;
- each SnapTrade account becomes a normalized `broker_accounts` row;
- account list is user-scoped;
- disabled/reauth-required connections are represented without enabling
  trading;
- sync is idempotent and updates existing rows instead of duplicating accounts;
- stale/deleted SnapTrade accounts are marked inactive rather than silently
  reused.

Verification:

```text
pnpm --filter @workspace/api-server exec tsx --test \
  src/services/snaptrade-*.test.ts \
  src/routes/broker-execution.test.ts
pnpm --filter @workspace/api-server run typecheck
pnpm run audit:api-codegen
```

## Phase 3: Early Capability Proof

Goal:

Prove the real-order threshold as early as possible so we do not spend weeks
polishing a read-only integration.

Broker order:

1. IBKR through SnapTrade.
2. E*TRADE through SnapTrade if IBKR fails or is read-only/delayed-only.
3. Alpaca Paper or another SnapTrade paper/sandbox brokerage for non-live
   safety testing if needed.

IBKR proof checklist:

- Connect IBKR through SnapTrade without IB Gateway/TWS.
- Confirm exact SnapTrade brokerage slug.
- Confirm account appears in SnapTrade account list.
- Confirm account details and balance appear.
- Confirm equity positions appear.
- Confirm option positions appear if account has options.
- Measure position freshness after a known account change.
- Check whether the connection is actually trade-enabled.
- Attempt an order validation/preview path if available.
- Submit no real order until explicit user confirmation.
- If user approves, submit a tiny real equity order using a limit order that is
  unlikely to create unintended exposure.
- Reconcile broker order id, status, fills/reject, and final account state.
- Record whether IBKR passes or fails the full threshold.

IBKR fail conditions:

- SnapTrade connection is Flex/reporting-only.
- Positions are delayed beyond acceptable account monitoring needs.
- Trading permission cannot be granted.
- Order placement endpoint rejects or is unavailable for IBKR accounts.
- Order status cannot be reconciled.
- Data freshness makes safe automation impossible.

E*TRADE fallback proof checklist:

- Connect E*TRADE through SnapTrade OAuth.
- Confirm account details, balances, stock positions, option positions, and
  recent orders.
- Confirm trading access for stocks and options.
- Confirm supported order types and TIFs.
- Confirm client order id/idempotency behavior.
- Submit a paper/sandbox order if available.
- If no sandbox is available, submit a tiny live equity order only with explicit
  confirmation.
- Reconcile status and fills.
- Record limitations: single active E*TRADE connection behavior, recent-order
  limits, webhook limitations for non-immediate limit fills, and rate limits.

Acceptance:

- we have a dated evidence note proving whether IBKR passes the real-order
  threshold through SnapTrade;
- if IBKR fails, E*TRADE evidence becomes the active proof lane;
- at least one brokerage has a verified account capability fixture;
- the capability fixture includes account, positions, balances, order
  submission, order status, fills/rejects, and idempotency behavior;
- unsupported broker/account states produce normalized block reasons.

Evidence file:

- Create `docs/plans/snaptrade-capability-proof-YYYY-MM-DD.md` when live
  testing starts.
- Include account numbers only in redacted form.
- Include screenshots/logs only if they do not expose secrets or full account
  numbers.

## Phase 4: Read-Only Account Surfaces

Goal:

Show SnapTrade-backed accounts and positions in PYRUS using the same surfaces
that will later support order entry.

Tasks:

1. Add a normalized API to list connected SnapTrade accounts for the current
   user.
2. Add a normalized API to list positions for a selected account.
3. Include position freshness, source, and last sync time in responses.
4. Include account readiness and trade eligibility in account responses.
5. Add account-level block reasons:
   - not trade-enabled;
   - read-only fallback;
   - reauth required;
   - stale positions;
   - unsupported asset class;
   - missing capability fixture;
   - unknown broker capability.
6. Wire account screen to show SnapTrade accounts for internal users.
7. Keep shadow/demo accounts visually and behaviorally distinct from real
   brokerage accounts.
8. Prevent read-only SnapTrade accounts from appearing as selectable execution
   accounts.

Acceptance:

- internal user can see connected SnapTrade account metadata;
- positions render from SnapTrade for connected accounts;
- account state includes freshness and trading eligibility;
- read-only accounts are visible but blocked for trading;
- no account data crosses user boundaries.

## Phase 5: Order Validation And Submission

Goal:

Submit real orders through SnapTrade from PYRUS while preserving PYRUS safety
gates.

Tasks:

1. Define the canonical PYRUS order intent for SnapTrade-backed accounts.
2. Support equity market and limit orders first.
3. Add single-leg option order support after equity order proof.
4. Map PYRUS order intent to SnapTrade order payload.
5. Normalize symbols using brokerage symbol where SnapTrade recommends it.
6. Add internal order validation:
   - selected account belongs to current user;
   - account is trade-enabled;
   - capability map allows asset class/order type/TIF;
   - quantity and notional fit configured caps;
   - order side is valid for holdings and account type;
   - market session and extended-hours constraints are respected;
   - instrument identity is unambiguous.
7. Use SnapTrade order validation/check/preview endpoints if available for the
   selected order type. If no preview exists, record that explicitly and rely on
   internal validation plus broker submission response.
8. Persist `order_requests` before calling SnapTrade.
9. Generate a client order id where supported.
10. Prevent duplicate submission on retry.
11. Require live-order confirmation in terminal UI.
12. Add dry-run/paper order route if the selected brokerage supports it.
13. Add real-order route only behind internal flag until capability proof
    passes.
14. Normalize SnapTrade/broker errors into the execution decision registry.

Acceptance:

- order button is disabled unless account readiness and capability gates pass;
- every submitted order has an `order_requests` row;
- successful submit creates/updates a `broker_orders` row;
- duplicate request ids do not submit duplicate orders;
- broker rejection does not leave an order in unknown-success state;
- all errors returned to UI use safe normalized messages;
- live orders require explicit user confirmation.

Verification:

```text
pnpm --filter @workspace/api-server exec tsx --test \
  src/services/snaptrade-order*.test.ts \
  src/routes/broker-execution.test.ts
pnpm run audit:api-codegen
pnpm --filter @workspace/api-server run typecheck
```

## Phase 6: Order Reconciliation

Goal:

After submission, PYRUS must know whether the broker accepted, rejected,
filled, partially filled, canceled, replaced, or left the order in an unknown
state.

Tasks:

1. Add order status polling for SnapTrade-backed accounts.
2. Add webhook handling if SnapTrade webhooks are enabled for the app.
3. Persist every status transition.
4. Persist fills in `execution_fills`.
5. Refresh positions and balances after final or material order status changes.
6. Mark stale/unknown order states as blocking for automation.
7. Add retry/backoff for transient SnapTrade failures.
8. Add a reconciliation watchdog for orders that remain pending or unknown.
9. Add manual resync controls for internal operators.
10. Add alerting/logging for failed reconciliation.

Acceptance:

- order status in PYRUS matches SnapTrade/broker state after submit;
- fills are represented as normalized execution rows;
- partial fill, reject, cancel, expired, and unknown states are covered by
  tests;
- automation cannot keep submitting new orders when prior reconciliation is
  stale or unknown;
- user-visible state is clear and not optimistic after broker uncertainty.

## Phase 7: Reconnect, Disable, And Delete

Goal:

Make connection lifecycle safe and support routine reauthorization.

Tasks:

1. Detect disabled/reauth-required SnapTrade connections.
2. Generate reconnect portal URLs using SnapTrade `reconnect`.
3. Sync after reconnect and update connection status.
4. Add disconnect/revoke flow if SnapTrade and product requirements allow it.
5. Add SnapTrade user deletion only for account deletion/privacy workflows.
6. Rotate per-user SnapTrade `userSecret` if exposed or invalidated.
7. Ensure disabled connections immediately block trading and automation.

Acceptance:

- disabled connection cannot submit orders;
- reconnect flow restores accounts without duplicating records;
- deleting/disconnecting a connection marks local accounts inactive;
- secret rotation does not expose old or new secrets to the browser.

## Phase 8: Security, Audit, And Compliance

Goal:

Make the integration safe enough for real customer brokerage accounts.

Tasks:

1. Keep SnapTrade `consumerKey` only in server-side secrets.
2. Keep SnapTrade `userSecret` encrypted at rest.
3. Never expose `userSecret`, `consumerKey`, API signatures, OAuth tokens,
   full account numbers, or raw brokerage credentials to browser logs.
4. Redact provider payloads before logs, errors, and persisted debug metadata.
5. Add audit events for:
   - SnapTrade user registration;
   - portal URL creation;
   - connection completed/synced;
   - reauth/reconnect;
   - account selected for trading;
   - capability map changed;
   - live order confirmation;
   - order submitted;
   - order status reconciled;
   - order rejected/failed/unknown;
   - automation blocked or resumed.
6. Review SnapTrade commercial terms, brokerage terms, and PYRUS product copy
   before public launch.
7. Decide whether counsel review is required before private beta based on
   routing, discretion, advisory/recommendation behavior, compensation, and
   jurisdiction.
8. Add a user disclosure and consent record before live order enablement.
9. Add kill switches:
   - global SnapTrade live trading off;
   - per-user live trading off;
   - per-account live trading off;
   - per-strategy automation off;
   - provider/brokerage off.

Acceptance:

- secret redaction tests cover route/service failures;
- audit records are written for order and connection decisions;
- kill switches fail closed;
- compliance/product approval is documented before external user launch.

## Phase 9: Multi-Tenant Hardening

Goal:

Ensure the SnapTrade work is not a one-user prototype.

Tasks:

1. Treat every SnapTrade credential as owned by an app user and eventually a
   tenant/workspace.
2. Make all account/order routes resolve the authenticated user before loading
   SnapTrade credentials.
3. Prevent account ids from being usable across users.
4. Add tests for cross-user credential and account access denial.
5. Add tenant/workspace columns or mappings when the broader app auth model is
   ready.
6. Keep platform launch eligibility separate from broker authorization.
7. Keep broker authorization separate from automation activation.
8. Record account-level trading permission separately from connection state.

Acceptance:

- user A cannot list, sync, trade, reconnect, or delete user B's SnapTrade
  data;
- account selection is always scoped by authenticated user/tenant;
- routes fail closed when auth context is missing or ambiguous;
- future SnapTrade brokerages can reuse the same tenant/account model.

## Phase 10: Broker-Agnostic Expansion

Goal:

After the first real-order proof, turn SnapTrade into the general brokerage
connection lane.

Tasks:

1. Convert the tested brokerage fixture into a reusable capability-map builder.
2. Add E*TRADE as the second supported fixture if IBKR passes first, or as the
   first fixture if IBKR fails.
3. Add brokerage-specific capability overlays only where SnapTrade data is
   incomplete.
4. Add a provider matrix entry per verified SnapTrade brokerage/account class.
5. Add support for additional brokerages only after:
   - official support page reviewed;
   - internal account fixture connected;
   - positions verified;
   - order submission verified;
   - reconciliation verified;
   - limitations documented.
6. Keep unsupported brokerages connectable only as read-only/internal if product
   wants that diagnostic state.

Acceptance:

- adding a new SnapTrade brokerage does not require a new UI flow;
- launch gating is brokerage/account capability driven;
- unsupported brokers are visible as blocked, not broken;
- user-facing copy is specific about what is ready.

## Launch Gates

### Internal Gate

Can be used by internal/admin users only when:

- SnapTrade app credentials are configured;
- current user can register with SnapTrade;
- current user can launch Connection Portal;
- connected accounts sync;
- read-only fallback is blocked for trading;
- secrets are not exposed.

### Real-Order Proof Gate

Can be considered passed when:

- at least one brokerage account connects through SnapTrade;
- account and positions sync in PYRUS;
- a tiny real equity order, or paper order if available, is submitted from
  PYRUS;
- broker order id is captured;
- order status and fills/rejects are reconciled;
- final positions/balances refresh;
- duplicate submission is prevented;
- all live-order actions are audited.

### Private Beta Gate

Can be considered after real-order proof when:

- at least one brokerage has a documented capability fixture;
- live terminal order flow has confirmations and caps;
- automation activation has caps, kill switches, and reconciliation gates;
- route/API contracts are tenant-safe;
- product/compliance review has signed off;
- support/runbook exists for failed connection, failed order, unknown order,
  disabled connection, and disconnect.

### Public Launch Gate

Blocked until:

- private beta has successful real-order history;
- provider/brokerage limits are documented;
- user-facing onboarding is clear;
- monitoring and incident response are in place;
- account deletion/disconnect/privacy paths are complete;
- legal/compliance obligations are resolved.

## Immediate Next Tasks

1. Add this plan to the session handoff.
2. Build the internal SnapTrade connect UI using existing generated React API
   hooks.
3. Add service/routes for SnapTrade connection and account sync.
4. Map SnapTrade connection/account data into `broker_connections` and
   `broker_accounts`.
5. Add account/position sync and internal account display.
6. Run IBKR Connection Portal test with `trade-if-available`.
7. Record IBKR capability evidence.
8. If IBKR cannot place real orders, run E*TRADE Connection Portal test.
9. Implement equity order validation/submission for the proven fixture.
10. Implement order reconciliation before expanding UI or broker coverage.

## Risks

### IBKR Through SnapTrade Is Not A Real Trading Path

Mitigation: test IBKR first, but pivot to E*TRADE without changing the
SnapTrade architecture. Do not declare IBKR success unless real orders and
reconciliation pass.

### Read-Only Connections Look Like Success

Mitigation: represent read-only as an internal checkpoint and block trading
eligibility. UI must say blocked, not connected-ready.

### Stale Positions Cause Unsafe Decisions

Mitigation: include freshness in account readiness and block automation when
positions are stale or source freshness is unknown.

### Duplicate Order Submission

Mitigation: persist `order_requests` before provider submit, use client order id
where supported, and reject duplicate request ids.

### SnapTrade/Brokerage Capability Is Account-Specific

Mitigation: capability maps belong to the connected account, not just provider
name. Unknown capabilities fail closed.

### Multi-Tenant Data Leak

Mitigation: every SnapTrade lookup starts from authenticated app user and never
trusts a browser-supplied SnapTrade user id, connection id, or account id
without ownership checks.

## Open Questions

- Which deployed URL should SnapTrade use for `customRedirect` during internal
  testing?
- Are SnapTrade webhooks enabled for the current app credentials?
- Which account should be the first tiny real-order fixture?
- What maximum dollar amount should be allowed for the first real-order test?
- Should the first live order be a buy and immediate sell, or a limit order
  designed to avoid fill unless intentionally crossed?
- Does product want read-only SnapTrade connections visible to users later, or
  internal-only forever?
- When should the broader portal launch gate require a connected trade-capable
  account?
- Do we need counsel review before private beta, or only before public launch?

## Definition Of Done

SnapTrade integration is done for this milestone when an internal PYRUS user can
connect a brokerage through SnapTrade, select a connected account, see current
positions, submit a real order from PYRUS with explicit confirmation, and see
the resulting order status/fills/account state reconcile in PYRUS, all without
IB Gateway/TWS or any local installation.
