# WO-08 Schwab Equity Order Routes Report - 2026-07-07

## Routes registered

- `POST /broker-execution/schwab/accounts/:accountId/orders/preview`
- `POST /broker-execution/schwab/accounts/:accountId/orders`
- `POST /broker-execution/schwab/accounts/:accountId/orders/cancel`

## Guard chain used

- `requireEntitlementCsrf("broker_connect")`
- Zod body parse via generated `@workspace/api-zod` body schema
- `readSchwabReadiness()` route preflight; rejects when `configured === false`
- Delegates to the existing Schwab equity order service
- Parses service output with the generated response schema before returning JSON

The service still owns per-account execution gating and attended confirmation behavior:

- Submit requires `confirm === true`.
- Preview/submit/cancel call service-level `assertExecutionReady`.
- Current Phase 0d blocked accounts still return `409 schwab_account_execution_blocked`.

## Spec and codegen

- `lib/api-spec/openapi.yaml` already contained all three Schwab order paths and schemas.
- No OpenAPI edits were made.
- No generated client output was changed.
- `rg -n "openapi" package.json artifacts/api-server/package.json lib/*/package.json` found no repo package script to regenerate from OpenAPI.

## Test evidence

- `pnpm --filter @workspace/api-server test -- schwab`
  - Exited 0 with no output; observed as a no-op in this workspace.
- `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/routes/broker-execution.test.ts src/services/schwab-equity-orders.test.ts src/services/schwab-oauth.test.ts src/services/schwab-account-sync.test.ts`
  - Passed: 73 tests, 0 failures.
- `pnpm --filter @workspace/api-server run typecheck`
  - Passed.

## Service workarounds

- No service code was changed.
- `schwab-readiness.ts` currently exposes `unconfigured` and `research_required`, not a ready status. The route-level readiness preflight treats `configured === false` as not ready and lets configured-but-research-required traffic reach the existing service account execution gate.
- A route-local `__brokerExecutionRouteInternalsForTests` test hook was added so route tests can mock Schwab readiness and service delegation without changing the service implementation.
