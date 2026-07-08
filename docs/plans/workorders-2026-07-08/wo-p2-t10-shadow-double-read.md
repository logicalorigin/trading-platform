# WO-P2-T10 — shadow reconcile reads shadow_positions twice per call

Codex worker, /home/runner/workspace. Target: artifacts/api-server/src/services/signal-options-automation.ts
(~:8619, shadow reconcile). Verify clean first (this file was just committed for WO-P1; it is clean —
your change must be a SEPARATE hunk far from the daily-loss/backfill edits). Working-tree edit only, NO
git commands, no ~/.claude/ or .claude/skills/ or agents/ access. Unit tests only.

PROBLEM (P2 perf, verified ≥0.85): the shadow reconcile path reads shadow_positions TWICE per call.
Locate the reconcile function (~:8619) and the two reads.

FIX: read shadow_positions once and reuse the result for the rest of the reconcile. AC: one
shadow_positions read per reconcile call; reconcile output unchanged.

Verify: targeted unit test asserting a single read per reconcile (spy the reader). Report:
.codex-watch/wo-p2-t10-report.md.
