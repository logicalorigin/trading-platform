# WO-FB-S3C — fix completed-bars memo key so unchanged cells cache-hit

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals for this run):** You are a
> headless work-order worker, not an interactive session. (1) Do NOT create or update any
> SESSION_HANDOFF_* file — the orchestrator owns handoffs. (2) Do NOT read ~/.claude/, ~/.agents/,
> .claude/skills/, .agents/skills/, or agents/ — skill definitions are for other tooling and waste
> your run. (3) NEVER restart, rebuild, or reload the app; never run REPLIT_MODE=workflow, never
> signal the supervisor (no SIGUSR2) — the orchestrator owns runtime. (4) AGENTS.md coding
> discipline (lazy-minimal, stdlib-first, smallest diff) still applies. Work ONLY the order below.


Codex worker (xhigh), /home/runner/workspace. Brief: `docs/plans/signal-monitor-db-load-rootcause-2026-07-08.md`
(NEXT / Stage 3 lever (c)). The stream-eval completed-bars memo (`signalMonitorStreamCompletedBarsCache`)
misses on every aggregate tick because its key bumps even when a cell's completed-bar inputs are unchanged,
so an unchanged cell rebuilds its whole series every tick. Fix the KEY so it changes only when the cell's
completed-bar inputs actually change; unchanged cells must cache-hit.

## Anchors (verified 2026-07-08; re-locate by snippet if drifted)
- `artifacts/api-server/src/services/signal-monitor.ts:8480` — `const signalMonitorStreamCompletedBarsCache = new Map<...>`
- `:8484-8485` — hit/miss counters (`...CacheHits` / `...CacheMisses`). USE THESE in your report.
- `:5345` — existing eviction (`signalMonitorStreamCompletedBarsCache.delete(key)`); preserve bounded size.
- Key construction is near the consumer (brief says ~:9533 pre-drift) — YOU find it: rg the cache name,
  read every reader/writer, and identify exactly which key component bumps per tick.

## The change
Rebuild the key from ONLY inputs that determine the completed-bar series for the cell, e.g. last completed
bar timestamp + completed-bar count + timeframe/profile/config identity — NOT per-tick counters/now()/eval
generation. If a key component exists to force invalidation on genuine input change (e.g. backfill promote),
keep that pathway working (prove it with the existing tests or a small new one).

## MUST-NOT
- Byte-identical signal outputs: a cache-hit must return a series identical to a rebuild. If you cannot
  prove that for some edge (e.g. provisional/live-edge bars inside the series), the key MUST include what
  distinguishes it — correctness beats hit-rate.
- Touch ONLY signal-monitor.ts (+ a test file). Tree is dirty with other lanes — no reverts/reformats
  outside your hunks; NEVER `git checkout`/`restore`. No commits, no `git add`.
- Minimal diff; no new deps; keep the Map + existing eviction.
- Run `git diff --stat -- artifacts/api-server/src/services/signal-monitor.ts` at start AND end; put both in the report.

## Verification (paste tails in report)
1. `pnpm --filter @workspace/api-server run typecheck` → exit 0
2. `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor*.test.ts src/services/signal-options*.test.ts`
   → baseline 442 pass / 0 fail; must stay 442+/0.
3. Demonstrate the hit-rate fix: a small targeted test (or instrumented assertion) showing two consecutive
   evals of an unchanged cell produce 1 miss + 1 hit (today: 2 misses). Use the existing counters.

## Report → `.codex-watch/wo-fb-s3c-memo-key-report.md`
old vs new key composition (exact fields), why each removed component was per-tick noise, hit/miss evidence,
test/typecheck tails, risks, start+end diff --stat.
