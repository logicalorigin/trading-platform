# Implementation Plan: Multi-Broker Trading Connections

Last reviewed: 2026-05-30

## Overview

Add user-connectable broker accounts beyond IBKR by introducing a provider-neutral broker layer, encrypted credential storage, provider capability gating, and a staged rollout. Webull should be the first new direct connector because its official Connect API supports OAuth account linking and its trading docs cover account, order preview, place, modify, cancel, multi-leg orders, and options workflows.

The current product is IBKR-shaped. `BrokerProvider` is currently only `ibkr`, the database broker enum is only `ibkr`, and trading services call the IBKR bridge directly. The rollout should preserve current IBKR behavior while moving broker-specific logic behind adapters.

## Goals

- Let users connect non-IBKR brokerage accounts from Settings.
- Normalize account, position, order, execution, preview, place, replace, and cancel behavior across providers.
- Preserve the existing IBKR bridge experience and live-trading safety model.
- Support paper/UAT first for each provider before live trading.
- Keep broker account connections separate from market-data provider selection.
- Add broker-specific capabilities without leaking provider-specific payloads into public APIs.

## Non-Goals

- Do not implement legacy TD Ameritrade APIs. Treat TD as Schwab Trader API.
- Do not store broker passwords or expose OAuth/API tokens to the browser.
- Do not enable automation on a new broker until paper/live reconciliation is validated.
- Do not use broker market-data endpoints for unrelated display or research features unless that broker's terms allow it.
- Do not make SnapTrade the default execution path without a separate security, compliance, and product decision.

## Current Repo Context

- API spec: `lib/api-spec/openapi.yaml`
- API server routes: `artifacts/api-server/src/routes/platform.ts`
- API server broker/trading services: `artifacts/api-server/src/services/platform.ts`
- Existing IBKR bridge client: `artifacts/api-server/src/providers/ibkr/bridge-client.ts`
- Normalized IBKR contracts: `lib/ibkr-contracts/src/client.ts`
- DB broker schema: `lib/db/src/schema/broker.ts`
- DB broker enum: `lib/db/src/schema/enums.ts`
- Settings UI: `artifacts/pyrus/src/screens/SettingsScreen.jsx`
- Platform shell/account/trading state: `artifacts/pyrus/src/app/PlatformApp.jsx`

Important current behavior to preserve:

- `/api/broker-connections`, `/api/accounts`, `/api/positions`, `/api/orders`, and `/api/orders/preview` are the core public broker surfaces.
- IBKR live order mutations require explicit confirmation.
- Gateway readiness blocks live mutations.
- Order preview is allowed independently from live order mutation readiness.
- Existing IBKR bridge and remote activation screens must continue to work.

## Architecture Decisions

- Use a `BrokerAdapter` registry. Each provider implements the same normalized interface and declares explicit capabilities.
- Keep public trading APIs normalized. Raw provider order payloads should stay provider-internal; the existing raw IBKR submit flow should become compatibility-only or move under an IBKR-specific route.
- Use feature flags at provider and capability level: connection, account sync, preview, live order placement, replace/cancel, options, complex options, streaming, and automation.
- Use encrypted server-side credential storage for OAuth/API tokens. Browser state should only contain connection status and redacted account metadata.
- Add provider readiness as a first-class concept. A connected broker is not necessarily ready for live trading.
- Treat all third-party responses as untrusted. Validate and normalize before storage or client response.

## Dependency Graph

```text
Provider approvals and official docs
  -> DB enum and encrypted credential storage
  -> OpenAPI/zod/client contracts
  -> BrokerAdapter interface and registry
  -> IBKR adapter compatibility
  -> OAuth connection endpoints
  -> Settings broker connection UI
  -> Webull adapter
  -> Provider-specific trading rollout
  -> Additional broker adapters
  -> Monitoring, reconciliation, and automation gates
```

## Provider Rollout Matrix

| Priority | Provider | Fit | Plan |
| --- | --- | --- | --- |
| P0 | IBKR | Existing production path | Wrap current bridge behind the adapter first with no behavior change. |
| P1 | Webull | Strong first direct connector | OAuth Connect, UAT first, equities/options, preview/place/modify/cancel, later multi-leg options. |
| P1 | tastytrade | Strong options fit | Add after Webull; supports balances/positions, dry-run orders, simple/complex orders, and account streaming. |
| P2 | Alpaca | Easy technical path | Add paper/live trading and options where normalized contracts support it. Good for equity-first users. |
| P2 | Tradier | Simple brokerage API | Add equities/options, preview/place/change/cancel with bearer-token auth. |
| P2 | E*TRADE | Useful retail coverage | Add after OAuth 1.0a and preview-id flow are isolated in adapter. Supports options/spreads. |
| P3 | Schwab | TD successor | Add only after Schwab portal approval and official production docs access. |
| P3 | TradeStation | Advanced active trader fit | Add after core order normalization is stable; supports OAuth scopes for trade/account/market data. |
| Optional | SnapTrade | Breadth accelerator | Evaluate separately for read-only aggregation or delegated trading; not default execution core. |

Providers not recommended for direct v1 execution:

- Robinhood: no broadly supported first-party public retail trading API suitable for this rollout.
- Fidelity: no broadly supported first-party public retail trading API suitable for this rollout.
- Legacy TD Ameritrade: migrated/retired in favor of Schwab.

## Public API Changes

Extend `BrokerProvider`:

```ts
type BrokerProvider =
  | "ibkr"
  | "webull"
  | "tastytrade"
  | "alpaca"
  | "tradier"
  | "etrade"
  | "schwab"
  | "tradestation"
  | "snaptrade";
```

Add or extend normalized response fields:

- `provider`: broker provider identifier.
- `connectionId`: internal broker connection id.
- `brokerAccountId`: internal stable account id used by Pyrus.
- `providerAccountId`: account id/key from the provider, redacted where appropriate.
- `environment`: `paper`, `uat`, `sandbox`, or `live`.
- `capabilities`: per-provider and per-account feature flags.
- `readiness`: connection, credential, account sync, order state, and live-trading readiness.

Add endpoints:

- `GET /api/broker-providers`: list supported providers, capability metadata, flags, and setup requirements.
- `POST /api/broker-connections/:provider/oauth/start`: create OAuth state/PKCE where supported and return redirect URL.
- `GET /api/broker-connections/:provider/oauth/callback`: complete OAuth in providers that redirect with GET.
- `POST /api/broker-connections/:provider/oauth/callback`: complete OAuth in providers that post code/state.
- `POST /api/broker-connections/:connectionId/sync`: manually refresh account metadata.
- `DELETE /api/broker-connections/:connectionId`: revoke/disconnect where supported and mark local connection inactive.

Preserve existing endpoints:

- `GET /api/broker-connections`
- `GET /api/accounts`
- `GET /api/positions`
- `GET /api/orders`
- `POST /api/orders/preview`
- `POST /api/orders`
- `POST /api/orders/:orderId/replace`
- `POST /api/orders/:orderId/cancel`

Order routes should resolve provider from `brokerAccountId` or `connectionId`. Existing IBKR-only fields should stay accepted for compatibility until callers migrate.

## BrokerAdapter Interface

Each adapter should implement:

```ts
interface BrokerAdapter {
  provider: BrokerProvider;
  getCapabilities(): BrokerProviderCapabilities;
  getHealth(connection: BrokerConnectionContext): Promise<BrokerHealth>;
  startOAuth?(input: StartBrokerOAuthInput): Promise<BrokerOAuthStart>;
  completeOAuth?(input: CompleteBrokerOAuthInput): Promise<BrokerConnectionResult>;
  refreshCredentials?(connection: BrokerConnectionContext): Promise<BrokerCredentialRefreshResult>;
  disconnect?(connection: BrokerConnectionContext): Promise<void>;
  listAccounts(connection: BrokerConnectionContext): Promise<BrokerAccountSnapshot[]>;
  listPositions(input: BrokerAccountRequest): Promise<BrokerPositionSnapshot[]>;
  listOrders(input: BrokerAccountRequest): Promise<BrokerOrderSnapshot[]>;
  listExecutions(input: BrokerAccountRequest): Promise<BrokerExecutionSnapshot[]>;
  previewOrder(input: BrokerOrderRequest): Promise<OrderPreview>;
  placeOrder(input: BrokerOrderRequest): Promise<BrokerOrderSnapshot>;
  replaceOrder(input: BrokerReplaceOrderRequest): Promise<BrokerOrderSnapshot>;
  cancelOrder(input: BrokerCancelOrderRequest): Promise<BrokerCancelResult>;
}
```

Optional adapter features:

- Account/order streams.
- Quote or option-chain reads.
- Complex option strategy support.
- Provider-side paper trading.
- Provider-side order dry-run.

Adapters must map provider-specific order status, reject codes, buying power errors, option symbols, time-in-force values, and partial-fill semantics into normalized types.

## Data Model Changes

Extend existing broker schema:

- Add provider enum values.
- Add a stable internal `connectionId`.
- Add `environment` to separate sandbox/UAT/paper/live.
- Add `status`, `lastSyncAt`, `lastHealthyAt`, `lastCredentialRefreshAt`, `revokedAt`, and `metadata`.
- Keep provider account ids separate from internal broker account ids.

Add encrypted credential storage:

- `connectionId`
- `provider`
- `accessTokenCiphertext`
- `refreshTokenCiphertext`
- `tokenType`
- `scopes`
- `expiresAt`
- `refreshStatus`
- `lastRefreshError`
- `createdAt`
- `updatedAt`
- `revokedAt`

Add OAuth state storage:

- `state`
- `provider`
- `codeVerifierHash` or encrypted verifier
- `redirectUri`
- `expiresAt`
- `consumedAt`
- `nonce`

Use `tenant_id = "local"` until real multi-user auth exists, but design tables so tenant/user scoping can be added without changing the adapter contract.

## Security Requirements

- Encrypt broker tokens at rest with AES-256-GCM or the repo's existing secret/KMS mechanism if available.
- Load encryption keys from environment/secrets only.
- Redact access tokens, refresh tokens, OAuth codes, account numbers, and authorization headers from logs.
- Store OAuth state server-side and enforce expiry plus single use.
- Use PKCE whenever a provider supports it.
- Reject callbacks with missing, expired, reused, or mismatched state.
- Do not send provider tokens to the browser.
- Do not store broker passwords.
- Validate provider responses with zod or equivalent schemas before normalizing.
- Mask account identifiers in logs and UI unless the user explicitly needs the full account id.

## Trading Safety Requirements

- Live order mutations require `confirm=true` across all providers.
- Preview never places an order.
- Live order mutation requires provider readiness: valid credentials, account sync freshness, order-state freshness, capability enabled, and live-trading flag enabled.
- Require `clientOrderId` or equivalent idempotency for all submitted orders.
- Persist order request, normalized response, provider response id, and final reconciliation state.
- Never auto-resubmit after a timeout or unknown provider order state. Reconcile first.
- Keep automation disabled per provider until paper and live reconciliation are proven.
- Generalize existing sell-call and position-intent validation so it is not IBKR-specific.

## Implementation Tasks

### Task 1: Finalize Provider Capability Matrix

**Description:** Create the implementation reference matrix for each provider's auth model, environments, account endpoints, order endpoints, preview support, options support, complex-order support, streaming support, rate limits, and approval requirements.

**Acceptance criteria:**

- Webull, tastytrade, Alpaca, Tradier, E*TRADE, Schwab, TradeStation, and SnapTrade have rows.
- Required credentials and scopes are listed.
- Unsupported features are marked as disabled, not unknown.

**Verification:**

- Human review against official docs.

**Dependencies:** None

**Estimated scope:** Small

### Task 2: Extend API and DB Contracts

**Description:** Update public contracts and persistence to represent multiple broker providers and multiple connections.

**Acceptance criteria:**

- `BrokerProvider` includes planned providers.
- Broker connection/account/order responses include provider and connection identity.
- DB schema supports encrypted credentials and OAuth state.
- Existing IBKR responses remain backward compatible.

**Verification:**

- `pnpm run audit:api-codegen`
- `pnpm run typecheck`

**Dependencies:** Task 1

**Estimated scope:** Medium

### Task 3: Add BrokerAdapter Registry

**Description:** Introduce the provider-neutral adapter interface, registry, shared errors, and capability checks.

**Acceptance criteria:**

- Services resolve adapter by provider or broker account.
- Unsupported capabilities return normalized API errors.
- Existing routes can delegate through the registry.

**Verification:**

- API server unit tests for registry resolution and unsupported capability errors.

**Dependencies:** Task 2

**Estimated scope:** Medium

### Task 4: Wrap IBKR Bridge Adapter

**Description:** Move current IBKR bridge calls behind the new adapter while preserving behavior and response shapes.

**Acceptance criteria:**

- Existing account, position, order, preview, place, replace, and cancel behavior still works.
- Current IBKR live-confirmation behavior is preserved.
- IBKR bridge-specific activation and diagnostics screens still work.

**Verification:**

- `pnpm --filter @workspace/api-server run unit validation`
- Focused regression on order gateway readiness tests.

**Dependencies:** Task 3

**Estimated scope:** Medium

### Task 5: Generalize Trading Safety Gates

**Description:** Convert IBKR-specific order mutation readiness into provider-neutral readiness and confirmation checks.

**Acceptance criteria:**

- Live mutations require `confirm=true` for all providers.
- Preview does not require live order readiness.
- Stale account or order state blocks live mutation.
- Idempotency is required for order submission.

**Verification:**

- Provider-agnostic order safety tests.
- Existing IBKR order readiness tests still pass.

**Dependencies:** Task 4

**Estimated scope:** Medium

### Task 6: Implement Credential Vault and OAuth State

**Description:** Store broker credentials securely and support OAuth state/PKCE flows.

**Acceptance criteria:**

- Tokens are encrypted at rest.
- OAuth state is expiring and single-use.
- Disconnect revokes provider tokens where supported and marks local credentials inactive.
- Logs are redacted.

**Verification:**

- Unit tests for encryption/decryption.
- Tests for state mismatch, expired state, reused state, refresh failure, and disconnect.

**Dependencies:** Task 2

**Estimated scope:** Medium

### Task 7: Add Broker Connection Endpoints

**Description:** Add provider listing, OAuth start/callback, manual sync, and disconnect endpoints.

**Acceptance criteria:**

- API exposes supported providers and capabilities.
- OAuth start returns a provider redirect URL where supported.
- Callback creates or updates broker connection records.
- Manual sync refreshes account metadata.
- Disconnect does not delete historical trading records.

**Verification:**

- API route tests.
- `pnpm run audit:api-codegen`

**Dependencies:** Tasks 3 and 6

**Estimated scope:** Medium

### Task 8: Update Settings Broker UI

**Description:** Replace the IBKR-only settings assumption with broker connection tiles and capability-aware controls.

**Acceptance criteria:**

- IBKR remains visible and functional.
- Webull appears as a connectable provider when enabled.
- Disabled providers show clear status and missing setup reason.
- Connected accounts show environment, status, and last sync.
- Tokens and sensitive account identifiers are never shown.

**Verification:**

- `pnpm --filter @workspace/pyrus run unit validation`
- Browser QA with `?pyrusQa=safe`.

**Dependencies:** Task 7

**Estimated scope:** Medium

### Task 9: Build Webull OAuth and Account Sync

**Description:** Implement the first new direct broker adapter using Webull Connect OAuth and UAT.

**Acceptance criteria:**

- Webull OAuth connects successfully in UAT.
- Account list, balances, positions, and orders normalize correctly.
- Token refresh works.
- Webull-specific errors normalize to public API problem responses.

**Verification:**

- Webull UAT integration test where credentials are available.
- Fixture-based adapter mapper tests.

**Dependencies:** Task 7

**Estimated scope:** Medium

### Task 10: Build Webull Manual Trading

**Description:** Add Webull preview, place, modify, and cancel for equities and single-leg options.

**Acceptance criteria:**

- Equity order preview/place/modify/cancel works in UAT.
- Single-leg option preview/place/modify/cancel works in UAT.
- Complex options, futures, crypto, and event contracts are explicitly capability-disabled for v1.
- Live Webull trading is feature-flagged off by default.

**Verification:**

- UAT paper/manual test script.
- Adapter order mapper fixture tests.
- Provider-agnostic live confirmation tests.

**Dependencies:** Tasks 5 and 9

**Estimated scope:** Medium

### Task 11: Add Reconciliation and Audit Logging

**Description:** Make order lifecycle tracking provider-neutral and safe around unknown states.

**Acceptance criteria:**

- Every order request and provider response is auditable.
- Duplicate `clientOrderId` cannot submit a second live order.
- Timeout or unknown state triggers reconciliation, not resubmission.
- Provider rate-limit and auth errors are observable.

**Verification:**

- Unit tests for duplicate submission, timeout, unknown order state, and reconciliation.

**Dependencies:** Task 10

**Estimated scope:** Medium

### Task 12: Add tastytrade Adapter

**Description:** Implement tastytrade after Webull to support the options-heavy user base.

**Acceptance criteria:**

- Sandbox/session auth works.
- Accounts, balances, positions, orders, dry-runs, and simple/complex orders normalize.
- Unsupported strategy types are capability-disabled.

**Verification:**

- tastytrade sandbox tests.
- Shared adapter contract suite.

**Dependencies:** Task 11

**Estimated scope:** Medium

### Task 13: Add Alpaca and Tradier Adapters

**Description:** Add two relatively straightforward API brokers behind the same adapter suite.

**Acceptance criteria:**

- Alpaca paper trading supports account, positions, orders, preview-equivalent validation where available, place, and cancel.
- Tradier supports account, balances, positions, preview, place, change, and cancel.
- Options support is enabled only where normalized contract support is complete.

**Verification:**

- Alpaca paper tests.
- Tradier sandbox/dev tests.
- Shared adapter contract suite.

**Dependencies:** Task 11

**Estimated scope:** Medium per provider

### Task 14: Add E*TRADE, Schwab, and TradeStation Adapters

**Description:** Add remaining direct providers after app approvals and after the shared contracts are stable.

**Acceptance criteria:**

- E*TRADE OAuth 1.0a and preview-id place flow are isolated in its adapter.
- Schwab implementation uses official approved docs only.
- TradeStation scopes and rate limits are respected.
- Each provider ships behind feature flags.

**Verification:**

- Provider-specific sandbox or approval validation.
- Shared adapter contract suite.

**Dependencies:** Task 11

**Estimated scope:** Split into one medium task per provider

### Task 15: Production Rollout and Monitoring

**Description:** Launch providers progressively with observability, rollback, and support playbooks.

**Acceptance criteria:**

- Feature flags exist per provider and capability.
- Webull launches UAT/paper first, then live manual trading.
- Automation remains disabled until reconciliation passes.
- Provider dashboards show token refresh failures, rate limits, API errors, stale sync, rejected orders, and unknown order states.

**Verification:**

- Launch checklist review.
- Rollback drill.
- Metrics and alert review.

**Dependencies:** Tasks 10 and 11

**Estimated scope:** Medium

## Checkpoints

### Foundation Checkpoint: After Tasks 1-5

- API contracts compile.
- IBKR behavior is unchanged.
- Provider-neutral safety tests pass.
- No new provider can place a live order unless explicitly enabled.

### Connection Checkpoint: After Tasks 6-8

- OAuth storage is secure.
- Settings broker tiles work.
- No token or full account-number leakage appears in logs or UI.
- Disconnection leaves historical trading data intact.

### Webull Checkpoint: After Tasks 9-11

- Webull UAT can connect, sync, preview, place, modify, cancel, reconcile, and audit orders.
- Webull live trading is still behind flags.
- Unknown order states do not trigger resubmission.

### Expansion Checkpoint: After Tasks 12-14

- Each added broker passes the shared adapter contract suite.
- Each live capability is explicitly enabled and documented.
- Provider-specific restrictions are visible in the UI before trade entry.

## Test Plan

- Adapter contract tests for every provider's mapper.
- OpenAPI and generated client drift checks.
- Provider-agnostic order readiness tests.
- OAuth callback and token refresh tests.
- Credential encryption and redaction tests.
- UI tests for Settings broker tiles and account selection.
- Browser QA for broker connection flows using `?pyrusQa=safe`.
- Provider sandbox/UAT tests where credentials are available.

Recommended validation commands:

```bash
pnpm run audit:api-codegen
pnpm --filter @workspace/api-server run unit validation
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/pyrus run unit validation
pnpm --filter @workspace/pyrus run browser validation -- --grep broker
pnpm run typecheck
```

If `.replit`, artifact startup config, artifact dev scripts, database startup config, or `scripts/reap-dev-port.mjs` are touched, also run:

```bash
pnpm run audit:replit-startup
```

## Rollout Plan

1. Internal only: IBKR adapter refactor behind flags, no UI behavior change.
2. Internal Webull UAT: connect, sync, preview, and paper/manual order flow.
3. Limited Webull beta: account sync and preview first, then live manual trading for approved users.
4. General Webull manual trading: only after reconciliation and support playbooks are proven.
5. Add tastytrade in sandbox, then paper/manual live.
6. Add Alpaca and Tradier.
7. Add E*TRADE, Schwab, and TradeStation after provider approvals.
8. Revisit SnapTrade only if breadth becomes more important than direct control.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Broker app approval delays | High | Start approval and credential checklist before implementation. |
| Provider order semantics differ | High | Normalize common behavior and expose capability flags for gaps. |
| Duplicate live orders | High | Require `clientOrderId`, persist idempotency, reconcile before retry. |
| Token leakage | High | Encrypt tokens, redact logs, keep tokens out of browser state. |
| Unknown provider order state | High | Never auto-resubmit; reconcile first. |
| OAuth callback abuse | High | Use server-side state, expiry, single-use enforcement, and PKCE where supported. |
| Market-data terms mismatch | Medium | Keep broker account linking separate from market-data provider selection. |
| UI implies unsupported trading capability | Medium | Capability-gate trade controls and show provider restrictions before order entry. |
| SnapTrade custody/trust concerns | Medium | Separate security and compliance review before execution use. |

## Open Questions Before Implementation

- Which providers already have approved developer applications and credentials?
- Is the product single-user/local for this rollout, or should broker credentials be scoped to real user ids immediately?
- Which users should be eligible for Webull live trading beta?
- Should SnapTrade be evaluated for read-only account aggregation, trading, or both?
- What compliance copy, user agreements, and order audit retention period are required before live non-IBKR trading?

## Official Sources Reviewed

- [Webull Connect API](https://developer.webull.com/apis/docs/connect-api/about-connect-api/)
- [Webull OAuth 2.0](https://developer.webull.com/apis/docs/connect-api/oauth2/)
- [Webull Trading API Overview](https://developer.webull.com/apis/docs/trade-api/overview/)
- [Webull Orders](https://developer.webull.com/apis/docs/trade-api/orders/)
- [Webull Options](https://developer.webull.com/apis/docs/trade-api/options/)
- [tastytrade API](https://developer.tastytrade.com/)
- [tastytrade API Basic Usage](https://developer.tastytrade.com/basic-api-usage/)
- [E*TRADE Getting Started](https://developer.etrade.com/getting-started)
- [E*TRADE Account API](https://apisb.etrade.com/docs/api/account/api-account-v1.html)
- [E*TRADE Order API](https://apisb.etrade.com/docs/api/order/api-order-v1.html)
- [Tradier Place Order](https://docs.tradier.com/reference/brokerage-api-trading-place-order)
- [Alpaca OAuth](https://docs.alpaca.markets/docs/oauth-integration)
- [Alpaca Trading API](https://docs.alpaca.markets/docs/trading-api)
- [Alpaca Options Trading](https://docs.alpaca.markets/us/docs/options-trading)
- [Schwab Trader API](https://developer.schwab.com/products/trader-api--individual)
- [TradeStation API Docs](https://api.tradestation.com/docs/)
- [SnapTrade Trading](https://docs.snaptrade.com/docs/trading-with-snaptrade)
- [Planning and Task Breakdown Skill](https://skillsmp.com/skills/addyosmani-agent-skills-skills-planning-and-task-breakdown-skill-md)
