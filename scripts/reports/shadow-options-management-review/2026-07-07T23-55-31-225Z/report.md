# Shadow Options Management Review

- Generated: 2026-07-07T23:55:43.719Z
- Account: shadow
- Window: 2026-05-22 through 2026-07-07
- Report directory: /home/runner/workspace/scripts/reports/shadow-options-management-review/2026-07-07T23-55-31-225Z

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
- Post-exit high opportunity: 0.00
- Opportunity / realized ratio: n/ax
- Caveat: Post-exit highs are an upper-bound diagnostic, not capturable P&L; use them to rank management hypotheses before dry-run validation.

## Recommendations

- **MEDIUM exit_management: Evaluate Greek tighten-only enforcement on shadow** Greek tighten diagnostics covered 20 exits with -5092.57 realized P&L, 25% wins, and 0.00 to post-exit highs. Next test: Run a shadow-only counterfactual that tightens premium trailing behavior on delta decay or theta burden, while leaving Greek loosening disabled.
- **MEDIUM entry_filtering: Downweight or exclude weak expectancy symbols** Lowest buckets include RBLX -2917.23, CCJ -2495.44, GLD -2352.11, NVDA -2070.56, HOOD -2002.18. Next test: Run a symbol-exclusion holdout sweep; only remove symbols that improve both April and May or improve one without harming the other materially.
- **MEDIUM exit_management: Promote prior dry-sweep winners into the next hypothesis set** Best prior sweep evidence is trail-ladder-aggressive-early8-loss25 with 28941.00 P&L, 5.143 PF, and 179 trades. Next test: Use that variant as the baseline for new partial-runner, re-entry, and sizing counterfactuals.
- **LOW data_quality: Keep audit-quality fill provenance in the loop** The April external audit found exact trade-source matches but aggregate-sourced sell exits had unresolved strict mismatches. Next test: For candidate production settings, rerun the Massive audit and separate trade-sourced vs aggregate-sourced exit conclusions.

## Greek Management Diagnostics

| Recommendation | Exits | Wins | Win % | P&L | Avg P&L | Missed To High | Reached +25% After Exit | Final > Exit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| unavailable | 39 | 7 | 17.9 | -18136.56 | -465.04 | 0 | 0 | 0 |
| tighten | 20 | 5 | 25 | -5092.57 | -254.63 | 0 | 0 | 0 |
| hold | 2 | 0 | 0 | -953.46 | -476.73 | 0 | 0 | 0 |

## Exit Reasons

| Reason | Exits | Wins | Win % | P&L | Avg P&L | Missed To High | Reached +25% After Exit | Final > Exit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runner_trail_stop | 35 | 23 | 65.7 | 8472.74 | 242.08 | 0 | 0 | 0 |
| opposite_signal | 20 | 2 | 10 | -906.56 | -45.33 | 0 | 0 | 0 |
| overnight_risk_exit | 29 | 3 | 10.3 | -4253.76 | -146.68 | 0 | 0 | 0 |
| early_invalidation | 14 | 0 | 0 | -6168.17 | -440.58 | 0 | 0 | 0 |
| unknown | 30 | 9 | 30 | -11419.56 | -380.65 | 0 | 0 | 0 |
| hard_stop | 22 | 0 | 0 | -16849.32 | -765.88 | 0 | 0 | 0 |

## Top Symbols

| Symbol | Exits | Wins | Win % | P&L | Avg P&L | Missed To High |
| --- | --- | --- | --- | --- | --- | --- |
| SPY | 6 | 1 | 16.7 | 7811.19 | 1301.87 | 0 |
| SMCI | 3 | 3 | 100 | 2703.24 | 901.08 | 0 |
| MSFT | 4 | 1 | 25 | 2220.58 | 555.15 | 0 |
| USO | 3 | 2 | 66.7 | 853.6 | 284.53 | 0 |
| IONQ | 3 | 3 | 100 | 568.18 | 189.39 | 0 |
| AAPL | 3 | 2 | 66.7 | 262.29 | 87.43 | 0 |
| DIA | 5 | 1 | 20 | -179.16 | -35.83 | 0 |
| ACHR | 3 | 0 | 0 | -200.19 | -66.73 | 0 |
| GLW | 3 | 0 | 0 | -428.69 | -142.9 | 0 |
| CORZ | 3 | 1 | 33.3 | -680.19 | -226.73 | 0 |
| GD | 3 | 0 | 0 | -1038.74 | -346.25 | 0 |
| AMZN | 4 | 1 | 25 | -1356.45 | -339.11 | 0 |
| GOOGL | 5 | 0 | 0 | -1374.09 | -274.82 | 0 |
| LUNR | 3 | 0 | 0 | -1571.13 | -523.71 | 0 |
| AAOI | 3 | 1 | 33.3 | -1610.01 | -536.67 | 0 |

## Weak Symbols

| Symbol | Exits | Wins | Win % | P&L | Avg P&L | Missed To High |
| --- | --- | --- | --- | --- | --- | --- |
| RBLX | 4 | 0 | 0 | -2917.23 | -729.31 | 0 |
| CCJ | 3 | 0 | 0 | -2495.44 | -831.81 | 0 |
| GLD | 4 | 1 | 25 | -2352.11 | -588.03 | 0 |
| NVDA | 5 | 1 | 20 | -2070.56 | -414.11 | 0 |
| HOOD | 6 | 2 | 33.3 | -2002.18 | -333.7 | 0 |
| TQQQ | 5 | 1 | 20 | -1739.54 | -347.91 | 0 |
| META | 5 | 1 | 20 | -1727.53 | -345.51 | 0 |
| AAOI | 3 | 1 | 33.3 | -1610.01 | -536.67 | 0 |
| LUNR | 3 | 0 | 0 | -1571.13 | -523.71 | 0 |
| GOOGL | 5 | 0 | 0 | -1374.09 | -274.82 | 0 |
| AMZN | 4 | 1 | 25 | -1356.45 | -339.11 | 0 |
| GD | 3 | 0 | 0 | -1038.74 | -346.25 | 0 |
| CORZ | 3 | 1 | 33.3 | -680.19 | -226.73 | 0 |
| GLW | 3 | 0 | 0 | -428.69 | -142.9 | 0 |
| ACHR | 3 | 0 | 0 | -200.19 | -66.73 | 0 |

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
| AAOI | hard_stop | 2026-05-26T19:12:26.004Z | -477.67 | 10.5 | 0 | 0 | 0 | 72 |
| AAOI | overnight_risk_exit | 2026-05-22T19:56:45.596Z | 31.33 | 14.95 | 0 | 0 | 0 | 76.2 |
| AAPL | unknown | 2026-07-06T20:04:20.434Z | 300.33 | 16.95 | 0 | 0 | 0 | 0 |
| AAPL | runner_trail_stop | 2026-06-12T13:39:36.679Z | -54.69 | 4.11 | 0 | 0 | 0 | 90.3 |
| AAPL | unknown | 2026-05-22T16:10:07.709Z | 16.65 | 5.98 | 0 | 0 | 0 | 0 |
| ABT | runner_trail_stop | 2026-07-01T19:12:21.732Z | -676.73 | 0.08 | 0 | 0 | 0 | 52.9 |
| ABT | unknown | 2026-06-11T16:31:24.955Z | -1371.73 | 0.225 | 0 | 0 | 0 | 0 |
| ABTC | overnight_risk_exit | 2026-06-29T19:45:13.552Z | -6.73 | 0.77 | 0 | 0 | 0 | 52.9 |
| ACHR | overnight_risk_exit | 2026-06-02T19:56:07.592Z | -26.73 | 0.13 | 0 | 0 | 0 | 87.9 |
| ACHR | opposite_signal | 2026-05-29T18:59:13.304Z | -6.73 | 0.53 | 0 | 0 | 0 | 78.7 |
| ACHR | early_invalidation | 2026-05-27T18:37:58.227Z | -166.73 | 0.51 | 0 | 0 | 0 | 66.7 |
| AFRM | runner_trail_stop | 2026-06-09T17:44:51.415Z | -942.06 | 1.1 | 0 | 0 | 0 | 84.2 |
| AIP | unknown | 2026-06-18T20:00:02.672Z | 566.33 | 22.3 | 0 | 0 | 0 | 0 |
| ALAB | overnight_risk_exit | 2026-07-01T19:45:15.877Z | -0.67 | 15 | 0 | 0 | 0 | 52.9 |
| AMD | overnight_risk_exit | 2026-06-02T19:53:31.689Z | 55.33 | 16.63 | 0 | 0 | 0 | 94.5 |
| AMZN | runner_trail_stop | 2026-06-12T13:39:37.247Z | -1275.06 | 0.71 | 0 | 0 | 0 | 76.3 |
| AMZN | runner_trail_stop | 2026-05-29T13:30:03.278Z | -366.69 | 3.38 | 0 | 0 | 0 | 74.6 |
| AMZN | overnight_risk_exit | 2026-05-26T19:59:44.540Z | -29.35 | 6.6 | 0 | 0 | 0 | 68 |
| AMZN | runner_trail_stop | 2026-05-22T16:39:43.528Z | 314.65 | 7.88 | 0 | 0 | 0 | 73.9 |
| ANET | opposite_signal | 2026-05-22T14:03:35.356Z | 596.64 | 3.7 | 0 | 0 | 0 | 79.1 |

Full row-level leak details are in `top-leaks.csv`; structured output is in `results.json`.

