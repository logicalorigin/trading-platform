# WO-P2-T8 Report

## Observed

- `artifacts/api-server/src/routes/index.ts` had `/^\/algo(\/|$)/` and `/^\/streams\/algo(\/|$)/` in `REQUIRE_USER_PATHS`, so the prefix gate called `requireUser` before the automation router.
- `artifacts/api-server/src/routes/automation.ts` also gates the current `/algo/*` and `/streams/algo/*` handlers with `requireUser(req)` or `requireAdminCsrf(req)`.
- `git diff --stat` showed a dirty working tree before my edit, with many unrelated pre-existing changes.

## Change

- Removed `/algo` and `/streams/algo` from the prefix-level `REQUIRE_USER_PATHS` list in `artifacts/api-server/src/routes/index.ts`.
- Left the existing per-handler auth gates intact, so current allow/deny behavior is still enforced at the handler boundary while avoiding the duplicate prefix lookup.

## Verification

- Ran a lightweight inline `tsx` unit with Node module mocks, importing `routes/index.ts` and mounting mocked `/algo/deployments` and `/streams/algo/cockpit` handlers that call the same `requireUser` spy.
- Result: `ok - algo routes invoke session lookup once per request`.

## Not Run

- No browser, Playwright, e2e, `browser:waterfall`, `pnpm shot`, project-wide typecheck, or full-suite tests.
