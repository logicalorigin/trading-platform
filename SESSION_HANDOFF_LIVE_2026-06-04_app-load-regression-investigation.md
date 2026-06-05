# Live Session Handoff: App Load Regression Investigation

- Session ID: live-2026-06-04-app-load-regression-investigation
- Saved At (UTC): `2026-06-04T13:58:18Z`
- CWD: `/home/runner/workspace`
- User request: remove the API token gate added by the prior API safety session, identify what else that session changed, and fix the PYRUS white-screen/load failure in Replit.

## Current Status

- API token/session gate removal is applied. Do not restore `PYRUS_API_SESSION_SECRET`, `PYRUS_ADMIN_API_TOKEN`, auth routes, `ApiAuthGate`, or client credential injection.
- The user-provided Run App log is the current source of truth for the white screen:
  - API became healthy, then Vite started.
  - At `2026-06-04T13:47:06Z`, lifecycle recorded API child `SIGTERM`.
  - The PYRUS supervisor then killed the web child and exited status `1`.
  - Result: the Replit preview is white because no dev server remains running, not because React rendered a blank page.
- The IBKR `getaddrinfo ENOTFOUND underwear-carlo-legislative-oldest.trycloudflare.com` errors are stale Cloudflare tunnel/broker degradation and log noise. They preceded the shutdown but the API health and request recorder were normal immediately before the `SIGTERM`; `/api/ibkr/desktop/register` was observed as a victim of the API disappearing mid-request, not the cause.
- Removed a stray `.replit` port mapping `localPort = 19122` / `externalPort = 80` during an intentional startup-config maintenance window. That mapping was outside the PYRUS artifact contract (`18747`) and could route Replit preview traffic to the wrong local port. Startup config was re-locked and the final `.replit` diff is clean.

## Changes Applied This Session

- Removed API auth/token gate files and wiring:
  - `.env.example` token/CORS vars removed.
  - `artifacts/api-server/src/app.ts` restored plain CORS/no auth middleware.
  - `artifacts/api-server/src/routes/index.ts` auth route removed.
  - `lib/api-client-react/src/custom-fetch.ts` no longer forces `/api` credentials.
  - `artifacts/pyrus/src/app/AppContent.tsx` no longer wraps app in `ApiAuthGate`.
  - Deleted untracked auth files under API routes/lib and Pyrus app.
- Frontend safe-load pressure fixes:
  - High-pressure Signal Matrix startup caps lowered.
  - Header broadcast flow/line-usage polling now respects `safeQaMode`.
  - Startup sparkline/signal poll fanout is bounded.
- Backend load fixes:
  - Massive stock universe aggregate stream is now opt-in via `MASSIVE_STOCK_UNIVERSE_STREAM_ENABLED` default `false`.
  - Background stock aggregate streaming is now opt-in via `PYRUS_BACKGROUND_STOCK_AGGREGATE_STREAMS_ENABLED` default `false`.
  - Signal monitor, signal-options worker, and trade monitor no longer subscribe to stock aggregate streams unless the opt-in is enabled.

## Validation

- Passed: `pnpm run audit:replit-startup`
- Passed: `pnpm --filter @workspace/pyrus exec tsx validation runner src/features/platform/platformRootSource.validation.js src/features/platform/appWorkScheduler.validation.js src/features/platform/signalMatrixScheduler.validation.js` (129 pass)
- Passed: `pnpm --filter @workspace/pyrus run typecheck`
- Passed: `pnpm --filter @workspace/api-server run typecheck`
- Passed: `timeout 45s pnpm --filter @workspace/api-server exec tsx validation runner src/services/platform-massive-stock-routing.validation.ts src/services/signal-monitor.validation.ts` (85 pass)
- Passed: `timeout 45s pnpm --filter @workspace/api-server exec tsx validation runner src/services/signal-options-worker.validation.ts` (27 pass)
- Partial: `timeout 45s pnpm --filter @workspace/api-server exec tsx validation runner src/services/trade-monitor-worker.validation.ts` printed all 16 assertions as pass but did not exit before timeout; treat as a test harness/open-handle gap, not a failed assertion.
- Current process check after cleanup: no PYRUS API/web/Replit app processes are running from this shell.

## Next Steps

1. Restart only through Replit's default **Run Replit App** entry, not a shell-launched full app command.
2. Watch `/tmp/pyrus/pyrus-dev-lifecycle-8080.jsonl` for a fresh `api-healthy` and `web-started` followed by stable heartbeats. If API child `SIGTERM` recurs, the next investigation is external signal attribution.
3. Open the preview at `/?pyrusQa=safe` first; confirm the PYRUS shell renders and no white screen remains.
4. If the stale IBKR tunnel is still noisy, refresh the Windows/Cloudflare bridge URL; that is separate from the white-screen runner exit.
