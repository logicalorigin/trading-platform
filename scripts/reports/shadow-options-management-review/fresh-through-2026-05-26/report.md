# Shadow Options Management Review

- Generated: 2026-05-26T16:57:48.612Z
- Account: shadow
- Window: 2026-04-01 through 2026-05-26
- Report directory: /home/runner/workspace/scripts/reports/shadow-options-management-review/fresh-through-2026-05-26

## Ledger Summary

- Fills: 1485
- Buy fills: 744
- Sell fills: 741
- Symbols: 69
- Fill window: 2026-04-01T13:30:00.000Z to 2026-05-26T16:42:37.355Z
- Realized P&L: 156036.85
- Fees: 3338.39
- Cash delta: 149777.61

## Opportunity Snapshot

- Realized exit P&L: 156036.85
- Post-exit high opportunity: 996747.00
- Opportunity / realized ratio: 6.39x
- Caveat: Post-exit highs are an upper-bound diagnostic, not capturable P&L; use them to rank management hypotheses before dry-run validation.

## Recommendations

- **HIGH exit_management: Keep a runner alive after first trail exit** 324 runner-trail exits produced 93044.43 realized P&L but left 485331.00 to post-exit highs. Next test: Dry-run partial exits: sell 50-70% at current trail, keep 30-50% under a looser trend/ATR trail, and compare April train vs May holdout.
- **HIGH exit_management: Require confirmation before full opposite-signal liquidation** 211 opposite-signal exits left 255874.00 to later highs while still making 51853.80. Next test: Test half-exit on first opposite signal, full exit only after second confirming bar or MTF direction loss.
- **MEDIUM entry_filtering: Convert early invalidation from permanent exit to re-entry watch** 24/52 early invalidations finished above their exit price despite negative realized P&L. Next test: Test a re-entry rule after early invalidation when the original direction re-confirms within 3-6 bars and option liquidity is still valid.
- **MEDIUM portfolio: Differentiate overnight exits for strong runners** Overnight-risk exits were nearly flat on realized P&L (264.27) but left 133404.00 to post-exit highs. Next test: Allow high-quality runners to hold a small residual overnight with a wider runner stop while forcing weak/flat positions out.
- **MEDIUM entry_filtering: Downweight or exclude weak expectancy symbols** Lowest buckets include KTOS -227.15, TLT 32.02, ACHR 85.99, JOBY 205.94, CRDO 229.60. Next test: Run a symbol-exclusion holdout sweep; only remove symbols that improve both April and May or improve one without harming the other materially.
- **MEDIUM exit_management: Promote prior dry-sweep winners into the next hypothesis set** Best prior sweep evidence is trail-ladder-aggressive-early8-loss25 with 28941.00 P&L, 5.143 PF, and 179 trades. Next test: Use that variant as the baseline for new partial-runner, re-entry, and sizing counterfactuals.
- **LOW sizing: Scale only after management improves capture** The post-exit opportunity ratio is 6.39x, so raw sizing alone risks amplifying avoidable exits. Next test: After exit/re-entry improvements, test quality-based premium caps and add-ons only for trades that reach +50%/+100%.
- **LOW data_quality: Keep audit-quality fill provenance in the loop** The April external audit found exact trade-source matches but aggregate-sourced sell exits had unresolved strict mismatches. Next test: For candidate production settings, rerun the Polygon-compatible audit and separate trade-sourced vs aggregate-sourced exit conclusions.

## Exit Reasons

| Reason | Exits | Wins | Win % | P&L | Avg P&L | Missed To High | Reached +25% After Exit | Final > Exit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runner_trail_stop | 324 | 257 | 79.3 | 93044.43 | 287.17 | 485331 | 285 | 163 |
| opposite_signal | 211 | 125 | 59.2 | 51853.8 | 245.75 | 255874 | 153 | 84 |
| expiration | 30 | 26 | 86.7 | 26415.73 | 880.52 | 32595 | 25 | 18 |
| unknown | 6 | 5 | 83.3 | 2521.54 | 420.26 | 0 | 0 | 0 |
| overnight_risk_exit | 76 | 45 | 59.2 | 264.27 | 3.48 | 133404 | 60 | 33 |
| overnight_runner_stop | 2 | 2 | 100 | 238.28 | 119.14 | 3370 | 1 | 1 |
| hard_stop | 40 | 14 | 35 | -6997.51 | -174.94 | 32883 | 26 | 15 |
| early_invalidation | 52 | 0 | 0 | -11303.69 | -217.38 | 53290 | 25 | 24 |

## Top Symbols

| Symbol | Exits | Wins | Win % | P&L | Avg P&L | Missed To High |
| --- | --- | --- | --- | --- | --- | --- |
| QCOM | 12 | 6 | 50 | 10339.15 | 861.6 | 34973 |
| APLD | 20 | 14 | 70 | 10246.47 | 512.32 | 26764 |
| AMD | 12 | 10 | 83.3 | 9807.54 | 817.3 | 54746 |
| HUT | 10 | 8 | 80 | 8270.14 | 827.01 | 17862 |
| META | 13 | 9 | 69.2 | 6339.29 | 487.64 | 13861 |
| HOOD | 14 | 10 | 71.4 | 6245.66 | 446.12 | 31891 |
| DELL | 12 | 9 | 75 | 5796.79 | 483.07 | 22265 |
| ARM | 15 | 11 | 73.3 | 5669.51 | 377.97 | 41726 |
| OKLO | 13 | 10 | 76.9 | 5212.36 | 400.95 | 20303 |
| NVDA | 20 | 14 | 70 | 4773.29 | 238.66 | 36441 |
| AMZN | 21 | 12 | 57.1 | 4730.25 | 225.25 | 36405 |
| TSLA | 16 | 10 | 62.5 | 4687.57 | 292.97 | 15138 |
| DIA | 18 | 11 | 61.1 | 4491.25 | 249.51 | 24077 |
| IONQ | 18 | 10 | 55.6 | 4097.87 | 227.66 | 37724 |
| ANET | 13 | 10 | 76.9 | 3686.75 | 283.6 | 13684 |

## Weak Symbols

| Symbol | Exits | Wins | Win % | P&L | Avg P&L | Missed To High |
| --- | --- | --- | --- | --- | --- | --- |
| KTOS | 6 | 2 | 33.3 | -227.15 | -37.86 | 6149 |
| TLT | 12 | 5 | 41.7 | 32.02 | 2.67 | 1197 |
| ACHR | 13 | 5 | 38.5 | 85.99 | 6.61 | 1194 |
| JOBY | 15 | 10 | 66.7 | 205.94 | 13.73 | 1812 |
| CRDO | 5 | 3 | 60 | 229.6 | 45.92 | 4020 |
| RBLX | 5 | 2 | 40 | 289.54 | 57.91 | 4219 |
| SQQQ | 8 | 5 | 62.5 | 310.79 | 38.85 | 3385 |
| CCJ | 6 | 4 | 66.7 | 316.2 | 52.7 | 7457 |
| RKLB | 10 | 6 | 60 | 332.17 | 33.22 | 19221 |
| UUUU | 6 | 3 | 50 | 364.84 | 60.81 | 2670 |
| VXX | 13 | 7 | 53.8 | 381.32 | 29.33 | 3075 |
| USO | 20 | 14 | 70 | 526.68 | 26.33 | 20806 |
| RTX | 5 | 4 | 80 | 613.87 | 122.77 | 2972 |
| CEG | 3 | 3 | 100 | 622.96 | 207.65 | 1656 |
| VST | 4 | 2 | 50 | 641.25 | 160.31 | 1989 |

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
| QCOM | runner_trail_stop | 2026-05-07T14:22:00.000Z | 317.31 | 4.25 | 36.5 | 758.8 | 12900 | 89 |
| ARM | runner_trail_stop | 2026-04-20T16:58:00.000Z | 288.65 | 7.5 | 70.27 | 836.9 | 12554 | 86.9 |
| HOOD | overnight_risk_exit | 2026-04-10T19:59:00.000Z | 26.64 | 2.44 | 23.7 | 871.3 | 10630 | 76.5 |
| AMZN | runner_trail_stop | 2026-04-07T14:02:00.000Z | 5.31 | 3.72 | 30.28 | 714 | 10624 | 89 |
| AMD | overnight_risk_exit | 2026-05-04T19:59:00.000Z | -90.67 | 13.3 | 110.68 | 732.2 | 9738 | 88 |
| DELL | runner_trail_stop | 2026-05-01T13:54:00.000Z | -111.35 | 5.6 | 51 | 810.7 | 9080 | 89 |
| MSTR | runner_trail_stop | 2026-04-16T13:35:00.000Z | 582.98 | 6.95 | 36.14 | 420 | 8757 | 83 |
| AMD | overnight_risk_exit | 2026-05-07T19:59:00.000Z | 186.65 | 8.04 | 50.97 | 534 | 8586 | 81.1 |
| RKLB | opposite_signal | 2026-05-07T18:20:00.000Z | -14.69 | 3.67 | 24.55 | 568.9 | 8352 | 80.7 |
| IONQ | early_invalidation | 2026-04-13T13:34:00.000Z | -238.36 | 1.75 | 18.3 | 945.7 | 8275 | 74.6 |
| MSTR | runner_trail_stop | 2026-04-16T16:25:00.000Z | 459.98 | 5.4 | 32.95 | 510.2 | 8265 | 87.5 |
| IONQ | hard_stop | 2026-04-13T14:20:00.000Z | 96.64 | 0.9 | 17.05 | 1794.4 | 8075 | 80.7 |
| HUT | opposite_signal | 2026-04-06T17:05:00.000Z | 1.64 | 2.48 | 18.1 | 629.8 | 7810 | 80.7 |
| AAOI | expiration | 2026-04-23T19:57:00.000Z | 117.31 | 3.5 | 22.52 | 543.4 | 7608 | 79.9 |
| MSFT | opposite_signal | 2026-04-14T18:15:00.000Z | -211.35 | 5.45 | 41.6 | 663.3 | 7230 | 81.6 |
| HOOD | opposite_signal | 2026-04-14T18:00:00.000Z | 3091.64 | 8.69 | 23.14 | 166.3 | 7225 | 85.9 |
| ALAB | runner_trail_stop | 2026-05-19T14:34:00.000Z | 96.33 | 14.52 | 86.35 | 494.7 | 7183 | 79.1 |
| TSM | opposite_signal | 2026-04-21T19:35:00.000Z | 158.65 | 5.95 | 39.65 | 566.4 | 6740 | 74.8 |
| TSM | opposite_signal | 2026-04-20T18:35:00.000Z | -1.35 | 6 | 39.65 | 560.8 | 6730 | 72.3 |
| ARM | runner_trail_stop | 2026-05-19T19:25:00.000Z | 264.33 | 13.05 | 80 | 513 | 6695 | 89 |

Full row-level leak details are in `top-leaks.csv`; structured output is in `results.json`.
