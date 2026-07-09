# WO-FB2-F1A — Universe completed-bars cache: stop clock-churn invalidation (port of a876dd01)

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** You are a headless fix worker,
> not an interactive session. (1) Do NOT create/update any SESSION_HANDOFF_* file. (2) Do NOT read
> ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, agents/, or AGENTS.md session sections.
> (3) NEVER restart/rebuild/reload the app, never signal the supervisor, never run
> REPLIT_MODE=workflow, never `git push`. (4) The box has 2 cores and a LIVE trading app: run ONLY
> the validations listed below. (5) Edit ONLY the files under "Files you may touch". The worktree
> carries OTHER agents' uncommitted work — never `git add -A`; stage exactly your files. If
> `.git/index.lock` exists, sleep 10s and retry. (6) Discipline: minimum diff that works; reuse
> existing helpers/patterns; no new abstractions or dependencies; every changed line traces to this
> mandate.

## Context (measured, 2026-07-09)

Root-cause doc: `docs/plans/signal-monitor-gc-pool-rootcause-2026-07-09.md` (cause #1). The
signal-monitor UNIVERSE evaluation's completed-bars cache (TTL 30s, 3072 entries; constants near
`signal-monitor.ts:456,470`; key built near `:7850-7871`) includes a clock-derived time component
(`signalMonitorCompletedBarsQueryTo`) in its key. Every advance of that component re-keys the entry,
so unchanged cells MISS and re-trigger the durable `bar_cache` read fan-out — up to 2000 symbols ×
{15m,1h,1d} × 2 sources × 1000 rows. This was measured as the dominant allocator
(node-postgres `_parseRowAsArray` = 50.7% of ALL heap allocation at market open) and the dominant
pool consumer (bar_cache SELECT ≈ 9,380s client-execution in one morning's slow-query firehose).

Precedent: commit `a876dd01` fixed the SAME bug class on the STREAM path — see
`buildSignalMonitorStreamCompletedBarsCacheKey` (near `signal-monitor.ts:9168-9180`) and its
1-miss-1-hit regression in `src/services/signal-monitor-stream-completed-bars-cache.test.ts`. Your
job is the universe-path port, with one crucial difference (below).

## The design requirement (read carefully — this is the identity-sensitive part)

Replace the raw clock component in the KEY with the **expected latest completed bucket** for the
cell's timeframe: `bucketStartMs(queryTo, timeframe)` (the file already has bucket helpers — find
and reuse them, e.g. what `resolveBucketStartMs`/equivalent the universe path uses). Effect:

- a 1m cell still re-keys every minute (a new bar genuinely exists every minute — refresh REQUIRED);
- a 15m cell re-keys only at 15m boundaries; 1h at hour boundaries; 1d at day boundaries —
  eliminating the universe-wide per-minute invalidation for exactly the three timeframes that hit
  the DB.

VALUE-level semantics that must be preserved BYTE-IDENTICALLY (failable):

1. A cache hit must never return bars newer than the request's `queryTo`. If the cached entry can
   contain bars beyond a request's boundary (same bucket, earlier queryTo), filter on read — the
   codebase has an established pattern for this (`barsThroughEvaluatedAt` in
   `signal-monitor-local-bar-cache.ts`); mirror it rather than inventing one. If, after reading the
   actual fetch code, you determine entries can never contain bars beyond the bucket boundary,
   document WHY in a comment instead of adding dead filtering.
2. Requests in a NEW bucket must MISS (fresh read) — never serve the previous bucket's tail as if
   current.
3. TTL and max-entry semantics unchanged.
4. Evaluation inputs for any (symbol, timeframe, queryTo) request must be identical pre/post change.
   If you find ANY case where they would differ, STOP, do not commit, and write the case into your
   report as a blocker.

First VERIFY the actual current key composition by reading the code (the anchor line numbers may
have drifted; the key may already quantize to some bucket — if it already quantizes to the
TIMEFRAME bucket for 15m/1h/1d, the premise is wrong: STOP, report what it actually does with
file:line evidence, and do not change code).

## Tests (RED-first)

In the appropriate existing test file (or a new focused one following
`signal-monitor-stream-completed-bars-cache.test.ts`'s style):

- 15m/1h cell: first read misses, second read with queryTo advanced by 1 minute WITHIN the same
  bucket HITS (this is the test that is RED today) and returns byte-identical bars.
- Same cell, queryTo crossing the bucket boundary → MISS (fresh read).
- Hit with an EARLIER queryTo in the same bucket never returns bars past that queryTo.
- 1m cell: advancing to the next minute still misses (per-minute refresh preserved).

## Validation (all required; report exact outputs)

1. `pnpm --filter @workspace/api-server run typecheck` → EXIT 0.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor*.test.ts src/services/signal-options*.test.ts`
   → 0 fail; report counts. (vitest is NOT installed.)

## Files you may touch

- `artifacts/api-server/src/services/signal-monitor.ts`
- ONE test file (existing or new `src/services/signal-monitor-*.test.ts`)

## Commit (only after validations pass)

```
perf(signal-monitor): universe completed-bars cache keys on expected latest bucket, not clock — unchanged 15m/1h/1d cells now cache-hit (WO-FB2-F1A)

<3-5 lines: measured evidence (50.7% _parseRowAsArray / 9,380s bar_cache reads), the bucket-key design, the queryTo value-filter guarantee, a876d01 precedent>
```

Do NOT push. Do NOT reload the app.

## Report

`.codex-watch/wo-fb2-f1a-report.md`: actual current key composition found (file:line), what changed,
why value-level queryTo semantics are preserved (evidence), validation outputs, commit SHA, risks.
Final message: 3 lines max (rc, SHA, counts) — or "BLOCKED: <reason>" if you hit requirement 4.
