# Live Session Handoff - Accounts Real/Shadow Cleanup

- Session ID: pending
- Saved (MT): `2026-06-04 19:01:35 MDT`
- Saved (UTC): `2026-06-05T01:01:35Z`
- CWD: `/home/runner/workspace`
- TTY: not a tty
- User request: finish the account/real-shadow positions and option quote cleanup slice referenced in `SESSION_HANDOFF_2026-06-04_019e94a9-bc59-7e40-93d2-8f113348cca2.md`, then run a full bug hunt and cleanup on the real and shadow account pages.

## Current Scope

- Focus files: `artifacts/api-server/src/services/account.ts`, `shadow-account.ts`, `account-page-streams.ts`, `account-position-model.ts`, `bridge-option-quote-stream.ts`, plus account page display/quote files under `artifacts/pyrus/src/screens/account/` and `artifacts/pyrus/src/features/account/`.
- Preserve unrelated dirty work across Signal Matrix, GEX ingest, Python compute, diagnostics, generated API clients, and other sessions.
- Replit startup config is locked with `pnpm run replit:config:lock`.

## What Changed This Continuation

- Fixed `AccountScreen.jsx` so `prefetchAccountSectionLiveQueries()` itself returns early when `accountQueriesEnabled` is false. This closes the safe-QA live-prefetch leak path through account-section intent callbacks, not just the active prefetch effect.
- Updated `accountSafeQaFixtures.test.js` to guard the stronger callback-level safe-QA invariant and the active prefetch effect gate.
- Fixed `account-page-streams.ts` critical cache diagnostics so real-account critical reads still record `criticalMisses` after account-page live/snapshot caches were removed.
- Updated `account-page-streams.test.ts` to assert the diagnostic miss accounting and shadow-only critical cache behavior.
- Cleaned up malformed wrapped-read blocks in `shadow-account.ts` for summary, allocation, equity-history, orders, closed-trades, ledger-bundle diagnostics, and risk-build diagnostics. Behavior was preserved; the cleanup makes the shadow account-page pressure path reviewable.

## Validation Status

- PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/account-page-streams.test.ts src/services/account-positions.test.ts src/services/shadow-account.test.ts src/services/account-risk.test.ts src/services/bridge-option-quote-stream.test.ts` (`206` passed).
- PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/account/*.test.js src/features/account/*.test.js` (`228` passed).
- PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/account-read-cache.test.ts src/services/account-trade-annotations.test.ts src/services/account-greek-scenarios.test.ts src/services/platform-quote-snapshot.test.ts src/services/marketing-shadow-dashboard.test.ts` (`28` passed).
- PASS: `pnpm --filter @workspace/api-server run typecheck`.
- PASS: `pnpm --filter @workspace/pyrus run typecheck`.
- PASS: `pnpm --filter @workspace/api-server run build`.
- PASS: `pnpm --filter @workspace/pyrus run build`.
- PASS: scoped `git diff --check` for account/shadow/quote touched files.

## Next Step

- Review/land the account real/shadow cleanup slice separately from unrelated dirty sessions. No Replit startup config, secrets, or artifact startup files were changed.
