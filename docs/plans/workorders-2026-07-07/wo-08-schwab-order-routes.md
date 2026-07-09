# WO-08: Schwab equity order routes — wire the existing service

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. Working tree has other agents' WIP — obey SCOPE.

## Context (verified 2026-07-07 ~13:55 MDT)

Phase 0d is HALF-built: `artifacts/api-server/src/services/schwab-equity-orders.ts` + `schwab-equity-orders.test.ts` exist, and `routes/broker-execution.ts` already IMPORTS `SubmitSchwabEquityOrderBody/Response`, `PreviewSchwabEquityOrderBody/Response`, `CancelSchwabEquityOrderBody/Response` — but registers only `readiness`/`connect`/`oauth/callback`/`sync` routes (lines ~210–260). The three ORDER routes are not registered. `lib/api-spec/openapi.yaml` has ~100 schwab mentions — check whether the order paths are already spec'd (types may be generated from it).

Attended-order doctrine: mirror how the existing SnapTrade/broker-execution order endpoints in the same file handle confirmation gating, entitlements (Slice 7, `entitlements.ts` — `d25b6901` gates broker-connect), auth/session, and error envelopes. Follow the local pattern exactly — do not invent new middleware.

## Task

1. Read `schwab-equity-orders.ts` service signatures and the existing spec'd paths; determine the intended route shapes (likely `POST /broker-execution/schwab/orders/preview`, `POST .../orders`, `POST or DELETE .../orders/:id/cancel` — derive from the spec/types, do not guess).
2. Register the three routes in `routes/broker-execution.ts` delegating to the service, with the same guards as sibling order routes (user scoping, entitlement check, attended confirmation semantics, readiness gate — reject if `schwab-readiness.ts` says not ready).
3. If openapi.yaml lacks the paths, add them consistent with generated-type names, and regenerate clients if the repo has a codegen script (`rg -n 'openapi' package.json` for the command).
4. Route-level tests: happy path (mock service), not-ready rejection, entitlement rejection, malformed body 400. Follow the existing route-test pattern in the api-server test suite (find one for broker-execution or a sibling route and mirror it).

## SCOPE

`artifacts/api-server/src/routes/broker-execution.ts`, a new/existing route test file for it, `lib/api-spec/openapi.yaml` (+ generated client output ONLY via the repo's own codegen command). Do NOT modify the service or oauth/sync code (WO-09 owns readiness/reauth).

## Acceptance / verification

- New route tests + `pnpm --filter @workspace/api-server test -- schwab` green.
- `pnpm --filter @workspace/api-server run typecheck` clean in SCOPE; openapi lint/codegen clean if run.
- Scope-check passes. Commit as `feat(api): register Schwab equity order routes (Phase 0d)`; do NOT push.

## Deliverable

`.codex-watch/wo-08-schwab-routes-report-2026-07-07.md`: routes registered (method+path), guard chain used, spec/codegen actions, test evidence, and anything about the service you had to work around (report, don't fix).
