# Signal Options Exit Policy Sweep

- Deployment: Pyrus Signals Shadow Paper (7e2e4e6f-749f-4e65-a011-87d3559a23b0)
- Symbols: 90
- Window: 2026-04-01 through latest completed trading day
- Signal timeframe: 5m
- PyrusSignals patch: `{"timeHorizon":8}`
- Risk caps: `{"maxOpenSymbols":10,"maxPremiumPerEntry":1500}`
- Premium-bucket variants: excluded
- Dry variants: 6
- Eligible variants: 6

| Rank | Variant | PnL | Score | Trades | Win % | PF | Max DD | Open | Exit Reasons |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
1 | combo-hard30-trail35-overnight10-early6 | 24979.00 | 49.958000 | 123 | 60.2 | 4.391 | 382.00 | 2 | `{"expiration":14,"runner_trail_stop":52,"overnight_risk_exit":12,"hard_stop":4,"early_invalidation":21,"opposite_signal":20}`
2 | overnight-positive-only | 22640.00 | 45.280000 | 119 | 58.8 | 3.015 | 287.00 | 2 | `{"expiration":16,"runner_trail_stop":44,"hard_stop":16,"opposite_signal":34,"overnight_risk_exit":8,"overnight_runner_stop":1}`
3 | overnight-gain-10 | 19798.00 | 39.596000 | 121 | 60.3 | 2.937 | 0.00 | 2 | `{"expiration":13,"runner_trail_stop":43,"overnight_risk_exit":15,"hard_stop":14,"opposite_signal":35,"overnight_runner_stop":1}`
4 | early-3-bars-loss-15 | 25602.00 | 32.163317 | 125 | 56.8 | 3.420 | 796.00 | 1 | `{"expiration":16,"runner_trail_stop":45,"hard_stop":7,"early_invalidation":30,"opposite_signal":27}`
5 | early-6-bars-loss-20 | 23851.00 | 16.808316 | 116 | 59.5 | 3.246 | 1419.00 | 2 | `{"expiration":17,"runner_trail_stop":43,"hard_stop":8,"early_invalidation":23,"opposite_signal":25}`
6 | trail-35-15-20 | 22575.00 | 10.514672 | 106 | 65.1 | 3.227 | 2147.00 | 0 | `{"expiration":21,"runner_trail_stop":48,"hard_stop":13,"opposite_signal":24}`
