# WO-09 Schwab Reauth Report - 2026-07-07

## State Machine

| Backend state | Reason / blocker | UI state | CTA |
|---|---|---|---|
| `unconfigured` | missing app credentials, redirect base URL, or encryption key | idle / missing prerequisites | `Connect` disabled |
| `research_required` | configured, no user reauth blocker; Schwab still has provider/order-tooling limitations | connected when user is connected, otherwise idle | `Connect`, `Reconnect`, or `Sync now` by user state |
| `reauth_required` | `broker_reauth`; `refresh_expired_or_revoked` or `refresh_expires_soon` | impaired broker card | `Reconnect Schwab` primary |

## Classifier Rules

- Schwab app docs used: `https://developer.schwab.com/user-guides/apis-and-apps/oauth-restart-vs-refresh-token` and `https://developer.schwab.com/user-guides/get-started/authenticate-with-oauth`.
- OAuth source used: RFC 6749 `invalid_grant` maps an invalid, expired, or revoked authorization grant / refresh token: `https://datatracker.ietf.org/doc/html/rfc6749`.
- `error=invalid_grant` on a 400/401 token-refresh response is classified as `refresh_expired_or_revoked`.
- Network errors, 5xx, malformed token responses, and non-`invalid_grant` OAuth errors stay `transient_or_unknown` and continue to surface as token refresh failures.
- On `refresh_expired_or_revoked`, `getSchwabAccessToken` marks the Schwab credential row expired by setting `status="expired"`, clearing `accessTokenExpiresAt`, and moving `refreshTokenExpiresAt` to `now`, then throws `409 schwab_reconnect_required`.

## Test Evidence

- `pnpm --filter @workspace/api-server exec tsx --test src/services/schwab-oauth.test.ts src/services/schwab-readiness.test.ts` - 14 passed.
- `pnpm --filter @workspace/pyrus exec node --test src/screens/settings/schwabConnectModel.test.mjs` - 2 passed.
- `pnpm --filter @workspace/api-server run typecheck` - passed.
- `pnpm --filter @workspace/pyrus run typecheck` - passed.
- `pnpm run audit:api-codegen` - passed; generated API clients current.

## Scope Notes

- Touched WO-09 implementation files plus required contract/generated files for `GET /broker-execution/schwab/readiness`.
- Existing working tree contains many unrelated dirty files from other lanes; those are not part of this report.
- No order-route logic was changed for WO-09. `broker-execution.ts` was touched only to pass current user readiness into Schwab readiness composition.
