# PyrusSignals Signal Options Backtest Analysis

- Regenerated analysis at: 2026-05-18T14:01:31Z
- Deployment: Pyrus Signals Shadow Paper (`7e2e4e6f-749f-4e65-a011-87d3559a23b0`)
- Universe: 90 symbols
- Window: 2026-04-01 through 2026-05-15 / latest completed trading day, depending on source artifact
- Signal timeframe: 5m
- Primary PyrusSignals structure patch: `{"timeHorizon":8,"bosConfirmation":"wicks","chochAtrBuffer":0,"chochBodyExpansionAtr":0,"chochVolumeGate":0}`
- Exit-policy risk caps: `{"maxOpenSymbols":10,"maxPremiumPerEntry":1500}`
- Fresh all-variant rerun status: attempted 2026-05-18, stopped after roughly 25 minutes because the first variant did not complete and the process was waiting on an async handle. No new result files were written.

## Executive Summary

The strongest completed result is still the combined exit policy:

```json
{
  "riskCaps": {
    "maxOpenSymbols": 10,
    "maxPremiumPerEntry": 1500
  },
  "exitPolicy": {
    "hardStopPct": -30,
    "trailActivationPct": 35,
    "minLockedGainPct": 15,
    "trailGivebackPct": 20,
    "overnightExitEnabled": true,
    "overnightMinGainPct": 10,
    "overnightRunnerGivebackPct": 15,
    "earlyExitBars": 6,
    "earlyExitLossPct": 20
  }
}
```

This result is not simply the highest PnL. It also has the best risk-adjusted score among completed exit-policy variants: `49.958`, with `24979.00` realized PnL, `123` closed trades, `60.2%` win rate, `4.391` profit factor, and only `382.00` realized max drawdown.

## Structure Sweep

Source: `scripts/reports/pyrus-signals-options-sweeps/2026-05-17T20-26-25-981Z/results.json`

| Rank | Variant | PnL | Score | Trades | PF | Max DD | Open |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | stage-b-h8-bos-wicks-atr-0-body-0-vol-0 | 7228.00 | 14.456000 | 69 | 4.012 | 480.00 | 3 |
| 2 | stage-b-h8-bos-wicks-atr-0-body-0-vol-1 | 7544.00 | 13.211909 | 62 | 4.655 | 571.00 | 3 |
| 3 | stage-b-h4-bos-close-atr-0-body-0p5-vol-0 | 6295.00 | 12.294922 | 104 | 3.508 | 512.00 | 3 |
| 4 | stage-b-h4-bos-wicks-atr-0-body-0-vol-1 | 6978.00 | 12.031034 | 129 | 2.988 | 580.00 | 2 |
| 5 | stage-b-h4-bos-wicks-atr-0p25-body-0-vol-0 | 8919.00 | 11.735526 | 127 | 4.235 | 760.00 | 2 |

Read: the selected structure variant is defensible. `h8 + wick BOS + no ATR/body/volume gates` wins by score, not raw PnL. It has lower trade count than the h4 variants, but materially better drawdown control.

## Focused Horizon Compare

Source: `scripts/reports/pyrus-signals-options-sweeps/focused-clean-h8-10-12-15-2026-05-18T01-02-30-355Z/results.json`

| Rank | Variant | PnL | Score | Trades | PF | Max DD | Open |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | focused-clean-h12-best-structure | 5823.00 | 7.890244 | 72 | 2.891 | 738.00 | 1 |
| 2 | focused-clean-h15-best-structure | 5952.00 | 7.543726 | 59 | 2.953 | 789.00 | 1 |
| 3 | focused-clean-h8-best-structure | 7663.00 | 7.062673 | 91 | 3.861 | 1085.00 | 2 |
| 4 | focused-clean-h10-best-structure | 6826.00 | 7.001026 | 74 | 3.260 | 975.00 | 2 |

Read: horizon 12 is the clean focused winner by score, but horizon 8 produces more PnL and more trades. Because the later exit-policy sweep was explicitly run on h8 and produced much stronger risk-adjusted performance, h8 remains the practical deployment default unless we rerun exit-policy variants for h12.

## Exit-Policy Sweep

Source: `scripts/reports/signal-options-exit-policy-sweeps/2026-05-18T04-25-43-767Z/results.json`

| Rank | Variant | PnL | Score | Trades | Win % | PF | Max DD | Open |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | combo-hard30-trail35-overnight10-early6 | 24979.00 | 49.958000 | 123 | 60.2 | 4.391 | 382.00 | 2 |
| 2 | overnight-positive-only | 22640.00 | 45.280000 | 119 | 58.8 | 3.015 | 287.00 | 2 |
| 3 | overnight-gain-10 | 19798.00 | 39.596000 | 121 | 60.3 | 2.937 | 0.00 | 2 |
| 4 | early-3-bars-loss-15 | 25602.00 | 32.163317 | 125 | 56.8 | 3.420 | 796.00 | 1 |
| 5 | early-6-bars-loss-20 | 23851.00 | 16.808316 | 116 | 59.5 | 3.246 | 1419.00 | 2 |
| 6 | trail-35-15-20 | 22575.00 | 10.514672 | 106 | 65.1 | 3.227 | 2147.00 | 0 |

Exit reasons for the winning policy:

```json
{
  "expiration": 14,
  "runner_trail_stop": 52,
  "overnight_risk_exit": 12,
  "hard_stop": 4,
  "early_invalidation": 21,
  "opposite_signal": 20
}
```

Read: the combined winner is balanced. Most exits are still controlled by runner trails and opposite signals, while early invalidation and overnight risk exits remove losers before they compound. The hard stop barely fires, which suggests the tighter risk profile is not just chopping trades at the stop; it is improving path control earlier.

## Recommendation

Promote this as the next shadow-paper candidate:

- PyrusSignals structure: `timeHorizon: 8`, `bosConfirmation: "wicks"`, `chochAtrBuffer: 0`, `chochBodyExpansionAtr: 0`, `chochVolumeGate: 0`
- Risk caps: max `10` open symbols, max premium per entry `$1500`
- Exit policy: `hardStopPct: -30`, trail `35/15/20`, overnight min gain `10`, overnight runner giveback `15`, early invalidation after `6` bars at `-20%`

Before live use, rerun an instrumented all-variant sweep and add progress checkpoints to `scripts/src/signal-options-exit-policy-sweep.ts`. The current direct all-variant rerun stalled before completing baseline, so the recommendation rests on completed May 17-18 artifacts, not a new May 18 full rerun.

## Follow-Up Tests

1. Rerun exit-policy variants for h12 using the same structure patch, because the focused horizon compare favored h12 by score.
2. Add progress logging around `loadHistoricalBackfillSignals` and each symbol/backfill phase, so long sweeps show where time is spent.
3. Add a timeout or heartbeat to the sweep script so future report regeneration fails visibly instead of waiting silently.
