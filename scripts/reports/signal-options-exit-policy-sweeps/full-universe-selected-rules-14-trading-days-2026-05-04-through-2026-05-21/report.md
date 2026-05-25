# Signal Options Exit Policy Sweep

- Deployment: Pyrus Signals Shadow Paper (7e2e4e6f-749f-4e65-a011-87d3559a23b0)
- Symbols: 90
- Window: 2026-05-04 through 2026-05-21
- Signal timeframe: 5m
- PyrusSignals patch: `{"timeHorizon":8,"bosConfirmation":"wicks","chochAtrBuffer":0,"chochBodyExpansionAtr":0,"chochVolumeGate":0}`
- Risk caps: `{"maxOpenSymbols":10,"maxPremiumPerEntry":1500}`
- Premium-bucket variants: excluded
- Dry variants: 6
- Eligible variants: 6

| Rank | Variant | PnL | Score | Trades | Win % | PF | Max DD | Open | Early | Early Recovered Entry | Early Final > Exit | Exit Reasons |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
1 | trail-ladder-aggressive-early8-loss25 | 28941.00 | 57.882000 | 179 | 66.5 | 5.143 | 218.00 | 5 | 5 | 1 | 0 | `{"runner_trail_stop":99,"opposite_signal":47,"expiration":1,"overnight_risk_exit":16,"hard_stop":11,"early_invalidation":5}`
2 | trail-ladder-aggressive | 28405.00 | 56.810000 | 179 | 65.9 | 5.123 | 140.00 | 6 | 10 | 3 | 2 | `{"runner_trail_stop":98,"opposite_signal":44,"expiration":1,"overnight_risk_exit":16,"early_invalidation":10,"hard_stop":10}`
3 | combo-hard30-trail35-overnight10-early6 | 22320.00 | 44.640000 | 161 | 65.2 | 3.269 | 150.00 | 5 | 19 | 12 | 5 | `{"early_invalidation":19,"opposite_signal":58,"runner_trail_stop":52,"expiration":2,"overnight_risk_exit":17,"hard_stop":13}`
4 | trail-ladder-balanced | 20114.00 | 40.228000 | 169 | 58.6 | 3.258 | 348.00 | 6 | 11 | 5 | 1 | `{"runner_trail_stop":80,"opposite_signal":53,"expiration":1,"overnight_risk_exit":15,"early_invalidation":11,"hard_stop":9}`
5 | early-grid-b8-loss25 | 20082.00 | 40.164000 | 160 | 65.0 | 2.942 | 150.00 | 4 | 12 | 8 | 2 | `{"early_invalidation":12,"opposite_signal":62,"runner_trail_stop":52,"expiration":2,"overnight_risk_exit":17,"hard_stop":15}`
6 | trail-ladder-balanced-early8-loss25 | 19550.00 | 39.100000 | 165 | 58.2 | 3.189 | 348.00 | 5 | 7 | 4 | 0 | `{"runner_trail_stop":78,"opposite_signal":55,"expiration":1,"overnight_risk_exit":15,"hard_stop":9,"early_invalidation":7}`
