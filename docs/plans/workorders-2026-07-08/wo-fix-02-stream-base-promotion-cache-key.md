# WO-FIX-02 — Stabilize completed-bars cache key against stream-base promotion churn

You are a codex worker in the PYRUS monorepo at /home/runner/workspace, implementing ONE fix
INSIDE uncommitted workstream-A code. Working-tree edit ONLY — NO git commands of any kind.

IMPORTANT: Do NOT read or execute files under ~/.claude/, ~/.agents/, .claude/skills/, or agents/.
Do NOT modify agents/openai.yaml. Repository code only.

## Gate
- `git status --porcelain -- artifacts/api-server/src/services/signal-monitor.ts` must show M. STOP if not.

## Operating discipline (binding)
Ponytail lazy-correct; fact-first (read every touched function end-to-end); surgical — preserve the
in-flight workstream's intent everywhere (it intentionally reduces persists and keeps bases fresh).

## The defect (verified by orchestrator)
artifacts/api-server/src/services/signal-monitor.ts — `promoteSignalMonitorBackfilledBaseFromStream`
(~5380) runs after every stream evaluation (~9841) and on equal-latest bars still calls
`rememberSignalMonitorBackfilledBaseBars` (~5361), rewriting the entry's `refreshedAt`. The stream
completed-bars cache dirty key (~9781-9786) includes `baseEntry?.refreshedAt` → the next flush in the
same completed bucket MISSES the cache and re-runs load/convert/aggregate for the cell. Promotion
content comes FROM this very evaluation path, so busting the cache for it is circular waste.
BUT: `refreshedAt` also drives the async backfill scheduler's overdue ranking (~5442-5476) — promotion
bumping `refreshedAt` is INTENTIONAL (keeps the DB backfiller quiet). Do NOT stop bumping it.

## Fix shape (required — orchestrator-designed)
1. `SignalMonitorBackfilledBaseEntry` (~5217) gains `contentStamp: number`.
2. `rememberSignalMonitorBackfilledBaseBars` gains input `source: "backfill" | "stream-promotion"`.
   - "backfill": `contentStamp = input.refreshedAtMs` (external content — must bust the cache).
   - "stream-promotion": preserve the EXISTING entry's `contentStamp` (fallback `refreshedAtMs` if
     somehow absent). `refreshedAt` is still set to `refreshedAtMs` in BOTH cases (scheduler intact).
3. Callers: the async backfiller call (~5616) passes "backfill"; the promotion call (~5402) passes
   "stream-promotion". Verify with grep these are the ONLY two callers; STOP and report if more.
4. Dirty key (~9784): replace `baseEntry?.refreshedAt ?? 0` with `baseEntry?.contentStamp ?? 0`.
5. Grep for any OTHER reader of `.refreshedAt` on these entries you'd affect — there must be none
   besides the scheduler candidates (~5460-5476, 5552-5558) and comment ~8423 (update the comment
   if it names refreshedAt as the cache-key input).

## Test (required, minimal)
Extend the existing suite that covers this cache (see signal-monitor-stream-completed-bars-cache.test.ts
and signal-monitor-backfill-base.test.ts — both already modified in the tree; follow their patterns):
ONE test asserting: after an evaluation that triggers stream-base promotion with unchanged latest bar,
the next evaluation in the same completed bucket is a cache HIT (counters
`signalMonitorStreamCompletedBarsCacheHits/Misses` or whatever seam those tests already use); and a
backfill-sourced remember DOES bust it.

## Verification (run, paste output)
`pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-stream-completed-bars-cache.test.ts src/services/signal-monitor-backfill-base.test.ts src/services/signal-monitor-completed-bars.test.ts`
All pass. NO full suite/typecheck/build/app.

## Deliverable
EXACTLY ONE file: .codex-watch/wo-fix-02-report.md — what/why (2-4 sentences), unified diff of YOUR
hunks only, test output, out-of-scope observations. NO git commands anywhere.
