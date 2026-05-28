# 5-28 Trading Analysis — Greek-Aware, Wireband-Following Trailing Stop

> Finalized update to `5-27 trading analysis.md`. This version is handoff-ready for implementation and backtesting. It keeps the 5-27 greek-aware trade-management thesis, but locks the concrete design around a Pyrus wireband-following trailing stop and corrects the feasibility gaps found in code review.

## Executive summary

The current signal-options exit stack exits runners in option-premium space only. The 5-26 shadow management review showed that this captured meaningful realized P&L, but left a large upper-bound opportunity behind:

- Realized exit P&L: `$156,036.85`
- Post-exit high opportunity: `$996,747.00`
- Opportunity / realized ratio: `6.39x`
- Largest leak: `runner_trail_stop` exits, with `324` exits, `$93,044.43` realized P&L, and `$485,331.00` later-high opportunity.
- Reversal-like exits also need caution: `opposite_signal` exits made `$51,853.80`, but left `$255,874.00` later-high opportunity.

The next trade-management improvement should be a dual-leg trailing stop:

1. **Structure leg:** follows the Pyrus Signals wirebands on the underlying and exits only when the latest closed signal-timeframe bar violates the selected wire.
2. **Premium floor:** preserves the existing option-premium stop/floor so theta bleed, IV crush, stale structure context, or premium collapse cannot go unprotected.

Phase 1 requires fresh greeks before enabling greek modulation. If greeks are missing or stale, the system must run in conservative fallback: structure leg plus fixed premium floor, no greek loosening.

## Current state verified in code

- **Exit math is option-premium-only.** `computeSignalOptionsPositionStop` in `artifacts/api-server/src/services/signal-options-exit-policy.ts` currently computes `max(hardStop, max(entry * (1 + minLockedGain%), peak * (1 - giveback%)))`. It has no underlying price, wire, regime, or greek input.
- **The live exit mark path can carry greeks, but does not require them today.** `SignalOptionsOptionQuote` includes `impliedVolatility`, `delta`, `gamma`, `theta`, and `vega`, but `refreshActivePosition` currently requests bridge position-mark snapshots with `requiresGreeks: false`. Greek modulation must not be considered live until this path sources fresh greeks.
- **Spread is already available in the live exit mark resolution.** `markResolution.liquidity.spreadPctOfMid` is usable for tightening/fallback decisions.
- **Exit cadence is deployment-scan-based.** The worker wakes every `5s`, but deployment scans are scheduled by `signalOptions.worker.pollIntervalSeconds` with a `15s` minimum. Per-position runner cadence is not a one-line change.
- **Wire math is frontend-owned today.** The frontend adapter derives `upperBand`, `lowerBand`, `trendLine`, and bull/bear wires from `basis`, `atrSmoothed`, `volatilityMultiplier`, `wireSpread`, and `regimeDirection`. `pyrus-signals-core` currently returns the ingredients, not the final wire arrays.
- **Signal monitor state does not currently expose wire context.** The monitor computes Pyrus evaluations internally, but the persisted/current state only includes signal direction/time/price, latest bar time, freshness, and status. Exit code needs an explicit structural-context handoff.
- **Historical greeks are not stored for signal-options replay.** Backtests can validate the structure leg and fixed premium floor, but greek modulation needs live/shadow validation unless a separate historical-greeks data effort is added.

## Locked design decisions

### 1. Greeks are a phase-1 prerequisite for modulation

Phase 1 does not merely "use greeks if present." It must update the live exit mark path to source fresh `delta`, `gamma`, `theta`, `vega`, and IV for the open contract before greek-modulated rung selection is enabled.

Implementation requirements:

- Change the live position mark quote source to request greeks or reuse a fresh greek-bearing quote source.
- Record greek values and greek freshness in the stop payload.
- If greeks are stale or missing:
  - fixed premium floor remains active;
  - wire structure leg remains active if structural context is fresh;
  - greek loosening is disabled;
  - greek tightening uses conservative fallback only.

### 2. Wire context comes from the existing scan pass

Do not refetch/recompute underlying bars per open position. During each signal-options scan, compute structural context once per evaluated underlying and pass it in memory to active position refresh.

Required context per symbol:

```ts
type SignalOptionsStructuralContext = {
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  latestClosedBarAt: string;
  latestClose: number;
  evaluationIndex: number;
  regimeDirection: 1 | -1;
  trendLine: number | null;
  upperBand: number | null;
  lowerBand: number | null;
  bullWires: [number | null, number | null, number | null];
  bearWires: [number | null, number | null, number | null];
  source: "signal_monitor_scan";
};
```

If this context is missing or stale, skip only the structure leg. The premium floor must still run.

### 3. `pyrus-signals-core` becomes the wire source of truth

Move band/wire derivation into `lib/pyrus-signals-core` and extend `PyrusSignalsEvaluation` with:

- `upperBand: number[]`
- `lowerBand: number[]`
- `trendLine: number[]`
- `bullWires: [number[], number[], number[]]`
- `bearWires: [number[], number[], number[]]`

The frontend adapter should either consume these arrays directly or remain fixture-tested against core output. Until that lands, do not claim "no divergence risk"; today the frontend and core share inputs, but the frontend owns the wire math.

### 4. Regime flip is replay-gated, not an automatic exit

An adverse CHOCH/regime flip is a thesis-warning event, not a phase-1 sell button. Current shadow data supports caution: `opposite_signal` exits captured profit but left substantial later-high opportunity. However, the existing shadow report does not record exact regime-flip timing relative to each trade.

Phase 1 behavior:

- Do not add `regime_flip_handoff` as an `exitReason`; existing automation treats exit reasons as closing events.
- Record a non-closing reversal-handoff/diagnostic state when structural context shows regime flipped against the open position.
- Tighten protective state conservatively after handoff, but keep final trim/full-exit rules behind replay validation.

Required replay diagnostic:

- Reconstruct Pyrus regime direction from underlying bars for historical shadow trades.
- Record whether and when regime flipped against each open position.
- Compare immediate exit, tighten-only, and partial-trim outcomes.
- Promote a regime-flip rule only if April train and May holdout results support it.

### 5. Runner cadence is a scheduler decision

The worker schedules scans per deployment, not per position. For phase 1, use the least surprising operational path:

- If wire trail is enabled for a deployment, set or recommend an effective deployment poll of `15-20s` during market hours.
- Do not promise per-position runner polling until the worker has a separate active-position scheduler or mark-only fast path.
- Keep the optional future enhancement: a lightweight 5s mark-only premium-floor check between full scans.

### 6. Backtest parity means both relevant engines

There are two historical surfaces to consider:

- `artifacts/api-server/src/services/signal-options-automation.ts` historical signal-options backfill, which replays option entries/exits.
- `lib/backtest-core/src/engine.ts`, the generic OHLC backtest engine.

For signal-options trade-management validation, the signal-options historical backfill path is the primary target. `backtest-core` parity is useful only if the strategy profile/UI uses it for comparison or sweeps.

## Stop behavior

### Dual-leg stop

Exit if either leg fires:

1. **Structure leg:** latest closed underlying bar violates the selected active-side wire.
   - Long/call runner: exit when latest close is below the selected bull wire.
   - Put/short-direction runner: exit when latest close is above the selected bear wire.
   - Use closed bars only, not intrabar wicks.
2. **Premium floor:** existing option mark check remains active.
   - `max(hardStop, entry * (1 + minLockedGain%), peak * (1 - giveback%))`
   - Always evaluated against the freshest actionable option mark.

The legs protect different failure modes:

- IV crush while structure holds -> premium floor exits.
- Structure breaks while premium is sticky -> structure leg exits.

### Rung selection

Profit sets the baseline wire rung:

- early runner: outer wire (`wire3`)
- stronger peak gain: `wire2`
- mature runner: `wire1`
- extreme/late runner: `trendLine`

Greeks modulate the rung only when fresh:

- Loosen one rung while delta is strong/improving and gamma is supportive.
- Tighten one rung on delta decay, theta burden, or spread deterioration.
- Never loosen on stale greeks.
- Never disable the premium floor because structure or greeks are unavailable.

Starting greek thresholds:

- Delta improvement: `abs(delta_now) - abs(delta_entry) > 0.05` -> eligible to loosen one rung.
- Delta decay: `abs(delta_now) - abs(delta_entry) < -0.10` -> tighten one rung.
- Theta burden: `abs(theta) / mark > 0.08` per day -> tighten one rung.
- Gamma: strong gamma plus profitable runner permits looser rung; gamma collapse removes extra loosening.
- Spread: `spreadPctOfMid > max(entrySpread * 1.5, liquidityGate.maxSpreadPctOfMid)` -> tighten or exit depending on severity.

### Premium floor rollout

Use two sub-phases:

1. **Phase 1A:** structure leg plus existing fixed-percent premium floor.
2. **Phase 1B:** delta-sized giveback after wire mechanics are validated.

Delta-sized floor formula:

```text
premiumGivebackToWire = abs(delta) * abs(underlyingSpot - selectedWire) * 100
```

Do not add an explicit `0.5 * gamma * dS^2` term in stop arithmetic. Gamma belongs in the quality/rung layer. Recomputing the delta translation every poll makes the first-order estimate converge as price approaches the wire.

## Implementation sequence

### Phase 1A — core wire trail with fixed premium floor

- Add band/wire arrays to `pyrus-signals-core`.
- Extend signal-monitor evaluation scan output with ephemeral `SignalOptionsStructuralContext` per symbol.
- Pass structural context into `refreshActivePosition`.
- Extend `computeSignalOptionsPositionStop` input with optional structural context and greek payload.
- Add structure-leg firing and stop payload diagnostics.
- Preserve existing hard stop, fixed premium floor, early invalidation, and overnight behavior unless explicitly gated by the new policy.
- Add profile/UI fields:
  - wire trail enabled;
  - rung-by-profit map;
  - greek modulation enabled;
  - greek freshness max age;
  - delta-sized floor disabled by default.

### Phase 1B — greek modulation and delta-sized floor

- Update live position mark sourcing so fresh greeks are required for modulation.
- Add rung loosening/tightening from delta/gamma/theta/spread.
- Add delta-sized premium giveback behind a feature flag.
- Record fallback mode whenever greeks are missing or stale.

### Phase 1C — regime replay diagnostic

- Add a shadow/backfill diagnostic that reconstructs Pyrus regime direction over each historical trade.
- Compare immediate adverse-regime exit vs tightened trail vs partial trim.
- Use the results to decide whether regime flip becomes:
  - non-closing handoff only;
  - partial trim;
  - full exit after confirmation;
  - no phase-1 trading action.

### Phase 2 — partial/runner scaling

- Add `exitQuantity` to exit events.
- On scale-out, reduce open position quantity instead of deleting the position.
- Reuse existing shadow `positionQuantity` / `partial_shadow` infrastructure.
- Candidate trigger: first major tighten after `+50%` peak gain sells `50-70%`, keeps `30-50%` runner on wire trail while greek quality stays strong.

### Later phases

- Opposite-signal greek gating.
- Overnight greek residuals.
- Historical greek storage only if live/shadow evidence shows the greek layer adds edge.

## Backtesting plan

### Primary: signal-options historical backfill

Backfill should validate:

- structure leg closes on latest closed-bar wire violation;
- premium floor still closes on premium collapse;
- missing structural context skips structure leg and keeps premium floor;
- fixed floor vs wire trail capture on April train and May holdout;
- replay diagnostic for adverse regime flips.

Historical greeks are neutral in this path unless a separate data source is added.

### Secondary: `backtest-core`

Add generic wire-structure parity only if needed for UI/sweep comparisons. Do not treat `lib/backtest-core/src/engine.ts` as sufficient validation for signal-options trade management by itself.

### Metrics to report

- realized P&L;
- profit factor;
- max drawdown;
- closed trades;
- win rate;
- runner-trail capture versus post-exit high opportunity;
- missed-to-realized ratio versus the `6.39x` baseline;
- count of structure exits, premium-floor exits, missing-context fallbacks, stale-greek fallbacks, and regime-handoff diagnostics.

## Verification checklist

Unit and integration coverage:

- `pyrus-signals-core`: wire arrays match current frontend adapter fixture output.
- Exit policy:
  - structure leg fires on closed-bar wire break;
  - structure leg ignores intrabar-only wick violation;
  - premium floor fires while structure holds;
  - either leg wins correctly in conflict scenarios;
  - missing/stale structural context does not disable premium floor;
  - fresh greeks are required for greek loosening;
  - stale/missing greeks fall back conservatively;
  - delta-sized giveback is tighter for deep-ITM than OTM when enabled;
  - adverse regime flip records non-closing handoff/diagnostic state.
- Signal-options automation:
  - active position refresh receives structural context from the current scan;
  - quote source requests or reuses fresh greeks when greek modulation is enabled;
  - stop payload records structural context, selected rung, greek freshness, and fallback mode.
- Backfill:
  - wire-structure replay works with greeks neutral;
  - regime diagnostic compares immediate exit/tighten-only/partial-trim variants.
- Frontend/profile:
  - settings normalize new exit policy fields;
  - Algo settings UI exposes the feature flags and thresholds without breaking existing profile defaults.

Expected targeted validation commands after implementation:

```bash
pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-options-automation.test.ts
pnpm --filter @workspace/api-server exec node --import tsx --test src/services/shadow-account.test.ts
pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/algo/algoHelpers.test.js
pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/charting/pyrusSignalsPineAdapter.test.ts
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/pyrus run typecheck
pnpm --filter @workspace/scripts run test:shadow-options-management-review
```

If startup config, artifact dev scripts, or Replit guard files are touched, also run:

```bash
pnpm run audit:replit-startup
```

## Handoff notes

- Do not implement `regime_flip_handoff` as an `exitReason`; exit reasons close positions today.
- Do not rely on current monitor state as wire context; add an explicit in-memory scan context.
- Do not enable greek rung loosening without fresh greeks.
- Do not remove the premium floor under any missing-data condition.
- Treat the structure leg as the novel mechanic to prove first; treat delta-sized floor and partial runners as subsequent controlled changes.
