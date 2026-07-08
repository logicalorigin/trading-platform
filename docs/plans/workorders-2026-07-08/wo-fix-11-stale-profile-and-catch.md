# WO-FIX-11 — Matrix producer picks up profile changes + backfill refresh gets a catch

Codex worker, /home/runner/workspace. signal-monitor.ts is clean (verify). Edit directly;
`git add -- <paths>`; NO commit. No ~/.claude/, .claude/skills/, agents/ access. TWO fixes,
separate hunk sets in the report.

FIX A (review P1, ~:10868): the server-owned matrix producer keeps evaluating/persisting with a
stale profile after a settings update — trace how the producer acquires its profile (cached at
start? 60s refresh?) and how profile updates propagate elsewhere; make the producer observe updates
(reuse whatever invalidation/notification already exists for profile changes — check for an
existing settings-changed hook/subscription before inventing one). Behavior: next producer cycle
after a settings save uses the new profile. STOP and report if propagation requires new
cross-module infrastructure (design decision).

FIX B (review P1, ~:5510): refreshSignalMonitorBackfilledBaseBars try/finally with no catch, called
as bare void at both call sites → rejections vanish/unhandled. Laziest correct: catch in the
function, count + record via the module's existing error/diagnostic fields (match neighboring
patterns), no rethrow.

Tests: FIX A — one test proving a profile update reaches the next producer evaluation (follow
signal-monitor test conventions); FIX B — one test proving a rejecting refresh is swallowed-with-
record not unhandled. Run touched suites; paste output.
Deliverable: .codex-watch/wo-fix-11-report.md.
