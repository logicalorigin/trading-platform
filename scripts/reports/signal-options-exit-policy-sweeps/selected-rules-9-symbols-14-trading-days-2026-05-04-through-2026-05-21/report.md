# Signal Options Exit Policy Sweep

- Deployment: Pyrus Signals Shadow Paper (7e2e4e6f-749f-4e65-a011-87d3559a23b0)
- Symbols: 9
- Window: 2026-05-04 through 2026-05-21
- Signal timeframe: 5m
- PyrusSignals patch: `{"timeHorizon":8,"bosConfirmation":"wicks","chochAtrBuffer":0,"chochBodyExpansionAtr":0,"chochVolumeGate":0}`
- Risk caps: `{"maxOpenSymbols":10,"maxPremiumPerEntry":1500}`
- Premium-bucket variants: excluded
- Dry variants: 10
- Eligible variants: 10

| Rank | Variant | PnL | Score | Trades | Win % | PF | Max DD | Open | Early | Early Recovered Entry | Early Final > Exit | Exit Reasons |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
1 | trail-ladder-aggressive | 5428.00 | 10.856000 | 33 | 81.8 | 7.386 | 309.00 | 1 | 0 | 0 | 0 | `{"runner_trail_stop":16,"opposite_signal":10,"overnight_risk_exit":6,"hard_stop":1}`
2 | trail-ladder-balanced | 4812.00 | 9.624000 | 40 | 72.5 | 3.425 | 61.00 | 1 | 1 | 1 | 0 | `{"runner_trail_stop":17,"opposite_signal":14,"early_invalidation":1,"overnight_risk_exit":7,"hard_stop":1}`
3 | early-grid-b8-loss25 | 4646.00 | 9.292000 | 40 | 72.5 | 3.090 | 190.00 | 1 | 2 | 2 | 0 | `{"opposite_signal":15,"early_invalidation":2,"runner_trail_stop":15,"overnight_risk_exit":7,"hard_stop":1}`
4 | early-grid-b12-loss30 | 4506.00 | 9.012000 | 40 | 72.5 | 2.907 | 270.00 | 1 | 0 | 0 | 0 | `{"opposite_signal":15,"hard_stop":3,"runner_trail_stop":15,"overnight_risk_exit":7}`
5 | early-grid-disabled | 4506.00 | 9.012000 | 40 | 72.5 | 2.907 | 270.00 | 1 | 0 | 0 | 0 | `{"opposite_signal":15,"hard_stop":3,"runner_trail_stop":15,"overnight_risk_exit":7}`
6 | early-grid-b6-loss20 | 3291.00 | 6.582000 | 35 | 68.6 | 2.546 | 240.00 | 1 | 2 | 2 | 0 | `{"opposite_signal":14,"early_invalidation":2,"runner_trail_stop":13,"overnight_risk_exit":5,"hard_stop":1}`
7 | early-grid-b4-loss15 | 3286.00 | 6.572000 | 28 | 71.4 | 3.009 | 40.00 | 1 | 4 | 4 | 0 | `{"opposite_signal":8,"early_invalidation":4,"runner_trail_stop":10,"overnight_risk_exit":5,"hard_stop":1}`
8 | early-grid-b3-loss15 | 3261.00 | 6.522000 | 28 | 71.4 | 2.963 | 40.00 | 1 | 4 | 4 | 0 | `{"opposite_signal":8,"early_invalidation":4,"runner_trail_stop":10,"overnight_risk_exit":5,"hard_stop":1}`
9 | trail-ladder-soft | 2545.00 | 5.090000 | 31 | 67.7 | 2.493 | 389.00 | 2 | 1 | 1 | 0 | `{"runner_trail_stop":12,"opposite_signal":10,"early_invalidation":1,"overnight_risk_exit":7,"overnight_runner_stop":1}`
10 | trail-ladder-runner-friendly | 2247.00 | 2.763838 | 29 | 72.4 | 1.953 | 813.00 | 1 | 1 | 1 | 0 | `{"opposite_signal":11,"runner_trail_stop":10,"early_invalidation":1,"overnight_risk_exit":5,"hard_stop":1,"overnight_runner_stop":1}`
