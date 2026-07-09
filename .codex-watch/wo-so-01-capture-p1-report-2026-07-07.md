# WO-SO-01 Capture Diagnostic + P1 Scale-Out Report

Generated: 2026-07-08T01:33Z  
Worker: codex-worker, signal-options lane

## Phase 0 - Capture Diagnostic

Implemented `scripts/src/shadow-options-post-exit-enrich.ts`, a rerunnable enrichment job for `signal_options_shadow_exit` events and their `shadow_orders` mirrors. It reuses the extracted `computeSignalOptionsPostExitOutcomeFromBars` helper from `signal-options-automation.ts`, updates only missing `postExitOutcome` fields with `jsonb_set`, and does not overwrite existing payload data.

Run command:

```bash
pnpm --filter @workspace/scripts exec tsx ./src/shadow-options-post-exit-enrich.ts --from=2026-05-22 --to=2026-07-07
```

First run coverage:

| Metric | Count |
| --- | ---: |
| Scanned exits | 145 |
| Already present | 34 |
| Newly enriched | 86 |
| Skipped no data | 25 |
| Event payloads updated | 86 |
| Order payloads updated | 82 |

Skip reasons:

| Reason | Count |
| --- | ---: |
| missing_contract_or_price | 21 |
| no-option-aggregate-bars | 3 |
| no_post_exit_bars | 1 |

Idempotency rerun:

| Metric | Count |
| --- | ---: |
| Scanned exits | 145 |
| Already present | 120 |
| Newly enriched | 0 |
| Skipped no data | 25 |
| Event payloads updated | 0 |
| Order payloads updated | 0 |

Read-only DB coverage after enrichment: `execution_events` 120/145 have `postExitOutcome`; mirrored `shadow_orders` 116/120 have `postExitOutcome`. The unenriched rows are the same skipped-no-data set.

Review reason fix: updated both review bucketing sites to use `coalesce(payload->>'reason', payload->>'exitReason', 'unknown')`. Residual `unknown` is now 5 rows, all with empty reason fields and no `source_event_id`; maintenance/expiry rows now attribute through `exitReason`.

## Refreshed Live Baseline

Review command:

```bash
SHADOW_OPTIONS_MANAGEMENT_REVIEW_START=2026-05-22 SHADOW_OPTIONS_MANAGEMENT_REVIEW_END=2026-07-07 pnpm --filter @workspace/scripts run shadow:management-review
```

Report path: `/home/runner/workspace/scripts/reports/shadow-options-management-review/2026-07-08T01-27-35-765Z`

Opportunity Snapshot:

| Metric | Value |
| --- | ---: |
| Realized exit P&L | -31124.63 |
| Post-exit high opportunity | 153767.00 |
| Opportunity / realized ratio | n/a |

Caveat: post-exit highs are an upper-bound diagnostic, not capturable P&L. The April training-window thesis remains backfill-reconstructed/hindsight-filled; the May 22 through July 7 window above is the honest live baseline. In that live window, `runner_trail_stop` remains the top positive bucket: +8659.36 P&L, 36 exits, 66.7% wins, 34980 missed-to-high.

Exit reasons:

| Reason | Exits | Wins | Win % | P&L | Avg P&L | Missed To High | Reached +25% After Exit | Final > Exit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| runner_trail_stop | 36 | 24 | 66.7 | 8659.36 | 240.54 | 34980 | 28 | 14 |
| manual_force_close | 1 | 0 | 0 | -6.73 | -6.73 | 0 | 0 | 0 |
| opposite_signal | 20 | 2 | 10 | -906.56 | -45.33 | 28116 | 14 | 7 |
| overnight_risk_exit | 29 | 3 | 10.3 | -4253.76 | -146.68 | 53978 | 20 | 16 |
| expiration | 22 | 8 | 36.4 | -5144.07 | -233.82 | 0 | 0 | 0 |
| unknown | 5 | 0 | 0 | -6048.65 | -1209.73 | 0 | 0 | 0 |
| early_invalidation | 14 | 0 | 0 | -6168.17 | -440.58 | 21574 | 8 | 8 |
| hard_stop | 23 | 0 | 0 | -17256.05 | -750.26 | 15119 | 5 | 5 |

## Phase 1 - P1 Scale-Outs

Config is default-off:

```ts
scaleOut: {
  enabled: false,
  sellFractionPct: 60,
  runnerGivebackPct: 30,
}
```

Design decisions:

- Kept the durable event type as `signal_options_shadow_exit`; scale-outs are marked with `payload.partial: true`, `payload.scaleOutId: "first_trail_arm"`, `exitQuantity`, `remainingQuantity`, and `remainingPosition`.
- The live claim key for the scale-out is `deployment:position:scale-out:first_trail_arm`; the final exit keeps `deployment:position`, so a partial does not consume the final-exit claim.
- The fold retains positions for partial exits, decrements `quantity`, scales `premiumAtRisk` proportionally, and uses `remainingPosition` to preserve residual peak/stop/trail state. Final exits still delete the position.
- Daily P&L now keys one partial per `position:partial:scaleOutId` plus one final per `position:final`, so duplicate partials collapse while partial+final both count.
- Shadow exit dedup ignores `payload.partial === true` in SQL and in-memory, so a scale-out cannot suppress the later final exit.
- Scale-out fires at first trail arm, at most once per replayed position, only for `quantity >= 2`; sold quantity is `clamp(round(quantity * sellFractionPct / 100), 1, quantity - 1)`.
- Residual runner uses `runnerGivebackPct` while preserving peak. If a real stop reason is already present at the mark, the full exit wins over scale-out.

Backfill parity stance: backfill/replay remains full-close for v1. `closeBackfillPosition` still uses the shared post-exit outcome helper, but it does not simulate scale-outs. Sweep results remain interpretable as full-close baselines until a separate parity order implements partial replay.

No deployment flags or `algo_deployments.config` rows were changed.

## Verification

Passed:

```bash
pnpm --filter @workspace/scripts run typecheck
pnpm --filter @workspace/api-server run typecheck
pnpm exec tsc -p lib/backtest-core/tsconfig.json --noEmit
```

Passed:

```bash
cd artifacts/api-server
pnpm exec tsx --test \
  src/services/signal-options-scale-out.test.ts \
  src/services/signal-options-overnight-exit.test.ts \
  src/services/signal-options-trailing-ratchet.test.ts \
  src/services/signal-options-automation.test.ts \
  src/services/shadow-account-signal-options-exit-dedup.test.ts
```

Result: 81 tests passed.

The exact requested command from `lib/backtest-core` fails before test execution because that package has no local `tsx` binary:

```bash
cd lib/backtest-core
pnpm exec tsx --test src/signal-options.test.ts
# ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "tsx" not found
```

Equivalent workspace-run test passed:

```bash
pnpm --filter @workspace/scripts exec tsx --test ../lib/backtest-core/src/signal-options.test.ts
```

Result: 9 tests passed.

## Scope / Diff

Scoped status after work:

```text
 M artifacts/api-server/src/services/shadow-account-signal-options-exit-dedup.test.ts
 M artifacts/api-server/src/services/shadow-account.ts
 M artifacts/api-server/src/services/signal-options-automation.test.ts
 M artifacts/api-server/src/services/signal-options-automation.ts
 M artifacts/api-server/src/services/signal-options-exit-policy.ts
 M artifacts/api-server/src/services/signal-options-overnight-exit.test.ts
 M artifacts/api-server/src/services/signal-options-trailing-ratchet.test.ts
 M artifacts/api-server/src/services/signal-options-worker.ts
 M lib/backtest-core/src/signal-options.test.ts
 M lib/backtest-core/src/signal-options.ts
 M scripts/src/shadow-options-management-review.ts
?? artifacts/api-server/src/services/signal-options-scale-out.test.ts
?? scripts/src/shadow-options-post-exit-enrich.ts
```

`signal-options-worker.ts` and several signal-options test files were already dirty with P3/Wave work at start; I did not edit outside the ordered scope. Full tracked worktree diff is polluted by other live lanes: `61 files changed, 4540 insertions(+), 1421 deletions(-)`.

Scoped tracked `git diff --stat`:

```text
 ...hadow-account-signal-options-exit-dedup.test.ts |  18 +
 .../api-server/src/services/shadow-account.ts      |  79 ++--
 .../src/services/signal-options-automation.test.ts | 202 ++++++++-
 .../src/services/signal-options-automation.ts      | 457 +++++++++++++++++----
 .../src/services/signal-options-exit-policy.ts     |  61 ++-
 .../services/signal-options-overnight-exit.test.ts |  57 ++-
 .../signal-options-trailing-ratchet.test.ts        |  68 ++-
 .../src/services/signal-options-worker.ts          |  22 +-
 lib/backtest-core/src/signal-options.test.ts       |  53 ++-
 lib/backtest-core/src/signal-options.ts            |  57 +++
 scripts/src/shadow-options-management-review.ts    |   4 +-
 11 files changed, 933 insertions(+), 145 deletions(-)
```

New scoped files omitted by plain `git diff --stat`:

```text
artifacts/api-server/src/services/signal-options-scale-out.test.ts 307 lines
scripts/src/shadow-options-post-exit-enrich.ts 289 lines
```

## Expected Tally Drift

`SIGNAL_OPTIONS_TALLY=shadow` bake is running. Partial exits may create expected comparator drift where older assumptions expect one full-close exit per lifecycle: residual active quantity/premium, fold state, and daily P&L now distinguish `partial` scale-outs from final exits. Drift should be treated as expected if a comparator reads partial events before consuming `payload.partial`, `exitQuantity`, and `remainingPosition` with the new semantics.

Backfill/replay drift is also expected: v1 backfill still full-closes and does not emit scale-outs.

## Deferred

- Future automatic enrichment wiring was not added. Recommendation: run the new enrichment job from an explicit maintenance/post-close path or add a small scheduled scripts invocation. Piggybacking the live exit writer would require more runtime coupling than the requested Phase 0 surgical fix.
- Backfill/replay scale-out parity deferred as a separate order.
- The remaining 5 `unknown` review rows have no reason fields and no `source_event_id`; they are not the fixed maintenance `exitReason` class.
- `lib/backtest-core` lacks a local `tsx` devDependency/script for the exact acceptance command; package metadata is outside this work order scope.
