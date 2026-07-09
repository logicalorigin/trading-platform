# Shadow Options Management Review

- Generated: 2026-07-08T01:27:40.467Z
- Account: shadow
- Window: 2026-05-22 through 2026-07-07
- Report directory: /home/runner/workspace/scripts/reports/shadow-options-management-review/2026-07-08T01-27-35-765Z

## Ledger Summary

- Fills: 288
- Buy fills: 138
- Sell fills: 150
- Symbols: 75
- Fill window: 2026-05-22T14:03:35.356Z to 2026-07-07T18:52:57.132Z
- Realized P&L: -31124.63
- Fees: 1010.66
- Cash delta: -17871.16

## Opportunity Snapshot

- Realized exit P&L: -31124.63
- Post-exit high opportunity: 153767.00
- Opportunity / realized ratio: n/ax
- Caveat: Post-exit highs are an upper-bound diagnostic, not capturable P&L; use them to rank management hypotheses before dry-run validation.

## Recommendations

- **MEDIUM exit_management: Evaluate Greek tighten-only enforcement on shadow** Greek tighten diagnostics covered 20 exits with -5092.57 realized P&L, 25% wins, and 30566.00 to post-exit highs. Next test: Run a shadow-only counterfactual that tightens premium trailing behavior on delta decay or theta burden, while leaving Greek loosening disabled.
- **HIGH exit_management: Keep a runner alive after first trail exit** 36 runner-trail exits produced 8659.36 realized P&L but left 34980.00 to post-exit highs. Next test: Dry-run partial exits: sell 50-70% at current trail, keep 30-50% under a looser trend/ATR trail, and compare April train vs May holdout.
- **MEDIUM entry_filtering: Convert early invalidation from permanent exit to re-entry watch** 8/14 early invalidations finished above their exit price despite negative realized P&L. Next test: Test a re-entry rule after early invalidation when the original direction re-confirms within 3-6 bars and option liquidity is still valid.
- **MEDIUM portfolio: Differentiate overnight exits for strong runners** Overnight-risk exits were nearly flat on realized P&L (-4253.76) but left 53978.00 to post-exit highs. Next test: Allow high-quality runners to hold a small residual overnight with a wider runner stop while forcing weak/flat positions out.
- **MEDIUM entry_filtering: Downweight or exclude weak expectancy symbols** Lowest buckets include RBLX -2917.23, CCJ -2495.44, GLD -2352.11, NVDA -2070.56, HOOD -2002.18. Next test: Run a symbol-exclusion holdout sweep; only remove symbols that improve both April and May or improve one without harming the other materially.
- **MEDIUM exit_management: Promote prior dry-sweep winners into the next hypothesis set** Best prior sweep evidence is trail-ladder-aggressive-early8-loss25 with 28941.00 P&L, 5.143 PF, and 179 trades. Next test: Use that variant as the baseline for new partial-runner, re-entry, and sizing counterfactuals.
- **LOW data_quality: Keep audit-quality fill provenance in the loop** The April external audit found exact trade-source matches but aggregate-sourced sell exits had unresolved strict mismatches. Next test: For candidate production settings, rerun the Massive audit and separate trade-sourced vs aggregate-sourced exit conclusions.

## Greek Management Diagnostics

| Recommendation | Exits | Wins | Win % | P&L | Avg P&L | Missed To High | Reached +25% After Exit | Final > Exit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| unavailable | 39 | 7 | 17.9 | -18136.56 | -465.04 | 23945 | 12 | 8 |
| tighten | 20 | 5 | 25 | -5092.57 | -254.63 | 30566 | 16 | 11 |
| hold | 2 | 0 | 0 | -953.46 | -476.73 | 1300 | 1 | 2 |

## Exit Reasons

| Reason | Exits | Wins | Win % | P&L | Avg P&L | Missed To High | Reached +25% After Exit | Final > Exit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runner_trail_stop | 36 | 24 | 66.7 | 8659.36 | 240.54 | 34980 | 28 | 14 |
| manual_force_close | 1 | 0 | 0 | -6.73 | -6.73 | 0 | 0 | 0 |
| opposite_signal | 20 | 2 | 10 | -906.56 | -45.33 | 28116 | 14 | 7 |
| overnight_risk_exit | 29 | 3 | 10.3 | -4253.76 | -146.68 | 53978 | 20 | 16 |
| expiration | 22 | 8 | 36.4 | -5144.07 | -233.82 | 0 | 0 | 0 |
| unknown | 5 | 0 | 0 | -6048.65 | -1209.73 | 0 | 0 | 0 |
| early_invalidation | 14 | 0 | 0 | -6168.17 | -440.58 | 21574 | 8 | 8 |
| hard_stop | 23 | 0 | 0 | -17256.05 | -750.26 | 15119 | 5 | 5 |

## Top Symbols

| Symbol | Exits | Wins | Win % | P&L | Avg P&L | Missed To High |
| --- | --- | --- | --- | --- | --- | --- |
| SPY | 6 | 1 | 16.7 | 7811.19 | 1301.87 | 8183 |
| SMCI | 3 | 3 | 100 | 2703.24 | 901.08 | 5525 |
| MSFT | 4 | 1 | 25 | 2220.58 | 555.15 | 9032 |
| USO | 3 | 2 | 66.7 | 853.6 | 284.53 | 2870 |
| IONQ | 3 | 3 | 100 | 568.18 | 189.39 | 1720 |
| AAPL | 3 | 2 | 66.7 | 262.29 | 87.43 | 0 |
| DIA | 5 | 1 | 20 | -179.16 | -35.83 | 3916 |
| ACHR | 3 | 0 | 0 | -200.19 | -66.73 | 820 |
| GLW | 3 | 0 | 0 | -428.69 | -142.9 | 404 |
| CORZ | 3 | 1 | 33.3 | -680.19 | -226.73 | 570 |
| GD | 3 | 0 | 0 | -1038.74 | -346.25 | 4692 |
| AMZN | 4 | 1 | 25 | -1356.45 | -339.11 | 3516 |
| GOOGL | 5 | 0 | 0 | -1374.09 | -274.82 | 6004 |
| LUNR | 3 | 0 | 0 | -1571.13 | -523.71 | 1575 |
| AAOI | 3 | 1 | 33.3 | -1610.01 | -536.67 | 1375 |

## Weak Symbols

| Symbol | Exits | Wins | Win % | P&L | Avg P&L | Missed To High |
| --- | --- | --- | --- | --- | --- | --- |
| RBLX | 4 | 0 | 0 | -2917.23 | -729.31 | 1436 |
| CCJ | 3 | 0 | 0 | -2495.44 | -831.81 | 156 |
| GLD | 4 | 1 | 25 | -2352.11 | -588.03 | 1194 |
| NVDA | 5 | 1 | 20 | -2070.56 | -414.11 | 6880 |
| HOOD | 6 | 2 | 33.3 | -2002.18 | -333.7 | 2101 |
| TQQQ | 5 | 1 | 20 | -1739.54 | -347.91 | 6030 |
| META | 5 | 1 | 20 | -1727.53 | -345.51 | 5543 |
| AAOI | 3 | 1 | 33.3 | -1610.01 | -536.67 | 1375 |
| LUNR | 3 | 0 | 0 | -1571.13 | -523.71 | 1575 |
| GOOGL | 5 | 0 | 0 | -1374.09 | -274.82 | 6004 |
| AMZN | 4 | 1 | 25 | -1356.45 | -339.11 | 3516 |
| GD | 3 | 0 | 0 | -1038.74 | -346.25 | 4692 |
| CORZ | 3 | 1 | 33.3 | -680.19 | -226.73 | 570 |
| GLW | 3 | 0 | 0 | -428.69 | -142.9 | 404 |
| ACHR | 3 | 0 | 0 | -200.19 | -66.73 | 820 |

## Prior Sweep Evidence

| Best Variant | P&L | PF | Trades | Win % | Max DD | Window | Report Dir |
| --- | --- | --- | --- | --- | --- | --- | --- |
| trail-ladder-aggressive-early8-loss25 | 28941 | 5.143 | 179 | 66.5 | 218 | 2026-05-04 through 2026-05-21 | /home/runner/workspace/scripts/reports/signal-options-exit-policy-sweeps/full-universe-selected-rules-14-trading-days-2026-05-04-through-2026-05-21 |
| combo-hard30-trail35-overnight10-early6 | 24979 | 4.391 | 123 | 60.2 | 382 | 2026-04-01 through 2026-05-15 | /home/runner/workspace/scripts/reports/signal-options-exit-policy-sweeps/2026-05-18T04-25-43-767Z |
| trail-ladder-aggressive | 5428 | 7.386 | 33 | 81.8 | 309 | 2026-05-04 through 2026-05-21 | /home/runner/workspace/scripts/reports/signal-options-exit-policy-sweeps/selected-rules-9-symbols-14-trading-days-2026-05-04-through-2026-05-21 |
| trail-ladder-aggressive-early8-loss25 | 3270 | 3.39 | 28 | 67.9 | 780 | 2026-05-04 through 2026-05-21 | /home/runner/workspace/scripts/reports/signal-options-exit-policy-sweeps/combined-trail-early8-9-symbols-14-trading-days-2026-05-04-through-2026-05-21 |

## Largest Post-Exit Leaks

| Symbol | Reason | Closed At | P&L | Exit | Post High | High vs Exit % | Missed $ | Score |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AVAV | opposite_signal | 2026-05-27T15:59:00.549Z | -514.69 | 3.45 | 36.9 | 969.6 | 13380 | 60 |
| DELL | overnight_risk_exit | 2026-05-27T19:52:43.585Z | -303.67 | 15.86 | 123.32 | 677.6 | 10746 | 69.2 |
| KTOS | early_invalidation | 2026-05-27T18:09:47.289Z | -461.38 | 1.9 | 10.5 | 452.6 | 6880 | 80 |
| MSFT | overnight_risk_exit | 2026-05-26T19:45:20.358Z | -39.35 | 6.5 | 32.46 | 399.4 | 5192 | 82.5 |
| SMCI | runner_trail_stop | 2026-05-26T19:11:37.722Z | 136.64 | 2.2 | 12.53 | 469.5 | 5165 | 92.8 |
| GD | overnight_risk_exit | 2026-07-01T19:59:34.601Z | -4.04 | 2.23 | 10.05 | 350.7 | 4692 | 47.6 |
| SQQQ | opposite_signal | 2026-05-29T16:46:24.022Z | -106.73 | 1.38 | 5.43 | 293.5 | 4050 | 80 |
| RGTI | hard_stop | 2026-06-04T18:29:48.254Z | -726.73 | 0.9 | 4.85 | 438.9 | 3950 | 83.3 |
| COIN | overnight_risk_exit | 2026-05-27T19:47:12.877Z | -146.02 | 4.9 | 17.05 | 248 | 3645 | 68.8 |
| ABT | runner_trail_stop | 2026-07-01T19:12:21.732Z | -676.73 | 0.08 | 3.6 | 4400 | 3520 | 52.9 |
| PLTR | early_invalidation | 2026-07-01T18:53:30.597Z | -1306.04 | 0.18 | 5.95 | 3205.6 | 3462 | 50.7 |
| LMT | overnight_risk_exit | 2026-07-01T19:55:18.187Z | -1.35 | 5.15 | 21.38 | 315.1 | 3246 | 52.9 |
| TQQQ | overnight_risk_exit | 2026-05-27T19:52:40.589Z | -16.73 | 1.88 | 4.67 | 148.4 | 2790 | 73.3 |
| ANET | opposite_signal | 2026-05-22T14:03:35.356Z | 596.64 | 3.7 | 9.27 | 150.5 | 2785 | 79.1 |
| SPY | runner_trail_stop | 2026-06-12T15:52:10.683Z | -79.35 | 5.41 | 18.66 | 244.9 | 2650 | 97.5 |
| MSFT | early_invalidation | 2026-05-26T15:13:59.257Z | -201.67 | 5.97 | 32.46 | 443.7 | 2649 | 85 |
| META | overnight_risk_exit | 2026-07-01T19:55:22.659Z | -0.67 | 10.3 | 36.74 | 256.7 | 2644 | 52.9 |
| ALAB | overnight_risk_exit | 2026-07-01T19:45:15.877Z | -0.67 | 15 | 41.15 | 174.3 | 2615 | 52.9 |
| GOOGL | overnight_risk_exit | 2026-06-29T19:50:09.654Z | -1223.35 | 0.73 | 13.35 | 1728.8 | 2524 | 52.9 |
| USO | runner_trail_stop | 2026-06-01T17:03:46.810Z | 1241.31 | 7.79 | 14.09 | 80.9 | 2520 | 46.6 |

Full row-level leak details are in `top-leaks.csv`; structured output is in `results.json`.

