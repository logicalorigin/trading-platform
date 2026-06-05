# Live Session Handoff - Cache Bars Pressure

- Session ID: pending
- Workstream: `/api/bars` and cache-pressure investigation
- CWD: `/home/runner/workspace`
- Last Updated (MT): `2026-06-04 22:48:06 MDT`
- Last Updated (UTC): `2026-06-05T04:48:06Z`

## User Request

Dive into the remaining post-push pressure target after Signals/Matrix fixes: cache/bars pressure.

## Current Status

- `origin/main` points at `8e2e6ac fix: bound trade monitor history fallback`.
- Local `main` is ahead by `0f13821 chore: restore Replit startup guard`.
- Startup config drift was cleaned and committed: `.replit` now exposes only `8080 -> 8080` and `18747 -> 3000`, `replit.md` satisfies the guard markers, `pnpm run audit:replit-startup` passes, and config files are locked again.
- No app code is dirty at investigation handoff time.
- Remaining docs/handoff changes are being landed separately from code/config.

## Baseline Evidence

- `pnpm -C artifacts/pyrus exec node scripts/checkDevRuntime.mjs` still reports API PID `128950` started at `2026-06-05T04:20:14.330Z`, before `artifacts/api-server/dist/index.mjs` was rebuilt at `2026-06-05T04:38:34.424Z`.
- Restart through the normal Replit Run App path before validating API behavior.
- Post-push Signals safe QA passed:
  - Ready `627ms`
  - Slow API calls `0`
  - Max long task `212ms`
- Diagnostics immediately after smoke:
  - API subsystem `ok`, p95 `543ms`, errors `0`
  - Market data `ok`, pressure `normal`
  - Resource pressure `watch` from cache pressure
  - `/signal-monitor/matrix` not present as API slow route
  - Browser diagnostics still show `/api/bars` p95 around `1307ms`, no errors

## Next Step

After a normal Replit Run App restart makes the API PID newer than the bundle, localize which screen/client path is producing the remaining `/api/bars` pressure, then inspect backend bars caching/admission for that family before editing.

## Restart Check - 2026-06-04 22:47 MT

- User reported another restart, but runtime did not reload the API process:
  - API PID remains `128950`.
  - API PID `128950` started at `2026-06-05T04:20:14Z`.
  - Current `artifacts/api-server/dist/index.mjs` timestamp is `2026-06-05T04:38:34Z`.
- `pnpm -C artifacts/pyrus exec node scripts/checkDevRuntime.mjs` still warns that live API validation is stale; do not trust live HTTP Matrix or `/api/bars` endpoint behavior until the normal Replit Run App path starts a newer API PID.
- Fresh validation baseline for the next source pass:
  - PASS: `pnpm -C artifacts/api-server exec tsx --test src/services/trade-monitor-worker.test.ts`
  - PASS: `git diff --check`
- Prepared next source target:
  - `artifacts/api-server/src/services/trade-monitor-worker.ts` already caps history fallback at `48`, interleaves pinned and expanded symbols, and skips timed-out per-symbol bar loads without blocking loaded siblings.
  - Next real investigation should compare live `/api/bars` browser attribution after a real API reload against backend bars family counters, then decide whether the remaining pressure is option-flow-history/background bars or account-shadow equity-history.
