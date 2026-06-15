# Current Session Handoff

This is a pointer to the active durable handoff. Do not use this file as the full session narrative.

- Last Updated (MT): `2026-06-13 10:24:43 MDT`
- Last Updated (UTC): `2026-06-13T16:24:43Z`
- Native Codex Session ID: `019ec132-92d0-78c1-a21c-4f5d378afa46`
- Summary: Broker connection audit plus fast-launch, bridge-status, direct Windows protocol credential-handoff, and hidden-tab launch-wait fixes.
- Handoff: `SESSION_HANDOFF_2026-06-13_019ec132-92d0-78c1-a21c-4f5d378afa46.md`
- Master Index: `SESSION_HANDOFF_MASTER.md`

## Current Status

- Broker connection audit completed; frontend credential recovery fix implemented, Playwright dummy UI path validated, fast-launch rebuild implemented, bridge-status regression fixed, direct Windows protocol launch now keeps the Pyrus page alive for credential delivery, and hidden/backgrounded pages no longer wait indefinitely on launch `requestAnimationFrame`.
- Main live finding: PowerShell/helper launch was fast; the original failure was browser credential delivery not reading the published helper key.
- New launch-process fix removes desktop-agent `/desktop/jobs/claim` long-poll, removes the extra PowerShell process on remote launch, removes the blind 3s Gateway-start sleep, and removes browser `/login-key/read` long-poll.
- Existing nearby model/readiness tests pass, but no tests cover `listBrokerConnections()`.
- Playwright browser QA tooling is installed at the root: `@playwright/test@1.60.0`; Chromium headless smoke passed.
- Backend watcher during Playwright found normal credential-handoff transitions, but also separate API/event-loop stall samples with endpoint delays up to `26-38s` outside the core handoff.
- Latest regression root cause: `/api/diagnostics/runtime` had bridge backoff/reconnect failure details and stale helper update status, but `/api/session` stripped compact runtime fields and hid stale helper status when the desktop was offline.
- Latest live watch root cause: direct Windows launch used `_self` custom-protocol navigation before credential delivery, so browser JS did not promptly call `/login-key/read` or post the encrypted credential envelope.
- Latest source-level timing fix: launch/credential flow no longer awaits uncapped `requestAnimationFrame`, so minimizing/backgrounding the page cannot freeze the pre-launch feedback wait.

## Next Recommended Steps

1. Refresh/rebuild Pyrus so `ibkrBridgeSession.js` uses the iframe launcher and `ibkrBridgeLaunchFeedback.js` uses the hidden-tab frame-wait fallback, cancel/replace the stuck activation, then retry the direct Windows launch.
2. Confirm `/login-key/read` fires immediately after `credential_key_published` and `/login-envelope` follows.
3. Add backend tests for `listBrokerConnections()` and frontend snapshot coverage for stale ready connection evidence plus fresh runtime disconnect diagnostics.

## Validation Snapshot

- `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/ibkrConnectionSnapshot.test.mjs src/features/platform/ibkrPopoverModel.test.mjs src/features/platform/ibkrConnectionCredentialActionModel.test.mjs src/features/platform/appWorkScheduler.test.mjs` passed.
- `pnpm --filter @workspace/api-server exec tsx --test src/services/platform-bridge-health.test.ts src/services/readiness.test.ts src/services/ibkr-account-bridge.test.ts` passed.
- `pnpm exec node --test artifacts/pyrus/src/features/platform/ibkrConnectionCredentialActionModel.test.mjs` passed.
- `pnpm --filter @workspace/pyrus run typecheck` passed.
- Direct dummy handoff reached envelope accepted and `gateway_process_started`, then canceled activation.
- `pnpm exec playwright --version` returned `Version 1.60.0`; headless Chromium smoke passed.
- Playwright dummy UI path reached encrypted-envelope delivery, then canceled activation; screenshots/result saved under `.gstack/qa-reports/screenshots/ibkr-playwright-2026-06-13T15-01-39-953Z/`.
- React `background`/`backgroundSize` warning in the IBKR step connector was fixed; `pnpm exec node --test artifacts/pyrus/src/features/platform/HeaderStatusCluster.test.mjs` passed; Playwright console re-check had no warnings/errors.
- Fast-launch rebuild validation passed: `pnpm exec node --test scripts/windows/pyrus-ibkr-helper.test.mjs`, API bridge runtime test, Pyrus credential/snapshot tests, API typecheck, and Pyrus typecheck.
- Bridge-status regression validation passed: API bridge runtime tests, API platform bridge health tests, Pyrus header/snapshot/popover/bridge-session tests, API typecheck, Pyrus typecheck, and scoped `git diff --check`.
- Direct-launch credential-stall validation passed: Pyrus bridge-session/header/credential tests, Pyrus typecheck, and scoped `git diff --check`.
- Hidden/backgrounded page launch-wait validation passed: `ibkrBridgeLaunchFeedback`/header/bridge-session/credential focused tests, Pyrus typecheck, and scoped `git diff --check`.
