# WO-FB2-F2A — Bound `signalMonitorBackfilledBaseByCell` (unbounded resident bar map)

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** You are a headless fix worker,
> not an interactive session. (1) Do NOT create/update any SESSION_HANDOFF_* file. (2) Do NOT read
> ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, agents/, or AGENTS.md session sections.
> (3) NEVER restart/rebuild/reload the app, never signal the supervisor, never run
> REPLIT_MODE=workflow, never `git push`. (4) The box has 2 cores and a LIVE trading app: run ONLY
> the validations listed below — no full builds, no unrelated suites. (5) Edit ONLY the files listed
> under "Files you may touch". The worktree carries OTHER agents' uncommitted work — never
> `git add -A`/`git add .`; stage exactly your files. If `.git/index.lock` exists, sleep 10s and
> retry (other lanes commit concurrently). (6) Discipline: minimum diff that works; reuse existing
> helpers/patterns in the file; no new abstractions, files, or dependencies; every changed line must
> trace to this mandate.

## Context (measured, 2026-07-09)

Root-cause doc: `docs/plans/signal-monitor-gc-pool-rootcause-2026-07-09.md` (cause #2, retention).
The live API's old_space held ~1.6GB; heap profile attributed ~640MB to
`signalMonitorBackfilledBaseByCell` — one ~240-bar array per warmed (symbol×timeframe) cell,
~8,088 entries at today's universe, **UNBOUNDED**: across all references there is only a per-row
delete and a full clear, no cap, no LRU, no time prune. It grows linearly with universe size and
never shrinks. Large resident sets make every major GC expensive (GC was 32.6% of busy CPU at open).

## Anchors (verify before editing — line numbers may have drifted)

- Map declaration: `artifacts/api-server/src/services/signal-monitor.ts:5485`
  (`signalMonitorBackfilledBaseByCell`).
- Existing per-row delete: `:5903`. Full clear: `:12962`. Grep ALL references first:
  `rg -n "signalMonitorBackfilledBaseByCell" artifacts/api-server/src/services/signal-monitor.ts`.
- Writers: the gap-tail fetch promotion path (commit `43956df7` — bounded on-demand durable gap
  fetch "promotes via signalMonitorBackfilledBaseByCell") and any warmup writer you find.
- The repo already has an LRU-set helper used for exactly this shape of fix: `lruCacheSet` (used by
  commit `970d0d19` for the gap-fetch attempt map, 4096 cap). Reuse it or the file's equivalent
  established pattern — do not invent a new LRU.

## Mandate

Bound the map with LRU semantics (least-recently-USED eviction, where "use" = read or write of a
cell's entry) behind a module constant with env override, following the file's existing env-constant
pattern:
`SIGNAL_MONITOR_BACKFILLED_BASE_MAX_CELLS`, **default 16384**. Rationale for the default: the
universe cap is 2000 symbols × 6 timeframes = 12,000 legitimate live cells — the cap must sit ABOVE
the working set (bounding runaway growth, not causing steady-state thrash). Document that rationale
in a short comment at the constant.

Semantics that must hold after your change (these are the failable checks):

1. Evicting an entry is SAFE-DEGRADED, never wrong: a subsequent read of an evicted cell behaves
   exactly like a cell that was never backfilled (the gap-fetch path may re-promote it later).
   Verify from the read sites that a missing entry falls back cleanly — cite the file:line evidence
   for this in your report.
2. The existing per-row delete and full clear keep working unchanged.
3. Map size can never exceed the cap (enforced at every insert site).

## Tests (RED-first where practical)

Add to the existing signal-monitor test file that already covers the gap-fetch/backfill promotion
behavior (find it: `rg -ln "backfilledBase|gap" artifacts/api-server/src/services/*.test.ts`), or a
new focused `*.test.ts` beside it following the repo's node:test style:

- Inserting beyond the cap evicts the least-recently-used entry and size stays ≤ cap.
- A read of an evicted cell returns the same result as a never-backfilled cell (no throw, no stale
  bars).
- Existing suites stay green.

## Validation (all required, in this order; report exact outputs)

1. `pnpm --filter @workspace/api-server run typecheck` → must EXIT 0.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor*.test.ts src/services/signal-options*.test.ts`
   → 0 fail; report pass/fail counts. (vitest is NOT installed — never use it.)

## Files you may touch

- `artifacts/api-server/src/services/signal-monitor.ts`
- ONE test file (existing signal-monitor test file or one new `src/services/signal-monitor-*.test.ts`)

## Commit (only after validations pass)

Stage exactly your touched files. Message:

```
perf(signal-monitor): LRU-bound backfilledBaseByCell resident bar map (WO-FB2-F2A)

<2-4 lines: what/why with the measured ~640MB unbounded evidence, cap+default rationale, eviction-safety note>
```

Do NOT push. Do NOT reload the app.

## Report

Write `.codex-watch/wo-fb2-f2a-report.md`: what changed (file:line), eviction-safety evidence
(file:line of the fallback path), validation outputs (exact counts), commit SHA, any follow-up
risks. Your final message: 3 lines max summarizing rc, commit SHA, test counts.
