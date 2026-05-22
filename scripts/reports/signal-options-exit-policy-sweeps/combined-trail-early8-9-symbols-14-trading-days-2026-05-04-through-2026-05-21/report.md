# Signal Options Exit Policy Sweep

- Deployment: RayReplica Signal Options Shadow Paper (7e2e4e6f-749f-4e65-a011-87d3559a23b0)
- Symbols: 9
- Window: 2026-05-04 through 2026-05-21
- Signal timeframe: 5m
- RayReplica patch: `{"timeHorizon":8,"bosConfirmation":"wicks","chochAtrBuffer":0,"chochBodyExpansionAtr":0,"chochVolumeGate":0}`
- Risk caps: `{"maxOpenSymbols":10,"maxPremiumPerEntry":1500}`
- Premium-bucket variants: excluded
- Dry variants: 2
- Eligible variants: 2

| Rank | Variant | PnL | Score | Trades | Win % | PF | Max DD | Open | Early | Early Recovered Entry | Early Final > Exit | Exit Reasons |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
1 | trail-ladder-aggressive-early8-loss25 | 3270.00 | 4.192308 | 28 | 67.9 | 3.390 | 780.00 | 1 | 0 | 0 | 0 | `{"runner_trail_stop":15,"opposite_signal":8,"overnight_risk_exit":5}`
2 | trail-ladder-balanced-early8-loss25 | 1874.00 | 3.748000 | 28 | 64.3 | 2.100 | 304.00 | 1 | 1 | 1 | 0 | `{"runner_trail_stop":12,"opposite_signal":10,"early_invalidation":1,"overnight_risk_exit":5}`
