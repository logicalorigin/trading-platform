# Shadow Options Management Review

- Generated: 2026-06-11T00:33:32.748Z
- Account: shadow
- Window: 2026-05-22 through 2026-06-10
- Report directory: /home/runner/workspace/scripts/reports/shadow-options-management-review/2026-06-11T00-33-32-592Z

## Ledger Summary

- Fills: 184
- Buy fills: 89
- Sell fills: 95
- Symbols: 58
- Fill window: 2026-05-22T14:03:35.356Z to 2026-06-10T20:07:30.363Z
- Realized P&L: -10094.68
- Fees: 649.27
- Cash delta: -6649.27

## Opportunity Snapshot

- Realized exit P&L: -10094.68
- Post-exit high opportunity: 0.00
- Opportunity / realized ratio: n/ax
- Caveat: Post-exit highs are an upper-bound diagnostic, not capturable P&L; use them to rank management hypotheses before dry-run validation.

## Recommendations

- **MEDIUM entry_filtering: Downweight or exclude weak expectancy symbols** Lowest buckets include RBLX -2917.23, TQQQ -2294.83, AAOI -1610.01, HOOD -1510.07, ACHR -200.19. Next test: Run a symbol-exclusion holdout sweep; only remove symbols that improve both April and May or improve one without harming the other materially.
- **MEDIUM exit_management: Promote prior dry-sweep winners into the next hypothesis set** Best prior sweep evidence is trail-ladder-aggressive-early8-loss25 with 28941.00 P&L, 5.143 PF, and 179 trades. Next test: Use that variant as the baseline for new partial-runner, re-entry, and sizing counterfactuals.
- **LOW data_quality: Keep audit-quality fill provenance in the loop** The April external audit found exact trade-source matches but aggregate-sourced sell exits had unresolved strict mismatches. Next test: For candidate production settings, rerun the Massive audit and separate trade-sourced vs aggregate-sourced exit conclusions.

## Greek Management Diagnostics

| Recommendation | Exits | Wins | Win % | P&L | Avg P&L | Missed To High | Reached +25% After Exit | Final > Exit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| unavailable | 8 | 1 | 12.5 | -3254.69 | -406.84 | 0 | 0 | 0 |
| tighten | 3 | 3 | 100 | 709.25 | 236.42 | 0 | 0 | 0 |
| hold | 1 | 0 | 0 | -106.73 | -106.73 | 0 | 0 | 0 |

## Exit Reasons

| Reason | Exits | Wins | Win % | P&L | Avg P&L | Missed To High | Reached +25% After Exit | Final > Exit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runner_trail_stop | 22 | 15 | 68.2 | 8495.64 | 386.17 | 0 | 0 | 0 |
| opposite_signal | 18 | 2 | 11.1 | -658.54 | -36.59 | 0 | 0 | 0 |
| overnight_risk_exit | 15 | 3 | 20 | -880.09 | -58.67 | 0 | 0 | 0 |
| early_invalidation | 11 | 0 | 0 | -4110.71 | -373.7 | 0 | 0 | 0 |
| unknown | 19 | 6 | 31.6 | -5871.38 | -309.02 | 0 | 0 | 0 |
| hard_stop | 10 | 0 | 0 | -7069.6 | -706.96 | 0 | 0 | 0 |

## Top Symbols

| Symbol | Exits | Wins | Win % | P&L | Avg P&L | Missed To High |
| --- | --- | --- | --- | --- | --- | --- |
| SPY | 5 | 1 | 20 | 7890.54 | 1578.11 | 0 |
| SMCI | 3 | 3 | 100 | 2703.24 | 901.08 | 0 |
| MSFT | 4 | 1 | 25 | 2220.58 | 555.15 | 0 |
| USO | 3 | 2 | 66.7 | 853.6 | 284.53 | 0 |
| DIA | 3 | 1 | 33.3 | 335.93 | 111.98 | 0 |
| AMZN | 3 | 1 | 33.3 | -81.39 | -27.13 | 0 |
| GOOGL | 3 | 0 | 0 | -149.39 | -49.8 | 0 |
| ACHR | 3 | 0 | 0 | -200.19 | -66.73 | 0 |
| HOOD | 3 | 1 | 33.3 | -1510.07 | -503.36 | 0 |
| AAOI | 3 | 1 | 33.3 | -1610.01 | -536.67 | 0 |
| TQQQ | 4 | 0 | 0 | -2294.83 | -573.71 | 0 |
| RBLX | 4 | 0 | 0 | -2917.23 | -729.31 | 0 |

## Weak Symbols

| Symbol | Exits | Wins | Win % | P&L | Avg P&L | Missed To High |
| --- | --- | --- | --- | --- | --- | --- |
| RBLX | 4 | 0 | 0 | -2917.23 | -729.31 | 0 |
| TQQQ | 4 | 0 | 0 | -2294.83 | -573.71 | 0 |
| AAOI | 3 | 1 | 33.3 | -1610.01 | -536.67 | 0 |
| HOOD | 3 | 1 | 33.3 | -1510.07 | -503.36 | 0 |
| ACHR | 3 | 0 | 0 | -200.19 | -66.73 | 0 |
| GOOGL | 3 | 0 | 0 | -149.39 | -49.8 | 0 |
| AMZN | 3 | 1 | 33.3 | -81.39 | -27.13 | 0 |
| DIA | 3 | 1 | 33.3 | 335.93 | 111.98 | 0 |
| USO | 3 | 2 | 66.7 | 853.6 | 284.53 | 0 |
| MSFT | 4 | 1 | 25 | 2220.58 | 555.15 | 0 |
| SMCI | 3 | 3 | 100 | 2703.24 | 901.08 | 0 |
| SPY | 5 | 1 | 20 | 7890.54 | 1578.11 | 0 |

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
| GOOGL | runner_trail_stop | 2026-05-22T14:47:56.387Z | -68.02 | 4.73 | 0 | 0 | 0 | 79.2 |
| HOOD | runner_trail_stop | 2026-05-22T15:21:57.247Z | 366.64 | 1.84 | 0 | 0 | 0 | 79 |
| ARM | runner_trail_stop | 2026-05-22T15:32:59.235Z | 1336.33 | 23.2 | 0 | 0 | 0 | 87.4 |
| IONQ | unknown | 2026-05-22T16:10:07.709Z | 381.64 | 2.21 | 0 | 0 | 0 | 0 |
| AAPL | unknown | 2026-05-22T16:10:07.709Z | 16.65 | 5.98 | 0 | 0 | 0 | 0 |
| DIA | unknown | 2026-05-22T16:10:07.709Z | 637.31 | 5.2 | 0 | 0 | 0 | 0 |
| USO | unknown | 2026-05-22T16:10:07.709Z | 170.65 | 8.36 | 0 | 0 | 0 | 0 |
| GOOGL | unknown | 2026-05-22T16:10:07.709Z | -1.35 | 7 | 0 | 0 | 0 | 0 |
| AMZN | runner_trail_stop | 2026-05-22T16:39:43.528Z | 314.65 | 7.88 | 0 | 0 | 0 | 73.9 |
| VXX | opposite_signal | 2026-05-22T17:55:37.165Z | -23.36 | 0.63 | 0 | 0 | 0 | 64 |
| HUT | opposite_signal | 2026-05-22T18:46:07.296Z | 899.33 | 16.7 | 0 | 0 | 0 | 73.5 |
| GLW | opposite_signal | 2026-05-22T18:53:55.110Z | -106.67 | 8.88 | 0 | 0 | 0 | 74.9 |
| AAOI | overnight_risk_exit | 2026-05-22T19:56:45.596Z | 31.33 | 14.95 | 0 | 0 | 0 | 76.2 |
| CCJ | overnight_risk_exit | 2026-05-22T19:56:47.505Z | -164.02 | 3.77 | 0 | 0 | 0 | 70 |
| SMCI | unknown | 2026-05-22T20:00:00.872Z | 1316.64 | 3.67 | 0 | 0 | 0 | 0 |
| MSFT | early_invalidation | 2026-05-26T15:13:59.257Z | -201.67 | 5.97 | 0 | 0 | 0 | 85 |
| SPY | early_invalidation | 2026-05-26T15:30:16.976Z | -211.35 | 4.07 | 0 | 0 | 0 | 91.9 |
| TSLA | early_invalidation | 2026-05-26T16:15:46.676Z | -213.67 | 7.96 | 0 | 0 | 0 | 89.5 |
| RBLX | early_invalidation | 2026-05-26T17:59:38.601Z | -438.06 | 1.54 | 0 | 0 | 0 | 68.8 |
| COHR | opposite_signal | 2026-05-26T18:57:13.718Z | -167.67 | 16.4 | 0 | 0 | 0 | 77.9 |

Full row-level leak details are in `top-leaks.csv`; structured output is in `results.json`.

