# WO-FIX-10 — Gate state-changing/heavy diagnostics routes behind auth

Codex worker, /home/runner/workspace. Files clean (verify `git status --porcelain --` first). Edit
directly; `git add -- <paths>`; NO commit. No ~/.claude/, .claude/skills/, agents/ access.

Finding (review workflow P1): state-changing/heavy diagnostics routes in
artifacts/api-server/src/routes/diagnostics.ts (~:302 area) are reachable anonymously — auth is a
hand-maintained prefix list in routes/index.ts (REQUIRE_USER_PATHS/REQUIRE_ADMIN_PATHS) and
/diagnostics isn't on it.

Fix (ponytail): enumerate every diagnostics route; classify read-only-cheap vs state-changing/heavy
(exports, refresh triggers, price-trace, gex-universe-refresh, anything POST). Gate state-changing +
heavy ones per-handler with the existing requireUser/requireAdmin helpers (match how
broker-execution does per-handler gating — do NOT blanket-gate the prefix; cheap read-only
diagnostics may stay anonymous if the app's own UI relies on them pre-auth — CHECK the frontend
callers before deciding each). List your per-route decision table in the report.
Tests: extend the existing route-auth test pattern (see automation-route-auth.test.ts) with the
gated routes → 401/403 without cookie. Run it + routes tests you touched; paste output.
Deliverable: .codex-watch/wo-fix-10-report.md (decision table, diff, tests).
