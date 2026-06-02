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

## 5-28 current state verified in code

This section records the implementation baseline that informed the original 5-28 wire-trail plan. Later code may have advanced parts of the exit stack; the 5-31 research update below re-verified only the contract-selection path.

- **Exit math is option-premium-only.** `computeSignalOptionsPositionStop` in `artifacts/api-server/src/services/signal-options-exit-policy.ts` currently computes `max(hardStop, max(entry * (1 + minLockedGain%), peak * (1 - giveback%)))`. It has no underlying price, wire, regime, or greek input.
- **The live exit mark path can carry greeks, but does not require them today.** `SignalOptionsOptionQuote` includes `impliedVolatility`, `delta`, `gamma`, `theta`, and `vega`, but `refreshActivePosition` currently requests bridge position-mark snapshots with `requiresGreeks: false`. Greek modulation must not be considered live until this path sources fresh greeks.
- **Spread is already available in the live exit mark resolution.** `markResolution.liquidity.spreadPctOfMid` is usable for tightening/fallback decisions.
- **Exit cadence is deployment-scan-based.** The worker wakes every `5s`, but deployment scans are scheduled by `signalOptions.worker.pollIntervalSeconds` with a `15s` minimum. Per-position runner cadence is not a one-line change.
- **Wire math is frontend-owned today.** The frontend adapter derives `upperBand`, `lowerBand`, `trendLine`, and bull/bear wires from `basis`, `atrSmoothed`, `volatilityMultiplier`, `wireSpread`, and `regimeDirection`. `pyrus-signals-core` currently returns the ingredients, not the final wire arrays.
- **Signal monitor state does not currently expose wire context.** The monitor computes Pyrus evaluations internally, but the persisted/current state only includes signal direction/time/price, latest bar time, freshness, and status. Exit code needs an explicit structural-context handoff.
- **Historical greeks are not stored for signal-options replay.** Backtests can validate the structure leg and fixed premium floor, but greek modulation needs live/shadow validation unless a separate historical-greeks data effort is added.

## 5-31 research update: Greek-expectancy contract selection

This update extends the 5-27 entry-Greek thesis into a research-backed contract-selection framework. It is intentionally **research and strategy only** for this pass: no live, paper, or shadow selector behavior should change from this document update alone.

The current selector still gives the algo a narrow search problem: choose the option right from the signal, search the configured DTE/strike-slot window, build an order plan, and take the first quote that passes premium/liquidity constraints. It captures `entryGreeks` when the selected quote has them, but it does not yet rank candidate contracts by expected value, IV richness, theta drag, or break-even distance.

The next selector should answer a different question:

```text
Given this signal, expected move, and expected holding window,
which available contract has the best net expectancy after
delta/gamma participation, theta, vega/IV risk, and trading friction?
```

### Research takeaways

- `delta` is the first filter for directional participation. For a bullish call or bearish put, the aligned delta should be large enough that the contract actually participates in the expected underlying move. Low-delta contracts can look cheap while requiring an outsized move just to overcome premium, theta, and spread.
- `gamma` is useful when the signal expects acceleration over a short window. It should be rewarded only when the expected move can occur soon enough to beat theta and spread cost. High gamma plus a flat underlying is usually just expensive optionality.
- `theta` should be measured against the planned holding window. A contract can be a good scalp candidate and a bad runner candidate at the same mark price if its daily theta burden is too high.
- `vega` and IV matter because entry P&L can be right directionally and still lose if IV compresses. Elevated IV is not automatically bad, but it should require a stronger expected move, better delta, more DTE, or a specific reason to expect IV to hold or expand.
- Spread and fill quality are part of expectancy, not just operational hygiene. A theoretically superior contract with a wide bid/ask can have worse realized expectancy than a slightly less convex but more liquid contract.

### Candidate scoring model

Use a per-contract score that projects the option's expected value over the signal horizon before applying caps/gates:

```text
aligned_delta = signal_direction * option_delta

projected_option_edge_per_contract =
  100 * (
    aligned_delta * expected_underlying_move
  + 0.5 * gamma * expected_underlying_move^2
  + vega * expected_iv_change
  - abs(theta) * expected_holding_days
  )
  - estimated_round_trip_spread_cost
```

Then normalize into a selector score:

```text
entry_greek_score =
  directional_delta_fit
+ gamma_convexity_fit
+ expected_move_fit
+ liquidity_quality
- theta_burden
- spread_cost
- IV_overpayment_penalty
- break_even_penalty
- stale_or_missing_greek_penalty
```

Important implementation notes for a future code pass:

- Provider Greek units must be normalized before using the formula directly. In particular, confirm whether `vega` is reported per 1.00 volatility change or per 1 volatility point.
- The formula should be used for ranking and diagnostics first, not as a hard truth model. It is a rough edge estimate that needs calibration against shadow/backtest outcomes.
- Missing or stale Greeks should not fabricate confidence. In a future rollout, the selector should fall back to the existing strike-slot behavior or heavily penalize missing-Greek candidates until coverage is proven.

### Strike and expiration framework

Contract selection should choose a management profile at entry, because the same Greek mix is not optimal for every signal:

- **Scalp:** shorter DTE is acceptable when the signal expects a fast move. Favor gamma and adequate delta, but cap theta burden and spread aggressively.
- **Intraday trend:** favor balanced delta/gamma, enough DTE to survive normal chop, and theta burden that is reasonable for the expected session hold.
- **Runner candidate:** favor stronger delta, lower theta burden, more DTE cushion, and tradable spreads. Do not overpay for maximum gamma if the intended hold may extend.
- **Lottery:** allow only for exceptional signal quality, capped premium, and explicit acceptance that low-delta OTM options often have poor average expectancy after IV, theta, and spread.

The strike decision should not be "more OTM is better because it is cheaper." A better rule is:

```text
Choose the strike whose break-even move plus expected decay/friction
is comfortably inside the signal's modeled favorable move.
```

The expiration decision should not be "nearest expiration is always better." A better rule is:

```text
Choose the shortest expiration that gives enough gamma
without making theta burden dominate the planned hold.
```

### Avoiding overpriced contracts

For this app, "overpriced" should mean overpriced relative to the signal's expected move and holding period, not simply "high IV."

Penalty conditions:

- **IV versus realized volatility:** penalize contracts where implied volatility is materially above recent realized volatility unless there is a known catalyst or the signal model expects a move large enough to justify it.
- **Implied move versus modeled move:** using the Rule of 16 approximation, high IV implies a larger expected daily move. If the option's implied move is much larger than the move our signal is forecasting, require stronger confirmation or reject the candidate.
- **Break-even distance:** penalize when the required underlying move to overcome premium, theta, and spread exceeds the expected favorable move.
- **Surface richness:** penalize strikes/expirations that are rich relative to nearby alternatives with similar delta/liquidity. This catches skew/smile cases where the exact strike being selected is expensive even if headline IV looks acceptable.
- **Theta burden:** penalize when `abs(theta) / mark` consumes too much of the premium over the intended hold.
- **Liquidity friction:** reject or heavily penalize wide spreads, stale quotes, crossed markets, very low bid, and thin contracts even when the theoretical Greek profile is attractive.

Starting diagnostics:

```text
theta_burden_pct = abs(theta) / mark * 100
spread_pct_of_mid = (ask - bid) / mid * 100
break_even_move = (ask + expected_theta_decay + spread_cost) / max(abs(delta), min_delta_floor)
iv_realized_premium = implied_volatility - realized_volatility_for_horizon
```

### Expected-move inputs from Pyrus

The selector needs an expected underlying move and expected holding window. Good first inputs are already close to the app:

- Pyrus wire distance from signal price to the next structural target or invalidation band.
- ATR or recent realized volatility over the signal timeframe.
- Signal confidence from MTF alignment, ADX/strength, volatility state, and trend age.
- Historical outcome distribution for the same signal family and timeframe.
- Time-of-day and session window, because a signal with 20 minutes left in the session should not pay the same theta/IV profile as a morning runner.

Do not require a perfect model for V1. Start by logging all candidate inputs and comparing score deciles against realized shadow outcomes.

### Data requirements and current gaps

Available now or already represented in the quote/position path:

- bid, ask, mark/last, quote freshness, open interest, volume;
- `delta`, `gamma`, `theta`, `vega`, `impliedVolatility` when the provider returns them;
- entry Greek snapshots on selected positions.

Needed before the selector can be trusted:

- candidate-level score payloads for every considered contract, not only the selected one;
- a realized-volatility baseline for the relevant horizon;
- IV rank/percentile or another symbol-local IV context;
- term-structure/skew comparison across nearby expirations and strikes;
- historical or shadow-captured candidate outcomes to prove that score rank predicts realized expectancy.

Historical signal-options replay still lacks stored historical Greeks, so full historical proof is not available yet. The first evidence loop should be shadow/live capture: record the current selector's pick, the Greek-expectancy preferred pick, and the realized outcome of both where market data permits.

### Rollout decision

The selected rollout for this pass is **research doc only**. A future implementation should use this order:

1. Add score computation and candidate payload logging without changing selection.
2. Compare current selector versus Greek-expectancy rank in shadow reports.
3. Promote to shadow selection only after score deciles show better expectancy without unacceptable drawdown or fill degradation.
4. Consider live/paper behavior only after shadow selection beats the current selector on out-of-sample data.

### Source notes

- Options Industry Council, Greek and volatility education: `https://www.optionseducation.org/advancedconcepts/volatility-the-greeks`
- Options Industry Council, Rule of 16 expected-move framing: `https://www.optionseducation.org/news/understanding-the-rule-of-16-in-plain-terms`
- Fidelity, choosing expiration and matching options to horizon: `https://www.fidelity.com/viewpoints/active-investor/options-expiration-date`
- Schwab, options volatility, skew, and Rule of 16: `https://www.schwab.com/learn/story/options-volatility-vix-skew-and-rule-16`
- FINRA, options and Greeks overview: `https://www.finra.org/investors/investing/investment-products/options`
- Goyal and Saretto, `Option Returns and Volatility Mispricing`: `https://papers.ssrn.com/sol3/papers.cfm?abstract_id=889947`
- Choy, retail demand and expensive high-IV options: `https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1577942`
- Options Industry Council, liquidity/open-interest FAQ: `https://www.optionseducation.org/referencelibrary/faq/general-information`

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
