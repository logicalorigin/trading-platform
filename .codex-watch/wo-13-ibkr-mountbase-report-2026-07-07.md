# WO-13 IBKR Client Portal Authenticator Mount-Base Fix

## Root-Cause Recap

Observed in `SESSION_HANDOFF_LIVE_2026-07-03_ibkr-client-portal-hosted-connector.md`: the IBKR login SPA computes its API base from `document.location.pathname.split("/")[1]`. At the hosted subpath mount, `/api/broker-execution/ibkr-portal/gateway/sso/Login`, segment 1 is `api`, so credential XHRs target `/api/Authenticator`, `/api/Dispatcher`, and `/api/report` instead of the gateway's real `/sso/*` handlers.

Chosen fix from the LIVE note: interim option (b), not durable host-root serving. Gateway-referer'd `/api/<X>` requests must be 307 redirected to `/api/broker-execution/ibkr-portal/gateway/sso/<X>`, preserving method and body.

Observed supporting logs:

- `.pyrus-runtime/ibkr-cpg/instances/cc74ab92-6faf-4f2f-b3ef-891ac19a6a19/logs/gw.message.2026-07-04.log:43-46`: `POST /sso/Authenticator` reached the gateway and returned 200 twice.
- `.pyrus-runtime/ibkr-cpg/instances/cc74ab92-6faf-4f2f-b3ef-891ac19a6a19/logs/gw.message.2026-07-04.log:89-92`: later retry also reached `POST /sso/Authenticator` and returned 200 twice.

## Applied Fix

- `artifacts/api-server/src/routes/ibkr-portal.ts:41`: added `getIbkrGatewayReanchorLocation()`, the single route-owned normalization rule.
- `artifacts/api-server/src/routes/ibkr-portal.ts:56`: maps `/api/<X>` to `/sso/<X>` only when the request referer is inside `/api/broker-execution/ibkr-portal/gateway`.
- `artifacts/api-server/src/routes/ibkr-portal.ts:62`: added router middleware that emits a 307 redirect to the normalized gateway mount URL.
- `artifacts/api-server/src/app.ts:23`: imports the route helper.
- `artifacts/api-server/src/app.ts:247`: the app-level pre-router guard now delegates to the route helper, preserving the note's production behavior while keeping the rule testable from the route layer.
- `artifacts/api-server/src/routes/broker-execution.test.ts:650`: regression test covers `/api/Authenticator`, `/api/Dispatcher?locale=en`, and `/api/report` with a gateway referer; each must 307 to the gateway mount's `/sso/*` path.

`artifacts/pyrus/vite.config.ts` was not changed in this work order. It already contains the same dev-server re-anchor guard at `artifacts/pyrus/vite.config.ts:289-313`; any future change there has web dev-server restart implications.

## Verification

- `pnpm --filter @workspace/api-server test -- ibkr-portal` exited 0, but observed no test output because `@workspace/api-server` currently has no `test` script.
- Meaningful targeted test: `pnpm --dir artifacts/api-server exec node --import tsx --test --test-reporter=spec --test-name-pattern 'IBKR portal' src/routes/broker-execution.test.ts`
  - Result: 3 tests, 3 pass.
- Broader route file run: `pnpm --dir artifacts/api-server exec node --import tsx --test --test-reporter=spec src/routes/broker-execution.test.ts`
  - Result: 49 tests, 49 pass.
- Typecheck: `pnpm --filter @workspace/api-server run typecheck`
  - Result: exit 0.
- Scope check: changed only `artifacts/api-server/src/routes/ibkr-portal.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/broker-execution.test.ts`, and this report. `app.ts` is in scope because the LIVE note explicitly named it as part of the chosen fix. No gateway/app restart was performed.

## Manual Retry Procedure

Use the normal app URL:

`https://5950eeb6-fc7d-4b18-87e8-8d1c0536942f-00-36emsiuflovpf.riker.replit.dev/`

Steps for the user/lead:

1. Open Settings -> Broker Connections -> Interactive Brokers Client Portal -> Connect.
2. The app opens the IBKR gateway login at `/api/broker-execution/ibkr-portal/gateway/`.
3. Enter IBKR credentials and complete IBKR 2FA.
4. Fixed mount-base behavior: the popup stays on the IBKR login flow, does not render PYRUS, and does not show the prior `/api/Authenticator` network connectivity failure.
5. Gateway log signal for this fix: fresh log lines should show `POST /sso/Authenticator` returning 200, with no browser-originated `/api/Authenticator` leak. If credentials + 2FA complete, the next positive signal is the gateway's `Client login succeeds`; any later `sso/validate?gw=1 -> 401` is a separate post-2FA gateway/session-bind issue, not this mount-base bug.
