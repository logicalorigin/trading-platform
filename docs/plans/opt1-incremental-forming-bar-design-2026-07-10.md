# OPT-1 design: kill the incremental-eval seed storm (forming-bar re-evaluation)

## Problem (measured)
`PYRUS_SIGNALS_INCREMENTAL_EVAL=shadow` live counters: **seeds 4077 vs appends 219** (~19:1).
The incremental evaluator re-seeds from scratch on almost every tick because the **live/forming
bar mutates in place** (same timestamp, changing OHLC). The extension check
(`signal-monitor.ts:9632-9663`) only appends genuinely NEW bars; a changed last bar fails the
full-series fingerprint match → full re-seed. So flipping the flag `on` today yields ~no CPU win
(still ~95% from-scratch rebuilds). This is the blocker for the biggest event-loop lever (GC 23% +
per-tick recompute across ~12k cells).

## Root
`IncrementalPyrusSignalsEvaluatorImpl` (`lib/pyrus-signals-core/src/incremental.ts:454`) is
**append-only**: `append(bar)` pushes onto ~20 growing series arrays, folds 4 stateful accumulators
(`IncrementalFiniteSma` ×3, `IncrementalAdx`), and mutates ~12 swing/regime scalars. There is no way
to re-evaluate a mutated last bar except re-seeding the whole series.

## Two viable approaches
### A. Per-step rollback ("replaceLast") — fastest, hardest
Each accumulator + scalar + series stores the pre-last-append value so a single `popLast()` can undo
exactly one `append`. Wiring: on a forming-bar tick, `popLast()` then `append(updatedFormingBar)` =
O(1)/tick. Risk: ~30 rollback points must each be byte-exact; easy to miss one (e.g. ADX smoothed
state, median-interval tracker, retroactive filter refresh at :529, `promoteNoLongerFinalBar` at :530).

### B. Checkpoint/clone the confirmed state — simpler, O(N)/tick (RECOMMENDED first)
After each CLOSED bar, snapshot the evaluator (deep clone of state, custom `clone()` per class since
`structuredClone` drops prototypes). On a forming-bar tick: clone the last-closed snapshot, `append`
the forming bar, return `result()`, discard the clone. Confirmed state never advances past the last
closed bar. On bar close, the forming bar becomes confirmed → new snapshot.
- Cost: O(N) array copy per tick (N≈240) vs today's O(N×indicators) re-seed → still a large win, and
  far simpler to prove correct than 30 rollback points.
- Only ~24 fields to clone; all are numbers/number[]/small structs (cloneable). Add `clone()` to the
  evaluator + `IncrementalFiniteSma` + `IncrementalAdx` + `MedianPositiveIntervalTracker`.

## Wiring change
`evaluateSignalMonitorMatrixIncrementalEvaluation` (`signal-monitor.ts:9619`): keep the append fast
path for genuinely-new closed bars; add a branch for "same closed prefix, only the forming (last)
bar changed" → clone-last-closed + append forming (B) or popLast+append (A). Detect via the existing
`lastBarTime`/`appendedCount` + a separate `lastClosedSnapshot`.

## Correctness gate (non-negotiable — byte-identical)
1. `lib/pyrus-signals-core` parity: 23/23 (`index.test.ts`, `incremental-last-bar-closed.test.ts`,
   `incremental.test.ts`) must stay green.
2. `signal-monitor-matrix-eval-cache.test.ts`: 29/29.
3. Extend `__fixtures__/parity-fixtures.ts` with a **forming-bar-mutation** golden: seed N-1 closed
   bars, then feed K successive mutations of bar N, asserting each provisional result is byte-identical
   to a from-scratch evaluate of the same N bars. This is the exact path that's currently uncovered.
4. Shadow soak after wiring: `signalMonitorIncrementalEvalStats` — appends must dominate seeds
   (invert today's 219:4077), `shadowMismatches` stays 0, before flipping `on`.

## Rollout (reuses the existing runbook)
Implement B behind the existing `PYRUS_SIGNALS_INCREMENTAL_EVAL` flag → shadow soak (appends≫seeds,
0 mismatches) → `on`. Expect the eval cluster's CPU share + a large fraction of the 23% GC to drop;
confirm by re-profiling (`kill -SIGUSR1` + CPU profile), do not assume.

## Recommendation
Do B (clone) first — simpler to prove byte-identical, still a large win. Only pursue A (rollback) if
re-profiling shows the O(N)/tick clone is itself material. Implement as a focused, fixture-gated pass;
revert on any parity drift.
