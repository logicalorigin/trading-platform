# 5-27 Trading Analysis

## Core Thesis

Our biggest trading improvement opportunity is not just finding more signals. The shadow-options review showed that the system already found many profitable trades, but exited too much of the position too early.

The key diagnostic from the shadow-options management review:

- Realized exit P&L: `150,959.15`
- Post-exit high opportunity: `996,747.00`
- Opportunity / realized ratio: `6.60x`

The refreshed report through May 26 showed the thesis still held:

- Realized P&L: `156,036.85`
- Post-exit high opportunity: `996,747.00`
- Opportunity / realized ratio: `6.39x`

Important caveat: post-exit highs are an upper-bound diagnostic, not directly capturable P&L. The value is that they reveal where trade management leaked the most opportunity.

The practical conclusion: we should use Greeks to improve both contract selection and post-entry trade management, with the goal of capturing more of the winners we already identify.

## What Greeks Should Do For Entry

Greeks should help answer: is this the right contract for this signal and intended holding window?

For long calls and long puts:

- `delta` measures how much the option participates in the underlying move.
- `gamma` measures convexity if the move accelerates.
- `theta` measures the time-decay cost of holding.
- `vega` measures sensitivity to implied-volatility changes.
- bid/ask spread and liquidity determine whether the theoretical edge is tradable.

The entry selector should score contracts instead of only selecting by affordability, strike slot, or nearest expiration.

```text
entry_score =
  directional_delta_fit
+ gamma_convexity
+ liquidity_quality
+ expected_move_fit
- theta_burden
- spread_cost
- IV_overpayment_penalty
```

The selector should also tag each contract with an intended management profile:

- `scalp`: high gamma acceptable, high theta tolerated, short hold expected.
- `intraday_trend`: balanced delta/gamma, avoid extreme theta bleed.
- `runner_candidate`: enough delta, lower theta burden, more DTE.
- `lottery`: allowed only when signal quality is exceptional and premium is capped.

That profile should follow the position after entry and influence exits, trails, overnight rules, and re-entry logic.

## What Greeks Should Do After Entry

After entry, Greeks should help answer: is this still the right position to hold, trim, exit, roll, or re-enter?

This is where Greeks connect directly to the 6x opportunity analysis. The system should avoid selling the exact contracts that have become the highest-quality runners.

### Theta Clock

Theta should create urgency, not panic.

Useful metric:

```text
theta_burden_ratio = abs(theta_per_day) / option_mark
```

Management rule:

- High theta burden plus flat underlying: exit or reduce.
- High theta burden plus favorable acceleration: keep runner but tighten.
- Low theta burden plus trend intact: allow longer hold.

### Delta Evolution

Delta tells us whether the option is becoming more directionally meaningful as the trade works.

For calls, rising delta is favorable. For puts, increasingly negative delta is favorable.

Useful metric:

```text
delta_improvement = current_abs_delta - entry_abs_delta
```

If delta improves after entry, the position is becoming higher quality. That should make the system more willing to:

- hold a runner,
- use looser trailing stops,
- avoid full opposite-signal liquidation,
- consider a small overnight residual.

If delta collapses, the trade is losing directional relevance and should be exited or reduced sooner.

### Gamma Payoff Zone

Gamma is the source of convex upside in long options, but it is only valuable when the underlying is moving favorably or sitting near the zone where acceleration matters.

Management rule:

- If the option is profitable and gamma remains strong, trim partial only.
- If gamma collapses because the option is deep ITM, manage more like a delta position.
- If gamma is high but the underlying stalls, theta risk rises quickly.

### Vega And IV Compression

The system should distinguish directional P&L from volatility-driven P&L.

Approximate decomposition:

```text
option_pnl = directional_component + volatility_component + decay_component
```

Management implications:

- If the trade is directionally right but IV compression hurt the option, do not automatically penalize the signal.
- If the option is profitable mostly from IV expansion without underlying follow-through, take profit faster.
- If IV is elevated at entry, require stronger signal quality, better delta, or more DTE.

## Greek-Aware Trade Management Rules

### Runner Treatment

The post-exit analysis showed that runner-trail exits produced strong realized P&L but left the largest opportunity behind.

Runner qualification should include Greeks, not only P&L.

High-quality runner conditions:

- position is profitable, especially above `+50%`,
- delta has improved,
- theta burden is acceptable,
- spread remains tradable,
- underlying trend remains aligned,
- DTE is not collapsing.

Suggested behavior:

- Sell 50-70% at the current trail or profit event.
- Keep 30-50% if Greek quality remains strong.
- Use a looser runner trail while delta/gamma support remains.
- Tighten aggressively if theta burden spikes, delta deteriorates, or spread quality worsens.

### Opposite-Signal Exits

Opposite-signal exits were another major missed-opportunity bucket.

Instead of liquidating the full position immediately, the system should check position quality:

- Strong Greek quality plus profit: trim or hedge, do not full exit immediately.
- Weak Greek quality plus opposite signal: full exit.
- Mixed quality: partial exit and move residual to a tighter trail.

### Overnight Decisions

The prior review showed that overnight-risk exits were nearly flat in realized P&L but left significant post-exit high opportunity.

Greek-aware overnight residuals should be allowed only when:

- position is already profitable,
- delta improved from entry,
- theta burden is acceptable for one more session,
- DTE is not too close,
- spread remains tradable,
- trend remains aligned.

Force full exit when:

- expiration is same day or next day,
- theta burden is extreme,
- delta is weak,
- IV is inflated and likely to mean-revert,
- position is only marginally profitable.

### Re-Entry Watch

Early invalidation and hard-stop exits should not always mean the trade is dead.

After exit, track:

- whether the underlying recovered,
- whether the original contract's delta/gamma profile improved,
- whether theta decay now makes the original contract unattractive,
- whether a new DTE/strike has a better Greek profile.

If the setup recovers but the original contract has decayed too much, re-entry should choose a new contract instead of blindly reopening the same one.

## Greek-Aware Position Sizing

Premium alone is not enough to size options trades.

Two contracts with the same premium can have very different directional exposure, decay pressure, and exit cost.

Sizing should account for:

```text
effective_directional_exposure = contracts * abs(delta) * underlying_price * 100
theta_dollars_per_day = contracts * abs(theta) * 100
spread_cost_dollars = contracts * bid_ask_spread * 100
```

Sizing rules:

- Lower size for high-theta or wide-spread contracts.
- Allow higher premium caps only for strong delta/gamma/liquidity profiles.
- Scale winners only after management improves capture.
- Avoid increasing size when Greek quality is poor but premium looks cheap.

## Proposed Scoring Layers

We should split Greek usage into two layers.

### 1. Entry Greek Score

Purpose: pick the best contract for the signal and intended holding window.

```text
entry_greek_score =
  directional_delta_fit
+ gamma_convexity
+ liquidity_quality
+ expected_move_fit
- theta_burden
- spread_cost
- IV_overpayment_penalty
```

### 2. Live Greek Management Score

Purpose: decide whether to exit, trim, hold a runner, re-enter, roll, or hold overnight.

```text
management_score =
  trend_alignment
+ delta_improvement
+ favorable_gamma
+ unrealized_profit_quality
+ liquidity_quality
- theta_pressure
- IV_crush_risk
- spread_exit_cost
- DTE_risk
```

Management interpretation:

- Low score: full exit.
- Medium score: normal trail.
- High score: partial exit plus runner.
- High score near close: allow small overnight residual.
- Recovered score after exit: re-entry candidate.

## How This Connects To The 6x Opportunity

The old analysis showed that the biggest gap was not signal generation. It was capture.

The major leaks were:

- runner-trail exits exited too much too early,
- opposite-signal exits often cut positions that still had large remaining upside,
- overnight-risk exits removed positions that later had meaningful upside,
- early invalidation exits sometimes recovered,
- calls carried almost all expectancy while puts were much weaker,
- longer holds performed better than very short holds,
- cheap contracts under `$500` were low-output,
- the `$1000-$1399` premium bucket was strongest.

Greeks should help us act on those findings by identifying which winners deserve patience and which losers deserve faster removal.

The guiding rule:

> Use Greeks to avoid selling the contracts that have become the highest-quality runners, while cutting faster when the option's Greek profile no longer supports the original trade thesis.

## Implementation Direction

The algo should evolve toward:

1. Greek-aware contract selection at entry.
2. Persistent entry Greek snapshot on each opened position.
3. Live Greek refresh while the position is open.
4. Greek-aware runner, opposite-signal, overnight, and re-entry rules.
5. Backtest reports that separate entry quality from management quality.
6. Capture metrics that compare realized exit P&L against post-exit high opportunity.

The most important validation question:

```text
Did Greek-aware management increase captured opportunity without simply increasing drawdown?
```

