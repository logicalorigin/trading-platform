# WO-P1-T1c3 — account-positions-route admission guard test is text-match (test-lie)

Codex worker, /home/runner/workspace. Target (clean):
artifacts/api-server/src/routes/account-positions-route.test.ts (asserts the regex
`/admitAccountRoute\(res/` presence ~:43 only). Reference real handler short-circuit pattern e.g.
platform.ts:1820. Working-tree edit only, NO git commands, no ~/.claude/ or .claude/skills/ or agents/
access.

PROBLEM (T1c-3, P1 test-integrity): the test only checks that the source MENTIONS admitAccountRoute, so
a protected route that calls the account service DESPITE a denied admission still passes.

FIX (test only): rewrite as a request-level test — drive each protected route with admission
FORCED-DENY and assert (a) the response is 503 (or the correct blocked status) and (b) the underlying
account-service function is NOT called. AC: a route that leaks (invokes the account service under
denied admission) makes the test FAIL.

Run the touched api-server suite; paste output. Report:
.codex-watch/wo-p1-t1c3-report.md.
