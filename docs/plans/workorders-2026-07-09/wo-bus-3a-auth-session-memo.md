# WO-BUS-3A — Request-scope memoize the auth-session lookup (fires ~2x per authenticated request)

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** You are a headless fix worker,
> not an interactive session. (1) Do NOT create/update any SESSION_HANDOFF_* file. (2) Do NOT read
> ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, agents/, or AGENTS.md session sections.
> (3) NEVER restart/rebuild/reload the app, never signal the supervisor, never `git push`. (4) 2-core
> box, LIVE trading app: run ONLY the listed validations. (5) Edit ONLY files under "Files you may
> touch"; if dirty from another lane, wait 60s up to 10 tries then report BLOCKED. Never
> `git add -A`. If `.git/index.lock` exists, sleep 10s and retry. (6) Minimum diff. This is a
> SECURITY-ADJACENT file: memoization must never extend a session's validity or cross requests.

## Context (measured, census 2026-07-09)

`readAuthSessionFromToken` (`artifacts/api-server/src/services/auth.ts:303` — verify by grep) runs
about TWICE per authenticated request: once from the global middleware in `app.ts` and once from the
per-route guard (`requireUser`/`requireAuth` path). rows=1, trivial execution — but it tracks total
API request rate, so under market-open polling it was the #1 pure queue victim in the slow-query
firehose (3,810s pool-inclusive, max 60s waiting for a connection). Halving it is the cheapest
admission win available.

## Mandate

Memoize the session lookup PER REQUEST so the second (and any further) lookup in the same request
reuses the first result:

- Scope: the HTTP request object (attach to `res.locals`/`req` per the codebase's existing pattern —
  grep how other per-request state is carried; reuse that pattern) or an AsyncLocalStorage request
  context if one already exists in app.ts. Do NOT build new infrastructure — rung 2: reuse what the
  file already has.
- Key: the exact bearer/cookie token string. If the two call sites could see DIFFERENT tokens
  (re-read the extraction logic!), memoize on token value, not just "the request".
- Cache the NEGATIVE result too (invalid/expired token) — otherwise a 401 path still queries twice.
- SECURITY INVARIANTS (failable): memo lives and dies with the single request — no cross-request
  reuse, no TTL, no module-level map keyed by token (that would extend session validity windows and
  leak sessions across users). Session revocation semantics within a single in-flight request are
  unchanged (two reads today could theoretically see a mid-request revocation; collapsing to one
  read is acceptable and equivalent to the first read winning — note this in a comment).
- Do not change the shape of what the call sites receive.

## Tests

Extend the existing auth test file (find it: `rg -ln "readAuthSessionFromToken" artifacts/api-server/src --glob '*.test.ts'`):
- Two lookups within one simulated request → one DB read (count via the test seam or a spy on the
  query fn following the file's existing test patterns).
- Two DIFFERENT requests → two DB reads (no cross-request leak).
- Negative lookup memoized within the request; still 401s.

## Validation

1. `pnpm --filter @workspace/api-server run typecheck` → EXIT 0.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit <auth test file(s)>` → 0 fail.

## Files you may touch

- `artifacts/api-server/src/services/auth.ts`
- `artifacts/api-server/src/app.ts` (only if the middleware must pass the memo through)
- ONE auth test file (existing or new)

## Commit

```
perf(auth): request-scope memoize session lookup — auth reads halve; #1 pool queue victim relieved (WO-BUS-3A)

<2-4 lines: the 2x-per-request evidence, the per-request-only scope guarantee, test counts>
```

Do NOT push. Do NOT reload.

## Report

`.codex-watch/wo-bus-3a-report.md`: both call sites (file:line), the carrier chosen for the memo,
security-invariant evidence, validation outputs, commit SHA. Final message: 3 lines max.
