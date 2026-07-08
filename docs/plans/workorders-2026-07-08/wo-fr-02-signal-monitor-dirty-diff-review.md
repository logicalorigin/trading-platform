# WO-FR-02 — Regression review: uncommitted signal-monitor.ts diff (READ-ONLY)

You are a codex worker in the PYRUS monorepo at /home/runner/workspace. STRICTLY READ-ONLY:
no file modifications, no test/build/app runs, no git state changes (read-only git commands like
`git diff`/`git show` are fine). Only output = the report file named below.

IMPORTANT: Do NOT read or execute any files under ~/.claude/, ~/.agents/, .claude/skills/, or
agents/. Do NOT modify agents/openai.yaml. Repository code only.

## Operating discipline (binding)
Fact-first (cite file:line / diff hunks you actually read); observed vs inferred; refute your own
findings before reporting; ponytail one-sentence lazy fixes; severity P0 money/trading risk,
P1 wrong data/user-visible, P2 low blast radius, P3 cleanup.

## Context
services/signal-monitor.ts carries ~+249 lines of UNCOMMITTED workstream-A (signal calibration)
changes. Today's live CPU profile (market hours, ELU pinned 1.0) shows a NEW dominant cluster in
exactly this territory: aggregateStockMinuteBarsForTimeframe, stockMinuteAggregateToSignalMonitorBar,
loadSignalMonitorStreamSourceMinuteBars ≈12–15% combined self-time, plus GC/allocation churn at
15.8% (doubled since 07-02, when this cluster was only a diffuse tail). The uncommitted diff is a
plausible but UNVERIFIED cause of the shift.

## Task
1. `git diff HEAD -- artifacts/api-server/src/services/signal-monitor.ts` (and the same for
   artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts and any signal-monitor-*.ts
   with uncommitted changes per `git status --porcelain -- 'artifacts/api-server/src/services/signal-monitor*'`).
2. Review each hunk for: (a) work added per tick/per symbol on the hot evaluation path (new loops,
   re-aggregation, allocations) that could produce the profile shift; (b) correctness regressions
   (changed thresholds/conditions with unintended reach, dropped guards, off-by-one on bar windows,
   timezone/session-boundary mistakes); (c) half-finished edits (dead flags, unreachable branches).
3. VERDICT with evidence: does this diff plausibly explain the aggregation-cluster + GC dominance?
   Rate plausibility low/medium/high and name the exact hunks. This is attribution evidence for a
   discussion doc, not a mandate to change the workstream.

## Deliverable
Write EXACTLY ONE file: .codex-watch/wo-fr-02-report.md — findings sections
(`file:line | severity | category | summary`, evidence, failure scenario, lazy fix, confidence),
then the plausibility verdict paragraph, then coverage note. Do NOT revert or "fix" the diff.
