# WO-SEC-1 — P1: gate live-order replace/cancel behind broker_connect entitlement + CSRF

> **HEADLESS FIX WORKER.** No SESSION_HANDOFF_* writes; don't read ~/.claude/, .claude/skills/,
> agents/, AGENTS.md session sections. NEVER restart/reload/signal the app (no REPLIT_MODE=workflow
> — retired), never `git push`. 2-core live box: only listed validations. PRECONDITION:
> `git status --short -- artifacts/api-server/src/routes/platform.ts` clean; if dirty wait 60s ×15
> then BLOCKED. Never `git add -A`. index.lock → sleep 10s, retry. Minimum diff — this is a
> SECURITY fix, match the sibling routes EXACTLY.

## Confirmed defect (adversarial review, verified at source 2026-07-09)

Live-order mutation routes are gated only by the global `requireUser`, missing the
`requireEntitlementCsrf("broker_connect")` guard that the sibling create/submit routes have:

- `router.post("/orders/:orderId/replace")` — artifacts/api-server/src/routes/platform.ts ~:2164
  → `replaceOrder(...)` → services/platform.ts:4889 submits to the broker after only
  `assertLiveOrderConfirmed` + `assertIbkrGatewayTradingAvailable`.
- `router.post("/orders/:orderId/cancel")` — routes/platform.ts ~:2175 → `cancelOrder(...)` →
  services/platform.ts:4909.
- Account-scoped cancel `router...("/…/orders/:orderId/cancel"...)` — routes/platform.ts ~:1918 →
  `cancelAccountOrder(...)` → services/account.ts:8547.

Correct sibling pattern (COPY it): `/orders` (:2117) and `/orders/submit` (:2129) both call
`await requireEntitlementCsrf("broker_connect")(req);` as the first line of the handler.

Impact: any authenticated member (no broker entitlement, no CSRF token) can cancel or replace a
live IBKR order. Real money, live broker.

## Mandate

1. Verify the exact line numbers by grep (they may have drifted). For EACH of the three routes
   above, add `await requireEntitlementCsrf("broker_connect")(req);` as the first statement of the
   handler, identical to the create/submit routes. Do NOT change the handler bodies otherwise.
2. Grep the WHOLE routes file for EVERY other route that reaches `replaceOrder`, `cancelOrder`,
   `cancelAccountOrder`, `submitOrder`, or any broker-mutating service call, and confirm each is
   gated — report the full inventory (route → guard present? y/n). Fix any other ungated
   live-mutation route the same way; if a route is intentionally unguarded (e.g. read-only
   preview), note why.
3. If `requireEntitlementCsrf` isn't already imported in the file, it is (the create routes use
   it) — confirm, don't re-import.

## Tests

Add to the existing route-auth test file (find it: `rg -ln "requireEntitlementCsrf|orders.*cancel|broker.*gate" artifacts/api-server/src/**/*.test.ts`):
- replace/cancel/account-cancel WITHOUT broker_connect entitlement → rejected (403/entitlement
  error) BEFORE any broker call (assert the broker client is not invoked — spy/mock per existing
  test patterns).
- WITH entitlement + CSRF → passes the guard (existing happy-path behavior).

## Validation
1. `pnpm --filter @workspace/api-server run typecheck` → EXIT 0.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit <the route-auth test file(s)>` → 0 fail; counts.

## Files you may touch
- `artifacts/api-server/src/routes/platform.ts`
- ONE route-auth test file

## Commit
`fix(security): gate live-order replace/cancel/account-cancel behind broker_connect entitlement + CSRF (WO-SEC-1, P1)` + evidence lines (the three routes, the sibling pattern, the full inventory result).

Do NOT push. Report: `.codex-watch/wo-sec-1-report.md` with the full route→guard inventory; final message 3 lines.
