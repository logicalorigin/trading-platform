# ADR-002: Use Automation-First Broker Scope And Permission Contract

## Status

Accepted

## Date

2026-06-08

## Context

Phase 0 established that the website portal is the launch authority and that
the platform owns account, order, automation, reauth, and audit enforcement
after launch. Phase 1 needs a product and permission contract that prevents a
connected broker account from being mistaken for a live automation-ready
execution account.

PYRUS must support supervised terminal orders and fully automated strategy
orders without weakening safety. Broker providers vary in scopes, account
identity, order preview, cancel/replace, status freshness, options support,
reauth, and token custody. Some provider links are read-only, paper-only,
manual-only, submit-only, or market-data-only; those must not become customer
v1 execution success paths by accident.

## Decision

Use `automation_trading_connection` as the only customer v1 success-path broker
connection type for live automation-capable execution.

- Minimum safe execution scope requires account, positions, orders, executions,
  submit, and manage access.
- `market_data` is excluded from the default broker scope. It can be requested
  only when a provider requires broker market data for order validation.
- V1 execution supports stocks and single-leg options. Multi-leg spreads and
  combo orders are deferred.
- Every provider/adapter must produce an account-specific capability map before
  activation, terminal order enablement, or automation order submission.
- Multi-provider private beta uses IBKR as a special connector and prioritizes
  SnapTrade as the first aggregator-backed non-IBKR execution candidate before
  direct OAuth, subject to official-doc verification, a named selected
  brokerage/account fixture that proves stocks and single-leg options, and
  compliance/product sign-off.
- Read-only, manual-only, submit-only, paper-only, demo, and shadow links are
  insufficient for customer v1 automation execution.
- Broker authorization and automation activation are separate. A
  `TradingPermission` record with caps, disclosures, kill switches, freshness,
  and reconciliation gates is required before automation can become active.
- Private beta requires explicit user-configured account and strategy caps, but
  does not define PYRUS hard numeric default caps. Missing or unlimited caps
  block activation; customer cap changes are audited and re-run activation
  gates without internal approval by default.
- Terminal orders may use the same activated account permission, but every live
  terminal order still requires per-order confirmation.
- Provider limitations are normalized into scope, capability, freshness, or
  permission decisions. They are not handled as ad hoc route exceptions.
- Unknown provider capability, stale account/order state, missing audit
  durability, active kill switches, failed reconciliation, and changed scopes or
  capabilities fail closed.
- Private-beta live automated execution does not allow
  `eligible_after_exception`; provider rows must pass normal eligibility or
  remain blocked/research-only. Exception-style provider approval is deferred to
  future/non-live or separately approved product contracts.

## Alternatives Considered

### Treat Any Connected Broker As Tradable

Pros: simpler launch and fewer product states.

Cons: connection does not prove order management, fills, cancel/replace,
freshness, or options capability. This would allow unsafe execution paths and
make reconciliation unreliable.

Rejected.

### Support Read-Only And Manual-Only As V1 Success Modes

Pros: wider provider compatibility and faster onboarding.

Cons: weakens the automation-first product contract, adds confusing partial
states, and risks letting customers believe a broker is ready for live strategy
execution when it is not.

Rejected for customer v1. These can exist as research/demo states later only
with a separate product contract.

### Global PYRUS Order Capability List

Pros: easier UI and fewer provider-specific branches.

Cons: provider/account support for order types, TIFs, sessions, routes,
brackets, trailing stops, OCO/OSO, cancel/replace, and preview differs. A
global list would either overpromise or unnecessarily block capable accounts.

Rejected. Capability is account-native through adapter-reported maps.

### Raw Broker Payload Pass-Through

Pros: fastest way to expose provider-specific features.

Cons: bypasses normalized order intent, caps, audit, idempotency, capability
checks, and reconciliation. It also leaks provider internals into public APIs.

Rejected.

## Consequences

- Phase 1 implementation must define broker scope constants, capability maps,
  provider classification, permission states, execution gate evaluators, and one
  canonical decision-code registry before new customer execution routes are
  exposed.
- New customer-facing multi-tenant execution routes use `/api/platform/...`.
  Existing generic order/account/broker-connection routes remain
  migration/internal surfaces unless they are explicitly wrapped with
  platform-session middleware, tenant/workspace/account authorization, and API
  contract review before customer exposure.
- Provider docs and aggregator behavior must be verified from primary sources
  before a provider is marked private-beta eligible.
- Once live customer trading depends on a provider, official provider or
  aggregator docs must be reviewed on every provider-related implementation
  change and at least monthly, with source refs and material changes recorded.
- Direct OAuth remains a second-wave research lane, but no direct-OAuth broker
  is named in Phase 1. If the SnapTrade-first aggregator path fails the
  safety/compliance bar, Phase 3 provider research chooses the replacement lane
  from current official docs rather than inheriting a preselected backup
  provider.
- Generic SnapTrade capability is insufficient for private-beta readiness; the
  selected underlying brokerage/account fixture must prove the supported order
  shapes before Phase 3 can pass.
- The selected SnapTrade brokerage/account fixture is intentionally deferred to
  a Phase 3 research spike; SnapTrade remains research-only until that spike
  names and proves the fixture.
- SnapTrade failure fallback selection is intentionally deferred to Phase 3
  provider research. No backup aggregator, direct OAuth broker, or embedded
  brokerage/BaaS lane is named in Phase 1.
- Public automated live execution is gated by documented internal
  product/security review for customer v1. External securities counsel review
  is a deferred escalation path, not the default public-launch blocker, unless
  provider terms, jurisdiction, discretionary routing, advisory/recommendation
  behavior, payment/order-routing arrangements, or regulatory status become
  unresolved.
- API responses and customer-facing copy must expose normalized decision codes
  and message keys from the canonical registry, not raw provider payloads,
  local evaluator-only codes, or internal adapter details.
- Phase 1 policy/evaluator modules must be pure domain functions. They do not
  read Express request/response objects, DB clients, provider clients,
  env/global state, clocks, network, persistence, or audit sinks. Route,
  service, and adapter layers fetch facts, inject time/freshness context,
  perform side effects, and call registry-backed evaluators.
- Audit events must record normalized allow/block decision context for scope,
  capability, permission, freshness, risk, kill-switch, and provider-result
  gates.
