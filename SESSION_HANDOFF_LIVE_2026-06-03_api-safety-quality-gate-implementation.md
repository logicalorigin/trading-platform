# Live Session Handoff: API Safety And Quality-Gate Implementation

- Session ID: pending
- Saved At (MT): `2026-06-03 21:47 MDT`
- Saved At (UTC): `2026-06-04T03:47:45Z`
- CWD: `/home/runner/workspace`
- User request: implement the accepted plan for API auth/CORS, cancel-order safety, failing API suites, shadow weight semantics, and route timeout policy.

## Supersession Note

- `2026-06-04 UTC`: The main PYRUS API browser session gate from this workstream was removed at user request. Do not restore `PYRUS_API_SESSION_SECRET`, `PYRUS_ADMIN_API_TOKEN`, `PYRUS_ADMIN_API_NEXT_TOKEN`, `PYRUS_API_CORS_ORIGINS`, `/api/auth/session`, `ApiAuthGate`, or default cookie credentials for generated API fetches as part of resuming this handoff.

## Current Status

- Implementation is complete for this workstream.
- `SESSION_HANDOFF_CURRENT.md` still points at the unrelated PYRUS loader session; I did not repoint it to avoid taking over that active handoff.
- The worktree still contains unrelated loader/Replit startup changes that predated this slice, including `.replit`, `artifacts/pyrus/index.html`, `artifacts/pyrus/src/app/App.tsx`, `artifacts/pyrus/src/components/LogoLoader.test.ts`, `artifacts/pyrus/src/index.css`, and `artifacts/pyrus/src/app/bootLoaderHandoff.ts`. Do not revert them as part of this API work.

## Completed Work

1. API auth/CORS boundary:
   - Added stateless HMAC session-cookie auth and admin-token login/logout/session routes.
   - Added configured credentialed CORS handling and left public health/auth/marketing routes open.
   - Added `.env.example` entries for API session/admin token configuration.
2. Pyrus API auth gate:
   - Added `ApiAuthGate` with cookie-based session check and admin-token form.
   - Wrapped Pyrus app content and made generated API fetches include credentials by default.
3. Cancel-order safety:
   - Added required cancel `mode` to OpenAPI/generated clients/zod schemas.
   - Routed scoped/global cancel calls through explicit paper/live mode and preserved live confirmation checks.
   - Updated Account screen cancel payloads to send mode.
4. Half-baked API suite repairs:
   - Fixed Massive env setup in `flow-premium-distribution.test.ts`.
   - Fixed retained flow-scanner option leases so same-owner single-contract refresh replaces, but multi-contract retained batches and other owners survive.
   - Fixed bars/option-chain fallback behavior around broker recovery, live-edge retry budget, cache scope, and expiration-batch concurrency/retries.
5. Shadow account weights:
   - Added `accountWeightPercent` and `scopedWeightPercent` to `AccountPositionRow`.
   - Preserved `weightPercent` as the current response-scope weight for compatibility.
   - Source/asset-class filtered Shadow rows now expose both full-account and scoped percentages, including cached filtered responses and historical rows.
6. Route timeout policy:
   - Added explicit Signal Options route timeout policy entries.
   - State/cockpit dashboard reads are documented as `continue-in-background` because they refresh shared caches.
   - Manual Signal Options and Overnight Spot scans are `abort-at-route-budget`.
   - Overnight Spot scan now accepts/checks `AbortSignal` before side-effectful event/order work.

## Validation

Passed:

- `pnpm --filter @workspace/api-server exec tsx --test src/routes/api-auth.test.ts src/routes/marketing.test.ts src/services/order-gateway-readiness.test.ts src/services/flow-premium-distribution.test.ts src/services/market-data-admission.test.ts src/services/bridge-option-quote-stream.test.ts src/services/option-chain-batch.test.ts src/services/shadow-account.test.ts src/services/automation.test.ts src/services/overnight-spot-execution.test.ts` - 298/298.
- `pnpm --filter @workspace/api-server exec tsx --test src/services/route-admission.test.ts` - 14/14.
- `pnpm --filter @workspace/api-server run typecheck`.
- `pnpm --filter @workspace/pyrus exec tsx --test src/app/ApiAuthGate.test.ts` - 3/3.
- `pnpm --filter @workspace/pyrus run typecheck`.
- `pnpm --filter @workspace/api-zod exec tsc -p tsconfig.json`.

Expected guard behavior:

- `node lib/api-spec/run-codegen.mjs` regenerated Orval client/zod files, then failed at its built-in `pnpm -w run typecheck:libs` step with exit 75 because the live PYRUS/Replit runtime is hot. I did not override `PYRUS_ALLOW_HOT_VALIDATION`.

Startup guard note:

- `pnpm run audit:replit-startup` failed because the already-dirty `.replit` exposes an extra `19122 -> 80` port. AGENTS.md requires an explicit startup maintenance window before editing Replit startup config, so I did not change `.replit` in this routine API slice.

## Next Recommended Steps

1. Review and land this API safety/quality diff separately from the unrelated loader/Replit startup diff.
2. Open an explicit Replit startup maintenance window if the `.replit` extra port should be removed, then rerun `pnpm run audit:replit-startup`.
3. Restart through the default Replit app runner after landing so the regenerated API bundle and auth gate are active.
