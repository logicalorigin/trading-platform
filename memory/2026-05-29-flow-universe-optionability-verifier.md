# Flow Universe Optionability Verifier

- Date: 2026-05-29
- Status: DONE_WITH_CONCERNS

## Symptom

Flow Scanner diagnostics showed the planner could have a large catalog but only a tiny verified optionable set, leaving the scanner effectively underfilled until a manual verifier script was run.

## Root Cause

The app had moved scanner admission to verified optionability, but optionability verification still lived mostly in a one-off script. Hydrated IBKR stock contracts without persisted optionability proof stayed out of the planner, and the script's old empty-expiration handling could mark transient degraded empties as rejected.

## Fix

- Added an API-side background verifier in `artifacts/api-server/src/services/flow-universe-optionability-verifier.ts`.
- The verifier drains hydrated-but-unverified listings in small batches and blocks under scanner-disabled, session-health, live-warmup, line-cap, pressure-throttle, and options-backoff conditions.
- Added Flow Scanner diagnostics under `optionabilityVerifier`.
- Started the verifier from API startup.
- Updated the manual script to share the runtime candidate loader, classifier, and persistence helper.
- Added focused tests for transient classification, pressure skips, persistence failures, and verifier backoff.

## Evidence

- `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/flow-universe-optionability-verifier.test.ts src/services/flow-universe-planner.test.ts src/services/flow-universe.test.ts` passed.
- Platform import smoke for verifier exports passed.
- `git diff --check` passed for touched files.

## Remaining Concerns

- Full API/scripts typecheck is blocked by unrelated `signal-options-automation.ts:7533`.
- Pyrus `platformRootSource.test.js` currently has unrelated source-contract failures.
- Live IBKR behavior still needs confirmation through Replit Run App with the migration/catalog sync/hydration applied.
