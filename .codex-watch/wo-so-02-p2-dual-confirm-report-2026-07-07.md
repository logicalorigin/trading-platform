# WO-SO-02 P2 Opposite-Signal Dual-Confirm Report

Generated: 2026-07-08T01:51:26Z  
Worker: codex-worker, signal-options lane

## Gate / Ownership

Observed gate pass: `.codex-watch/wo-so-01-capture-p1-report-2026-07-07.md`
exists and its P1 section reports scale-out partial-exit machinery with
`exitQuantity`, `remainingPosition`, and green tests.

Observed newer WO-SO files: WO-SO-04 and WO-SO-05 were read-only report/audit
orders. WO-SO-06 explicitly stays scripts-only and says service files remain
owned by WO-SO-01. This work inherits WO-SO-01's service-file ownership.

## Design Decisions

- Config is default-off:
  `exitPolicy.oppositeSignalDualConfirm = { enabled: false, firstBarSellFractionPct: 50 }`.
  It normalizes nested config plus root compatibility keys, matching the P1
  `scaleOut` config style.
- First confirm definition: the first distinct actionable opposite signal for
  the open position's symbol/direction. If enabled, quantity is `>= 2`, and the
  carried entry quality tier is not `low`, the scan emits a partial
  `signal_options_shadow_exit` with `reason: "opposite_signal"`,
  `partial: true`, `scaleOutId: "opposite_signal_first_confirm"`,
  `exitQuantity`, `remainingQuantity`, and
  `remainingPosition.oppositeSignalPendingConfirm`.
- Sold quantity uses the P1 clamp:
  `min(quantity - 1, max(1, round(quantity * firstBarSellFractionPct / 100)))`.
  There is no second partial-exit path.
- Second confirm definition: a later distinct `signalKey` with the same
  opposite direction as the pending confirm. The same signal key returns a hold
  action so replay/retry cannot sell the residual twice.
- Direction resume clearing: a same-direction actionable signal while pending
  writes a durable skipped event with
  `reason: "opposite_signal_pending_confirm_cleared"`. The existing fold now
  treats only that reason as a position-state patch and clears
  `oppositeSignalPendingConfirm`; skipped events are not mirrored into shadow
  orders.
- Quality shading: if `position.signalQuality.tier === "low"`, the feature keeps
  today's immediate full close.
- One-contract positions keep today's immediate full close.
- Flip precedence: when dual-confirm is enabled, the first confirm returns
  "not closed" to the scan after emitting the partial, so the reverse entry is
  not opened. The second confirm uses the existing full-position claim key,
  returns closed, and the current close-and-reverse flow may then open the flip.
- Restart safety: pending state persists via the partial exit's
  `remainingPosition`. Clear state persists via the skipped clear event. Both
  full derive and running tally use the same fold logic.
- MTF-alignment loss: deferred in this P2 implementation. Observed cheapest data
  at this branch is the actionable opposite candidate itself; treating its entry
  MTF mismatch as "original direction lost" would collapse the requested first-bar
  trim into an immediate full exit. A separate source-backed MTF-loss check should
  use explicit original-direction matrix state if/when the product wants that
  precedence.

No deployment flags or `algo_deployments.config` rows were changed.

## Verification

Failing-first observed:

```bash
cd artifacts/api-server
pnpm exec tsx --test src/services/signal-options-opposite-dual-confirm.test.ts
# 8/8 failed before implementation: missing helpers and pending replay absent
```

Passed:

```bash
pnpm exec tsc -p lib/backtest-core/tsconfig.json --noEmit
pnpm --filter @workspace/api-server run typecheck
```

Passed:

```bash
cd artifacts/api-server
pnpm exec tsx --test \
  src/services/signal-options-opposite-dual-confirm.test.ts \
  src/services/signal-options-scale-out.test.ts \
  src/services/signal-options-overnight-exit.test.ts \
  src/services/signal-options-trailing-ratchet.test.ts \
  src/services/signal-options-automation.test.ts
# 83 tests passed
```

Additional config test run:

```bash
pnpm --filter @workspace/scripts exec tsx --test ../lib/backtest-core/src/signal-options.test.ts
# 10 tests passed
```

Note: API typecheck reads local project-reference declarations from
`lib/backtest-core/dist`; I regenerated those ignored declarations with
`pnpm exec tsc -p lib/backtest-core/tsconfig.json` after the no-emit source
check. No tracked dist files were added.

## Scope / Diff

Scoped status:

```text
 M artifacts/api-server/src/services/signal-options-automation.test.ts
 M artifacts/api-server/src/services/signal-options-automation.ts
 M artifacts/api-server/src/services/signal-options-exit-policy.ts
 M artifacts/api-server/src/services/signal-options-overnight-exit.test.ts
 M artifacts/api-server/src/services/signal-options-trailing-ratchet.test.ts
 M artifacts/api-server/src/services/signal-options-worker.ts
 M lib/backtest-core/src/signal-options.test.ts
 M lib/backtest-core/src/signal-options.ts
?? artifacts/api-server/src/services/signal-options-opposite-dual-confirm.test.ts
?? artifacts/api-server/src/services/signal-options-scale-out.test.ts
```

`signal-options-scale-out.test.ts` and several modified signal-options files
were inherited from WO-SO-01/P3/P1 before this work. New WO-SO-02 test file:
`artifacts/api-server/src/services/signal-options-opposite-dual-confirm.test.ts`
is 318 lines.

Scoped tracked `git diff --stat`:

```text
 .../src/services/signal-options-automation.test.ts | 202 ++++-
 .../src/services/signal-options-automation.ts      | 811 +++++++++++++++++----
 .../src/services/signal-options-exit-policy.ts     |  61 +-
 .../services/signal-options-overnight-exit.test.ts |  57 +-
 .../signal-options-trailing-ratchet.test.ts        |  68 +-
 .../src/services/signal-options-worker.ts          |  15 +-
 lib/backtest-core/src/signal-options.test.ts       |  83 ++-
 lib/backtest-core/src/signal-options.ts            |  97 +++
 8 files changed, 1236 insertions(+), 158 deletions(-)
```

## Deferred

- MTF-alignment-loss full-exit trigger, pending a clear source of original
  direction alignment state that does not erase the first-confirm trim behavior.
- Historical backfill parity for dual-confirm exits.
- Deployment flag/config flip. claude-lead owns enabling the default-off field.
