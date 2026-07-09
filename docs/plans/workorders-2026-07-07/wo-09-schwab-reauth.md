# WO-09: Schwab readiness re-auth blocker

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. Obey SCOPE.

## Context

Handoff `ca9f4967` (Jul 6): "Schwab readiness reauth blocker remains unimplemented." Verified: no `reauth`/token-expiry markers in `schwab-oauth.ts`/`schwab-account-sync.ts`. Files: `artifacts/api-server/src/services/schwab-readiness.ts` (readiness probe), `schwab-oauth.ts` (token exchange/refresh), `schwab-user-custody.ts`. Schwab refresh tokens hard-expire (7 days) — an expired refresh token must surface as "re-auth required", not as a generic failure or a silent retry loop.

First: read `docs/plans/*schwab*` and `docs/plans/ibkr-approval-readiness.md`-adjacent broker plans (rg `Phase 0` docs) for the intended readiness states, and `ca9f4967`'s handoff section (repo root `SESSION_HANDOFF_2026-07-06_ca9f4967-*.md`, "What Changed/Next Steps") for the blocker's exact description.

## Task

1. In `schwab-oauth.ts`: classify token-refresh failures — distinguish `refresh_expired_or_revoked` (Schwab invalid_grant family) from transient errors; persist the classification on the connection record the way sibling brokers do (mirror SnapTrade/Robinhood readiness patterns — `robinhood-readiness.ts` exists as a template).
2. In `schwab-readiness.ts`: expose a `reauthRequired` state (with reason) instead of a plain not-ready; ensure `GET /broker-execution/schwab/readiness` (already registered) returns it.
3. Frontend CTA: in the settings broker panel (`artifacts/pyrus/src/screens/settings/SnapTradeConnectPanel.jsx` hosts the unified broker picker; schwab model `schwabConnectModel.js`), surface reauthRequired as a "Reconnect Schwab" call-to-action mirroring how an existing broker's reauth/reconnect state is rendered — smallest diff that fits the panel's existing state machine.
4. Tests: unit tests for the failure classifier and the readiness state machine (extend `schwab-oauth.test.ts` / add readiness test); one frontend model test if `schwabConnectModel` has a test file pattern to follow.

## SCOPE

`schwab-oauth.ts`, `schwab-readiness.ts`, their tests, `schwabConnectModel.js` (+ test), minimal render wiring in the settings broker panel. Nothing else — do not touch order routes (WO-08).

## Acceptance / verification

- `pnpm --filter @workspace/api-server test -- schwab` green; pyrus tests for the touched model green.
- Typecheck clean in SCOPE. Scope-check passes.
- Commit as `feat(api,web): Schwab re-auth detection + reconnect CTA`; do NOT push.

## Deliverable

`.codex-watch/wo-09-schwab-reauth-report-2026-07-07.md`: state machine table (readiness states → UI), classifier rules with Schwab error codes cited, test evidence.
