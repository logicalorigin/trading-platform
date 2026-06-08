# ADR-001: Use Portal-Gated One-Time Handoff For Platform Launch

## Status

Accepted

## Date

2026-06-08

## Context

PYRUS is becoming a hosted SaaS where users log into a website portal, connect
their own broker, and then launch the trading platform. The platform must not
be the first PYRUS login gate for ordinary users. After launch, it is the
user's PYRUS workspace and owns broker-session continuity and broker reauth.
No PYRUS surface may collect broker credentials in a terminal popover or form.

The website dashboard may show a read-only shadow/demo account before broker
connect, but unconnected users must not enter the trading platform. Customer
broker credentials must never be entered into PYRUS; broker authorization
happens at broker-hosted OAuth/consent or aggregator-hosted connect surfaces.

## Decision

Use the website portal as the app auth gate and launch authority.

- Portal owns Better Auth app sessions, dashboard access, first-time broker
  connect UX, launch eligibility, and launch handoff issuance.
- `Launch platform` is disabled until the tenant has at least one valid
  live-capable automation-grade customer broker connection, or a recoverable
  broker reauth path.
- Platform launch uses a one-time tenant/workspace handoff code, not a bearer
  JWT in a URL.
- The platform server exchanges the handoff code through a portal-owned
  server-to-server endpoint and then creates a short-lived platform session.
- Handoff codes are stored only as hashes, are single-use, have short TTLs, and
  are stripped from browser-visible URLs immediately after exchange.
- The platform must not read portal handoff storage directly; the portal remains
  the handoff validation and atomic-consumption authority.
- The portal handoff exchange endpoint must require authenticated
  service-to-service calls from an allowlisted platform service identity and
  must rate-limit malformed, replayed, and unauthorized exchange attempts.
- Handoff codes are bound to the expected platform origin and normalized return
  path, not arbitrary full URLs.
- Failed exchange renders a platform-owned blocked launch screen with a
  return-to-portal action instead of an automatic redirect loop.
- The launched platform workspace is the user's isolated PYRUS instance:
  tenant/account-scoped orders, fills, positions, settings, manual trading,
  and automation controls inside a shared SaaS platform by default.
- Customer v1 uses one tenant/workspace per user. Enterprise/org accounts,
  multi-member tenant membership, org roles, support impersonation, and
  workspace switching are deferred until a separate contract is approved.
- The platform session authenticates tenant/workspace entry only. Account
  authority, broker connection state, execution permission, capability support,
  and kill switches are re-checked server-side for account/order/stream routes.
- Platform session cookies are httpOnly, secure, sameSite, short-lived,
  revocable, and stored server-side only as hashes.
- Broker account selection, caps, strategy activation, paused automation, and
  terminal order readiness are platform/workspace states after launch; they are
  not portal launch blockers.
- Platform/broker adapters own durable broker authorization state, broker
  token/reference storage, token refresh, broker reauth, execution,
  reconciliation, and execution audit.
- The terminal starts broker-hosted/OAuth reauth when an adapter supports a
  clean hosted flow. If the provider requires a full reconnect/setup reset,
  the terminal blocks trading and sends the user to the portal for setup; that
  is not the routine reauth path.
- Reauth success updates broker authorization state, then goes through account
  sync/reconciliation before order or automation routes are re-enabled.
- Reauth must not automatically resume automation paused by unknown state,
  disconnect, revoke, or failed reconciliation.
- No customer-facing PYRUS surface collects broker usernames, passwords, API
  keys, or API secrets without a separate approved exception.

## Alternatives Considered

### Bearer JWT In Launch URL

Pros: simple to implement.

Cons: URLs leak through browser history, logs, analytics, screenshots, and
referrers. A bearer token in a URL is too easy to misuse for account/order
access.

Rejected.

### Platform Has Its Own Login

Pros: platform can be independently deployed.

Cons: creates two app auth systems, duplicated session logic, and confusing
user entry paths. It also conflicts with the website portal becoming the
customer account home.

Rejected for v1.

### Platform Reads Shared Handoff Store

Pros: fewer network calls if portal and platform share infrastructure.

Cons: spreads handoff validation, replay handling, expiry, and audit authority
across two services. It also couples the platform to portal storage internals.

Rejected. The platform must use the portal-owned server-to-server exchange
endpoint.

### Auto-Redirect On Failed Exchange

Pros: fewer visible error states for users.

Cons: redirect loops hide launch failures, make replay/expiry bugs harder to
debug, and can obscure security audit events.

Rejected. Failed exchange terminates on a platform-owned blocked launch screen
with a return-to-portal action.

### First-Time Broker Connect Inside Platform

Pros: user can launch immediately and complete setup inside the terminal.

Cons: reintroduces setup/auth into the workspace, encourages popover-style
credential UX, and weakens the portal dashboard as the account control center.

Rejected for ordinary customer v1.

### Routine Broker Reauth In The Website Portal

Pros: centralizes all broker-auth UI in one customer dashboard.

Cons: breaks the launched-workspace model. Once a user is operating inside
PYRUS, broker reauth should feel like part of that workspace, just as a broker
portal can prompt for account authorization without asking the user to restart
from a marketing/dashboard site.

Rejected for routine reauth. Portal remains the place for first-time setup and
full reconnect/setup reset.

## Consequences

- Portal and platform need a stable handoff/session contract with portal-owned
  handoff exchange.
- Platform APIs must authorize every account/order/stream request from the
  platform session and server-side account state.
- Platform session validity alone must never authorize account access, order
  mutation, streaming subscriptions, or automation changes.
- CSRF or equivalent same-site mutation protection is required for browser
  mutations, especially order submit/replace/cancel.
- Broker token/reference storage and reauth orchestration belong behind the
  platform/broker-adapter boundary, not in browser-visible flows.
- Broker-hosted/OAuth reauth attempts must be state/PKCE/replay protected,
  tenant/workspace scoped, and audited.
- Broker reauth callback endpoints are external input boundaries. They validate
  the active attempt, state/PKCE, provider identity, expiry, redirect binding,
  and tenant/workspace/connection ownership rather than relying on browser
  session presence alone.
- Full reconnect/setup reset remains a portal flow; ordinary recoverable reauth
  remains a platform workspace flow.
- Credential-capture attempts in customer-facing PYRUS must fail closed and be
  audited.
- Audit events are immutable and append-only. They store normalized decision
  context for launch, handoff, session, broker, automation, order, and
  reconciliation decisions without storing raw sensitive payloads.
- Customer-facing activity history is a sanitized projection from audit events,
  not the raw internal/compliance audit stream.
- Customer-facing activity endpoints are tenant/workspace scoped,
  cursor-paginated, and separate from any internal/compliance audit export.
- Raw broker/OAuth/session secrets, full cookies, authorization headers, raw
  broker payloads, and full broker account numbers must never be stored in audit
  events or exposed through customer activity.
- If a broker callback terminates on the portal, raw returned token material is
  forwarded to the platform over a server-to-server channel and discarded by
  the portal after platform storage succeeds.
- Demo/shadow is explicitly read-only and non-tradable.
- Handoff and broker lifecycle events must be auditable across both systems.
- Portal automation status can deep-link into the platform workspace, but direct
  customer trading activation/pause/resume controls remain platform-owned for
  v1 unless a separate execution-control contract is approved.
