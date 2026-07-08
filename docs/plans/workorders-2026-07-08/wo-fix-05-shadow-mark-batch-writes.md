# WO-FIX-05 — Batch shadow position mark writes (closes remediation item P1.2)

You are a codex worker in the PYRUS monorepo at /home/runner/workspace, implementing ONE fix.
Working-tree edits ONLY — NO git commands (shadow-account.ts is dirty with in-flight work).

IMPORTANT: Do NOT read or execute files under ~/.claude/, ~/.agents/, .claude/skills/, or agents/.
Do NOT modify agents/openai.yaml.

## Operating discipline (binding)
Ponytail lazy-correct; fact-first (verify every cite below yourself first — the tree moves);
surgical; this code marks LIVE shadow trading positions — mark VALUES and their semantics must be
byte-identical, only the write mechanics change.

## The defect (traced + runtime-verified today; owner-priority symptom: frozen shadow positions)
artifacts/api-server/src/services/shadow-account.ts — `refreshShadowPositionMarks` (~:6037),
single-flighted via `kickShadowPositionMarkRefresh` (~:1064-1078), loops open positions (~:6052)
and issues TWO serial awaited DB writes PER POSITION: `db.update(shadowPositionsTable)` (~:6098) +
`db.insert(shadowPositionMarksTable)` (~:6107). Under pool saturation (12/12, waiting up to 93
today) each write measured 22-38s or aborted on pool-acquire timeout (825 aborts today); one thrown
abort rejects the WHOLE refresh -> `{updatedCount:0}` -> cache not invalidated (~:6139) -> marks
freeze. 2N acquisitions also feed the very saturation that starves them.

## Fix shape (required)
Collapse the loop's writes into set-based statements issued AFTER the loop computes all marks:
1. ONE multi-row insert into shadow_position_marks (single statement, all positions).
2. ONE set-based update of shadow_positions via UPDATE ... FROM (VALUES ...) / unnest — the
   codebase already uses unnest for mark READS (~:3540, :4798, :7015); mirror that idiom with
   drizzle `sql` the way those sites do.
Semantics to preserve exactly: which positions get marked, the computed mark values, updatedCount,
the `updatedCount>0` cache-invalidation condition, and single-flighting. Improve failure semantics
minimally: a pool-acquire failure now fails 2 statements instead of 2N — if the insert succeeds and
the update fails (or vice versa), handle it the laziest correct way (both in one short transaction
is acceptable — it's ONE connection either way — but do NOT hold the transaction across any
non-DB await; compute marks first, then write).
Do NOT implement the SSE last-known-snapshot change or reserved pool lanes (separate decisions).

## Tests (required)
Extend the existing shadow-account suites (shadow-account-latest-marks.test.ts,
shadow-account-read-cache.test.ts, shadow-account-streams.test.ts — follow their harness):
(a) refresh with N>1 open positions issues ONE insert statement + ONE update statement (count via
whatever query-capture seam the suite uses), (b) mark values identical to the per-row behavior,
(c) updatedCount semantics preserved.

## Verification (run, paste output)
`pnpm --filter @workspace/api-server exec tsx --test src/services/shadow-account-latest-marks.test.ts src/services/shadow-account-read-cache.test.ts src/services/shadow-account-recompute.test.ts src/services/shadow-account-streams.test.ts`
All pass. NO full suite/typecheck/build/app restart.

## Deliverable
EXACTLY ONE file: .codex-watch/wo-fix-05-report.md — what/why, unified diff of YOUR hunks only
(file is dirty; separate from pre-existing), test output, exact statement-count evidence.
