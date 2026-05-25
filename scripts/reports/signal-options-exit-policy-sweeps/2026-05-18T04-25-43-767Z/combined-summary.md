# Signal Options Exit Policy Combined Ranking

- Deployment: Pyrus Signals Shadow Paper (7e2e4e6f-749f-4e65-a011-87d3559a23b0)
- Window: 2026-04-01 through 2026-05-15
- Universe: 90 deployment symbols
- Signal timeframe: 5m
- PyrusSignals patch: `{"timeHorizon":8}`
- Risk caps: `{"maxOpenSymbols":10,"maxPremiumPerEntry":1500}`
- Premium-bucket variants: excluded
- All runs used `commit:false`

| Rank | Variant | PnL | Score | Trades | Win % | PF | Max DD | Open |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | combo-hard30-trail35-overnight10-early6 | 24979.00 | 49.958000 | 123 | 60.2 | 4.391 | 382.00 | 2 |
| 2 | overnight-positive-only | 22640.00 | 45.280000 | 119 | 58.8 | 3.015 | 287.00 | 2 |
| 3 | overnight-gain-10 | 19798.00 | 39.596000 | 121 | 60.3 | 2.937 | 0.00 | 2 |
| 4 | early-3-bars-loss-15 | 25602.00 | 32.163317 | 125 | 56.8 | 3.420 | 796.00 | 1 |
| 5 | early-6-bars-loss-20 | 23851.00 | 16.808316 | 116 | 59.5 | 3.246 | 1419.00 | 2 |
| 6 | hard-stop-30 | 22924.00 | 16.155039 | 112 | 61.6 | 3.201 | 1419.00 | 2 |
| 7 | hard-stop-25 | 22412.00 | 15.794221 | 113 | 61.1 | 3.051 | 1419.00 | 2 |
| 8 | baseline-h8-current-exits | 20952.00 | 14.765328 | 109 | 61.5 | 2.766 | 1419.00 | 2 |
| 9 | trail-35-15-20 | 22575.00 | 10.514672 | 106 | 65.1 | 3.227 | 2147.00 | 0 |

Winning profile patch:

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
