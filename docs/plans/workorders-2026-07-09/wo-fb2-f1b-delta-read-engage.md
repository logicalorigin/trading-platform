# WO-FB2-F1B — Cross-cycle stored-bars cache: diagnose the dead delta-read path, split the counters, fix what the evidence supports

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** You are a headless
> diagnose-then-fix worker, not an interactive session. (1) Do NOT create/update any
> SESSION_HANDOFF_* file. (2) Do NOT read ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/,
> agents/, or AGENTS.md session sections. (3) NEVER restart/rebuild/reload the app, never signal the
> supervisor, never run REPLIT_MODE=workflow, never `git push`. (4) The box has 2 cores and a LIVE
> trading app: run ONLY the validations listed below. You MAY curl the local API read-only
> diagnostics (`http://127.0.0.1:8080/api/diagnostics/runtime`) to read live counters — nothing
> else against the live app. (5) Edit ONLY the files under "Files you may touch". The worktree
> carries OTHER agents' uncommitted work — never `git add -A`; stage exactly your files. If
> `.git/index.lock` exists, sleep 10s and retry. (6) Discipline: minimum diff that works; reuse
> existing helpers/patterns; no new abstractions or dependencies.

## Context (measured live, 2026-07-09, ~25 min window)

Root-cause doc: `docs/plans/signal-monitor-gc-pool-rootcause-2026-07-09.md`. The cross-cycle
stored-bars cache in `artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts` measured:

```
storedBarsCache: { maxCells:30000, cellCount:4192, hitCount:0, missCount:4192,
                   fullReadCount:6, deltaReadCount:0, invalidationCount:24917, evictionCount:0 }
storedBarsRead:  { prefetchHitCount:1439, fallbackCount:211, fallbackNoPrefetchCount:211,
                   fallbackMismatchCount:0 }
```

Read this carefully: **hitCount 0 and deltaReadCount 0** — the cache designed to stop repeat
`bar_cache` DB reads has never served a hit in this process, and its delta path (fetch only bars
after a cell's high-water) has never fired. Meanwhile `invalidationCount` incremented ~1,000/min.

Design intent (READ these first):
- Invalidation subscription: `ensureStoredBarsCacheSubscription` (near `:609-639`) — note the
  counter at `:629` increments for BOTH branches (full `invalidated=true` when
  `change.startsAtMs <= cell.highWaterMs`, vs `deltaDue=true` for appends), so the aggregate
  cannot distinguish "historical rewrite storms" from "append notifications".
- Emitter contract: `market-data-store.ts` near `:949-1010` — the upsert's `IS DISTINCT FROM`
  setWhere + RETURNING means change events fire only for rows actually inserted/updated; the
  comment claims "~1 row/flush in steady state", which the measured ~1,000/min contradicts —
  possibly per-cell amplification (one change × N cached cells sharing the base key, × 2 limit
  variants, × sources), possibly massive-history backfill genuinely rewriting below-high-water rows.
- Read path: `loadStoredBarsForSymbolsForPrefetch` (near `:1009-1127`) — hit/miss/delta accounting;
  a cell is delta-eligible only when
  `cell.deltaDue || (cell.lastDeltaBucketMs ?? -1) < deltaBucketMs` AND `highWaterMs < evaluatedAtMs`.

## Mandate — three deliverables, strictly in this order

### 1. Split + extend the diagnostics counters (unconditional, land regardless of findings)

In the invalidation subscription, split `invalidationCount` into
`invalidationFullCount` (below/at high-water branch) and `invalidationDeltaDueCount` (append
branch), keep the legacy aggregate for continuity, and surface both in
`getSignalMonitorLocalBarCacheDiagnostics()` under `storedBarsCache`. Also count
`invalidationEventsCount` (change events received) vs the per-cell increments, so amplification is
measurable. Cheap integers only — this path runs per DB write event.

### 2. Diagnose WHY hits/deltas are zero (report with file:line + counter evidence)

Answer, with evidence, which of these holds (more than one may):
a. **Cycle starvation**: full universe evaluation takes longer than the invalidation interval, so
   cells are (re)read at most once before being re-keyed/invalidated — the cache never gets a
   second read. Evidence: only 6 batch loads in 25 min. If the API has been up >30 min when you
   run, curl the live diagnostics and read your NEW split counters after ~5 min to see which
   invalidation branch dominates.
b. **Full-invalidation storm**: the dominant branch is `startsAtMs <= highWaterMs` (historical
   rewrites — e.g. massive-history backfill re-upserting changed rows below high-water). If so,
   identify WHICH writer produces them (grep the persist paths feeding `persistMarketDataBars` /
   the batched writer) and whether the rewrites are content-identical (should be filtered by the
   IS DISTINCT FROM guard) or genuine.
c. **Delta-eligibility bug**: cells sit `deltaDue=true` but the read-path condition or the
   `lastDeltaBucketMs` bookkeeping prevents the delta group from forming.

### 3. Fix ONLY what the evidence from (2) supports, with the smallest correct diff

- If (c): fix the eligibility/bookkeeping bug + RED-first regression test.
- If (b) with content-identical rewrites leaking past the emitter guard: fix at the emitter
  (it must not dispatch unchanged rows) + regression test in the market-data-store test file.
- If (b) with GENUINE below-water rewrites from backfill: do NOT weaken correctness (a genuine
  historical change MUST invalidate). Instead check feasibility of per-ROW granularity (invalidate
  only the affected cell's bars, or mark the cell for a bounded re-read from the changed row
  forward). Implement ONLY if it is a small, obviously correct diff; otherwise specify it in the
  report as a follow-up WO with exact anchors.
- If ONLY (a): no cache-side code fix is appropriate (the fix is upstream cycle time, being
  addressed by other WOs) — land deliverable 1, write the diagnosis, and say exactly that.

## Validation (all required; report exact outputs)

1. `pnpm --filter @workspace/api-server run typecheck` → EXIT 0.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor*.test.ts src/services/signal-options*.test.ts src/services/market-data-store*.test.ts`
   → 0 fail; report counts. (vitest is NOT installed; if the market-data-store glob matches no
   test file, drop it and say so.)

## Files you may touch

- `artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts`
- `artifacts/api-server/src/services/market-data-store.ts` (only if the evidence points at the emitter)
- ONE test file per touched source file (existing or new, node:test style)

## Commit (only after validations pass; one commit covering the counter split + any evidence-backed fix)

```
perf(signal-monitor): split stored-bars invalidation counters; <fix summary or 'diagnosis: cycle starvation, no cache-side fix'> (WO-FB2-F1B)

<3-6 lines: the measured zeros, which hypothesis the evidence confirmed, what was fixed vs deferred>
```

Do NOT push. Do NOT reload the app.

## Report

`.codex-watch/wo-fb2-f1b-report.md`: the diagnosis (a/b/c with evidence), counter values you
observed live (if the API was up long enough), what you fixed vs deferred (with anchors for any
follow-up WO), validation outputs, commit SHA. Final message: 3 lines max (rc, SHA, diagnosis
letter(s)).
