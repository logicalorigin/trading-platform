# WO-13: IBKR Client Portal `/api/Authenticator` mount-base fix

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. Obey SCOPE. Do NOT start/stop the gateway or the app; static fix + tests only — the live login retry needs the user's IBKR credentials + 2FA and is claude-lead's step.

## Context

`SESSION_HANDOFF_LIVE_2026-07-03_ibkr-client-portal-hosted-connector.md` (updated Jul 6) root-caused the credential-submit failure: a mount-base bug involving `/api/Authenticator` paths in the hosted Client Portal proxy flow. The note says the fix was CHOSEN but NOT applied. Current `routes/ibkr-portal.ts` contains no `Authenticator` string (verified) — so either the fix is genuinely unapplied or it lives in a different layer.

READ FIRST, decision-source order: (1) that LIVE note's root-cause + chosen-fix section (repo root), (2) `artifacts/api-server/src/routes/ibkr-portal.ts` (subpath proxy), `services/ibkr-portal-gateway-manager.ts`, `ibkr-portal-session.ts`, `ibkr-portal-context.ts`, (3) `artifacts/pyrus/vite.config.ts` proxy entries and `artifacts/api-server/src/app.ts` mount points, (4) gateway logs under `.pyrus-runtime/ibkr-cpg/**/logs/` for the failing request shape (Jul 4 log shows the post-2FA `sso/validate?gw=1` → 401 → login-loop signature).

## Task

1. Reconstruct the exact chosen fix from the LIVE note. If the note's chosen fix is ambiguous or conflicts with current code, STOP after analysis and write the conflict into your report (fact-first rule: do not pick an interpretation silently).
2. Apply it (expected shape: the proxy/mount base must rewrite or preserve the gateway's `/api/Authenticator`-family paths consistently between the login page's form action, the XHR base, and the server-side proxy prefix — but the NOTE is the source of truth, not this guess).
3. Add/extend a route test for `ibkr-portal` proxy path handling covering the Authenticator-family path shape (mirror existing route tests; mock the gateway).

## SCOPE

`routes/ibkr-portal.ts`, the three `ibkr-portal-*` services, their tests. `app.ts`/`vite.config.ts` ONLY if the note's fix explicitly names them — and if `vite.config.ts` changes, say so loudly in the report (web dev-server restart implications are claude-lead's problem).

## Acceptance / verification

- `pnpm --filter @workspace/api-server test -- ibkr-portal` green including the new test; typecheck clean in SCOPE.
- Report maps note-fix → code change line by line.
- Scope-check passes. Commit as `fix(api): IBKR CP Authenticator mount-base path handling`; do NOT push.

## Deliverable

`.codex-watch/wo-13-ibkr-mountbase-report-2026-07-07.md`: root-cause recap, the applied fix with file:line, test evidence, and the exact manual retry procedure for the user (URL, expected 2FA flow, what "fixed" looks like in the gateway log).
