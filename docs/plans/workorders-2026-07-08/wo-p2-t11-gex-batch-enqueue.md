# WO-P2-T11 — GEX on-demand refresh enqueues jobs one-at-a-time with redundant enqueue

Codex worker, /home/runner/workspace. Target: artifacts/api-server/src/services/gex.ts (~:671,
on-demand refresh). Verify clean first; working-tree edit only, NO git commands, no ~/.claude/ or
.claude/skills/ or agents/ access. Unit tests only.

PROBLEM (P2 perf, verified ≥0.85): the GEX on-demand refresh enqueues jobs one at a time and re-enqueues
redundantly. Locate the enqueue loop (~:671).

FIX: batch the enqueue (single batched enqueue call for the set of jobs) and drop the redundant
re-enqueue. AC: jobs enqueued in one batch; no duplicate enqueue; same set of jobs scheduled.

Verify: targeted unit test asserting a single batched enqueue for a multi-job refresh (spy the enqueue).
Report: .codex-watch/wo-p2-t11-report.md.
