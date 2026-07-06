# Schwab "Make-Tradable" Audit — decision-grade (2026-07-06)

> Produced by a 4-reader + synthesis audit workflow (wf_daa05f1d-bf4) over the Schwab
> subsystems: order path, execution gating, token/session, readiness/ADR-002. Compiled
> when the user asked to make Schwab tradable (readiness + executable promotion). Branch: main.

## Verdict up front

**DO NOT flip Schwab executable. Schwab today is a read-only, connect-and-sync integration.
There is no order-placement path at all — not a stubbed one, an *absent* one.** Flipping the
readiness/gating flags without building the order client, order service, order route,
safety-gate reads, and a token-durability strategy would either (a) do nothing, or (b) if the
flags were ever wired to future order code, arm a live real-money path with no fill
confirmation, no cancel/replace, and no working safety gates. Two independent structural
blockers (missing order path + Schwab's 7-day refresh wall) make **unattended** trading
impossible today. The current `executionReady:false` + `order_tooling_unverified` +
`PROVIDER_RESEARCH_REQUIRED` posture is **correct and should stay** until the order path is
built and fixture-verified.

## BUILT vs ABSENT

**Built (real, working):**
- OAuth2 token custody — per-user tokens in `schwab_user_credentials`, AES-256-GCM at rest with
  per-field AAD (`schwab-user-custody.ts:126-185`, `lib/db/src/schema/schwab.ts:18-46`).
- On-demand token refresh with 60s skew; correctly preserves the non-extendable 7-day refresh
  wall and detects crossing → `409 schwab_reconnect_required` (`schwab-oauth.ts:303-371`).
- Two READ endpoints only: `getAccountNumbers()`, `getAccounts()` (`trader-api-client.ts:75-98`).
  The private `request()` is hardcoded `method:"GET"`, no body param (line 44) — writes are
  structurally impossible.
- Account sync (`schwab-account-sync.ts`), readiness surface, `BROKER_CONNECT` entitlement gate.

**Absent (entirely missing, not half-built):**
- Every order op: place/preview/replace/cancel/get-order/list-orders — all absent.
- Safety-gate reads: positions (`?fields=positions` omitted), transactions — absent.
- No `schwab-equity-orders.ts` service; no `/broker-execution/schwab/.../orders` route; no order
  JSON model. Readiness ceiling is `research_required` (no higher enum). No `schwab` row in the
  classification table — and that table is informational with zero runtime importers.

## The real gate

The classification `executionAllowed` table is **inert** (nothing consumes
`decideProviderClassification`). The only thing that blocks a live order is the runtime
`executionReady` capability + `executionBlockers` check (SnapTrade pattern,
`snaptrade-equity-orders.ts:475-485, 565-581`). So the work is order-path + runtime gating, not
the table.

## S1 blockers (all three must clear before any executable flip)

1. **Order path doesn't exist** — absent, not incomplete. GET-only client, no service/route/model.
2. **Safety gates not satisfiable** — no order-read/cancel/replace/positions/transactions, so even
   a submitted order could not be fill-confirmed, canceled, or reconciled (ADR-002:58-60 fail-closed).
3. **7-day refresh wall breaks unattended trading structurally** — refresh token dies 7 days after
   the user's last browser auth and never extends; re-auth is browser/consent-gated (no headless).
   There isn't even a warm-refresh loop keeping tokens alive within the window. **Schwab cannot meet
   an "unattended/offline" promise without an attended weekly-reconnect posture.**

Lower: S2 "premature real order" risk (partial flip of gates before safe reads exist);
S2 order-route auth ambiguity (SnapTrade orders use `requireAdminCsrf`, reads use entitlement CSRF).

## Phased plan (if we proceed)

- **Phase 0 — build the order path, keep ALL gates blocked.** Add method+body `request()`, then
  place/preview/replace/cancel/get-order/list-orders + positions + transactions to the client; add
  the order JSON model; build `schwab-equity-orders.ts` + Zod contracts; register routes **behind
  the existing block** (readiness still blocked, accounts still `executionReady:false`). Verify every
  method against a **live authorized Schwab fixture** (confirm cancel/replace/fill-read work before
  trusting submit). **USER DECISION #1:** order-route auth model (`requireAdminCsrf` vs entitlement).
- **Phase 1 — token durability + ADR-002 activation.** **USER DECISION #2 (product):** attended
  weekly-reconnect vs unattended (Schwab cannot do unattended past 7 days — recommend attended +
  prominent reauth blocker). Build the `TradingPermission` record (caps/kill-switches/disclosures/
  freshness/reconciliation; authorization ≠ activation, ADR-002:47-53) + warm-refresh + stale
  `broker_reauth` blocker.
- **Phase 2 — flip gates fact-driven, LAST and together.** Replace the blanket
  `order_tooling_unverified` blocker with fact-driven blockers; grant `execution-ready` only when
  clean; make readiness `executionDecision` status-conditional + add status tiers/capability-map/
  TradingPermission fields to `SchwabReadinessResponse` (openapi + regen). Per-order confirmation for
  terminal orders. **USER DECISION #3:** final go/no-go (official-doc verified; no exception path,
  ADR-002:61-64).

## Strategic note

The platform's thrust (the IBKR OAuth 1.0a work) is **unattended overnight auto-trading**. Schwab's
7-day refresh wall makes it structurally unsuitable for that — the same shape of finding as IBKR CP
Gateway being unsuitable for central hosting. If unattended is the requirement, Schwab is an
attended-only broker; decide whether the order-path build is worth it on that basis.
