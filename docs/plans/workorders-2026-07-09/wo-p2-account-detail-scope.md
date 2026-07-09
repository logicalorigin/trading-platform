# WO-P2-ACCTSCOPE — Account detail routes not user-scoped (cross-user data + broken 404s)

> **HEADLESS FIX WORKER.** No SESSION_HANDOFF_* writes; don't read ~/.claude/, .claude/skills/,
> agents/, AGENTS.md session sections. NEVER restart/reload/signal the app, never `git push`. 2-core
> live box: only listed validations. PRECONDITION: `git status --short -- artifacts/api-server/src/routes/platform.ts artifacts/api-server/src/services/account.ts`
> BOTH clean; if either dirty wait 60s ×15 then BLOCKED (SEC-1 + a sibling lane touch these). Never
> `git add -A`. index.lock → sleep 10s, retry. Minimum diff — SECURITY-adjacent; match the working
> `/accounts` list route's scoping exactly.

## Defect (adversarial review, verified at source)

`GET /accounts` correctly passes `appUserId` into `listAccounts` (routes/platform.ts:1758-1764), but
the DETAIL routes do not thread the caller identity:
- `GET /accounts/:accountId/summary` → `getAccountSummary(...)` and
- `GET /accounts/:accountId/positions` → `getAccountPositions(...)`
  called WITHOUT the caller id at routes/platform.ts ~:1780-1786 and ~:1835-1845.
- `getLiveAccountUniverse` → `readLiveAccountUniverseUncached(accountId, mode)` has NO appUserId
  param and caches only by accountId/mode (account.ts:1293-1300).
- Provider-backed readers `getSnapTradeBackedAccounts` / `getRobinhoodBackedAccounts` return `[]`
  when appUserId is null (account.ts:4504-4508, 4585-4590).

Two consequences: (a) a user's own SnapTrade/Robinhood detail can 404/empty because the id isn't
propagated; (b) the detail route does not verify the requested accountId BELONGS to the caller —
cross-user read exposure for accounts resolvable without the provider filter. Verify BOTH at source
before fixing; if the detail path already authorizes via another mechanism (an assertCanReadAccount
equivalent — grep for it), the exposure half may be moot — report which.

## Mandate

1. Trace how `/accounts` (list) scopes to the user and how detail routes SHOULD (there is almost
   certainly an existing `assertCanRead*` / ownership helper — the algo deployments path has
   `assertCanReadAlgoDeployment`; find the account equivalent or the appUserId-threading pattern).
2. Thread `appUserId` through the detail routes → `getAccountSummary`/`getAccountPositions` →
   `getLiveAccountUniverse`/`readLiveAccountUniverseUncached` so provider-backed detail resolves
   for the owner AND a non-owner is denied (403/404 consistent with the list route's behavior).
   CACHE KEY: include appUserId (or the ownership scope) so the universe cache can't serve one
   user's accounts to another — this is the sharp edge, get it right.
3. Do NOT broaden what an owner can see; do NOT change the list route.

## Tests

Route/service tests (find the account route-auth test file):
- Owner requests own account detail → resolves (non-empty for a seeded provider account).
- Non-owner requests another user's accountId → denied (403/404), and the universe cache does not
  leak across users (two users, same-shaped request, distinct results).
- Existing account tests green.

## Validation
1. `pnpm --filter @workspace/api-server run typecheck` → EXIT 0.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/account*.test.ts <route-auth test>` → 0 fail; counts.

## Files you may touch
- `artifacts/api-server/src/routes/platform.ts`, `artifacts/api-server/src/services/account.ts`
  (+ ONE test file)

## Commit
`fix(security): scope account detail routes to the requesting user + user-keyed universe cache (WO-P2-ACCTSCOPE)` + evidence (the ungated routes, the scoping pattern reused, cache-key change).

Do NOT push. Report: `.codex-watch/wo-p2-acctscope-report.md`; final message 3 lines.
