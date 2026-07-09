# WO-S3B-2 — Wire the incremental evaluator into signal-monitor behind a flag, with runtime parity sampling

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** You are a headless fix worker,
> not an interactive session. (1) Do NOT create/update any SESSION_HANDOFF_* file. (2) Do NOT read
> ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, agents/, or AGENTS.md session sections.
> (3) NEVER restart/rebuild/reload the app, never signal the supervisor, never `git push`. (4) 2-core
> box, LIVE trading app: run ONLY the listed validations. (5) Edit ONLY files under "Files you may
> touch". **PRECONDITION:** `git status --short -- artifacts/api-server/src/services/signal-monitor.ts`
> clean — if dirty (BUS-2 or another lane finishing), wait 60s up to 15 tries, then BLOCKED. Never
> `git add -A`. If `.git/index.lock` exists, sleep 10s and retry. (6) Minimum diff; the engine is
> DONE (commit dffa255e) — this WO is integration only.

## Context

- Engine: `createIncrementalPyrusSignalsEvaluator` (`lib/pyrus-signals-core/src/incremental.ts`,
  commit dffa255e) — byte-identical to `evaluatePyrusSignalsSignals` across all 11 parity fixtures
  at every append step (`assertAppendParity`).
- Integration point: the heavy-eval memo `evaluateSignalMonitorMatrixHeavyEvaluation`
  (signal-monitor.ts ~:9250-9296 — verify by grep) currently calls the from-scratch evaluator on
  every cache MISS (each new completed bar per cell → ~15 full array rebuilds). Gate context:
  `.codex-watch/wo-fb-s3b-decision.md` (GC 32.6% at open; gate MET).

## Mandate

1. Per-cell incremental evaluator instances keyed exactly like the heavy-eval memo
   (settingsSignature + symbol + timeframe): on miss, if an evaluator exists for the cell AND the
   new completed-bars array extends the previously evaluated series (same bars up to the previous
   length — verify cheaply via length + last-known fingerprint/timestamp, reusing the cache's
   existing content stamps; do NOT deep-compare full arrays), `append()` only the new bar(s).
   Otherwise (gap, rewrite, settings change, eviction) fall back to a FRESH evaluator seeded by
   appending the full series (which the parity harness proved equals from-scratch), replacing the
   cell's instance.
2. Flag: `PYRUS_SIGNALS_INCREMENTAL_EVAL` — default OFF ('off' | 'on' | 'shadow').
   - 'shadow' mode: run BOTH engines on a deterministic sample (1 in N evaluations, env, default
     50), compare results with the stable serializer, count matches/mismatches, and log + count any
     mismatch (a mismatch NEVER affects emitted results — from-scratch wins in shadow mode).
     Surface {mode, appends, seeds, shadowChecks, shadowMismatches} via the signal-monitor
     diagnostics the way the caches expose stats.
   - 'on': incremental result is used; keep the mismatch counter wired to a cheap periodic
     self-check (1 in 500, env) that logs — never throws — on divergence.
3. Bound instance memory: evaluator instances live in an LRU keyed like the heavy-eval cache with
   the SAME max entries constant; eviction = seed-on-next-miss (safe-degraded).
4. Byte-identity constraint unchanged: with the flag OFF, zero behavior difference (the only code
   on the hot path is the flag check).

## Tests

- Flag off → from-scratch path untouched (existing suites prove; run them).
- Flag on: append path produces identical evaluation results to from-scratch for a multi-append
  sequence (reuse fixture bars through the signal-monitor-level entry — follow the existing
  heavy-eval cache test file's patterns).
- Non-append transitions (shorter series, changed middle bar via content stamp change, settings
  change) → seed fallback, correct results.
- Shadow mode: mismatch counter stays 0 across the fixture sequence; a deliberately corrupted
  incremental result (test seam) increments it and does not alter the emitted result.

## Validation

1. `pnpm --filter @workspace/api-server run typecheck` → EXIT 0.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor*.test.ts` → 0 fail; report counts.
3. `pnpm --filter @workspace/pyrus-signals-core exec tsx --test --test-force-exit src/parity-fixtures.test.ts` (verify package name) → 0 fail.

## Files you may touch

- `artifacts/api-server/src/services/signal-monitor.ts`
- ONE test file (existing heavy-eval/matrix cache test file or new focused one)

## Commit

```
perf(signal-monitor): incremental signal evaluation behind PYRUS_SIGNALS_INCREMENTAL_EVAL with shadow parity sampling (WO-S3B-2)

<3-6 lines: append/seed mechanics, flag modes, LRU bound, default-off note>
```

Do NOT push. Do NOT reload (the dispatcher reloads, runs 'shadow' soak, then flips 'on' after clean soak).

## Report

`.codex-watch/wo-s3b-2-report.md`: integration mechanics (how append-extension is detected —
file:line), flag surface, validation outputs, commit SHA. Final message: 3 lines max.
