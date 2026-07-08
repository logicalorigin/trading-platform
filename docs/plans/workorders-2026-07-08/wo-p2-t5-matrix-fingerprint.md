# WO-P2-T5 — matrix cell eval fingerprints the completed-bar series twice

Codex worker, /home/runner/workspace. Target: artifacts/api-server/src/services/signal-monitor.ts
(~:8690, matrix cell eval). Verify clean first (`git status --porcelain --`); working-tree edit only,
NO git commands, no ~/.claude/ or .claude/skills/ or agents/ access. Unit tests only — NO browser/
e2e/typecheck-full.

PROBLEM (P2 perf, verified ≥0.85): in the matrix cell evaluation path the full completed-bar series is
fingerprinted twice per eval (and double JSON.stringify'd). Locate the eval by description (grep for the
completed-bars fingerprint used as a cell/eval key).

FIX: compute the fingerprint ONCE per eval and reuse it (single stringify). Preserve identical cache/
invalidation semantics — the key value must be unchanged, only computed once. AC: one fingerprint + one
stringify per eval; no behavior change.

Verify: targeted signal-monitor unit test for the eval/cache path (add or extend). Report:
.codex-watch/wo-p2-t5-report.md (what/why, diff, test output, confirm finding real).
