# Shadow Options Management Review

- Generated: 2026-05-29T14:35:54.898Z
- Account: shadow
- Window: 2026-05-27 through 2026-05-29
- Report directory: /home/runner/workspace/scripts/scripts/reports/shadow-options-management-review/2026-05-27-through-2026-05-29-audit

## Ledger Summary

- Fills: 49
- Buy fills: 26
- Sell fills: 23
- Symbols: 22
- Fill window: 2026-05-27T14:52:43.885Z to 2026-05-29T14:31:37.280Z
- Realized P&L: -4751.24
- Fees: 203.87
- Cash delta: -9654.87

## Opportunity Snapshot

- Realized exit P&L: -4751.24
- Post-exit high opportunity: 0.00
- Opportunity / realized ratio: n/ax
- Caveat: Post-exit highs are an upper-bound diagnostic, not capturable P&L; use them to rank management hypotheses before dry-run validation.

## Recommendations

- **MEDIUM exit_management: Promote prior dry-sweep winners into the next hypothesis set** Best prior sweep evidence is trail-ladder-aggressive-early8-loss25 with 28941.00 P&L, 5.143 PF, and 179 trades. Next test: Use that variant as the baseline for new partial-runner, re-entry, and sizing counterfactuals.
- **LOW data_quality: Keep audit-quality fill provenance in the loop** The April external audit found exact trade-source matches but aggregate-sourced sell exits had unresolved strict mismatches. Next test: For candidate production settings, rerun the Polygon-compatible audit and separate trade-sourced vs aggregate-sourced exit conclusions.

## Exit Reasons

| Reason | Exits | Wins | Win % | P&L | Avg P&L | Missed To High | Reached +25% After Exit | Final > Exit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runner_trail_stop | 7 | 5 | 71.4 | 548.42 | 78.35 | 0 | 0 | 0 |
| overnight_risk_exit | 6 | 1 | 16.7 | -481.9 | -80.32 | 0 | 0 | 0 |
| opposite_signal | 2 | 0 | 0 | -598.04 | -299.02 | 0 | 0 | 0 |
| hard_stop | 3 | 0 | 0 | -2029.79 | -676.6 | 0 | 0 | 0 |
| early_invalidation | 5 | 0 | 0 | -2189.93 | -437.99 | 0 | 0 | 0 |

## Top Symbols

No rows.

## Weak Symbols

No rows.

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
| AVAV | opposite_signal | 2026-05-27T15:59:00.549Z | -514.69 | 3.45 | 0 | 0 | 0 | 60 |
| USO | early_invalidation | 2026-05-27T16:02:28.040Z | -558.36 | 2.75 | 0 | 0 | 0 | 58.6 |
| JOBY | runner_trail_stop | 2026-05-27T17:02:32.575Z | 83.27 | 0.7 | 0 | 0 | 0 | 82.7 |
| RGTI | early_invalidation | 2026-05-27T17:58:12.007Z | -556.73 | 1.26 | 0 | 0 | 0 | 75.6 |
| KTOS | early_invalidation | 2026-05-27T18:09:47.289Z | -461.38 | 1.9 | 0 | 0 | 0 | 80 |
| ACHR | early_invalidation | 2026-05-27T18:37:58.227Z | -166.73 | 0.51 | 0 | 0 | 0 | 66.7 |
| QBTS | early_invalidation | 2026-05-27T19:00:08.553Z | -446.73 | 1.45 | 0 | 0 | 0 | 77.6 |
| CLSK | runner_trail_stop | 2026-05-27T19:07:12.064Z | 153.27 | 1.46 | 0 | 0 | 0 | 73.4 |
| RKLB | opposite_signal | 2026-05-27T19:23:45.770Z | -83.35 | 6.38 | 0 | 0 | 0 | 93.3 |
| META | runner_trail_stop | 2026-05-27T19:27:41.491Z | 137.33 | 14.13 | 0 | 0 | 0 | 78.2 |
| SPY | overnight_risk_exit | 2026-05-27T19:46:13.829Z | -62.02 | 4.9 | 0 | 0 | 0 | 73.2 |
| COIN | overnight_risk_exit | 2026-05-27T19:47:12.877Z | -146.02 | 4.9 | 0 | 0 | 0 | 68.8 |
| CORZ | overnight_risk_exit | 2026-05-27T19:50:00.299Z | 73.27 | 1.57 | 0 | 0 | 0 | 78.7 |
| TQQQ | overnight_risk_exit | 2026-05-27T19:52:40.589Z | -16.73 | 1.88 | 0 | 0 | 0 | 73.3 |
| DELL | overnight_risk_exit | 2026-05-27T19:52:43.585Z | -303.67 | 15.86 | 0 | 0 | 0 | 69.2 |
| TLT | overnight_risk_exit | 2026-05-27T19:59:16.726Z | -26.73 | 0.21 | 0 | 0 | 0 | 72.3 |
| APLD | runner_trail_stop | 2026-05-28T13:50:52.716Z | 170.62 | 2.62 | 0 | 0 | 0 | 74.7 |
| CRWV | runner_trail_stop | 2026-05-28T16:34:13.731Z | 769.31 | 6.13 | 0 | 0 | 0 | 66.7 |
| RKLB | runner_trail_stop | 2026-05-28T19:17:37.529Z | -398.69 | 3.94 | 0 | 0 | 0 | 92.1 |
| VRT | hard_stop | 2026-05-28T19:40:36.260Z | -707.02 | 4.04 | 0 | 0 | 0 | 63.7 |

Full row-level leak details are in `top-leaks.csv`; structured output is in `results.json`.

