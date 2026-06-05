# Live Session Handoff - PYRUS Safe QA And Restart Resilience

- Session ID: `pending`
- Saved At (MT): `2026-05-29 13:58:46 MDT`
- Saved At (UTC): `2026-05-29T19:58:46Z`
- CWD: `/home/runner/workspace`
- Workstream: implement safe browser QA and route-admission restart resilience

## User Request

Implement the plan derived from the 5 Whys/root-cause analysis for the Replit container restart, specifically preventing Codex/browser QA from generating another full-app fanout and making backend shedding enforceable.

## What Changed

- Added browser QA safe mode in `artifacts/pyrus/src/app/qa-mode.ts`.
- `?pyrusQa=safe` now persists per tab, marks the DOM, records recent QA API attempts, and adds `X-Pyrus-QA-Mode: safe` to same-origin `/api/*` fetches.
- QA mode storage reads/writes are guarded so browser storage restrictions cannot break app boot.
- Early runtime config installs QA mode before API client base URL setup.
- App-content preload skips priority platform screen preloads in safe QA mode.
- Platform work scheduling treats safe QA mode as not work-visible, disabling startup invalidation bursts, background warmup, broad runtime work, and stock aggregate streaming.
- Market, Account, and Trade screens accept `safeQaMode` and suppress chart-grid fanout, account live streams, broker freshness streams, trade quote/option/flow runtimes, and background readiness.
- API route admission now has explicit `allow`, `cache-only`, and `shed` actions with classes for streams, decorative/logo work, live data, deferred analytics, and background maintenance.
- Safe QA mode sheds streams/decorative/live/deferred/background work server-side; high/ pressure now sheds lower-priority classes while preserving  execution.
- Logo proxy now times out quickly and returns `204` on upstream miss/error instead of surfacing noisy image failures.
- Flight recorder heartbeat request summary now includes status-family counts, top routes, and recent failures.
- `AGENTS.md` now requires PYRUS browser QA to use `?pyrusQa=safe`, explicit readiness selectors, no `networkidle`, no raw `@e*` clicks, and explicit approval for live full-app browser navigation.

## Validation

- `pnpm --filter @workspace/api-server exec node --import tsx src/services/route-admission.validation.ts` passed: 5 tests.
- `pnpm --filter @workspace/pyrus exec node --import tsx src/app/runtime-config.validation.ts` passed: 5 tests.
- `pnpm --filter @workspace/api-server run typecheck` passed.
- `pnpm --filter @workspace/pyrus run typecheck` passed.
- Re-ran the Pyrus runtime-config QA-mode test and API/Pyrus typechecks after storage/abort hardening; they still passed.
- Confirmed no diff in `.replit`, `artifacts/*/.replit-artifact/artifact.toml`, `artifacts/*/package.json`, `scripts/reap-dev-port.mjs`, or `scripts/check-replit-startup-guards.mjs`.

## Current Status

- Safe QA and backend shedding are implemented and validated with focused checks.
- No Replit app/browser run was performed during this implementation.
- Worktree still contains pre-existing unrelated dirty files; do not treat all diffs in touched files as authored by this session.

## Next Step

When browser validation is explicitly approved, use `?pyrusQa=safe` and wait on explicit readiness selectors. Do not use `networkidle` for the PYRUS full app.
