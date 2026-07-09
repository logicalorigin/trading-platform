# WO-S3B-1 — Incremental signal-evaluation engine (pyrus-signals-core), gated on the landed parity harness

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** You are a headless fix worker,
> not an interactive session. (1) Do NOT create/update any SESSION_HANDOFF_* file. (2) Do NOT read
> ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, agents/, or AGENTS.md session sections.
> (3) NEVER restart/rebuild/reload the app, never signal the supervisor, never `git push`. (4) The
> box has 2 cores and a LIVE trading app: run ONLY the validations listed below. (5) Edit ONLY files
> under "Files you may touch" — this WO does NOT touch artifacts/api-server at all (wiring is a
> separate WO). Never `git add -A`; stage exactly your files. If `.git/index.lock` exists, sleep 10s
> and retry. (6) Discipline: minimum code that works; no new dependencies; byte-identity beats
> elegance everywhere they conflict.

## Context

Gate history: `docs/plans/workorders-2026-07-08/wo-fb-s3b-incremental-agg.md` (HELD → gate MET, see
`.codex-watch/wo-fb-s3b-decision.md`: GC 32.6% of busy CPU at open; from-scratch rebuild confirmed
at source). The parity harness this WO depends on LANDED as commit `193cd181`:
- `lib/pyrus-signals-core/src/__fixtures__/parity-fixtures.ts` — fixture generator, stable
  serializer, and **`assertAppendParity(series, evaluateIncremental)`** (bar-by-bar prefix
  comparison against the from-scratch evaluator, first-diff reporting).
- 11 committed goldens + `src/parity-fixtures.test.ts` (golden drift test).

The from-scratch evaluator: `evaluatePyrusSignalsSignals` (`lib/pyrus-signals-core/src/index.ts:1149`)
rebuilds ~15 full-length series per call — closes map; WMA basis (:1165); ATR raw+smoothed
(:1166-1167, Wilder-recursive, running value carried UNROUNDED, outputs rounded `toFixed(6)`);
upper/lower bands via `toFixed(6)` string coercion (:1168-1177); trendLine; 3×bull/3×bear wires;
ADX (:1185, Wilder); volumeSma; volatilityScore (Sma+StdDev inside); trendDirection/regime arrays
(:1195-1200); then a full structure/CHoCH scan loop (~:1268+).

## Mandate — an append-incremental engine with BYTE-IDENTICAL outputs

New module `lib/pyrus-signals-core/src/incremental.ts`:

```
createIncrementalPyrusSignalsEvaluator(settings) -> {
  append(bar): EvaluationResult   // same result shape as evaluatePyrusSignalsSignals over all bars so far
  result(): EvaluationResult
}
```

### The identity rule that makes this tractable (follow it, don't fight it)

Float identity requires IDENTICAL ARITHMETIC ORDER, not just identical math. For each output
series, choose per-series between:

1. **True incremental** where the from-scratch code is already sequential-in-order — these carry
   over exactly: SMA (`computePyrusSignalsSma` :497 already uses one forward rolling sum — continue
   the same sum), ATR (:573 — continue the same unrounded recursion), ADX (:603 — same), and any
   other forward-only recursion you find. The incremental state stores the same intermediates the
   from-scratch loop would hold at that index.
2. **Windowed recompute per append** where the from-scratch computes each index from a bounded
   window in fixed order — WMA (window of `period`), StdDev (window slice), bands, volumeSma —
   computing ONLY the newest index per append (identical per-index arithmetic to the from-scratch
   loop body) is already O(period) instead of O(n·period): copy the exact loop-body expressions.
3. **Bounded-suffix recompute** for anything genuinely non-append-computable (candidate: the
   structure/CHoCH scan at :1268+ — ANALYZE it first; if pivots/structure state can be carried
   append-only with identical semantics, do that; if it back-references unboundedly, recompute that
   series over the exact suffix the from-scratch semantics require and PROVE the bound from the
   code — cite lines).

Every append returns the full result object; series arrays may be maintained in place (append) but
the values at every index must equal the from-scratch run over the same prefix — including all
`toFixed(6)` roundings and NaN warmup prefixes.

### Non-goals (do NOT do)

- No API changes to `evaluatePyrusSignalsSignals`; no consumer wiring (that is WO-S3B-2).
- No new fixture cases (use the landed 11; if a fixture exposes an impossibility, STOP and report
  BLOCKED with the exact divergence rather than weakening the comparison).
- No performance micro-tuning beyond the structural win; correctness first.

## Tests (extend `src/parity-fixtures.test.ts` or a sibling test file)

- **Full append parity, ALL 11 fixtures**: `assertAppendParity(fixture.series, incremental)` — the
  entire point of this WO; every prefix, every key, byte-identical. This is the merge gate.
- Settings variants: run parity on at least 2 fixtures with 2 non-default settings objects
  (read the settings shape/defaults at index.ts:172-206; vary at least timeHorizon and one period).
- State isolation: two interleaved evaluators (different fixtures) do not contaminate each other.
- Perf sanity (assertion, not benchmark): appending bar N to a 1000-bar series must not scale with
  N for the incremental series (e.g. wall-time for last 100 appends < from-scratch evaluating 100
  full prefixes / 5 — a loose factor, just proving the complexity class changed).

## Validation (report exact outputs)

1. Package typecheck (verify package name/script from lib/pyrus-signals-core/package.json).
2. `pnpm --filter <pkg> exec tsx --test --test-force-exit src/parity-fixtures.test.ts <your test file>`
   → 0 fail; report counts and the append-parity runtime.

## Files you may touch

- NEW `lib/pyrus-signals-core/src/incremental.ts`
- `lib/pyrus-signals-core/src/parity-fixtures.test.ts` or NEW sibling test file
- `lib/pyrus-signals-core/src/index.ts` ONLY if an internal helper must be exported to share exact
  loop-body arithmetic (export, never modify behavior)

## Commit (only after validations pass)

```
feat(pyrus-signals-core): append-incremental evaluator, byte-identical to from-scratch across all parity fixtures (WO-S3B-1)

<3-6 lines: per-series strategy split (incremental/windowed/suffix), the structure-scan finding,
parity + perf-sanity results>
```

Do NOT push. Do NOT reload the app.

## Report

`.codex-watch/wo-s3b-1-report.md`: per-series strategy table (series → strategy → evidence line),
the structure-scan analysis, validation outputs, commit SHA. Final message: 3 lines max — or
"BLOCKED: <fixture/key/index of the divergence>".
