# MTF Pattern Discovery Settings Sweep

- Symbols: SPY, QQQ
- Timeframes: 1m, 2m, 5m, 15m
- Horizons: 3, 6, 12, 24
- Study window: 2026-04-24T00:00:00.000Z through latest loaded bar
- Min sample threshold: 1
- Possible direction combinations per horizon: 81
- Variants: 9

## Cross-Variant Best By Family/Horizon

| Horizon | Family | Variant | Study ID | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | --- | --- | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | slow fast / slow context | `1c314f44-2640-49b0-a07f-a369e2c40738` | 30 | 0.060926 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.695398 | long |
| 3 | bear_confluence | fast fast / tight context | `d0a66705-e3ba-42f6-bbcd-5ef90557d74e` | 28 | -0.033016 | `1m:sell|2m:sell|5m:sell|15m:sell` | 1.711857 | short |
| 3 | fast_bullish_reversal | slow fast / tight context | `dc743cec-7c3a-482a-ac9b-cfbf148c222f` | 6 | -0.089980 | `1m:buy|2m:buy|5m:sell|15m:sell` | 2.016143 | short |
| 3 | fast_bearish_reversal | slow fast / base context | `cf8ec68a-c835-406b-8abf-246dd5869fdf` | 8 | 0.032682 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.254513 | long |
| 3 | mixed_divergence | slow fast / tight context | `dc743cec-7c3a-482a-ac9b-cfbf148c222f` | 111 | 0.016152 | `1m:buy|2m:buy|5m:sell|15m:buy` | 7.166546 | short |
| 6 | bull_confluence | slow fast / slow context | `1c314f44-2640-49b0-a07f-a369e2c40738` | 30 | 0.074972 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.274613 | long |
| 6 | bear_confluence | fast fast / tight context | `d0a66705-e3ba-42f6-bbcd-5ef90557d74e` | 28 | -0.027340 | `1m:sell|2m:sell|5m:sell|15m:sell` | 1.185857 | short |
| 6 | fast_bullish_reversal | slow fast / tight context | `dc743cec-7c3a-482a-ac9b-cfbf148c222f` | 6 | -0.085987 | `1m:buy|2m:buy|5m:sell|15m:sell` | 1.840257 | short |
| 6 | fast_bearish_reversal | slow fast / base context | `cf8ec68a-c835-406b-8abf-246dd5869fdf` | 8 | 0.047706 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.107105 | long |
| 6 | mixed_divergence | base fast / tight context | `8b64d374-dd3d-4ec2-987d-e9b42a8ed1f8` | 123 | 0.016239 | `1m:sell|2m:sell|5m:buy|15m:sell` | 28.834061 | short |
| 12 | bull_confluence | slow fast / slow context | `1c314f44-2640-49b0-a07f-a369e2c40738` | 30 | 0.100540 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.793140 | long |
| 12 | bear_confluence | base fast / slow context | `c6faa0a1-68dc-4fd2-b2af-98d72efbe410` | 6 | 0.124900 | `1m:sell|2m:sell|5m:sell|15m:sell` | 1.244375 | long |
| 12 | fast_bullish_reversal | fast fast / slow context | `4be96d7c-97f4-454c-bff6-cf27a88fa34a` | 8 | 0.057735 | `1m:buy|2m:buy|5m:sell|15m:sell` | 2.854347 | long |
| 12 | fast_bearish_reversal | slow fast / slow context | `1c314f44-2640-49b0-a07f-a369e2c40738` | 14 | 0.070413 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.357750 | long |
| 12 | mixed_divergence | fast fast / base context | `803e557f-deb7-45c9-954b-e13ad0bed2b2` | 199 | -0.016745 | `1m:buy|2m:sell|5m:buy|15m:sell` | 5.291004 | short |
| 24 | bull_confluence | slow fast / slow context | `1c314f44-2640-49b0-a07f-a369e2c40738` | 30 | 0.116132 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.275670 | long |
| 24 | bear_confluence | Baseline calibrated defaults | `c492a418-7591-44f3-beb8-46fd6c196432` | 13 | 0.030505 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.722684 | long |
| 24 | fast_bullish_reversal | fast fast / base context | `803e557f-deb7-45c9-954b-e13ad0bed2b2` | 19 | 0.105624 | `1m:buy|2m:buy|5m:sell|15m:sell` | 3.083977 | long |
| 24 | fast_bearish_reversal | slow fast / slow context | `1c314f44-2640-49b0-a07f-a369e2c40738` | 14 | 0.187677 | `1m:sell|2m:sell|5m:buy|15m:buy` | 2.034846 | long |
| 24 | mixed_divergence | fast fast / base context | `803e557f-deb7-45c9-954b-e13ad0bed2b2` | 198 | -0.001396 | `1m:sell|2m:buy|5m:buy|15m:sell` | 3.211292 | long |

## Baseline calibrated defaults

- Study ID: `c492a418-7591-44f3-beb8-46fd6c196432`
- Variant: `baseline-calibrated-defaults`
- Description: Current per-timeframe defaults from pattern-discovery.ts.
- Observed transitions: 199
- Result rows: 64
- Occurrence rows: 791
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Family Summary By Horizon

| Horizon | Family | Patterns | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | ---: | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | 1 | 38 | 0.044799 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.859992 | long |
| 3 | bear_confluence | 1 | 15 | -0.021613 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.591072 | short |
| 3 | fast_bullish_reversal | 1 | 10 | 0.011298 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.480820 | long |
| 3 | fast_bearish_reversal | 1 | 22 | 0.022634 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.893825 | long |
| 3 | mixed_divergence | 12 | 114 | 0.002145 | `1m:buy|2m:sell|5m:buy|15m:sell` | 2.832940 | long |
| 3 | inactive | 0 | 0 |  | `` |  |  |
| 6 | bull_confluence | 1 | 38 | 0.045248 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.093057 | long |
| 6 | bear_confluence | 1 | 14 | -0.013027 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.291830 | short |
| 6 | fast_bullish_reversal | 1 | 10 | -0.023611 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.413707 | short |
| 6 | fast_bearish_reversal | 1 | 22 | -0.031694 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.421825 | short |
| 6 | mixed_divergence | 12 | 114 | 0.013095 | `1m:sell|2m:buy|5m:buy|15m:sell` | 3.368174 | long |
| 6 | inactive | 0 | 0 |  | `` |  |  |
| 12 | bull_confluence | 1 | 38 | 0.072218 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.424105 | long |
| 12 | bear_confluence | 1 | 13 | 0.040071 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.605227 | long |
| 12 | fast_bullish_reversal | 1 | 10 | 0.069146 | `1m:buy|2m:buy|5m:sell|15m:sell` | 1.162843 | long |
| 12 | fast_bearish_reversal | 1 | 22 | -0.021128 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.225118 | short |
| 12 | mixed_divergence | 12 | 114 | 0.015401 | `1m:buy|2m:sell|5m:buy|15m:sell` | 2.771812 | long |
| 12 | inactive | 0 | 0 |  | `` |  |  |
| 24 | bull_confluence | 1 | 38 | 0.075826 | `1m:buy|2m:buy|5m:buy|15m:buy` | 2.946292 | long |
| 24 | bear_confluence | 1 | 13 | 0.030505 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.722684 | long |
| 24 | fast_bullish_reversal | 1 | 10 | 0.075094 | `1m:buy|2m:buy|5m:sell|15m:sell` | 1.015361 | long |
| 24 | fast_bearish_reversal | 1 | 22 | -0.010048 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.103414 | short |
| 24 | mixed_divergence | 12 | 114 | 0.061101 | `1m:sell|2m:buy|5m:sell|15m:buy` | 2.256215 | long |
| 24 | inactive | 0 | 0 |  | `` |  |  |

### All Observed Combination Outcomes

| Horizon | Rank | Pattern | Family | n | Bias | Mean% | Delta Mean% | Win% | Delta Win% | Median% | Std% | MAE% | MFE% | t-stat | Score |
| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.044799 | 0.000000 | 68.421053 | 0.000000 | 0.029061 | 0.071544 | -0.017776 | 0.072092 | 3.859992 | 0.626173 |
| 3 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.048226 | 0.000000 | 75.000000 | 0.000000 | 0.061490 | 0.034047 | -0.021228 | 0.067156 | 2.832940 | 1.416470 |
| 3 | 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.033748 | 0.000000 | 60.000000 | 0.000000 | 0.044697 | 0.044775 | -0.024257 | 0.057680 | 2.383484 | 0.753724 |
| 3 | 4 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.026611 | 0.000000 | 30.769231 | 0.000000 | -0.009498 | 0.057471 | -0.069543 | 0.027023 | -1.669475 | -0.463029 |
| 3 | 5 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 11 | short | -0.044264 | 0.000000 | 36.363636 | 0.000000 | -0.043141 | 0.089827 | -0.090208 | 0.039630 | -1.634309 | -0.492763 |
| 3 | 6 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.032018 | 0.000000 | 80.000000 | 0.000000 | 0.018869 | 0.045785 | -0.043813 | 0.072418 | 1.563723 | 0.699318 |
| 3 | 7 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.022273 | 0.000000 | 75.000000 | 0.000000 | 0.019274 | 0.072479 | -0.042708 | 0.047608 | 1.374286 | 0.307300 |
| 3 | 8 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.009247 | 0.000000 | 42.857143 | 0.000000 | -0.004929 | 0.018238 | -0.040467 | 0.012539 | -1.341500 | -0.507039 |
| 3 | 9 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 22 | long | 0.022634 | 0.000000 | 54.545455 | 0.000000 | 0.004773 | 0.118774 | -0.047741 | 0.064624 | 0.893825 | 0.190564 |
| 3 | 10 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.045907 | 0.000000 | 50.000000 | 0.000000 | -0.016243 | 0.148797 | -0.102693 | 0.096799 | -0.617037 | -0.308518 |
| 3 | 11 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 15 | short | -0.021613 | 0.000000 | 53.333333 | 0.000000 | 0.006504 | 0.141619 | -0.095610 | 0.068838 | -0.591072 | -0.152614 |
| 3 | 12 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.012066 | 0.000000 | 57.142857 | 0.000000 | 0.014240 | 0.063607 | -0.044614 | 0.038773 | 0.501878 | 0.189692 |
| 3 | 13 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | long | 0.011298 | 0.000000 | 60.000000 | 0.000000 | 0.035042 | 0.074306 | -0.038949 | 0.051836 | 0.480820 | 0.152049 |
| 3 | 14 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.005257 | 0.000000 | 40.909091 | 0.000000 | -0.004044 | 0.083478 | -0.056466 | 0.047903 | 0.295387 | 0.062977 |
| 3 | 15 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.003567 | 0.000000 | 28.571429 | 0.000000 | -0.020368 | 0.031998 | -0.027351 | 0.018679 | -0.294921 | -0.111470 |
| 3 | 16 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.003669 | 0.000000 | 25.000000 | 0.000000 | -0.011166 | 0.048503 | -0.059442 | 0.045825 | 0.151269 | 0.075634 |
| 6 | 1 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.038434 | 0.000000 | 80.000000 | 0.000000 | 0.039087 | 0.025516 | -0.043813 | 0.093063 | 3.368174 | 1.506293 |
| 6 | 2 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.045248 | 0.000000 | 60.526316 | 0.000000 | 0.013884 | 0.090178 | -0.027193 | 0.092452 | 3.093057 | 0.501760 |
| 6 | 3 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.058237 | 0.000000 | 72.727273 | 0.000000 | 0.028714 | 0.109938 | -0.059920 | 0.086899 | 2.484614 | 0.529722 |
| 6 | 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.039732 | 0.000000 | 80.000000 | 0.000000 | 0.021046 | 0.073553 | -0.045576 | 0.071688 | 2.415745 | 0.540177 |
| 6 | 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.037066 | 0.000000 | 23.076923 | 0.000000 | -0.044003 | 0.056822 | -0.095000 | 0.027023 | -2.351953 | -0.652314 |
| 6 | 6 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.082870 | 0.000000 | 75.000000 | 0.000000 | 0.089596 | 0.079410 | -0.022458 | 0.118903 | 2.087142 | 1.043571 |
| 6 | 7 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.080497 | 0.000000 | 14.285714 | 0.000000 | -0.015842 | 0.125548 | -0.112158 | 0.017961 | -1.696356 | -0.641162 |
| 6 | 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.033027 | 0.000000 | 60.000000 | 0.000000 | 0.034474 | 0.076107 | -0.040563 | 0.076458 | 1.372284 | 0.433954 |
| 6 | 9 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.031609 | 0.000000 | 75.000000 | 0.000000 | 0.015974 | 0.061352 | -0.059442 | 0.061655 | 1.030425 | 0.515212 |
| 6 | 10 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.011714 | 0.000000 | 42.857143 | 0.000000 | -0.018985 | 0.030645 | -0.036416 | 0.026905 | -1.011385 | -0.382267 |
| 6 | 11 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 11 | short | -0.028316 | 0.000000 | 27.272727 | 0.000000 | -0.024546 | 0.124584 | -0.111907 | 0.054470 | -0.753813 | -0.227283 |
| 6 | 12 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 22 | short | -0.031694 | 0.000000 | 54.545455 | 0.000000 | 0.021695 | 0.352415 | -0.134214 | 0.084017 | -0.421825 | -0.089933 |
| 6 | 13 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | short | -0.023611 | 0.000000 | 50.000000 | 0.000000 | 0.008098 | 0.180480 | -0.084446 | 0.066369 | -0.413707 | -0.130826 |
| 6 | 14 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.039483 | 0.000000 | 50.000000 | 0.000000 | 0.000763 | 0.218289 | -0.157459 | 0.124920 | -0.361755 | -0.180877 |
| 6 | 15 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 14 | short | -0.013027 | 0.000000 | 50.000000 | 0.000000 | -0.001224 | 0.167027 | -0.120150 | 0.090911 | -0.291830 | -0.077995 |
| 6 | 16 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.004767 | 0.000000 | 42.857143 | 0.000000 | -0.010393 | 0.057512 | -0.053978 | 0.044004 | 0.219298 | 0.082887 |
| 12 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.072218 | 0.000000 | 60.526316 | 0.000000 | 0.031872 | 0.130014 | -0.043539 | 0.127392 | 3.424105 | 0.555463 |
| 12 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.114931 | 0.000000 | 100.000000 | 0.000000 | 0.111561 | 0.082929 | -0.022634 | 0.139040 | 2.771812 | 1.385906 |
| 12 | 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.062866 | 0.000000 | 65.000000 | 0.000000 | 0.046042 | 0.124651 | -0.055539 | 0.105524 | 2.255449 | 0.504334 |
| 12 | 4 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.117860 | 0.000000 | 14.285714 | 0.000000 | -0.042911 | 0.169931 | -0.149985 | 0.028542 | -1.835027 | -0.693575 |
| 12 | 5 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.052536 | 0.000000 | 70.000000 | 0.000000 | 0.035874 | 0.103179 | -0.047975 | 0.097356 | 1.610151 | 0.509174 |
| 12 | 6 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | long | 0.069146 | 0.000000 | 70.000000 | 0.000000 | 0.074122 | 0.188037 | -0.095114 | 0.134041 | 1.162843 | 0.367723 |
| 12 | 7 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.044580 | 0.000000 | 20.000000 | 0.000000 | -0.025806 | 0.112451 | -0.096794 | 0.099834 | -0.886464 | -0.396439 |
| 12 | 8 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.033527 | 0.000000 | 42.857143 | 0.000000 | -0.005425 | 0.109530 | -0.076432 | 0.092020 | 0.809862 | 0.306099 |
| 12 | 9 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.033635 | 0.000000 | 68.181818 | 0.000000 | 0.056380 | 0.240924 | -0.107383 | 0.127240 | 0.654818 | 0.139608 |
| 12 | 10 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 13 | long | 0.040071 | 0.000000 | 61.538462 | 0.000000 | 0.048613 | 0.238714 | -0.147272 | 0.158934 | 0.605227 | 0.167860 |
| 12 | 11 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 11 | short | -0.022582 | 0.000000 | 54.545455 | 0.000000 | 0.025336 | 0.131524 | -0.129523 | 0.083728 | -0.569438 | -0.171692 |
| 12 | 12 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.012280 | 0.000000 | 57.142857 | 0.000000 | 0.002034 | 0.069756 | -0.064228 | 0.039661 | -0.465769 | -0.176044 |
| 12 | 13 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.012548 | 0.000000 | 30.769231 | 0.000000 | -0.040707 | 0.137663 | -0.127113 | 0.087627 | -0.328658 | -0.091153 |
| 12 | 14 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.010940 | 0.000000 | 25.000000 | 0.000000 | -0.019127 | 0.095954 | -0.060146 | 0.073040 | 0.228032 | 0.114016 |
| 12 | 15 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 22 | short | -0.021128 | 0.000000 | 59.090909 | 0.000000 | 0.017778 | 0.440208 | -0.157635 | 0.135750 | -0.225118 | -0.047995 |
| 12 | 16 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | long | 0.010082 | 0.000000 | 50.000000 | 0.000000 | 0.044153 | 0.172867 | -0.157459 | 0.133586 | 0.116645 | 0.058322 |
| 24 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.075826 | 0.000000 | 65.789474 | 0.000000 | 0.061699 | 0.158648 | -0.057036 | 0.170510 | 2.946292 | 0.477952 |
| 24 | 2 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.300072 | 0.000000 | 85.714286 | 0.000000 | 0.151463 | 0.351880 | -0.103680 | 0.345274 | 2.256215 | 0.852769 |
| 24 | 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.052239 | 0.000000 | 55.000000 | 0.000000 | 0.039630 | 0.128154 | -0.071408 | 0.139571 | 1.822973 | 0.407629 |
| 24 | 4 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.016757 | 0.000000 | 75.000000 | 0.000000 | 0.015822 | 0.019484 | -0.077643 | 0.093940 | 1.720036 | 0.860018 |
| 24 | 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.060356 | 0.000000 | 63.636364 | 0.000000 | 0.052922 | 0.207253 | -0.127880 | 0.163400 | 1.365942 | 0.291220 |
| 24 | 6 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | long | 0.117496 | 0.000000 | 53.846154 | 0.000000 | 0.025231 | 0.318968 | -0.153525 | 0.191261 | 1.328148 | 0.368362 |
| 24 | 7 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.061417 | 0.000000 | 50.000000 | 0.000000 | 0.049527 | 0.103208 | -0.045509 | 0.178673 | 1.190158 | 0.595079 |
| 24 | 8 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.075428 | 0.000000 | 42.857143 | 0.000000 | -0.061252 | 0.189483 | -0.176081 | 0.052773 | -1.053205 | -0.398074 |
| 24 | 9 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.132794 | 0.000000 | 57.142857 | 0.000000 | 0.014403 | 0.334439 | -0.101412 | 0.202360 | 1.050533 | 0.397064 |
| 24 | 10 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | long | 0.075094 | 0.000000 | 80.000000 | 0.000000 | 0.094437 | 0.233877 | -0.101056 | 0.167975 | 1.015361 | 0.321085 |
| 24 | 11 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 13 | long | 0.030505 | 0.000000 | 69.230769 | 0.000000 | 0.031036 | 0.152193 | -0.183561 | 0.180103 | 0.722684 | 0.200437 |
| 24 | 12 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.023043 | 0.000000 | 60.000000 | 0.000000 | 0.052527 | 0.116578 | -0.086368 | 0.116067 | 0.625054 | 0.197659 |
| 24 | 13 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.020653 | 0.000000 | 60.000000 | 0.000000 | 0.004554 | 0.086221 | -0.136338 | 0.119934 | -0.535615 | -0.239534 |
| 24 | 14 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 11 | long | 0.005897 | 0.000000 | 54.545455 | 0.000000 | 0.058038 | 0.128178 | -0.148175 | 0.110362 | 0.152586 | 0.046006 |
| 24 | 15 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | long | 0.014677 | 0.000000 | 50.000000 | 0.000000 | 0.096487 | 0.279257 | -0.181227 | 0.146266 | 0.105113 | 0.052557 |
| 24 | 16 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 22 | short | -0.010048 | 0.000000 | 54.545455 | 0.000000 | 0.019095 | 0.455723 | -0.209202 | 0.174462 | -0.103414 | -0.022048 |

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.044799 | 68.421053 | 3.859992 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.048226 | 75.000000 | 2.832940 |
| 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.033748 | 60.000000 | 2.383484 |
| 4 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.026611 | 30.769231 | -1.669475 |
| 5 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 11 | short | -0.044264 | 36.363636 | -1.634309 |
| 6 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.032018 | 80.000000 | 1.563723 |
| 7 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.022273 | 75.000000 | 1.374286 |
| 8 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.009247 | 42.857143 | -1.341500 |
| 9 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 22 | long | 0.022634 | 54.545455 | 0.893825 |
| 10 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.045907 | 50.000000 | -0.617037 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.038434 | 80.000000 | 3.368174 |
| 2 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.045248 | 60.526316 | 3.093057 |
| 3 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.058237 | 72.727273 | 2.484614 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.039732 | 80.000000 | 2.415745 |
| 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.037066 | 23.076923 | -2.351953 |
| 6 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.082870 | 75.000000 | 2.087142 |
| 7 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.080497 | 14.285714 | -1.696356 |
| 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.033027 | 60.000000 | 1.372284 |
| 9 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.031609 | 75.000000 | 1.030425 |
| 10 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.011714 | 42.857143 | -1.011385 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.072218 | 60.526316 | 3.424105 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.114931 | 100.000000 | 2.771812 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.062866 | 65.000000 | 2.255449 |
| 4 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.117860 | 14.285714 | -1.835027 |
| 5 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.052536 | 70.000000 | 1.610151 |
| 6 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | long | 0.069146 | 70.000000 | 1.162843 |
| 7 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.044580 | 20.000000 | -0.886464 |
| 8 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.033527 | 42.857143 | 0.809862 |
| 9 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.033635 | 68.181818 | 0.654818 |
| 10 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 13 | long | 0.040071 | 61.538462 | 0.605227 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.075826 | 65.789474 | 2.946292 |
| 2 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.300072 | 85.714286 | 2.256215 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.052239 | 55.000000 | 1.822973 |
| 4 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.016757 | 75.000000 | 1.720036 |
| 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.060356 | 63.636364 | 1.365942 |
| 6 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | long | 0.117496 | 53.846154 | 1.328148 |
| 7 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.061417 | 50.000000 | 1.190158 |
| 8 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.075428 | 42.857143 | -1.053205 |
| 9 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.132794 | 57.142857 | 1.050533 |
| 10 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | long | 0.075094 | 80.000000 | 1.015361 |

## fast fast / tight context

- Study ID: `d0a66705-e3ba-42f6-bbcd-5ef90557d74e`
- Variant: `horizon-fast-fast-tight-context`
- Description: timeHorizon grid: 1m=6, 2m=6, 5m=6, 15m=6.
- Observed transitions: 351
- Result rows: 64
- Occurrence rows: 1401
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Family Summary By Horizon

| Horizon | Family | Patterns | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | ---: | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | 1 | 59 | 0.034150 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.961583 | long |
| 3 | bear_confluence | 1 | 28 | -0.033016 | `1m:sell|2m:sell|5m:sell|15m:sell` | 1.711857 | short |
| 3 | fast_bullish_reversal | 1 | 20 | 0.012626 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.992788 | long |
| 3 | fast_bearish_reversal | 1 | 34 | 0.015810 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.924949 | long |
| 3 | mixed_divergence | 12 | 210 | 0.001746 | `1m:sell|2m:buy|5m:buy|15m:buy` | 2.664579 | long |
| 3 | inactive | 0 | 0 |  | `` |  |  |
| 6 | bull_confluence | 1 | 59 | 0.038723 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.022062 | long |
| 6 | bear_confluence | 1 | 28 | -0.027340 | `1m:sell|2m:sell|5m:sell|15m:sell` | 1.185857 | short |
| 6 | fast_bullish_reversal | 1 | 20 | 0.004093 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.172870 | long |
| 6 | fast_bearish_reversal | 1 | 34 | -0.016193 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.337350 | short |
| 6 | mixed_divergence | 12 | 210 | -0.006778 | `1m:sell|2m:buy|5m:sell|15m:buy` | 1.803425 | long |
| 6 | inactive | 0 | 0 |  | `` |  |  |
| 12 | bull_confluence | 1 | 59 | 0.037789 | `1m:buy|2m:buy|5m:buy|15m:buy` | 2.638667 | long |
| 12 | bear_confluence | 1 | 27 | -0.005493 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.158297 | short |
| 12 | fast_bullish_reversal | 1 | 20 | 0.020812 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.556050 | long |
| 12 | fast_bearish_reversal | 1 | 34 | -0.037868 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.575862 | short |
| 12 | mixed_divergence | 12 | 210 | -0.009252 | `1m:sell|2m:buy|5m:buy|15m:buy` | 2.493095 | long |
| 12 | inactive | 0 | 0 |  | `` |  |  |
| 24 | bull_confluence | 1 | 59 | 0.065787 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.105120 | long |
| 24 | bear_confluence | 1 | 27 | -0.011209 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.349642 | short |
| 24 | fast_bullish_reversal | 1 | 20 | 0.028220 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.642384 | long |
| 24 | fast_bearish_reversal | 1 | 34 | -0.083204 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.089505 | short |
| 24 | mixed_divergence | 12 | 209 | 0.012683 | `1m:sell|2m:sell|5m:buy|15m:sell` | 2.567478 | short |
| 24 | inactive | 0 | 0 |  | `` |  |  |

### All Observed Combination Outcomes

| Horizon | Rank | Pattern | Family | n | Bias | Mean% | Delta Mean% | Win% | Delta Win% | Median% | Std% | MAE% | MFE% | t-stat | Score |
| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 59 | long | 0.034150 | -0.010649 | 71.186441 | +2.765388 | 0.019145 | 0.066214 | -0.020288 | 0.065733 | 3.961583 | 0.515754 |
| 3 | 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.024268 | +0.001995 | 66.666667 | -8.333333 | 0.015973 | 0.061095 | -0.031181 | 0.050895 | 2.664579 | 0.397212 |
| 3 | 3 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 28 | short | -0.033016 | -0.011403 | 35.714286 | -17.619047 | -0.042999 | 0.102055 | -0.091910 | 0.051680 | -1.711857 | -0.323511 |
| 3 | 4 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 20 | long | 0.017182 | -0.016566 | 55.000000 | -5.000000 | 0.029702 | 0.048976 | -0.027771 | 0.050759 | 1.568933 | 0.350824 |
| 3 | 5 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.028767 | +0.025098 | 71.428571 | +46.428571 | 0.018869 | 0.051445 | -0.040808 | 0.069107 | 1.479463 | 0.559184 |
| 3 | 6 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 22 | short | -0.015085 | +0.029179 | 40.909091 | +4.545455 | -0.015051 | 0.051706 | -0.051186 | 0.035702 | -1.368418 | -0.291748 |
| 3 | 7 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.030291 | +0.015616 | 33.333333 | -16.666667 | -0.008922 | 0.088956 | -0.074744 | 0.033466 | -1.179565 | -0.340511 |
| 3 | 8 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 19 | short | -0.011187 | +0.015424 | 42.105263 | +11.336032 | -0.009054 | 0.042310 | -0.058424 | 0.029758 | -1.152570 | -0.264418 |
| 3 | 9 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.018384 | +0.006318 | 54.545455 | -2.597402 | 0.005610 | 0.055448 | -0.033475 | 0.044450 | 1.099662 | 0.331560 |
| 3 | 10 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 20 | long | 0.012626 | +0.001328 | 65.000000 | +5.000000 | 0.024391 | 0.056876 | -0.039189 | 0.051687 | 0.992788 | 0.221994 |
| 3 | 11 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.006405 | +0.002842 | 50.000000 | +7.142857 | -0.004027 | 0.021388 | -0.037197 | 0.024332 | -0.946972 | -0.299459 |
| 3 | 12 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 34 | long | 0.015810 | -0.006824 | 55.882353 | +1.336898 | 0.001694 | 0.099665 | -0.052157 | 0.048869 | 0.924949 | 0.158627 |
| 3 | 13 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 34 | short | -0.009548 | -0.014805 | 38.235294 | -2.673797 | -0.010854 | 0.075933 | -0.051151 | 0.032709 | -0.733172 | -0.125738 |
| 3 | 14 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.009113 | -0.005546 | 20.000000 | -8.571429 | -0.018596 | 0.040771 | -0.030404 | 0.034436 | -0.706807 | -0.223512 |
| 3 | 15 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.008387 | -0.039839 | 57.142857 | -17.857143 | 0.015180 | 0.036491 | -0.048160 | 0.047090 | 0.608071 | 0.229829 |
| 3 | 16 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 13 | short | -0.011054 | -0.043072 | 61.538462 | -18.461538 | 0.018282 | 0.100019 | -0.061426 | 0.048703 | -0.398485 | -0.110520 |
| 6 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 59 | long | 0.038723 | -0.006525 | 72.881356 | +12.355040 | 0.023299 | 0.073951 | -0.028135 | 0.088268 | 4.022062 | 0.523628 |
| 6 | 2 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.031118 | +0.026351 | 63.636364 | +20.779221 | 0.023141 | 0.057228 | -0.037532 | 0.070979 | 1.803425 | 0.543753 |
| 6 | 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.016970 | -0.022762 | 71.111111 | -8.888889 | 0.018261 | 0.078001 | -0.046309 | 0.067919 | 1.459480 | 0.217566 |
| 6 | 4 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 20 | long | 0.022054 | -0.010973 | 55.000000 | -5.000000 | 0.030238 | 0.078206 | -0.042452 | 0.072714 | 1.261120 | 0.281995 |
| 6 | 5 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.041550 | -0.002067 | 33.333333 | -16.666667 | -0.047994 | 0.116366 | -0.118909 | 0.055519 | -1.236901 | -0.357062 |
| 6 | 6 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.014682 | -0.068188 | 71.428571 | -3.571429 | 0.009056 | 0.032632 | -0.057148 | 0.065928 | 1.190413 | 0.449934 |
| 6 | 7 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 28 | short | -0.027340 | -0.014313 | 32.142857 | -17.857143 | -0.027099 | 0.121997 | -0.120083 | 0.066027 | -1.185857 | -0.224106 |
| 6 | 8 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.014185 | -0.017424 | 57.142857 | -17.857143 | 0.019514 | 0.034298 | -0.050074 | 0.075174 | 1.094230 | 0.413580 |
| 6 | 9 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 34 | short | -0.044302 | -0.102539 | 55.882353 | -16.844920 | 0.002850 | 0.270178 | -0.118818 | 0.047533 | -0.956128 | -0.163975 |
| 6 | 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 22 | short | -0.026822 | +0.001494 | 45.454545 | +18.181818 | -0.007209 | 0.133206 | -0.088891 | 0.054763 | -0.944458 | -0.201359 |
| 6 | 11 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.014050 | +0.066447 | 40.000000 | +25.714286 | -0.008525 | 0.050158 | -0.054709 | 0.029351 | -0.885777 | -0.280107 |
| 6 | 12 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 19 | short | -0.013693 | +0.023373 | 31.578947 | +8.502024 | -0.021038 | 0.068545 | -0.078380 | 0.043130 | -0.870756 | -0.199765 |
| 6 | 13 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 13 | short | -0.011947 | -0.050381 | 38.461538 | -41.538462 | -0.010571 | 0.077821 | -0.079321 | 0.064655 | -0.553519 | -0.153518 |
| 6 | 14 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 34 | short | -0.016193 | +0.015501 | 58.823529 | +4.278074 | 0.009175 | 0.279884 | -0.107675 | 0.065938 | -0.337350 | -0.057855 |
| 6 | 15 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 20 | long | 0.004093 | +0.027704 | 55.000000 | +5.000000 | 0.017181 | 0.105882 | -0.061611 | 0.069032 | 0.172870 | 0.038655 |
| 6 | 16 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.002155 | +0.009559 | 30.000000 | -12.857143 | -0.014399 | 0.066985 | -0.053886 | 0.048423 | -0.101721 | -0.032167 |
| 12 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 59 | long | 0.037789 | -0.034429 | 57.627119 | -2.899197 | 0.022846 | 0.110002 | -0.049072 | 0.110645 | 2.638667 | 0.343525 |
| 12 | 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.032506 | -0.030360 | 66.666667 | +1.666667 | 0.042167 | 0.087465 | -0.059820 | 0.091243 | 2.493095 | 0.371649 |
| 12 | 3 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 7 | short | -0.060194 | -0.071134 | 0.000000 | -25.000000 | -0.040499 | 0.072885 | -0.093958 | 0.075174 | -2.185064 | -0.825877 |
| 12 | 4 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 7 | short | -0.042497 | -0.157428 | 42.857143 | -57.142857 | -0.025806 | 0.076035 | -0.088008 | 0.065928 | -1.478743 | -0.558912 |
| 12 | 5 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.057721 | -0.067803 | 50.000000 | 0.000000 | -0.020243 | 0.143521 | -0.172455 | 0.064200 | -1.393177 | -0.402176 |
| 12 | 6 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.111738 | +0.006122 | 30.000000 | +15.714286 | -0.019895 | 0.273197 | -0.161157 | 0.037618 | -1.293382 | -0.409003 |
| 12 | 7 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.025506 | -0.008021 | 63.636364 | +20.779221 | 0.012045 | 0.083208 | -0.062229 | 0.082542 | 1.016673 | 0.306538 |
| 12 | 8 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 34 | short | -0.051985 | -0.085620 | 55.882353 | -12.299465 | 0.012493 | 0.329925 | -0.142329 | 0.068768 | -0.918753 | -0.157565 |
| 12 | 9 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 22 | short | -0.018976 | +0.003606 | 50.000000 | -4.545455 | 0.002648 | 0.108311 | -0.113912 | 0.076237 | -0.821741 | -0.175196 |
| 12 | 10 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 20 | long | 0.017732 | -0.034804 | 60.000000 | -10.000000 | 0.033911 | 0.097190 | -0.070787 | 0.089649 | 0.815942 | 0.182450 |
| 12 | 11 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 13 | long | 0.020316 | +0.064896 | 61.538462 | +41.538462 | 0.016693 | 0.090110 | -0.103450 | 0.098148 | 0.812922 | 0.225464 |
| 12 | 12 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 34 | short | -0.037868 | -0.016740 | 58.823529 | -0.267380 | 0.034753 | 0.383435 | -0.155475 | 0.098691 | -0.575862 | -0.098759 |
| 12 | 13 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 20 | long | 0.020812 | -0.048334 | 60.000000 | -10.000000 | 0.033798 | 0.167384 | -0.083276 | 0.111380 | 0.556050 | 0.124337 |
| 12 | 14 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 19 | long | 0.015603 | +0.028151 | 36.842105 | +6.072874 | -0.032293 | 0.192333 | -0.110541 | 0.115511 | 0.353610 | 0.081124 |
| 12 | 15 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 10 | long | 0.011230 | +0.023510 | 40.000000 | -17.142857 | -0.008328 | 0.103275 | -0.061022 | 0.063408 | 0.343867 | 0.108740 |
| 12 | 16 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 27 | short | -0.005493 | -0.045564 | 44.444444 | -17.094018 | -0.022555 | 0.180295 | -0.142186 | 0.099000 | -0.158297 | -0.030464 |
| 24 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 59 | long | 0.065787 | -0.010039 | 67.796610 | +2.007136 | 0.038535 | 0.162739 | -0.072214 | 0.163591 | 3.105120 | 0.404252 |
| 24 | 2 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 7 | short | -0.050652 | -0.067409 | 14.285714 | -60.714286 | -0.035100 | 0.052197 | -0.151800 | 0.075576 | -2.567478 | -0.970415 |
| 24 | 3 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 19 | long | 0.158295 | +0.040799 | 63.157895 | +9.311741 | 0.050416 | 0.305529 | -0.140344 | 0.229997 | 2.258352 | 0.518102 |
| 24 | 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.036999 | -0.015240 | 66.666667 | +11.666667 | 0.039642 | 0.114101 | -0.081607 | 0.117895 | 2.175262 | 0.324269 |
| 24 | 5 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 13 | long | 0.058119 | +0.078772 | 61.538462 | +1.538462 | 0.083657 | 0.116270 | -0.118877 | 0.142870 | 1.802279 | 0.499862 |
| 24 | 6 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 34 | short | -0.112004 | -0.172360 | 52.941176 | -10.695188 | 0.006875 | 0.411557 | -0.248014 | 0.094465 | -1.586876 | -0.272147 |
| 24 | 7 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.118167 | -0.181905 | 72.727273 | -12.987013 | 0.030515 | 0.268793 | -0.104926 | 0.217490 | 1.458051 | 0.439619 |
| 24 | 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 20 | long | 0.039490 | +0.016447 | 55.000000 | -5.000000 | 0.060526 | 0.133633 | -0.099001 | 0.130801 | 1.321567 | 0.295511 |
| 24 | 9 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 7 | short | -0.070815 | -0.132232 | 42.857143 | -7.142857 | -0.005573 | 0.147921 | -0.163458 | 0.074893 | -1.266621 | -0.478738 |
| 24 | 10 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 10 | long | 0.114441 | -0.018353 | 60.000000 | +2.857143 | 0.021743 | 0.287283 | -0.093308 | 0.185617 | 1.259713 | 0.398356 |
| 24 | 11 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 34 | short | -0.083204 | -0.073156 | 47.058824 | -7.486631 | -0.009531 | 0.445302 | -0.230054 | 0.132381 | -1.089505 | -0.186849 |
| 24 | 12 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.042161 | -0.056838 | 50.000000 | 0.000000 | 0.012721 | 0.174108 | -0.190639 | 0.090183 | -0.838851 | -0.242156 |
| 24 | 13 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 21 | short | -0.027425 | -0.033322 | 47.619048 | -6.926407 | -0.005399 | 0.167422 | -0.133404 | 0.103230 | -0.750659 | -0.163807 |
| 24 | 14 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 20 | long | 0.028220 | -0.046874 | 60.000000 | -20.000000 | 0.064168 | 0.196464 | -0.117622 | 0.143092 | 0.642384 | 0.143641 |
| 24 | 15 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.027122 | +0.048306 | 60.000000 | +17.142857 | 0.021108 | 0.172688 | -0.176559 | 0.073473 | -0.496667 | -0.157060 |
| 24 | 16 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 27 | short | -0.011209 | -0.041714 | 48.148148 | -21.082621 | -0.010624 | 0.166574 | -0.180261 | 0.123986 | -0.349642 | -0.067289 |

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 59 | long | 0.034150 | 71.186441 | 3.961583 |
| 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.024268 | 66.666667 | 2.664579 |
| 3 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 28 | short | -0.033016 | 35.714286 | -1.711857 |
| 4 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 20 | long | 0.017182 | 55.000000 | 1.568933 |
| 5 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.028767 | 71.428571 | 1.479463 |
| 6 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 22 | short | -0.015085 | 40.909091 | -1.368418 |
| 7 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.030291 | 33.333333 | -1.179565 |
| 8 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 19 | short | -0.011187 | 42.105263 | -1.152570 |
| 9 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.018384 | 54.545455 | 1.099662 |
| 10 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 20 | long | 0.012626 | 65.000000 | 0.992788 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 59 | long | 0.038723 | 72.881356 | 4.022062 |
| 2 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.031118 | 63.636364 | 1.803425 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.016970 | 71.111111 | 1.459480 |
| 4 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 20 | long | 0.022054 | 55.000000 | 1.261120 |
| 5 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.041550 | 33.333333 | -1.236901 |
| 6 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.014682 | 71.428571 | 1.190413 |
| 7 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 28 | short | -0.027340 | 32.142857 | -1.185857 |
| 8 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.014185 | 57.142857 | 1.094230 |
| 9 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 34 | short | -0.044302 | 55.882353 | -0.956128 |
| 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 22 | short | -0.026822 | 45.454545 | -0.944458 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 59 | long | 0.037789 | 57.627119 | 2.638667 |
| 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.032506 | 66.666667 | 2.493095 |
| 3 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 7 | short | -0.060194 | 0.000000 | -2.185064 |
| 4 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 7 | short | -0.042497 | 42.857143 | -1.478743 |
| 5 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.057721 | 50.000000 | -1.393177 |
| 6 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.111738 | 30.000000 | -1.293382 |
| 7 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.025506 | 63.636364 | 1.016673 |
| 8 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 34 | short | -0.051985 | 55.882353 | -0.918753 |
| 9 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 22 | short | -0.018976 | 50.000000 | -0.821741 |
| 10 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 20 | long | 0.017732 | 60.000000 | 0.815942 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 59 | long | 0.065787 | 67.796610 | 3.105120 |
| 2 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 7 | short | -0.050652 | 14.285714 | -2.567478 |
| 3 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 19 | long | 0.158295 | 63.157895 | 2.258352 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.036999 | 66.666667 | 2.175262 |
| 5 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 13 | long | 0.058119 | 61.538462 | 1.802279 |
| 6 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 34 | short | -0.112004 | 52.941176 | -1.586876 |
| 7 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.118167 | 72.727273 | 1.458051 |
| 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 20 | long | 0.039490 | 55.000000 | 1.321567 |
| 9 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 7 | short | -0.070815 | 42.857143 | -1.266621 |
| 10 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 10 | long | 0.114441 | 60.000000 | 1.259713 |

## fast fast / base context

- Study ID: `803e557f-deb7-45c9-954b-e13ad0bed2b2`
- Variant: `horizon-fast-fast-base-context`
- Description: timeHorizon grid: 1m=6, 2m=6, 5m=8, 15m=8.
- Observed transitions: 339
- Result rows: 64
- Occurrence rows: 1348
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Family Summary By Horizon

| Horizon | Family | Patterns | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | ---: | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | 1 | 61 | 0.030357 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.534065 | long |
| 3 | bear_confluence | 1 | 22 | -0.021027 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.894347 | short |
| 3 | fast_bullish_reversal | 1 | 19 | 0.010893 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.800253 | long |
| 3 | fast_bearish_reversal | 1 | 37 | 0.014114 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.897282 | long |
| 3 | mixed_divergence | 12 | 200 | 0.000772 | `1m:sell|2m:buy|5m:buy|15m:buy` | 2.635271 | long |
| 3 | inactive | 0 | 0 |  | `` |  |  |
| 6 | bull_confluence | 1 | 61 | 0.038001 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.901758 | long |
| 6 | bear_confluence | 1 | 21 | -0.021360 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.728913 | short |
| 6 | fast_bullish_reversal | 1 | 19 | 0.025382 | `1m:buy|2m:buy|5m:sell|15m:sell` | 1.518452 | long |
| 6 | fast_bearish_reversal | 1 | 37 | -0.011913 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.268195 | short |
| 6 | mixed_divergence | 12 | 200 | -0.011811 | `1m:sell|2m:sell|5m:sell|15m:buy` | 2.661397 | short |
| 6 | inactive | 0 | 0 |  | `` |  |  |
| 12 | bull_confluence | 1 | 61 | 0.040598 | `1m:buy|2m:buy|5m:buy|15m:buy` | 2.748549 | long |
| 12 | bear_confluence | 1 | 20 | 0.008247 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.184481 | long |
| 12 | fast_bullish_reversal | 1 | 19 | 0.063894 | `1m:buy|2m:buy|5m:sell|15m:sell` | 2.255930 | long |
| 12 | fast_bearish_reversal | 1 | 37 | -0.024595 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.388802 | short |
| 12 | mixed_divergence | 12 | 199 | -0.016745 | `1m:buy|2m:sell|5m:buy|15m:sell` | 5.291004 | short |
| 12 | inactive | 0 | 0 |  | `` |  |  |
| 24 | bull_confluence | 1 | 61 | 0.066886 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.104379 | long |
| 24 | bear_confluence | 1 | 20 | 0.011588 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.323360 | long |
| 24 | fast_bullish_reversal | 1 | 19 | 0.105624 | `1m:buy|2m:buy|5m:sell|15m:sell` | 3.083977 | long |
| 24 | fast_bearish_reversal | 1 | 37 | -0.056126 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.762317 | short |
| 24 | mixed_divergence | 12 | 198 | -0.001396 | `1m:sell|2m:buy|5m:buy|15m:sell` | 3.211292 | long |
| 24 | inactive | 0 | 0 |  | `` |  |  |

### All Observed Combination Outcomes

| Horizon | Rank | Pattern | Family | n | Bias | Mean% | Delta Mean% | Win% | Delta Win% | Median% | Std% | MAE% | MFE% | t-stat | Score |
| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 61 | long | 0.030357 | -0.014442 | 65.573770 | -2.847283 | 0.011435 | 0.067090 | -0.021863 | 0.063561 | 3.534065 | 0.452491 |
| 3 | 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.024622 | +0.002349 | 64.444444 | -10.555556 | 0.015973 | 0.062677 | -0.032134 | 0.052402 | 2.635271 | 0.392843 |
| 3 | 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.029022 | -0.077248 | 16.666667 | -58.333333 | -0.032633 | 0.031912 | -0.064917 | 0.026504 | -2.227644 | -0.909432 |
| 3 | 4 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 20 | short | -0.026901 | -0.000290 | 35.000000 | +4.230769 | -0.021378 | 0.059122 | -0.065515 | 0.026385 | -2.034838 | -0.455004 |
| 3 | 5 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 15 | long | 0.019549 | -0.014199 | 53.333333 | -6.666667 | 0.040195 | 0.056166 | -0.039580 | 0.048762 | 1.348023 | 0.348058 |
| 3 | 6 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 12 | long | 0.019368 | +0.007302 | 58.333333 | +1.190476 | 0.006948 | 0.051864 | -0.020323 | 0.040651 | 1.293608 | 0.373432 |
| 3 | 7 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.029751 | +0.016156 | 50.000000 | 0.000000 | 0.006361 | 0.110232 | -0.084904 | 0.030848 | -0.934946 | -0.269896 |
| 3 | 8 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 37 | long | 0.014114 | -0.008520 | 54.054054 | -0.491401 | 0.001383 | 0.095679 | -0.054144 | 0.047472 | 0.897282 | 0.147512 |
| 3 | 9 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 22 | short | -0.021027 | +0.000586 | 45.454545 | -7.878788 | -0.005348 | 0.110275 | -0.090978 | 0.064562 | -0.894347 | -0.190676 |
| 3 | 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 16 | short | -0.011742 | +0.032522 | 43.750000 | +7.386364 | -0.006417 | 0.056860 | -0.052230 | 0.042220 | -0.826019 | -0.206505 |
| 3 | 11 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 19 | long | 0.010893 | -0.000405 | 57.894737 | -2.105263 | 0.019706 | 0.059332 | -0.038367 | 0.058677 | 0.800253 | 0.183591 |
| 3 | 12 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 36 | short | -0.009633 | -0.014890 | 38.888889 | -2.020202 | -0.010854 | 0.074210 | -0.050366 | 0.033781 | -0.778840 | -0.129807 |
| 3 | 13 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.007661 | +0.011228 | 45.454545 | +16.883116 | -0.004068 | 0.038968 | -0.020849 | 0.038864 | 0.652012 | 0.196589 |
| 3 | 14 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.003045 | +0.006202 | 53.846154 | +10.989011 | 0.000693 | 0.022103 | -0.034056 | 0.023882 | -0.496769 | -0.137779 |
| 3 | 15 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.007602 | +0.003933 | 42.857143 | +17.857143 | -0.018282 | 0.059644 | -0.053419 | 0.070884 | 0.337216 | 0.127456 |
| 3 | 16 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.003822 | -0.028196 | 71.428571 | -8.571429 | 0.018282 | 0.046869 | -0.038666 | 0.043646 | 0.215729 | 0.081538 |
| 6 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 61 | long | 0.038001 | -0.007247 | 68.852459 | +8.326143 | 0.017758 | 0.076067 | -0.030379 | 0.085692 | 3.901758 | 0.499569 |
| 6 | 2 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 20 | short | -0.033254 | +0.003812 | 25.000000 | +1.923077 | -0.033904 | 0.055879 | -0.090803 | 0.032981 | -2.661397 | -0.595107 |
| 6 | 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.018803 | -0.020929 | 71.111111 | -8.888889 | 0.019355 | 0.078344 | -0.047195 | 0.067702 | 1.610038 | 0.240010 |
| 6 | 4 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 19 | long | 0.025382 | +0.048993 | 52.631579 | +2.631579 | 0.026054 | 0.072863 | -0.048189 | 0.075550 | 1.518452 | 0.348357 |
| 6 | 5 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.036320 | -0.024606 | 45.454545 | +2.597402 | -0.009814 | 0.107586 | -0.068958 | 0.045813 | -1.119670 | -0.337593 |
| 6 | 6 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.032631 | -0.115501 | 50.000000 | -25.000000 | -0.017837 | 0.075283 | -0.094533 | 0.048481 | -1.061720 | -0.433446 |
| 6 | 7 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 36 | short | -0.041040 | -0.099277 | 55.555556 | -17.171717 | 0.002850 | 0.262731 | -0.114313 | 0.048608 | -0.937241 | -0.156207 |
| 6 | 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 15 | long | 0.016455 | -0.016572 | 53.333333 | -6.666667 | 0.025342 | 0.083922 | -0.052910 | 0.071448 | 0.759406 | 0.196078 |
| 6 | 9 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 21 | short | -0.021360 | -0.008333 | 38.095238 | -11.904762 | -0.022251 | 0.134289 | -0.119173 | 0.078645 | -0.728913 | -0.159062 |
| 6 | 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 16 | short | -0.024211 | +0.004105 | 43.750000 | +16.477273 | -0.000371 | 0.150506 | -0.095721 | 0.066369 | -0.643446 | -0.160862 |
| 6 | 11 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.017741 | +0.021742 | 41.666667 | -8.333333 | -0.017682 | 0.097973 | -0.111206 | 0.057767 | -0.627297 | -0.181085 |
| 6 | 12 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | short | -0.020949 | -0.059383 | 28.571429 | -51.428571 | -0.010571 | 0.093186 | -0.070711 | 0.061061 | -0.594775 | -0.224804 |
| 6 | 13 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.007710 | +0.072787 | 53.846154 | +39.560440 | 0.001481 | 0.051852 | -0.048871 | 0.027560 | -0.536130 | -0.148696 |
| 6 | 14 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 12 | long | 0.006628 | +0.001861 | 50.000000 | +7.142857 | -0.001568 | 0.058810 | -0.035402 | 0.062209 | 0.390380 | 0.112693 |
| 6 | 15 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 37 | short | -0.011913 | +0.019781 | 56.756757 | +2.211302 | 0.008692 | 0.270193 | -0.106467 | 0.067131 | -0.268195 | -0.044091 |
| 6 | 16 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.007185 | -0.024424 | 57.142857 | -17.857143 | 0.006288 | 0.072395 | -0.076222 | 0.082786 | 0.262589 | 0.099249 |
| 12 | 1 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.118343 | -0.233274 | 0.000000 | -100.000000 | -0.131027 | 0.054787 | -0.155692 | 0.048481 | -5.291004 | -2.160043 |
| 12 | 2 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 61 | long | 0.040598 | -0.031620 | 57.377049 | -3.149267 | 0.021628 | 0.115363 | -0.050916 | 0.110910 | 2.748549 | 0.351916 |
| 12 | 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.034921 | -0.027945 | 68.888889 | +3.888889 | 0.042167 | 0.087668 | -0.060709 | 0.090665 | 2.672069 | 0.398329 |
| 12 | 4 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 19 | long | 0.063894 | -0.005252 | 78.947368 | +8.947368 | 0.049968 | 0.123456 | -0.063996 | 0.130241 | 2.255930 | 0.517546 |
| 12 | 5 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.051877 | -0.039597 | 27.272727 | -29.870130 | -0.014813 | 0.138054 | -0.086031 | 0.046718 | -1.246295 | -0.375772 |
| 12 | 6 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 36 | short | -0.071555 | -0.105190 | 55.555556 | -12.626262 | 0.012493 | 0.347998 | -0.160164 | 0.068662 | -1.233708 | -0.205618 |
| 12 | 7 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 12 | short | -0.046069 | -0.079596 | 41.666667 | -1.190476 | -0.032316 | 0.155901 | -0.105423 | 0.067502 | -1.023640 | -0.295499 |
| 12 | 8 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 20 | short | -0.020942 | -0.008394 | 30.000000 | -0.769231 | -0.035444 | 0.115887 | -0.118184 | 0.067980 | -0.808146 | -0.180707 |
| 12 | 9 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.039644 | -0.050584 | 16.666667 | -8.333333 | -0.054381 | 0.122253 | -0.101689 | 0.091708 | -0.794329 | -0.324283 |
| 12 | 10 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.023682 | +0.068262 | 71.428571 | +51.428571 | 0.039465 | 0.089838 | -0.087831 | 0.073634 | 0.697431 | 0.263604 |
| 12 | 11 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 15 | long | 0.017951 | -0.034585 | 53.333333 | -16.666667 | 0.025327 | 0.119798 | -0.085616 | 0.083550 | 0.580357 | 0.149848 |
| 12 | 12 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 16 | short | -0.014989 | +0.007593 | 56.250000 | +1.704545 | 0.019771 | 0.109774 | -0.114702 | 0.087122 | -0.546164 | -0.136541 |
| 12 | 13 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 37 | short | -0.024595 | -0.003467 | 56.756757 | -2.334152 | 0.032639 | 0.384784 | -0.152947 | 0.114750 | -0.388802 | -0.063919 |
| 12 | 14 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.005379 | +0.112481 | 46.153846 | +31.868132 | 0.000000 | 0.079065 | -0.068421 | 0.044717 | -0.245278 | -0.068028 |
| 12 | 15 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 20 | long | 0.008247 | -0.031824 | 50.000000 | -11.538462 | -0.001304 | 0.199925 | -0.148126 | 0.121713 | 0.184481 | 0.041251 |
| 12 | 16 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 12 | long | 0.003110 | -0.006972 | 58.333333 | +8.333333 | 0.004353 | 0.061867 | -0.124028 | 0.089842 | 0.174156 | 0.050274 |
| 24 | 1 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.068449 | +0.089102 | 85.714286 | +25.714286 | 0.083657 | 0.056395 | -0.088734 | 0.135448 | 3.211292 | 1.213754 |
| 24 | 2 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 61 | long | 0.066886 | -0.008940 | 65.573770 | -0.215704 | 0.035936 | 0.168278 | -0.073447 | 0.164689 | 3.104379 | 0.397475 |
| 24 | 3 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 19 | long | 0.105624 | +0.030530 | 84.210526 | +4.210526 | 0.082342 | 0.149289 | -0.081561 | 0.180633 | 3.083977 | 0.707513 |
| 24 | 4 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.145406 | -0.206823 | 20.000000 | -30.000000 | -0.155055 | 0.114870 | -0.233927 | 0.051429 | -2.830469 | -1.265824 |
| 24 | 5 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.039963 | -0.012276 | 68.888889 | +13.888889 | 0.039642 | 0.114472 | -0.082095 | 0.121234 | 2.341880 | 0.349107 |
| 24 | 6 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 36 | short | -0.113928 | -0.174284 | 52.777778 | -10.858586 | 0.006875 | 0.407294 | -0.260133 | 0.097784 | -1.678315 | -0.279719 |
| 24 | 7 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.035674 | -0.052431 | 33.333333 | -41.666667 | -0.022862 | 0.064404 | -0.139475 | 0.104319 | -1.356775 | -0.553901 |
| 24 | 8 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 20 | long | 0.087852 | -0.029644 | 50.000000 | -3.846154 | 0.014016 | 0.295302 | -0.152739 | 0.170294 | 1.330461 | 0.297500 |
| 24 | 9 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | long | 0.015683 | +0.091111 | 61.538462 | +18.681319 | 0.019670 | 0.060542 | -0.085195 | 0.073039 | 0.933975 | 0.259038 |
| 24 | 10 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 12 | long | 0.022861 | +0.008184 | 50.000000 | 0.000000 | 0.012721 | 0.088415 | -0.143129 | 0.112661 | 0.895712 | 0.258570 |
| 24 | 11 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 16 | short | -0.038964 | -0.044861 | 50.000000 | -4.545455 | 0.005749 | 0.185677 | -0.146929 | 0.108373 | -0.839404 | -0.209851 |
| 24 | 12 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 37 | short | -0.056126 | -0.046078 | 48.648649 | -5.896806 | -0.005863 | 0.447850 | -0.226312 | 0.152003 | -0.762317 | -0.125324 |
| 24 | 13 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 15 | long | 0.018888 | -0.004155 | 53.333333 | -6.666667 | 0.047841 | 0.131908 | -0.118147 | 0.119463 | 0.554566 | 0.143188 |
| 24 | 14 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 12 | long | 0.034719 | -0.265353 | 50.000000 | -35.714286 | -0.004019 | 0.320008 | -0.148194 | 0.174599 | 0.375830 | 0.108493 |
| 24 | 15 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 20 | long | 0.011588 | -0.018917 | 55.000000 | -14.230769 | 0.014045 | 0.160269 | -0.184507 | 0.146604 | 0.323360 | 0.072306 |
| 24 | 16 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.016069 | -0.116725 | 36.363636 | -20.779221 | -0.048141 | 0.302441 | -0.127988 | 0.133628 | 0.176212 | 0.053130 |

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 61 | long | 0.030357 | 65.573770 | 3.534065 |
| 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.024622 | 64.444444 | 2.635271 |
| 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.029022 | 16.666667 | -2.227644 |
| 4 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 20 | short | -0.026901 | 35.000000 | -2.034838 |
| 5 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 15 | long | 0.019549 | 53.333333 | 1.348023 |
| 6 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 12 | long | 0.019368 | 58.333333 | 1.293608 |
| 7 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.029751 | 50.000000 | -0.934946 |
| 8 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 37 | long | 0.014114 | 54.054054 | 0.897282 |
| 9 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 22 | short | -0.021027 | 45.454545 | -0.894347 |
| 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 16 | short | -0.011742 | 43.750000 | -0.826019 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 61 | long | 0.038001 | 68.852459 | 3.901758 |
| 2 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 20 | short | -0.033254 | 25.000000 | -2.661397 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.018803 | 71.111111 | 1.610038 |
| 4 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 19 | long | 0.025382 | 52.631579 | 1.518452 |
| 5 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.036320 | 45.454545 | -1.119670 |
| 6 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.032631 | 50.000000 | -1.061720 |
| 7 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 36 | short | -0.041040 | 55.555556 | -0.937241 |
| 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 15 | long | 0.016455 | 53.333333 | 0.759406 |
| 9 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 21 | short | -0.021360 | 38.095238 | -0.728913 |
| 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 16 | short | -0.024211 | 43.750000 | -0.643446 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.118343 | 0.000000 | -5.291004 |
| 2 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 61 | long | 0.040598 | 57.377049 | 2.748549 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.034921 | 68.888889 | 2.672069 |
| 4 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 19 | long | 0.063894 | 78.947368 | 2.255930 |
| 5 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.051877 | 27.272727 | -1.246295 |
| 6 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 36 | short | -0.071555 | 55.555556 | -1.233708 |
| 7 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 12 | short | -0.046069 | 41.666667 | -1.023640 |
| 8 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 20 | short | -0.020942 | 30.000000 | -0.808146 |
| 9 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.039644 | 16.666667 | -0.794329 |
| 10 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.023682 | 71.428571 | 0.697431 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.068449 | 85.714286 | 3.211292 |
| 2 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 61 | long | 0.066886 | 65.573770 | 3.104379 |
| 3 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 19 | long | 0.105624 | 84.210526 | 3.083977 |
| 4 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.145406 | 20.000000 | -2.830469 |
| 5 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.039963 | 68.888889 | 2.341880 |
| 6 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 36 | short | -0.113928 | 52.777778 | -1.678315 |
| 7 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.035674 | 33.333333 | -1.356775 |
| 8 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 20 | long | 0.087852 | 50.000000 | 1.330461 |
| 9 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | long | 0.015683 | 61.538462 | 0.933975 |
| 10 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 12 | long | 0.022861 | 50.000000 | 0.895712 |

## fast fast / slow context

- Study ID: `4be96d7c-97f4-454c-bff6-cf27a88fa34a`
- Variant: `horizon-fast-fast-slow-context`
- Description: timeHorizon grid: 1m=6, 2m=6, 5m=12, 15m=12.
- Observed transitions: 329
- Result rows: 64
- Occurrence rows: 1310
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Family Summary By Horizon

| Horizon | Family | Patterns | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | ---: | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | 1 | 65 | 0.030373 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.928434 | long |
| 3 | bear_confluence | 1 | 11 | -0.024718 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.685160 | short |
| 3 | fast_bullish_reversal | 1 | 8 | 0.015789 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.819146 | long |
| 3 | fast_bearish_reversal | 1 | 45 | 0.002249 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.178031 | long |
| 3 | mixed_divergence | 12 | 200 | 0.000252 | `1m:sell|2m:buy|5m:buy|15m:buy` | 3.155133 | long |
| 3 | inactive | 0 | 0 |  | `` |  |  |
| 6 | bull_confluence | 1 | 65 | 0.033759 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.005566 | long |
| 6 | bear_confluence | 1 | 11 | -0.013231 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.277967 | short |
| 6 | fast_bullish_reversal | 1 | 8 | 0.022426 | `1m:buy|2m:buy|5m:sell|15m:sell` | 1.334738 | long |
| 6 | fast_bearish_reversal | 1 | 45 | -0.022992 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.638181 | short |
| 6 | mixed_divergence | 12 | 199 | -0.011858 | `1m:sell|2m:buy|5m:buy|15m:buy` | 1.924859 | long |
| 6 | inactive | 0 | 0 |  | `` |  |  |
| 12 | bull_confluence | 1 | 65 | 0.032362 | `1m:buy|2m:buy|5m:buy|15m:buy` | 2.439053 | long |
| 12 | bear_confluence | 1 | 11 | 0.063836 | `1m:sell|2m:sell|5m:sell|15m:sell` | 1.117893 | long |
| 12 | fast_bullish_reversal | 1 | 8 | 0.057735 | `1m:buy|2m:buy|5m:sell|15m:sell` | 2.854347 | long |
| 12 | fast_bearish_reversal | 1 | 44 | -0.030119 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.573519 | short |
| 12 | mixed_divergence | 12 | 199 | -0.016078 | `1m:sell|2m:buy|5m:buy|15m:buy` | 3.063419 | long |
| 12 | inactive | 0 | 0 |  | `` |  |  |
| 24 | bull_confluence | 1 | 65 | 0.064039 | `1m:buy|2m:buy|5m:buy|15m:buy` | 2.924164 | long |
| 24 | bear_confluence | 1 | 11 | 0.028761 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.510655 | long |
| 24 | fast_bullish_reversal | 1 | 8 | 0.068108 | `1m:buy|2m:buy|5m:sell|15m:sell` | 2.459881 | long |
| 24 | fast_bearish_reversal | 1 | 44 | 0.018499 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.297903 | long |
| 24 | mixed_divergence | 12 | 198 | -0.022331 | `1m:sell|2m:buy|5m:buy|15m:buy` | 2.751849 | long |
| 24 | inactive | 0 | 0 |  | `` |  |  |

### All Observed Combination Outcomes

| Horizon | Rank | Pattern | Family | n | Bias | Mean% | Delta Mean% | Win% | Delta Win% | Median% | Std% | MAE% | MFE% | t-stat | Score |
| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 65 | long | 0.030373 | -0.014426 | 64.615385 | -3.805668 | 0.012642 | 0.062335 | -0.020954 | 0.063485 | 3.928434 | 0.487262 |
| 3 | 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 49 | long | 0.028327 | +0.006054 | 67.346939 | -7.653061 | 0.023705 | 0.062846 | -0.030211 | 0.055988 | 3.155133 | 0.450733 |
| 3 | 3 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 40 | short | -0.012363 | -0.017620 | 32.500000 | -8.409091 | -0.016803 | 0.070580 | -0.053358 | 0.032964 | -1.107869 | -0.175169 |
| 3 | 4 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 18 | short | -0.007556 | +0.001691 | 44.444444 | +1.587301 | -0.010395 | 0.035216 | -0.041433 | 0.033058 | -0.910245 | -0.214547 |
| 3 | 5 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.026957 | +0.018950 | 50.000000 | 0.000000 | 0.006361 | 0.080387 | -0.066754 | 0.020142 | -0.821413 | -0.335341 |
| 3 | 6 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 8 | long | 0.015789 | +0.004491 | 50.000000 | -10.000000 | 0.001908 | 0.054519 | -0.021497 | 0.043981 | 0.819146 | 0.289612 |
| 3 | 7 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.020907 | -0.032973 | 46.153846 | -10.989011 | -0.002030 | 0.094812 | -0.066589 | 0.031205 | -0.795054 | -0.220508 |
| 3 | 8 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 11 | short | -0.024718 | -0.003105 | 45.454545 | -7.878788 | -0.002832 | 0.119652 | -0.098244 | 0.070348 | -0.685160 | -0.206583 |
| 3 | 9 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 24 | short | -0.010822 | +0.015789 | 50.000000 | +19.230769 | -0.000681 | 0.087417 | -0.068994 | 0.049186 | -0.606486 | -0.123799 |
| 3 | 10 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.026525 | +0.022856 | 50.000000 | +25.000000 | 0.026525 | 0.063366 | -0.061130 | 0.055279 | 0.591979 | 0.418592 |
| 3 | 11 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 20 | long | 0.006873 | +0.010440 | 60.000000 | +31.428571 | 0.022723 | 0.052445 | -0.037936 | 0.053429 | 0.586083 | 0.131052 |
| 3 | 12 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | short | -0.020868 | -0.069094 | 50.000000 | -25.000000 | -0.020868 | 0.050979 | -0.084623 | 0.014800 | -0.578889 | -0.409336 |
| 3 | 13 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | short | -0.007140 | -0.040888 | 30.000000 | -30.000000 | -0.004979 | 0.047611 | -0.048931 | 0.030265 | -0.474248 | -0.149970 |
| 3 | 14 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 10 | short | -0.009113 | +0.035151 | 60.000000 | +23.636364 | 0.006610 | 0.063149 | -0.043239 | 0.039879 | -0.456356 | -0.144312 |
| 3 | 15 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 45 | long | 0.002249 | -0.020385 | 46.666667 | -7.878788 | -0.003473 | 0.084746 | -0.058394 | 0.042061 | 0.178031 | 0.026539 |
| 3 | 16 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | neutral | -0.000013 | -0.032031 | 66.666667 | -13.333333 | 0.016171 | 0.050125 | -0.043010 | 0.034477 | -0.000652 | -0.000266 |
| 6 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 65 | long | 0.033759 | -0.011489 | 67.692308 | +7.165992 | 0.017515 | 0.067950 | -0.031279 | 0.083619 | 4.005566 | 0.496829 |
| 6 | 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 49 | long | 0.020981 | -0.018751 | 71.428571 | -8.571429 | 0.019770 | 0.076299 | -0.044569 | 0.070320 | 1.924859 | 0.274980 |
| 6 | 3 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 8 | long | 0.022426 | +0.046037 | 50.000000 | 0.000000 | 0.012349 | 0.047523 | -0.029700 | 0.055326 | 1.334738 | 0.471901 |
| 6 | 4 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | short | -0.025713 | -0.058740 | 30.000000 | -30.000000 | -0.018973 | 0.061359 | -0.068926 | 0.038982 | -1.325167 | -0.419055 |
| 6 | 5 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.042057 | -0.080491 | 16.666667 | -63.333333 | -0.024267 | 0.081716 | -0.080395 | 0.047753 | -1.260688 | -0.514674 |
| 6 | 6 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.044986 | -0.005503 | 33.333333 | -16.666667 | -0.043867 | 0.096215 | -0.100586 | 0.046022 | -1.145282 | -0.467559 |
| 6 | 7 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 40 | short | -0.044867 | -0.103104 | 52.500000 | -20.227273 | 0.001400 | 0.249735 | -0.117645 | 0.046907 | -1.136267 | -0.179660 |
| 6 | 8 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 23 | short | -0.019468 | +0.017598 | 34.782609 | +11.705686 | -0.016608 | 0.082396 | -0.088435 | 0.055591 | -1.133119 | -0.236272 |
| 6 | 9 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 10 | short | -0.058117 | -0.029801 | 40.000000 | +12.727273 | -0.000371 | 0.162568 | -0.094266 | 0.049675 | -1.130493 | -0.357493 |
| 6 | 10 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 18 | long | 0.012155 | +0.092652 | 55.555556 | +41.269842 | 0.002246 | 0.072917 | -0.055074 | 0.053170 | 0.707240 | 0.166698 |
| 6 | 11 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 45 | short | -0.022992 | +0.008702 | 51.111111 | -3.434344 | 0.005946 | 0.241680 | -0.107682 | 0.058957 | -0.638181 | -0.095134 |
| 6 | 12 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.039645 | +0.008036 | 50.000000 | -25.000000 | 0.039645 | 0.089883 | -0.061130 | 0.077285 | 0.623771 | 0.441073 |
| 6 | 13 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.006178 | -0.010945 | 46.153846 | +3.296703 | -0.026350 | 0.077957 | -0.086669 | 0.059109 | -0.285734 | -0.079248 |
| 6 | 14 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 11 | short | -0.013231 | -0.000204 | 45.454545 | -4.545455 | -0.005649 | 0.157869 | -0.128902 | 0.086234 | -0.277967 | -0.083810 |
| 6 | 15 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | short | -0.022381 | -0.105251 | 50.000000 | -25.000000 | -0.022381 | 0.115377 | -0.105112 | 0.042883 | -0.274331 | -0.193981 |
| 6 | 16 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 20 | long | 0.002106 | +0.013820 | 55.000000 | +12.142857 | 0.013032 | 0.110112 | -0.062864 | 0.072655 | 0.085524 | 0.019124 |
| 12 | 1 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 49 | long | 0.037512 | -0.025354 | 69.387755 | +4.387755 | 0.042167 | 0.085717 | -0.056980 | 0.092638 | 3.063419 | 0.437631 |
| 12 | 2 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 8 | long | 0.057735 | -0.011411 | 75.000000 | +5.000000 | 0.064159 | 0.057210 | -0.035683 | 0.091964 | 2.854347 | 1.009164 |
| 12 | 3 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 65 | long | 0.032362 | -0.039856 | 55.384615 | -5.141701 | 0.008391 | 0.106971 | -0.051923 | 0.104994 | 2.439053 | 0.302527 |
| 12 | 4 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 23 | short | -0.052303 | -0.039755 | 21.739130 | -9.030101 | -0.059514 | 0.129245 | -0.124072 | 0.070564 | -1.940782 | -0.404681 |
| 12 | 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 40 | short | -0.084022 | -0.117657 | 45.000000 | -23.181818 | -0.028341 | 0.330133 | -0.169485 | 0.066165 | -1.609655 | -0.254509 |
| 12 | 6 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.025912 | -0.035994 | 33.333333 | -16.666667 | -0.025447 | 0.043888 | -0.111916 | 0.049250 | -1.446223 | -0.590418 |
| 12 | 7 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | short | -0.098276 | -0.213207 | 0.000000 | -100.000000 | -0.098276 | 0.102488 | -0.137365 | 0.042883 | -1.356092 | -0.958902 |
| 12 | 8 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 11 | long | 0.063836 | +0.023765 | 54.545455 | -6.993007 | 0.001408 | 0.189391 | -0.132888 | 0.128426 | 1.117893 | 0.337057 |
| 12 | 9 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | short | -0.027756 | -0.080292 | 40.000000 | -30.000000 | -0.015481 | 0.094943 | -0.104283 | 0.047024 | -0.924465 | -0.292341 |
| 12 | 10 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.077091 | +0.066151 | 50.000000 | +25.000000 | 0.077091 | 0.124926 | -0.061130 | 0.099292 | 0.872702 | 0.617093 |
| 12 | 11 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.025380 | -0.058907 | 61.538462 | +18.681319 | 0.009818 | 0.149379 | -0.142934 | 0.095904 | -0.612597 | -0.169904 |
| 12 | 12 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 44 | short | -0.030119 | -0.008991 | 54.545455 | -4.545454 | 0.027079 | 0.348351 | -0.150961 | 0.104575 | -0.573519 | -0.086461 |
| 12 | 13 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 20 | long | 0.020621 | +0.032901 | 60.000000 | +2.857143 | 0.035173 | 0.167185 | -0.083934 | 0.111937 | 0.551595 | 0.123340 |
| 12 | 14 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 10 | short | -0.013786 | +0.008796 | 60.000000 | +5.454545 | 0.019771 | 0.112094 | -0.110792 | 0.065921 | -0.388903 | -0.122982 |
| 12 | 15 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 18 | long | 0.002417 | +0.120277 | 55.555556 | +41.269842 | 0.014746 | 0.076975 | -0.070189 | 0.071082 | 0.133206 | 0.031397 |
| 12 | 16 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | long | 0.002267 | +0.046847 | 66.666667 | +46.666667 | 0.038718 | 0.076374 | -0.100368 | 0.053970 | 0.072719 | 0.029687 |
| 24 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 65 | long | 0.064039 | -0.011787 | 64.615385 | -1.174089 | 0.035936 | 0.176563 | -0.078264 | 0.161340 | 2.924164 | 0.362698 |
| 24 | 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 49 | long | 0.044375 | -0.007864 | 71.428571 | +16.428571 | 0.039642 | 0.112879 | -0.080479 | 0.129466 | 2.751849 | 0.393121 |
| 24 | 3 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | long | 0.060597 | +0.081250 | 83.333333 | +23.333333 | 0.067190 | 0.057433 | -0.101423 | 0.102847 | 2.584450 | 1.055097 |
| 24 | 4 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 8 | long | 0.068108 | -0.006986 | 87.500000 | +7.500000 | 0.080222 | 0.078312 | -0.046821 | 0.140531 | 2.459881 | 0.869699 |
| 24 | 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 39 | short | -0.097977 | -0.158333 | 48.717949 | -14.918415 | 0.000000 | 0.365241 | -0.237502 | 0.092555 | -1.675237 | -0.268253 |
| 24 | 6 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 23 | short | -0.086927 | -0.204423 | 34.782609 | -19.063545 | -0.056087 | 0.267458 | -0.229559 | 0.085346 | -1.558695 | -0.325010 |
| 24 | 7 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 20 | long | 0.057906 | -0.074888 | 65.000000 | +7.857143 | 0.074449 | 0.197308 | -0.105726 | 0.149620 | 1.312487 | 0.293481 |
| 24 | 8 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 18 | short | -0.074457 | +0.000971 | 50.000000 | +7.142857 | -0.002428 | 0.255055 | -0.175818 | 0.091719 | -1.238536 | -0.291926 |
| 24 | 9 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.024429 | -0.039106 | 16.666667 | -33.333333 | -0.022629 | 0.064523 | -0.150118 | 0.062344 | -0.927391 | -0.378606 |
| 24 | 10 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | short | -0.039840 | -0.101257 | 50.000000 | 0.000000 | -0.039840 | 0.062783 | -0.154442 | 0.042883 | -0.897419 | -0.634571 |
| 24 | 11 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | short | -0.026623 | -0.049666 | 40.000000 | -20.000000 | -0.027454 | 0.130804 | -0.146336 | 0.081627 | -0.643623 | -0.203532 |
| 24 | 12 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.025737 | -0.325809 | 53.846154 | -31.868132 | 0.028482 | 0.172828 | -0.163865 | 0.115990 | -0.536927 | -0.148917 |
| 24 | 13 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 11 | long | 0.028761 | -0.001744 | 54.545455 | -14.685314 | 0.030966 | 0.186797 | -0.152339 | 0.159926 | 0.510655 | 0.153968 |
| 24 | 14 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 44 | long | 0.018499 | +0.028547 | 54.545455 | 0.000000 | 0.040204 | 0.411908 | -0.191030 | 0.172777 | 0.297903 | 0.044911 |
| 24 | 15 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 10 | short | -0.013337 | -0.019234 | 60.000000 | +5.454545 | 0.026290 | 0.196161 | -0.125729 | 0.096971 | -0.214997 | -0.067988 |
| 24 | 16 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.001732 | -0.015025 | 50.000000 | -25.000000 | 0.001732 | 0.017474 | -0.089292 | 0.108288 | 0.140175 | 0.099119 |

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 65 | long | 0.030373 | 64.615385 | 3.928434 |
| 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 49 | long | 0.028327 | 67.346939 | 3.155133 |
| 3 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 40 | short | -0.012363 | 32.500000 | -1.107869 |
| 4 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 18 | short | -0.007556 | 44.444444 | -0.910245 |
| 5 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.026957 | 50.000000 | -0.821413 |
| 6 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 8 | long | 0.015789 | 50.000000 | 0.819146 |
| 7 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.020907 | 46.153846 | -0.795054 |
| 8 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 11 | short | -0.024718 | 45.454545 | -0.685160 |
| 9 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 24 | short | -0.010822 | 50.000000 | -0.606486 |
| 10 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.026525 | 50.000000 | 0.591979 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 65 | long | 0.033759 | 67.692308 | 4.005566 |
| 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 49 | long | 0.020981 | 71.428571 | 1.924859 |
| 3 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 8 | long | 0.022426 | 50.000000 | 1.334738 |
| 4 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | short | -0.025713 | 30.000000 | -1.325167 |
| 5 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.042057 | 16.666667 | -1.260688 |
| 6 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.044986 | 33.333333 | -1.145282 |
| 7 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 40 | short | -0.044867 | 52.500000 | -1.136267 |
| 8 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 23 | short | -0.019468 | 34.782609 | -1.133119 |
| 9 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 10 | short | -0.058117 | 40.000000 | -1.130493 |
| 10 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 18 | long | 0.012155 | 55.555556 | 0.707240 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 49 | long | 0.037512 | 69.387755 | 3.063419 |
| 2 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 8 | long | 0.057735 | 75.000000 | 2.854347 |
| 3 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 65 | long | 0.032362 | 55.384615 | 2.439053 |
| 4 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 23 | short | -0.052303 | 21.739130 | -1.940782 |
| 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 40 | short | -0.084022 | 45.000000 | -1.609655 |
| 6 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.025912 | 33.333333 | -1.446223 |
| 7 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | short | -0.098276 | 0.000000 | -1.356092 |
| 8 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 11 | long | 0.063836 | 54.545455 | 1.117893 |
| 9 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | short | -0.027756 | 40.000000 | -0.924465 |
| 10 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.077091 | 50.000000 | 0.872702 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 65 | long | 0.064039 | 64.615385 | 2.924164 |
| 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 49 | long | 0.044375 | 71.428571 | 2.751849 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | long | 0.060597 | 83.333333 | 2.584450 |
| 4 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 8 | long | 0.068108 | 87.500000 | 2.459881 |
| 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 39 | short | -0.097977 | 48.717949 | -1.675237 |
| 6 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 23 | short | -0.086927 | 34.782609 | -1.558695 |
| 7 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 20 | long | 0.057906 | 65.000000 | 1.312487 |
| 8 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 18 | short | -0.074457 | 50.000000 | -1.238536 |
| 9 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.024429 | 16.666667 | -0.927391 |
| 10 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | short | -0.039840 | 50.000000 | -0.897419 |

## base fast / tight context

- Study ID: `8b64d374-dd3d-4ec2-987d-e9b42a8ed1f8`
- Variant: `horizon-base-fast-tight-context`
- Description: timeHorizon grid: 1m=12, 2m=10, 5m=6, 15m=6.
- Observed transitions: 211
- Result rows: 64
- Occurrence rows: 844
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Family Summary By Horizon

| Horizon | Family | Patterns | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | ---: | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | 1 | 39 | 0.045347 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.012710 | long |
| 3 | bear_confluence | 1 | 19 | -0.025919 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.872311 | short |
| 3 | fast_bullish_reversal | 1 | 11 | -0.012946 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.439012 | short |
| 3 | fast_bearish_reversal | 1 | 19 | 0.018470 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.651760 | long |
| 3 | mixed_divergence | 12 | 123 | 0.005880 | `1m:buy|2m:sell|5m:buy|15m:sell` | 3.807823 | long |
| 3 | inactive | 0 | 0 |  | `` |  |  |
| 6 | bull_confluence | 1 | 39 | 0.045220 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.192058 | long |
| 6 | bear_confluence | 1 | 19 | -0.009337 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.276663 | short |
| 6 | fast_bullish_reversal | 1 | 11 | -0.045427 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.837976 | short |
| 6 | fast_bearish_reversal | 1 | 19 | -0.047846 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.561375 | short |
| 6 | mixed_divergence | 12 | 123 | 0.016239 | `1m:sell|2m:sell|5m:buy|15m:sell` | 28.834061 | short |
| 6 | inactive | 0 | 0 |  | `` |  |  |
| 12 | bull_confluence | 1 | 39 | 0.071986 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.524608 | long |
| 12 | bear_confluence | 1 | 19 | 0.016433 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.350223 | long |
| 12 | fast_bullish_reversal | 1 | 11 | 0.049077 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.879964 | long |
| 12 | fast_bearish_reversal | 1 | 19 | -0.054067 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.527823 | short |
| 12 | mixed_divergence | 12 | 123 | 0.018448 | `1m:buy|2m:sell|5m:buy|15m:buy` | 2.573695 | long |
| 12 | inactive | 0 | 0 |  | `` |  |  |
| 24 | bull_confluence | 1 | 39 | 0.081550 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.276488 | long |
| 24 | bear_confluence | 1 | 19 | 0.010294 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.338326 | long |
| 24 | fast_bullish_reversal | 1 | 11 | 0.008404 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.121370 | long |
| 24 | fast_bearish_reversal | 1 | 19 | -0.059036 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.565068 | short |
| 24 | mixed_divergence | 12 | 123 | 0.068505 | `1m:buy|2m:sell|5m:buy|15m:sell` | 2.784728 | long |
| 24 | inactive | 0 | 0 |  | `` |  |  |

### All Observed Combination Outcomes

| Horizon | Rank | Pattern | Family | n | Bias | Mean% | Delta Mean% | Win% | Delta Win% | Median% | Std% | MAE% | MFE% | t-stat | Score |
| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 39 | long | 0.045347 | +0.000548 | 69.230769 | +0.809716 | 0.030268 | 0.070574 | -0.017099 | 0.073161 | 4.012710 | 0.642548 |
| 3 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.049121 | +0.000895 | 80.000000 | +5.000000 | 0.059990 | 0.028846 | -0.015948 | 0.064341 | 3.807823 | 1.702910 |
| 3 | 3 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | long | 0.050342 | +0.018324 | 100.000000 | +20.000000 | 0.033506 | 0.040085 | -0.043764 | 0.084301 | 3.076208 | 1.255856 |
| 3 | 4 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 14 | long | 0.027407 | -0.006341 | 64.285714 | +4.285714 | 0.038710 | 0.035891 | -0.017833 | 0.059097 | 2.857187 | 0.763615 |
| 3 | 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.012271 | -0.003024 | 37.500000 | -5.357143 | -0.011107 | 0.019827 | -0.056925 | 0.027339 | -1.750469 | -0.618884 |
| 3 | 6 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.021365 | -0.000908 | 77.272727 | +2.272727 | 0.015870 | 0.069037 | -0.041161 | 0.045227 | 1.451527 | 0.309467 |
| 3 | 7 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 14 | short | -0.031354 | +0.012910 | 42.857143 | +6.493507 | -0.038381 | 0.085488 | -0.077635 | 0.039104 | -1.372327 | -0.366770 |
| 3 | 8 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.053614 | -0.007707 | 33.333333 | -16.666667 | -0.029908 | 0.100503 | -0.089980 | 0.052572 | -1.306689 | -0.533453 |
| 3 | 9 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 19 | short | -0.025919 | -0.004306 | 42.105263 | -11.228070 | -0.008454 | 0.129516 | -0.096725 | 0.057220 | -0.872311 | -0.200122 |
| 3 | 10 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | short | -0.007789 | -0.011458 | 50.000000 | +25.000000 | -0.007789 | 0.014839 | -0.043595 | 0.023096 | -0.742304 | -0.524888 |
| 3 | 11 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | long | 0.018470 | -0.004164 | 52.631579 | -1.913876 | 0.002005 | 0.123522 | -0.050584 | 0.061132 | 0.651760 | 0.149524 |
| 3 | 12 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | short | -0.006108 | -0.002541 | 16.666667 | -11.904762 | -0.017386 | 0.032688 | -0.044293 | 0.026417 | -0.457681 | -0.186848 |
| 3 | 13 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.009078 | +0.003821 | 42.105263 | +1.196172 | -0.002702 | 0.089001 | -0.053260 | 0.047339 | 0.444612 | 0.102001 |
| 3 | 14 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 11 | short | -0.012946 | -0.024244 | 54.545455 | -5.454545 | 0.019492 | 0.097806 | -0.062273 | 0.043419 | -0.439012 | -0.132367 |
| 3 | 15 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.008998 | -0.003068 | 50.000000 | -7.142857 | -0.002977 | 0.066456 | -0.042063 | 0.034783 | 0.331674 | 0.135405 |
| 3 | 16 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 15 | long | 0.000427 | +0.027038 | 46.666667 | +15.897436 | -0.008081 | 0.062290 | -0.051021 | 0.041918 | 0.026579 | 0.006863 |
| 6 | 1 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | short | -0.023110 | -0.054719 | 0.000000 | -75.000000 | -0.023110 | 0.001133 | -0.064552 | 0.023096 | -28.834061 | -20.388760 |
| 6 | 2 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 39 | long | 0.045220 | -0.000028 | 61.538462 | +1.012146 | 0.014807 | 0.088469 | -0.025707 | 0.092739 | 3.192058 | 0.511138 |
| 6 | 3 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | long | 0.065404 | +0.026970 | 100.000000 | +20.000000 | 0.049145 | 0.058091 | -0.043764 | 0.118248 | 2.757879 | 1.125899 |
| 6 | 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.038816 | -0.000916 | 81.818182 | +1.818182 | 0.024611 | 0.070030 | -0.043768 | 0.072705 | 2.599800 | 0.554279 |
| 6 | 5 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.080999 | -0.001871 | 80.000000 | +5.000000 | 0.075990 | 0.073318 | -0.016933 | 0.111388 | 2.470349 | 1.104774 |
| 6 | 6 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.048920 | -0.009317 | 73.684211 | +0.956938 | 0.025660 | 0.110537 | -0.056230 | 0.077842 | 1.929091 | 0.442564 |
| 6 | 7 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.068130 | -0.028647 | 0.000000 | -50.000000 | -0.016778 | 0.133172 | -0.126491 | 0.057964 | -1.253151 | -0.511597 |
| 6 | 8 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 14 | short | -0.042986 | -0.014670 | 28.571429 | +1.298702 | -0.030035 | 0.143531 | -0.120962 | 0.055841 | -1.120589 | -0.299490 |
| 6 | 9 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 14 | long | 0.021415 | -0.011612 | 57.142857 | -2.857143 | 0.034474 | 0.071568 | -0.034786 | 0.075924 | 1.119599 | 0.299225 |
| 6 | 10 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 11 | short | -0.045427 | -0.021816 | 54.545455 | +4.545455 | 0.001481 | 0.179796 | -0.107632 | 0.054712 | -0.837976 | -0.252659 |
| 6 | 11 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 8 | long | 0.022724 | +0.103221 | 37.500000 | +23.214286 | -0.008790 | 0.106789 | -0.076114 | 0.063492 | 0.601867 | 0.212792 |
| 6 | 12 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | short | -0.047846 | -0.016152 | 57.894737 | +3.349282 | 0.032318 | 0.371507 | -0.147157 | 0.076878 | -0.561375 | -0.128788 |
| 6 | 13 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.007898 | +0.003131 | 50.000000 | +7.142857 | -0.003959 | 0.062733 | -0.052988 | 0.043528 | 0.308392 | 0.125900 |
| 6 | 14 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 19 | short | -0.009337 | +0.003690 | 52.631579 | +2.631579 | 0.006288 | 0.147102 | -0.111009 | 0.078318 | -0.276663 | -0.063471 |
| 6 | 15 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 15 | short | -0.004832 | +0.032234 | 33.333333 | +10.256410 | -0.020511 | 0.101136 | -0.074428 | 0.050415 | -0.185043 | -0.047778 |
| 6 | 16 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.002800 | +0.014514 | 33.333333 | -9.523810 | -0.025087 | 0.066614 | -0.054498 | 0.047858 | 0.102954 | 0.042031 |
| 12 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 39 | long | 0.071986 | -0.000232 | 61.538462 | +1.012146 | 0.022846 | 0.127548 | -0.042460 | 0.126627 | 3.524608 | 0.564389 |
| 12 | 2 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.075600 | +0.041965 | 73.684211 | +5.502393 | 0.059404 | 0.128038 | -0.066384 | 0.117542 | 2.573695 | 0.590446 |
| 12 | 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.082969 | -0.031962 | 100.000000 | 0.000000 | 0.057696 | 0.076565 | -0.017929 | 0.133965 | 2.423080 | 1.083634 |
| 12 | 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.060799 | -0.002067 | 68.181818 | +3.181818 | 0.045526 | 0.118796 | -0.052826 | 0.106174 | 2.400531 | 0.511795 |
| 12 | 5 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | short | -0.040777 | -0.051717 | 0.000000 | -25.000000 | -0.040777 | 0.041764 | -0.086861 | 0.023096 | -1.380780 | -0.976359 |
| 12 | 6 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 14 | long | 0.024957 | -0.027579 | 64.285714 | -5.714286 | 0.030412 | 0.082600 | -0.054182 | 0.087999 | 1.130521 | 0.302144 |
| 12 | 7 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.127149 | -0.009289 | 25.000000 | +10.714286 | -0.046943 | 0.330935 | -0.202001 | 0.089404 | -1.086717 | -0.384213 |
| 12 | 8 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 14 | short | -0.041945 | -0.019363 | 50.000000 | -4.545455 | 0.005923 | 0.174534 | -0.142584 | 0.081973 | -0.899206 | -0.240323 |
| 12 | 9 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 11 | long | 0.049077 | -0.020069 | 63.636364 | -6.363636 | 0.049968 | 0.184974 | -0.113636 | 0.115725 | 0.879964 | 0.265319 |
| 12 | 10 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.040599 | +0.007072 | 50.000000 | +7.142857 | 0.018389 | 0.118213 | -0.079184 | 0.096082 | 0.841258 | 0.343442 |
| 12 | 11 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 15 | long | 0.036762 | +0.049310 | 40.000000 | +9.230769 | -0.030180 | 0.211512 | -0.107331 | 0.149038 | 0.673147 | 0.173806 |
| 12 | 12 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.024229 | -0.034311 | 33.333333 | -16.666667 | -0.009024 | 0.106091 | -0.144152 | 0.062104 | -0.559427 | -0.228385 |
| 12 | 13 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | short | -0.054067 | -0.032939 | 57.894737 | -1.196172 | 0.014035 | 0.446498 | -0.168635 | 0.102898 | -0.527823 | -0.121091 |
| 12 | 14 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.024559 | +0.020021 | 16.666667 | -3.333333 | -0.018904 | 0.125534 | -0.083868 | 0.124026 | -0.479209 | -0.195636 |
| 12 | 15 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | short | -0.014246 | -0.001966 | 50.000000 | -7.142857 | -0.002755 | 0.080774 | -0.086946 | 0.059899 | -0.432013 | -0.176369 |
| 12 | 16 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 19 | long | 0.016433 | -0.023638 | 47.368421 | -14.170041 | -0.026472 | 0.204526 | -0.132429 | 0.124892 | 0.350223 | 0.080347 |
| 24 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 39 | long | 0.081550 | +0.005724 | 69.230769 | +3.441295 | 0.077583 | 0.155435 | -0.054966 | 0.171370 | 3.276488 | 0.524658 |
| 24 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.106833 | +0.045416 | 80.000000 | +30.000000 | 0.116977 | 0.085784 | -0.032283 | 0.175188 | 2.784728 | 1.245368 |
| 24 | 3 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.338736 | +0.038664 | 100.000000 | +14.285714 | 0.242972 | 0.365280 | -0.103076 | 0.380767 | 2.271489 | 0.927332 |
| 24 | 4 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.076675 | +0.016319 | 68.421053 | +4.784689 | 0.067310 | 0.158496 | -0.081523 | 0.151602 | 2.108703 | 0.483770 |
| 24 | 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 15 | long | 0.174234 | +0.056738 | 73.333333 | +19.487179 | 0.038953 | 0.327555 | -0.140598 | 0.254734 | 2.060128 | 0.531923 |
| 24 | 6 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.052419 | +0.000180 | 59.090909 | +4.090909 | 0.039630 | 0.122956 | -0.067985 | 0.139342 | 1.999613 | 0.426319 |
| 24 | 7 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.144810 | +0.012016 | 66.666667 | +9.523810 | 0.027543 | 0.368418 | -0.145239 | 0.249715 | 0.962790 | 0.393057 |
| 24 | 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 14 | long | 0.031683 | +0.008640 | 50.000000 | -10.000000 | 0.014058 | 0.132537 | -0.090696 | 0.120053 | 0.894457 | 0.239054 |
| 24 | 9 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 14 | short | -0.034565 | -0.040462 | 42.857143 | -11.688312 | -0.030987 | 0.170801 | -0.161443 | 0.103984 | -0.757195 | -0.202369 |
| 24 | 10 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | short | -0.036222 | -0.052979 | 50.000000 | -25.000000 | -0.036222 | 0.071150 | -0.155861 | 0.024504 | -0.719979 | -0.509102 |
| 24 | 11 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | short | -0.059036 | -0.048988 | 47.368421 | -7.177034 | -0.013198 | 0.455397 | -0.220595 | 0.135186 | -0.565068 | -0.129635 |
| 24 | 12 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 19 | long | 0.010294 | -0.020211 | 57.894737 | -11.336032 | 0.017556 | 0.132620 | -0.162443 | 0.143628 | 0.338326 | 0.077617 |
| 24 | 13 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.014855 | +0.060573 | 50.000000 | +7.142857 | -0.019752 | 0.250882 | -0.240357 | 0.129150 | -0.167480 | -0.059213 |
| 24 | 14 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.006015 | +0.014638 | 33.333333 | -26.666667 | -0.013061 | 0.117561 | -0.132903 | 0.129689 | -0.125321 | -0.051162 |
| 24 | 15 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 11 | long | 0.008404 | -0.066690 | 54.545455 | -25.454545 | 0.035206 | 0.229653 | -0.140108 | 0.131923 | 0.121370 | 0.036594 |
| 24 | 16 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | long | 0.005798 | -0.008879 | 50.000000 | 0.000000 | 0.019600 | 0.208725 | -0.152284 | 0.096483 | 0.068044 | 0.027779 |

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 39 | long | 0.045347 | 69.230769 | 4.012710 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.049121 | 80.000000 | 3.807823 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | long | 0.050342 | 100.000000 | 3.076208 |
| 4 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 14 | long | 0.027407 | 64.285714 | 2.857187 |
| 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.012271 | 37.500000 | -1.750469 |
| 6 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.021365 | 77.272727 | 1.451527 |
| 7 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 14 | short | -0.031354 | 42.857143 | -1.372327 |
| 8 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.053614 | 33.333333 | -1.306689 |
| 9 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 19 | short | -0.025919 | 42.105263 | -0.872311 |
| 10 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | short | -0.007789 | 50.000000 | -0.742304 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | short | -0.023110 | 0.000000 | -28.834061 |
| 2 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 39 | long | 0.045220 | 61.538462 | 3.192058 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | long | 0.065404 | 100.000000 | 2.757879 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.038816 | 81.818182 | 2.599800 |
| 5 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.080999 | 80.000000 | 2.470349 |
| 6 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.048920 | 73.684211 | 1.929091 |
| 7 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.068130 | 0.000000 | -1.253151 |
| 8 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 14 | short | -0.042986 | 28.571429 | -1.120589 |
| 9 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 14 | long | 0.021415 | 57.142857 | 1.119599 |
| 10 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 11 | short | -0.045427 | 54.545455 | -0.837976 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 39 | long | 0.071986 | 61.538462 | 3.524608 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.075600 | 73.684211 | 2.573695 |
| 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.082969 | 100.000000 | 2.423080 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.060799 | 68.181818 | 2.400531 |
| 5 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | short | -0.040777 | 0.000000 | -1.380780 |
| 6 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 14 | long | 0.024957 | 64.285714 | 1.130521 |
| 7 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.127149 | 25.000000 | -1.086717 |
| 8 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 14 | short | -0.041945 | 50.000000 | -0.899206 |
| 9 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 11 | long | 0.049077 | 63.636364 | 0.879964 |
| 10 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.040599 | 50.000000 | 0.841258 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 39 | long | 0.081550 | 69.230769 | 3.276488 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.106833 | 80.000000 | 2.784728 |
| 3 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.338736 | 100.000000 | 2.271489 |
| 4 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.076675 | 68.421053 | 2.108703 |
| 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 15 | long | 0.174234 | 73.333333 | 2.060128 |
| 6 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.052419 | 59.090909 | 1.999613 |
| 7 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.144810 | 66.666667 | 0.962790 |
| 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 14 | long | 0.031683 | 50.000000 | 0.894457 |
| 9 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 14 | short | -0.034565 | 42.857143 | -0.757195 |
| 10 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | short | -0.036222 | 50.000000 | -0.719979 |

## base fast / slow context

- Study ID: `c6faa0a1-68dc-4fd2-b2af-98d72efbe410`
- Variant: `horizon-base-fast-slow-context`
- Description: timeHorizon grid: 1m=12, 2m=10, 5m=12, 15m=12.
- Observed transitions: 189
- Result rows: 64
- Occurrence rows: 753
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Family Summary By Horizon

| Horizon | Family | Patterns | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | ---: | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | 1 | 39 | 0.043443 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.149300 | long |
| 3 | bear_confluence | 1 | 6 | -0.031214 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.415994 | short |
| 3 | fast_bullish_reversal | 1 | 7 | 0.015879 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.542466 | long |
| 3 | fast_bearish_reversal | 1 | 27 | 0.015631 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.742860 | long |
| 3 | mixed_divergence | 12 | 110 | -0.000809 | `1m:buy|2m:sell|5m:sell|15m:sell` | 2.096415 | short |
| 3 | inactive | 0 | 0 |  | `` |  |  |
| 6 | bull_confluence | 1 | 39 | 0.037574 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.004565 | long |
| 6 | bear_confluence | 1 | 6 | 0.003000 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.032594 | long |
| 6 | fast_bullish_reversal | 1 | 7 | -0.036824 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.463424 | short |
| 6 | fast_bearish_reversal | 1 | 27 | -0.030366 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.496335 | short |
| 6 | mixed_divergence | 12 | 109 | 0.008477 | `1m:sell|2m:buy|5m:buy|15m:buy` | 2.295005 | long |
| 6 | inactive | 0 | 0 |  | `` |  |  |
| 12 | bull_confluence | 1 | 39 | 0.067461 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.395882 | long |
| 12 | bear_confluence | 1 | 6 | 0.124900 | `1m:sell|2m:sell|5m:sell|15m:sell` | 1.244375 | long |
| 12 | fast_bullish_reversal | 1 | 7 | -0.000525 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.009951 | short |
| 12 | fast_bearish_reversal | 1 | 27 | -0.005436 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.070404 | short |
| 12 | mixed_divergence | 12 | 109 | 0.010872 | `1m:buy|2m:sell|5m:buy|15m:sell` | 2.086953 | long |
| 12 | inactive | 0 | 0 |  | `` |  |  |
| 24 | bull_confluence | 1 | 39 | 0.062842 | `1m:buy|2m:buy|5m:buy|15m:buy` | 2.964810 | long |
| 24 | bear_confluence | 1 | 6 | 0.024614 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.284542 | long |
| 24 | fast_bullish_reversal | 1 | 7 | -0.007647 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.097356 | short |
| 24 | fast_bearish_reversal | 1 | 27 | 0.054868 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.612565 | long |
| 24 | mixed_divergence | 12 | 109 | 0.039740 | `1m:sell|2m:buy|5m:buy|15m:sell` | 2.253963 | long |
| 24 | inactive | 0 | 0 |  | `` |  |  |

### All Observed Combination Outcomes

| Horizon | Rank | Pattern | Family | n | Bias | Mean% | Delta Mean% | Win% | Delta Win% | Median% | Std% | MAE% | MFE% | t-stat | Score |
| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 39 | long | 0.043443 | -0.001356 | 69.230769 | +0.809716 | 0.030093 | 0.065385 | -0.017283 | 0.070640 | 4.149300 | 0.664420 |
| 3 | 2 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.072078 | -0.027814 | 20.000000 | -16.363636 | -0.043141 | 0.076879 | -0.089833 | 0.020141 | -2.096415 | -0.937545 |
| 3 | 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.041133 | -0.007093 | 66.666667 | -8.333333 | 0.053474 | 0.037906 | -0.022923 | 0.060295 | 1.879485 | 1.085121 |
| 3 | 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 24 | long | 0.016097 | -0.006176 | 70.833333 | -4.166667 | 0.013417 | 0.061775 | -0.043221 | 0.042029 | 1.276521 | 0.260569 |
| 3 | 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.018369 | -0.009122 | 45.454545 | +2.597402 | -0.028037 | 0.072170 | -0.064126 | 0.035283 | -0.844174 | -0.254528 |
| 3 | 6 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 27 | long | 0.015631 | -0.007003 | 48.148148 | -6.397307 | -0.002792 | 0.109337 | -0.052355 | 0.060935 | 0.742860 | 0.142963 |
| 3 | 7 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.012476 | -0.019542 | 66.666667 | -13.333333 | 0.015180 | 0.030941 | -0.050283 | 0.031536 | 0.698402 | 0.403222 |
| 3 | 8 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.045907 | 0.000000 | 50.000000 | 0.000000 | -0.016243 | 0.148797 | -0.102693 | 0.096799 | -0.617037 | -0.308518 |
| 3 | 9 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.027670 | +0.024001 | 50.000000 | +25.000000 | 0.027670 | 0.064986 | -0.044436 | 0.065155 | 0.602150 | 0.425784 |
| 3 | 10 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | long | 0.007198 | -0.026550 | 33.333333 | -26.666667 | -0.004819 | 0.031976 | -0.025722 | 0.039324 | 0.551416 | 0.225115 |
| 3 | 11 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 7 | long | 0.015879 | +0.004581 | 57.142857 | -2.857143 | 0.038708 | 0.077444 | -0.032018 | 0.050615 | 0.542466 | 0.205033 |
| 3 | 12 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 24 | long | 0.008049 | +0.002792 | 41.666667 | +0.757576 | -0.003816 | 0.080660 | -0.056272 | 0.047818 | 0.488837 | 0.099783 |
| 3 | 13 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 6 | short | -0.031214 | -0.009601 | 50.000000 | -3.333333 | 0.001063 | 0.183795 | -0.114015 | 0.070484 | -0.415994 | -0.169829 |
| 3 | 14 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 16 | short | -0.008577 | +0.018034 | 50.000000 | +19.230769 | 0.001227 | 0.099521 | -0.080515 | 0.053172 | -0.344746 | -0.086187 |
| 3 | 15 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.004306 | -0.000739 | 42.857143 | +14.285714 | -0.008878 | 0.049084 | -0.038343 | 0.033187 | -0.232102 | -0.087726 |
| 3 | 16 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.002886 | -0.014952 | 60.000000 | +2.857143 | 0.018869 | 0.045696 | -0.054207 | 0.050156 | -0.141213 | -0.063152 |
| 6 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 39 | long | 0.037574 | -0.007674 | 58.974359 | -1.551957 | 0.011476 | 0.078097 | -0.027120 | 0.086847 | 3.004565 | 0.481116 |
| 6 | 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 24 | long | 0.023882 | -0.015850 | 70.833333 | -9.166667 | 0.011193 | 0.050979 | -0.048228 | 0.059788 | 2.295005 | 0.468466 |
| 6 | 3 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 24 | long | 0.053002 | -0.005235 | 70.833333 | -1.893940 | 0.025638 | 0.115018 | -0.063198 | 0.085941 | 2.257547 | 0.460820 |
| 6 | 4 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.071155 | -0.042839 | 0.000000 | -27.272727 | -0.024546 | 0.084192 | -0.116836 | 0.020141 | -1.889817 | -0.845152 |
| 6 | 5 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.030457 | -0.007977 | 66.666667 | -13.333333 | 0.033851 | 0.030585 | -0.050283 | 0.056126 | 1.724778 | 0.995801 |
| 6 | 6 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.053169 | -0.029701 | 66.666667 | -8.333333 | 0.075990 | 0.064544 | -0.024563 | 0.092791 | 1.426783 | 0.823754 |
| 6 | 7 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.037580 | +0.042917 | 27.272727 | +12.987013 | -0.032867 | 0.146765 | -0.110970 | 0.052584 | -0.849231 | -0.256053 |
| 6 | 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.015943 | -0.048970 | 33.333333 | -26.666667 | -0.004163 | 0.051951 | -0.052898 | 0.042007 | -0.751731 | -0.306893 |
| 6 | 9 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 15 | short | -0.017239 | +0.019827 | 40.000000 | +16.923077 | -0.020511 | 0.094542 | -0.098451 | 0.061109 | -0.706189 | -0.182337 |
| 6 | 10 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.047245 | +0.015636 | 50.000000 | -25.000000 | 0.047245 | 0.100631 | -0.044436 | 0.087165 | 0.663954 | 0.469487 |
| 6 | 11 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 27 | short | -0.030366 | +0.001328 | 51.851852 | -2.693603 | 0.006288 | 0.317900 | -0.127832 | 0.076139 | -0.496335 | -0.095520 |
| 6 | 12 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 7 | short | -0.036824 | -0.013213 | 57.142857 | +7.142857 | 0.026054 | 0.210234 | -0.091310 | 0.063478 | -0.463424 | -0.175158 |
| 6 | 13 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.039483 | 0.000000 | 50.000000 | 0.000000 | 0.000763 | 0.218289 | -0.157459 | 0.124920 | -0.361755 | -0.180877 |
| 6 | 14 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.004602 | +0.016316 | 57.142857 | +14.285714 | 0.001481 | 0.067885 | -0.048462 | 0.046943 | 0.179343 | 0.067785 |
| 6 | 15 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.003486 | -0.008253 | 60.000000 | +17.142857 | 0.017758 | 0.048026 | -0.054753 | 0.055132 | -0.162306 | -0.072585 |
| 6 | 16 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 6 | long | 0.003000 | +0.016027 | 66.666667 | +16.666667 | 0.040036 | 0.225491 | -0.130056 | 0.101109 | 0.032594 | 0.013307 |
| 12 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 39 | long | 0.067461 | -0.004757 | 61.538462 | +1.012146 | 0.022846 | 0.124060 | -0.043046 | 0.122116 | 3.395882 | 0.543776 |
| 12 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.085150 | -0.029781 | 100.000000 | 0.000000 | 0.057696 | 0.070670 | -0.024798 | 0.114492 | 2.086953 | 1.204903 |
| 12 | 3 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.117126 | +0.129406 | 85.714286 | +28.571429 | 0.050364 | 0.162857 | -0.052393 | 0.137163 | 1.902814 | 0.719196 |
| 12 | 4 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.080494 | +0.037366 | 36.363636 | +22.077922 | -0.032821 | 0.170227 | -0.138194 | 0.062099 | -1.568307 | -0.472862 |
| 12 | 5 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 24 | long | 0.031977 | -0.030889 | 58.333333 | -6.666667 | 0.038895 | 0.104882 | -0.071378 | 0.094050 | 1.493626 | 0.304885 |
| 12 | 6 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 6 | long | 0.124900 | +0.084829 | 66.666667 | +5.128205 | 0.121261 | 0.245859 | -0.132431 | 0.180372 | 1.244375 | 0.508014 |
| 12 | 7 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.069517 | +0.058577 | 50.000000 | +25.000000 | 0.069517 | 0.114215 | -0.044436 | 0.109935 | 0.860765 | 0.608652 |
| 12 | 8 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 15 | short | -0.033474 | -0.020926 | 33.333333 | +2.564102 | -0.047858 | 0.150856 | -0.128097 | 0.086746 | -0.859399 | -0.221896 |
| 12 | 9 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.020129 | +0.064709 | 33.333333 | +13.333333 | -0.010623 | 0.066845 | -0.061413 | 0.067409 | 0.521565 | 0.301125 |
| 12 | 10 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | long | 0.012738 | -0.020789 | 40.000000 | -2.857143 | -0.007424 | 0.063920 | -0.061222 | 0.087112 | 0.445616 | 0.199286 |
| 12 | 11 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.010523 | -0.063059 | 50.000000 | -20.000000 | 0.008039 | 0.059384 | -0.061623 | 0.054374 | -0.434046 | -0.177198 |
| 12 | 12 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 24 | long | 0.017513 | -0.016122 | 62.500000 | -5.681818 | 0.051583 | 0.234070 | -0.110226 | 0.118321 | 0.366547 | 0.074821 |
| 12 | 13 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 5 | long | 0.013829 | +0.036411 | 60.000000 | +5.454545 | 0.025336 | 0.092139 | -0.122748 | 0.065538 | 0.335613 | 0.150091 |
| 12 | 14 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | long | 0.010082 | 0.000000 | 50.000000 | 0.000000 | 0.044153 | 0.172867 | -0.157459 | 0.133586 | 0.116645 | 0.058322 |
| 12 | 15 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 27 | short | -0.005436 | +0.015692 | 55.555556 | -3.535353 | 0.014035 | 0.401229 | -0.148768 | 0.137103 | -0.070404 | -0.013549 |
| 12 | 16 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 7 | short | -0.000525 | -0.069671 | 57.142857 | -12.857143 | 0.049968 | 0.139579 | -0.102619 | 0.084977 | -0.009951 | -0.003761 |
| 24 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 39 | long | 0.062842 | -0.012984 | 69.230769 | +3.441295 | 0.045814 | 0.132369 | -0.059787 | 0.159073 | 2.964810 | 0.474749 |
| 24 | 2 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.040198 | +0.060851 | 100.000000 | +40.000000 | 0.056870 | 0.030890 | -0.070521 | 0.100910 | 2.253963 | 1.301326 |
| 24 | 3 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.138813 | +0.006019 | 71.428571 | +14.285714 | 0.106532 | 0.173598 | -0.062138 | 0.185981 | 2.115602 | 0.799622 |
| 24 | 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 24 | long | 0.095859 | +0.043620 | 58.333333 | +3.333333 | 0.046867 | 0.235561 | -0.092621 | 0.178790 | 1.993580 | 0.406938 |
| 24 | 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 24 | long | 0.048698 | -0.011658 | 62.500000 | -1.136364 | 0.037992 | 0.196768 | -0.133251 | 0.148462 | 1.212455 | 0.247491 |
| 24 | 6 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.045457 | -0.068500 | 33.333333 | -26.666667 | -0.032721 | 0.097154 | -0.125611 | 0.059065 | -1.146068 | -0.467880 |
| 24 | 7 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.047529 | +0.027899 | 45.454545 | +2.597402 | -0.051350 | 0.181171 | -0.164212 | 0.075906 | -0.870094 | -0.262343 |
| 24 | 8 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | long | 0.040629 | -0.259443 | 60.000000 | -25.714286 | 0.044151 | 0.110211 | -0.094961 | 0.123804 | 0.824333 | 0.368653 |
| 24 | 9 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 27 | long | 0.054868 | +0.064916 | 59.259259 | +4.713804 | 0.038953 | 0.465420 | -0.197885 | 0.215356 | 0.612565 | 0.117888 |
| 24 | 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 5 | long | 0.024219 | +0.018322 | 60.000000 | +5.454545 | 0.078843 | 0.115478 | -0.122748 | 0.117023 | 0.468964 | 0.209727 |
| 24 | 11 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.020822 | -0.040595 | 33.333333 | -16.666667 | -0.010624 | 0.078038 | -0.055297 | 0.152829 | 0.462134 | 0.266813 |
| 24 | 12 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.004008 | -0.012749 | 50.000000 | -25.000000 | 0.004008 | 0.014255 | -0.079431 | 0.118173 | 0.397619 | 0.281159 |
| 24 | 13 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 15 | long | 0.007477 | -0.110019 | 60.000000 | +6.153846 | 0.017556 | 0.085933 | -0.172420 | 0.101598 | 0.336968 | 0.087005 |
| 24 | 14 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 6 | long | 0.024614 | -0.005891 | 66.666667 | -2.564102 | 0.046869 | 0.211892 | -0.142134 | 0.201916 | 0.284542 | 0.116164 |
| 24 | 15 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | long | 0.014677 | 0.000000 | 50.000000 | 0.000000 | 0.096487 | 0.279257 | -0.181227 | 0.146266 | 0.105113 | 0.052557 |
| 24 | 16 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 7 | short | -0.007647 | -0.082741 | 71.428571 | -8.571429 | 0.078101 | 0.207827 | -0.111108 | 0.104770 | -0.097356 | -0.036797 |

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 39 | long | 0.043443 | 69.230769 | 4.149300 |
| 2 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.072078 | 20.000000 | -2.096415 |
| 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.041133 | 66.666667 | 1.879485 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 24 | long | 0.016097 | 70.833333 | 1.276521 |
| 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.018369 | 45.454545 | -0.844174 |
| 6 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 27 | long | 0.015631 | 48.148148 | 0.742860 |
| 7 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.012476 | 66.666667 | 0.698402 |
| 8 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.045907 | 50.000000 | -0.617037 |
| 9 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.027670 | 50.000000 | 0.602150 |
| 10 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | long | 0.007198 | 33.333333 | 0.551416 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 39 | long | 0.037574 | 58.974359 | 3.004565 |
| 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 24 | long | 0.023882 | 70.833333 | 2.295005 |
| 3 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 24 | long | 0.053002 | 70.833333 | 2.257547 |
| 4 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.071155 | 0.000000 | -1.889817 |
| 5 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.030457 | 66.666667 | 1.724778 |
| 6 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.053169 | 66.666667 | 1.426783 |
| 7 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.037580 | 27.272727 | -0.849231 |
| 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.015943 | 33.333333 | -0.751731 |
| 9 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 15 | short | -0.017239 | 40.000000 | -0.706189 |
| 10 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.047245 | 50.000000 | 0.663954 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 39 | long | 0.067461 | 61.538462 | 3.395882 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.085150 | 100.000000 | 2.086953 |
| 3 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.117126 | 85.714286 | 1.902814 |
| 4 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.080494 | 36.363636 | -1.568307 |
| 5 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 24 | long | 0.031977 | 58.333333 | 1.493626 |
| 6 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 6 | long | 0.124900 | 66.666667 | 1.244375 |
| 7 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.069517 | 50.000000 | 0.860765 |
| 8 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 15 | short | -0.033474 | 33.333333 | -0.859399 |
| 9 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.020129 | 33.333333 | 0.521565 |
| 10 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | long | 0.012738 | 40.000000 | 0.445616 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 39 | long | 0.062842 | 69.230769 | 2.964810 |
| 2 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.040198 | 100.000000 | 2.253963 |
| 3 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.138813 | 71.428571 | 2.115602 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 24 | long | 0.095859 | 58.333333 | 1.993580 |
| 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 24 | long | 0.048698 | 62.500000 | 1.212455 |
| 6 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.045457 | 33.333333 | -1.146068 |
| 7 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.047529 | 45.454545 | -0.870094 |
| 8 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | long | 0.040629 | 60.000000 | 0.824333 |
| 9 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 27 | long | 0.054868 | 59.259259 | 0.612565 |
| 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 5 | long | 0.024219 | 60.000000 | 0.468964 |

## slow fast / tight context

- Study ID: `dc743cec-7c3a-482a-ac9b-cfbf148c222f`
- Variant: `horizon-slow-fast-tight-context`
- Description: timeHorizon grid: 1m=16, 2m=14, 5m=6, 15m=6.
- Observed transitions: 170
- Result rows: 64
- Occurrence rows: 680
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Family Summary By Horizon

| Horizon | Family | Patterns | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | ---: | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | 1 | 31 | 0.055081 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.354381 | long |
| 3 | bear_confluence | 1 | 17 | -0.037451 | `1m:sell|2m:sell|5m:sell|15m:sell` | 1.276092 | short |
| 3 | fast_bullish_reversal | 1 | 6 | -0.089980 | `1m:buy|2m:buy|5m:sell|15m:sell` | 2.016143 | short |
| 3 | fast_bearish_reversal | 1 | 5 | 0.015405 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.528432 | long |
| 3 | mixed_divergence | 12 | 111 | 0.016152 | `1m:buy|2m:buy|5m:sell|15m:buy` | 7.166546 | short |
| 3 | inactive | 0 | 0 |  | `` |  |  |
| 6 | bull_confluence | 1 | 31 | 0.068171 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.023179 | long |
| 6 | bear_confluence | 1 | 17 | -0.024603 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.704014 | short |
| 6 | fast_bullish_reversal | 1 | 6 | -0.085987 | `1m:buy|2m:buy|5m:sell|15m:sell` | 1.840257 | short |
| 6 | fast_bearish_reversal | 1 | 5 | 0.016258 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.570827 | long |
| 6 | mixed_divergence | 12 | 111 | 0.021793 | `1m:buy|2m:sell|5m:buy|15m:sell` | 2.752659 | long |
| 6 | inactive | 0 | 0 |  | `` |  |  |
| 12 | bull_confluence | 1 | 31 | 0.088923 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.538210 | long |
| 12 | bear_confluence | 1 | 17 | 0.023440 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.455377 | long |
| 12 | fast_bullish_reversal | 1 | 6 | 0.078250 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.891349 | long |
| 12 | fast_bearish_reversal | 1 | 5 | 0.015440 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.393643 | long |
| 12 | mixed_divergence | 12 | 111 | 0.014552 | `1m:buy|2m:sell|5m:buy|15m:buy` | 2.346206 | long |
| 12 | inactive | 0 | 0 |  | `` |  |  |
| 24 | bull_confluence | 1 | 31 | 0.110202 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.110494 | long |
| 24 | bear_confluence | 1 | 17 | 0.013406 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.388525 | long |
| 24 | fast_bullish_reversal | 1 | 6 | 0.072066 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.775367 | long |
| 24 | fast_bearish_reversal | 1 | 5 | -0.021284 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.303702 | short |
| 24 | mixed_divergence | 12 | 111 | 0.071273 | `1m:sell|2m:sell|5m:sell|15m:buy` | 2.183032 | long |
| 24 | inactive | 0 | 0 |  | `` |  |  |

### All Observed Combination Outcomes

| Horizon | Rank | Pattern | Family | n | Bias | Mean% | Delta Mean% | Win% | Delta Win% | Median% | Std% | MAE% | MFE% | t-stat | Score |
| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.023508 | -0.019941 | 0.000000 | -28.571429 | -0.021692 | 0.007335 | -0.058180 | 0.016137 | -7.166546 | -3.204977 |
| 3 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 9 | long | 0.046001 | -0.002225 | 88.888889 | +13.888889 | 0.050112 | 0.023978 | -0.013719 | 0.075540 | 5.755238 | 1.918413 |
| 3 | 3 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 31 | long | 0.055081 | +0.010282 | 74.193548 | +5.772495 | 0.039391 | 0.070429 | -0.015462 | 0.081869 | 4.354381 | 0.782070 |
| 3 | 4 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 15 | long | 0.033380 | -0.000368 | 73.333333 | +13.333333 | 0.047888 | 0.041762 | -0.021933 | 0.054131 | 3.095635 | 0.799289 |
| 3 | 5 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.038756 | +0.006738 | 85.714286 | +5.714286 | 0.023804 | 0.046254 | -0.036739 | 0.075604 | 2.216837 | 0.837886 |
| 3 | 6 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 6 | short | -0.089980 | -0.101278 | 33.333333 | -26.666667 | -0.108064 | 0.109320 | -0.116643 | 0.023437 | -2.016143 | -0.823087 |
| 3 | 7 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.037999 | +0.007908 | 40.000000 | -10.000000 | -0.056290 | 0.059019 | -0.072105 | 0.062040 | -1.439685 | -0.643847 |
| 3 | 8 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 17 | short | -0.037451 | -0.015838 | 29.411765 | -23.921568 | -0.013515 | 0.121005 | -0.093919 | 0.047715 | -1.276092 | -0.309498 |
| 3 | 9 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.032549 | +0.010276 | 55.000000 | -20.000000 | 0.006913 | 0.118792 | -0.047432 | 0.069159 | 1.225358 | 0.273998 |
| 3 | 10 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | long | 0.020446 | +0.047057 | 53.846154 | +23.076923 | 0.009818 | 0.060433 | -0.043534 | 0.046369 | 1.219844 | 0.338324 |
| 3 | 11 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.004061 | +0.013308 | 57.142857 | +14.285714 | 0.006035 | 0.013844 | -0.040065 | 0.040082 | 0.776078 | 0.293330 |
| 3 | 12 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 14 | short | -0.011285 | +0.032979 | 42.857143 | +6.493507 | -0.020256 | 0.068262 | -0.062885 | 0.037673 | -0.618573 | -0.165321 |
| 3 | 13 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 5 | long | 0.015405 | -0.007229 | 80.000000 | +25.454545 | 0.015028 | 0.065186 | -0.033564 | 0.044288 | 0.528432 | 0.236322 |
| 3 | 14 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 7 | long | 0.005983 | +0.000726 | 57.142857 | +16.233766 | 0.002816 | 0.039257 | -0.049645 | 0.036245 | 0.403259 | 0.152417 |
| 3 | 15 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | long | 0.003166 | -0.008900 | 50.000000 | -7.142857 | 0.001791 | 0.070058 | -0.052238 | 0.043764 | 0.127819 | 0.045191 |
| 3 | 16 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 1 | long | 0.059990 | +0.056321 | 100.000000 | +75.000000 | 0.059990 | 0.000000 | -0.002727 | 0.064081 | 0.000000 | 0.000000 |
| 6 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 31 | long | 0.068171 | +0.022923 | 74.193548 | +13.667232 | 0.040986 | 0.094343 | -0.028294 | 0.120206 | 4.023179 | 0.722584 |
| 6 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 9 | long | 0.062430 | -0.020440 | 77.777778 | +2.777778 | 0.064032 | 0.068039 | -0.019164 | 0.113473 | 2.752659 | 0.917553 |
| 6 | 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 15 | long | 0.031898 | -0.001129 | 60.000000 | 0.000000 | 0.025342 | 0.065204 | -0.034438 | 0.073171 | 1.894662 | 0.489200 |
| 6 | 4 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 6 | short | -0.085987 | -0.062376 | 33.333333 | -16.666667 | -0.074571 | 0.114454 | -0.144215 | 0.026485 | -1.840257 | -0.751282 |
| 6 | 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 7 | long | 0.041874 | -0.016363 | 71.428571 | -1.298702 | 0.072624 | 0.063723 | -0.049726 | 0.065824 | 1.738577 | 0.657121 |
| 6 | 6 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.041000 | +0.002566 | 71.428571 | -8.571429 | 0.033474 | 0.068722 | -0.042727 | 0.096678 | 1.578482 | 0.596610 |
| 6 | 7 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.049274 | +0.009542 | 70.000000 | -10.000000 | 0.021046 | 0.160161 | -0.066865 | 0.093609 | 1.375871 | 0.307654 |
| 6 | 8 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.123901 | -0.084418 | 0.000000 | -50.000000 | -0.031948 | 0.207218 | -0.166264 | 0.064651 | -1.337001 | -0.597925 |
| 6 | 9 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 17 | short | -0.024603 | -0.011576 | 47.058824 | -2.941176 | -0.010393 | 0.144090 | -0.109645 | 0.066712 | -0.704014 | -0.170748 |
| 6 | 10 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | long | 0.019309 | +0.056375 | 38.461538 | +15.384615 | -0.020511 | 0.115436 | -0.061854 | 0.071760 | 0.603112 | 0.167273 |
| 6 | 11 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.019906 | +0.100403 | 42.857143 | +28.571429 | -0.007001 | 0.089757 | -0.060962 | 0.066434 | 0.586782 | 0.221783 |
| 6 | 12 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 5 | long | 0.016258 | +0.047952 | 80.000000 | +25.454545 | 0.040986 | 0.063686 | -0.034382 | 0.052969 | 0.570827 | 0.255281 |
| 6 | 13 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 14 | short | -0.010418 | +0.017898 | 42.857143 | +15.584416 | -0.004986 | 0.126723 | -0.092333 | 0.056265 | -0.307603 | -0.082210 |
| 6 | 14 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | long | 0.006600 | +0.018314 | 40.000000 | -2.857143 | -0.031189 | 0.073347 | -0.065272 | 0.043692 | 0.201203 | 0.089981 |
| 6 | 15 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | long | 0.003536 | -0.001231 | 62.500000 | +19.642857 | 0.011583 | 0.064220 | -0.069614 | 0.044553 | 0.155747 | 0.055065 |
| 6 | 16 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 1 | long | 0.126798 | +0.095189 | 100.000000 | +25.000000 | 0.126798 | 0.000000 | -0.002727 | 0.136342 | 0.000000 | 0.000000 |
| 12 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 31 | long | 0.088923 | +0.016705 | 74.193548 | +13.667232 | 0.065448 | 0.109097 | -0.039309 | 0.157537 | 4.538210 | 0.815087 |
| 12 | 2 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 7 | long | 0.093509 | +0.059874 | 85.714286 | +17.532468 | 0.091654 | 0.105448 | -0.060610 | 0.117923 | 2.346206 | 0.886782 |
| 12 | 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 9 | long | 0.052430 | -0.062501 | 77.777778 | -22.222222 | 0.035496 | 0.079140 | -0.037061 | 0.123670 | 1.987495 | 0.662498 |
| 12 | 4 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 15 | long | 0.019760 | -0.032776 | 53.333333 | -16.666667 | 0.025327 | 0.073957 | -0.049286 | 0.079353 | 1.034813 | 0.267188 |
| 12 | 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.042022 | +0.075838 | 42.857143 | +28.571429 | -0.001400 | 0.110867 | -0.077605 | 0.079368 | -1.002827 | -0.379033 |
| 12 | 6 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | long | 0.055000 | +0.067548 | 38.461538 | +7.692307 | -0.037345 | 0.207424 | -0.094388 | 0.160616 | 0.956048 | 0.265160 |
| 12 | 7 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 6 | long | 0.078250 | +0.009104 | 66.666667 | -3.333333 | 0.064159 | 0.215036 | -0.148087 | 0.130349 | 0.891349 | 0.363892 |
| 12 | 8 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.044301 | -0.054383 | 40.000000 | -10.000000 | -0.016876 | 0.132418 | -0.193270 | 0.065461 | -0.748094 | -0.334558 |
| 12 | 9 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.027960 | -0.015680 | 20.000000 | -37.142857 | -0.010519 | 0.084102 | -0.104210 | 0.056429 | -0.743379 | -0.332449 |
| 12 | 10 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | short | -0.029014 | +0.015566 | 14.285714 | -5.714286 | -0.012001 | 0.116135 | -0.082175 | 0.101630 | -0.661000 | -0.249834 |
| 12 | 11 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 17 | long | 0.023440 | -0.016631 | 47.058824 | -14.479638 | -0.007424 | 0.212233 | -0.133664 | 0.118515 | 0.455377 | 0.110445 |
| 12 | 12 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 5 | long | 0.015440 | +0.036568 | 80.000000 | +20.909091 | 0.032639 | 0.087707 | -0.053343 | 0.068266 | 0.393643 | 0.176043 |
| 12 | 13 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.023232 | -0.039634 | 50.000000 | -15.000000 | 0.023065 | 0.308317 | -0.132785 | 0.129557 | 0.336986 | 0.075352 |
| 12 | 14 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 14 | short | -0.011297 | +0.011285 | 57.142857 | +2.597402 | 0.013372 | 0.146757 | -0.107673 | 0.082714 | -0.288034 | -0.076980 |
| 12 | 15 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.009774 | -0.043301 | 37.500000 | -5.357143 | -0.022360 | 0.145895 | -0.119829 | 0.114506 | -0.189495 | -0.066997 |
| 12 | 16 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 1 | long | 0.107710 | +0.096770 | 100.000000 | +75.000000 | 0.107710 | 0.000000 | -0.002727 | 0.212693 | 0.000000 | 0.000000 |
| 24 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 31 | long | 0.110202 | +0.034376 | 80.645161 | +14.855687 | 0.082461 | 0.149271 | -0.047026 | 0.209326 | 4.110494 | 0.738266 |
| 24 | 2 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | long | 0.207642 | +0.090146 | 69.230769 | +15.384615 | 0.106699 | 0.342947 | -0.131435 | 0.280014 | 2.183032 | 0.605464 |
| 24 | 3 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | long | 0.247522 | -0.052550 | 75.000000 | -10.714286 | 0.086978 | 0.352160 | -0.156046 | 0.315821 | 1.988017 | 0.702870 |
| 24 | 4 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 7 | long | 0.079795 | +0.019439 | 85.714286 | +22.077922 | 0.107833 | 0.127632 | -0.062517 | 0.158187 | 1.654109 | 0.625194 |
| 24 | 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.134528 | +0.209956 | 57.142857 | +14.285714 | 0.040683 | 0.309751 | -0.144199 | 0.247944 | 1.149076 | 0.434310 |
| 24 | 6 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 9 | long | 0.051795 | -0.009622 | 55.555556 | +5.555556 | 0.073462 | 0.138629 | -0.077348 | 0.149306 | 1.120873 | 0.373624 |
| 24 | 7 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | long | 0.177478 | +0.044684 | 60.000000 | +2.857143 | 0.073618 | 0.403282 | -0.146162 | 0.264556 | 0.984058 | 0.440084 |
| 24 | 8 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 6 | long | 0.072066 | -0.003028 | 50.000000 | -30.000000 | 0.034336 | 0.227667 | -0.148087 | 0.151602 | 0.775367 | 0.316542 |
| 24 | 9 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.068645 | -0.083322 | 20.000000 | -30.000000 | -0.021607 | 0.241396 | -0.193832 | 0.068808 | -0.635867 | -0.284369 |
| 24 | 10 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 15 | long | 0.018977 | -0.004066 | 60.000000 | 0.000000 | 0.032377 | 0.136454 | -0.086056 | 0.112509 | 0.538629 | 0.139073 |
| 24 | 11 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 17 | long | 0.013406 | -0.017099 | 52.941176 | -16.289593 | 0.009864 | 0.142264 | -0.164374 | 0.146578 | 0.388525 | 0.094231 |
| 24 | 12 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | short | -0.016155 | +0.004498 | 28.571429 | -31.428571 | -0.016365 | 0.111922 | -0.140015 | 0.106887 | -0.381900 | -0.144345 |
| 24 | 13 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.026996 | -0.025243 | 50.000000 | -5.000000 | 0.033799 | 0.367880 | -0.158276 | 0.177156 | 0.328172 | 0.073382 |
| 24 | 14 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 5 | short | -0.021284 | -0.011236 | 40.000000 | -14.545455 | -0.021520 | 0.156705 | -0.093333 | 0.088722 | -0.303702 | -0.135820 |
| 24 | 15 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 14 | short | -0.010803 | -0.016700 | 50.000000 | -4.545455 | 0.014122 | 0.150148 | -0.118196 | 0.107966 | -0.269206 | -0.071948 |
| 24 | 16 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 1 | long | 0.160897 | +0.144140 | 100.000000 | +25.000000 | 0.160897 | 0.000000 | -0.002727 | 0.212693 | 0.000000 | 0.000000 |

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.023508 | 0.000000 | -7.166546 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 9 | long | 0.046001 | 88.888889 | 5.755238 |
| 3 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 31 | long | 0.055081 | 74.193548 | 4.354381 |
| 4 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 15 | long | 0.033380 | 73.333333 | 3.095635 |
| 5 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.038756 | 85.714286 | 2.216837 |
| 6 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 6 | short | -0.089980 | 33.333333 | -2.016143 |
| 7 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.037999 | 40.000000 | -1.439685 |
| 8 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 17 | short | -0.037451 | 29.411765 | -1.276092 |
| 9 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.032549 | 55.000000 | 1.225358 |
| 10 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | long | 0.020446 | 53.846154 | 1.219844 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 31 | long | 0.068171 | 74.193548 | 4.023179 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 9 | long | 0.062430 | 77.777778 | 2.752659 |
| 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 15 | long | 0.031898 | 60.000000 | 1.894662 |
| 4 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 6 | short | -0.085987 | 33.333333 | -1.840257 |
| 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 7 | long | 0.041874 | 71.428571 | 1.738577 |
| 6 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.041000 | 71.428571 | 1.578482 |
| 7 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.049274 | 70.000000 | 1.375871 |
| 8 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.123901 | 0.000000 | -1.337001 |
| 9 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 17 | short | -0.024603 | 47.058824 | -0.704014 |
| 10 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | long | 0.019309 | 38.461538 | 0.603112 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 31 | long | 0.088923 | 74.193548 | 4.538210 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 7 | long | 0.093509 | 85.714286 | 2.346206 |
| 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 9 | long | 0.052430 | 77.777778 | 1.987495 |
| 4 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 15 | long | 0.019760 | 53.333333 | 1.034813 |
| 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.042022 | 42.857143 | -1.002827 |
| 6 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | long | 0.055000 | 38.461538 | 0.956048 |
| 7 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 6 | long | 0.078250 | 66.666667 | 0.891349 |
| 8 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.044301 | 40.000000 | -0.748094 |
| 9 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.027960 | 20.000000 | -0.743379 |
| 10 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | short | -0.029014 | 14.285714 | -0.661000 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 31 | long | 0.110202 | 80.645161 | 4.110494 |
| 2 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | long | 0.207642 | 69.230769 | 2.183032 |
| 3 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | long | 0.247522 | 75.000000 | 1.988017 |
| 4 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 7 | long | 0.079795 | 85.714286 | 1.654109 |
| 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.134528 | 57.142857 | 1.149076 |
| 6 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 9 | long | 0.051795 | 55.555556 | 1.120873 |
| 7 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | long | 0.177478 | 60.000000 | 0.984058 |
| 8 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 6 | long | 0.072066 | 50.000000 | 0.775367 |
| 9 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.068645 | 20.000000 | -0.635867 |
| 10 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 15 | long | 0.018977 | 60.000000 | 0.538629 |

## slow fast / base context

- Study ID: `cf8ec68a-c835-406b-8abf-246dd5869fdf`
- Variant: `horizon-slow-fast-base-context`
- Description: timeHorizon grid: 1m=16, 2m=14, 5m=8, 15m=8.
- Observed transitions: 159
- Result rows: 64
- Occurrence rows: 631
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Family Summary By Horizon

| Horizon | Family | Patterns | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | ---: | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | 1 | 30 | 0.052897 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.958173 | long |
| 3 | bear_confluence | 1 | 13 | -0.047092 | `1m:sell|2m:sell|5m:sell|15m:sell` | 1.248988 | short |
| 3 | fast_bullish_reversal | 1 | 9 | -0.021674 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.733445 | short |
| 3 | fast_bearish_reversal | 1 | 8 | 0.032682 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.254513 | long |
| 3 | mixed_divergence | 12 | 99 | 0.013691 | `1m:buy|2m:sell|5m:buy|15m:sell` | 2.495200 | long |
| 3 | inactive | 0 | 0 |  | `` |  |  |
| 6 | bull_confluence | 1 | 30 | 0.067619 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.809493 | long |
| 6 | bear_confluence | 1 | 12 | -0.042454 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.883993 | short |
| 6 | fast_bullish_reversal | 1 | 9 | -0.028207 | `1m:buy|2m:buy|5m:sell|15m:sell` | 1.042090 | short |
| 6 | fast_bearish_reversal | 1 | 8 | 0.047706 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.107105 | long |
| 6 | mixed_divergence | 12 | 99 | 0.019408 | `1m:buy|2m:sell|5m:buy|15m:sell` | 2.683849 | long |
| 6 | inactive | 0 | 0 |  | `` |  |  |
| 12 | bull_confluence | 1 | 30 | 0.087959 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.250594 | long |
| 12 | bear_confluence | 1 | 11 | 0.037140 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.472352 | long |
| 12 | fast_bullish_reversal | 1 | 9 | 0.066535 | `1m:buy|2m:buy|5m:sell|15m:sell` | 1.173177 | long |
| 12 | fast_bearish_reversal | 1 | 8 | 0.104599 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.291413 | long |
| 12 | mixed_divergence | 12 | 99 | 0.011592 | `1m:buy|2m:sell|5m:buy|15m:sell` | 2.698977 | long |
| 12 | inactive | 0 | 0 |  | `` |  |  |
| 24 | bull_confluence | 1 | 30 | 0.106935 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.822640 | long |
| 24 | bear_confluence | 1 | 11 | 0.021192 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.424571 | long |
| 24 | fast_bullish_reversal | 1 | 9 | 0.065867 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.959783 | long |
| 24 | fast_bearish_reversal | 1 | 8 | 0.099504 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.972508 | long |
| 24 | mixed_divergence | 12 | 99 | 0.070592 | `1m:buy|2m:sell|5m:sell|15m:sell` | 1.889286 | long |
| 24 | inactive | 0 | 0 |  | `` |  |  |

### All Observed Combination Outcomes

| Horizon | Rank | Pattern | Family | n | Bias | Mean% | Delta Mean% | Win% | Delta Win% | Median% | Std% | MAE% | MFE% | t-stat | Score |
| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.052897 | +0.008098 | 70.000000 | +1.578947 | 0.034970 | 0.073198 | -0.017647 | 0.080360 | 3.958173 | 0.722660 |
| 3 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.043847 | -0.004379 | 80.000000 | +5.000000 | 0.053474 | 0.039293 | -0.024654 | 0.061863 | 2.495200 | 1.115887 |
| 3 | 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.036635 | +0.002887 | 63.636364 | +3.636364 | 0.051708 | 0.051405 | -0.029851 | 0.060772 | 2.363694 | 0.712681 |
| 3 | 4 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.036589 | +0.004571 | 75.000000 | -5.000000 | 0.030422 | 0.051220 | -0.043590 | 0.084014 | 1.428719 | 0.714360 |
| 3 | 5 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 8 | long | 0.032682 | +0.010048 | 75.000000 | +20.454545 | 0.029985 | 0.073684 | -0.032244 | 0.061197 | 1.254513 | 0.443537 |
| 3 | 6 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 13 | short | -0.047092 | -0.025479 | 38.461538 | -14.871795 | -0.013515 | 0.135945 | -0.103282 | 0.058235 | -1.248988 | -0.346407 |
| 3 | 7 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.033977 | +0.011704 | 52.631579 | -22.368421 | 0.008407 | 0.121871 | -0.048146 | 0.071873 | 1.215232 | 0.278793 |
| 3 | 8 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | short | -0.021674 | -0.032972 | 55.555556 | -4.444444 | 0.031375 | 0.088655 | -0.055558 | 0.036754 | -0.733445 | -0.244482 |
| 3 | 9 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 10 | long | 0.006622 | +0.001365 | 60.000000 | +19.090909 | 0.007473 | 0.033734 | -0.052926 | 0.042071 | 0.620811 | 0.196318 |
| 3 | 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 10 | short | -0.010376 | +0.033888 | 50.000000 | +13.636364 | 0.000707 | 0.079845 | -0.066437 | 0.046965 | -0.410954 | -0.129955 |
| 3 | 11 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.010985 | +0.007316 | 33.333333 | +8.333333 | -0.004051 | 0.056636 | -0.050644 | 0.053589 | 0.335956 | 0.193964 |
| 3 | 12 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.006075 | -0.002508 | 25.000000 | -3.571429 | -0.021030 | 0.038843 | -0.028425 | 0.018636 | -0.312786 | -0.156393 |
| 3 | 13 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.012723 | +0.033184 | 50.000000 | 0.000000 | -0.016243 | 0.092911 | -0.064294 | 0.102173 | -0.273871 | -0.136936 |
| 3 | 14 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 12 | long | 0.002707 | +0.029318 | 41.666667 | +10.897436 | -0.008439 | 0.045216 | -0.049686 | 0.028867 | 0.207364 | 0.059861 |
| 3 | 15 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.000808 | +0.008439 | 50.000000 | +7.142857 | 0.000984 | 0.020777 | -0.027674 | 0.022437 | -0.109993 | -0.038889 |
| 3 | 16 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 9 | short | -0.000552 | -0.012618 | 44.444444 | -12.698413 | -0.009054 | 0.070575 | -0.054205 | 0.042562 | -0.023455 | -0.007818 |
| 6 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.067619 | +0.022371 | 70.000000 | +9.473684 | 0.043600 | 0.097221 | -0.032065 | 0.116276 | 3.809493 | 0.695515 |
| 6 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.088087 | +0.005217 | 80.000000 | +5.000000 | 0.103202 | 0.073390 | -0.024654 | 0.120244 | 2.683849 | 1.200254 |
| 6 | 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.052318 | +0.019291 | 72.727273 | +12.727273 | 0.059203 | 0.068481 | -0.036441 | 0.083701 | 2.533849 | 0.763984 |
| 6 | 4 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.024348 | -0.012634 | 25.000000 | -17.857143 | -0.035749 | 0.030819 | -0.039727 | 0.018810 | -1.580122 | -0.790061 |
| 6 | 5 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.027685 | -0.010749 | 75.000000 | -5.000000 | 0.036469 | 0.036461 | -0.043590 | 0.095778 | 1.518603 | 0.759302 |
| 6 | 6 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.050116 | +0.018507 | 100.000000 | +25.000000 | 0.025659 | 0.059925 | -0.050644 | 0.074696 | 1.448544 | 0.836317 |
| 6 | 7 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.050442 | +0.010710 | 68.421053 | -11.578947 | 0.017758 | 0.164463 | -0.068602 | 0.096967 | 1.336908 | 0.306708 |
| 6 | 8 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 10 | long | 0.034311 | -0.023926 | 60.000000 | -12.727273 | 0.045198 | 0.088540 | -0.069328 | 0.077764 | 1.225445 | 0.387520 |
| 6 | 9 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 8 | long | 0.047706 | +0.079400 | 75.000000 | +20.454545 | 0.048933 | 0.121880 | -0.038798 | 0.083544 | 1.107105 | 0.391421 |
| 6 | 10 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | short | -0.028207 | -0.004596 | 33.333333 | -16.666667 | -0.013548 | 0.081202 | -0.076881 | 0.047430 | -1.042090 | -0.347363 |
| 6 | 11 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 12 | short | -0.042454 | -0.029427 | 41.666667 | -8.333333 | -0.064873 | 0.166365 | -0.134129 | 0.075001 | -0.883993 | -0.255187 |
| 6 | 12 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.032792 | +0.047705 | 50.000000 | +35.714286 | -0.002760 | 0.128418 | -0.070238 | 0.034687 | -0.722255 | -0.255356 |
| 6 | 13 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 10 | long | 0.019620 | +0.047936 | 40.000000 | +12.727273 | -0.004986 | 0.099626 | -0.076190 | 0.068061 | 0.622778 | 0.196940 |
| 6 | 14 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.077769 | -0.038286 | 50.000000 | 0.000000 | 0.000763 | 0.289967 | -0.170158 | 0.130294 | -0.536397 | -0.268198 |
| 6 | 15 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 12 | short | -0.011520 | +0.025546 | 25.000000 | +1.923077 | -0.020775 | 0.076744 | -0.067534 | 0.046703 | -0.520016 | -0.150116 |
| 6 | 16 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 9 | short | -0.004923 | -0.009690 | 55.555556 | +12.698413 | 0.002933 | 0.064692 | -0.074911 | 0.043883 | -0.228293 | -0.076098 |
| 12 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.087959 | +0.015741 | 70.000000 | +9.473684 | 0.072818 | 0.113342 | -0.044246 | 0.155054 | 4.250594 | 0.776049 |
| 12 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.106761 | -0.008170 | 80.000000 | -20.000000 | 0.124615 | 0.088450 | -0.029509 | 0.132135 | 2.698977 | 1.207019 |
| 12 | 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.058457 | +0.005921 | 72.727273 | +2.727273 | 0.046420 | 0.084010 | -0.041291 | 0.101790 | 2.307825 | 0.695835 |
| 12 | 4 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.059300 | -0.047020 | 0.000000 | -57.142857 | -0.043006 | 0.061057 | -0.091878 | 0.018810 | -1.942439 | -0.971220 |
| 12 | 5 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 8 | long | 0.104599 | +0.125727 | 87.500000 | +28.409091 | 0.051534 | 0.229091 | -0.051977 | 0.174801 | 1.291413 | 0.456584 |
| 12 | 6 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | long | 0.066535 | -0.002611 | 66.666667 | -3.333333 | 0.069895 | 0.170140 | -0.086869 | 0.118891 | 1.173177 | 0.391059 |
| 12 | 7 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | short | -0.049429 | -0.004849 | 25.000000 | +5.000000 | -0.040666 | 0.129219 | -0.101470 | 0.104241 | -0.765042 | -0.382521 |
| 12 | 8 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 10 | long | 0.016075 | +0.038657 | 60.000000 | +5.454545 | 0.013372 | 0.069124 | -0.084484 | 0.100248 | 0.735420 | 0.232560 |
| 12 | 9 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.037360 | +0.080500 | 62.500000 | +48.214286 | 0.010376 | 0.175968 | -0.087512 | 0.055527 | -0.600516 | -0.212314 |
| 12 | 10 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 11 | long | 0.037140 | -0.002931 | 54.545455 | -6.993007 | 0.051345 | 0.260782 | -0.169787 | 0.149086 | 0.472352 | 0.142419 |
| 12 | 11 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 10 | long | 0.021639 | -0.011996 | 60.000000 | -8.181818 | 0.045817 | 0.149989 | -0.088791 | 0.114689 | 0.456216 | 0.144268 |
| 12 | 12 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.021817 | -0.041049 | 47.368421 | -17.631579 | -0.003997 | 0.316699 | -0.137992 | 0.131671 | 0.300278 | 0.068889 |
| 12 | 13 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 9 | short | -0.013046 | -0.046573 | 33.333333 | -9.523810 | -0.014541 | 0.137329 | -0.123003 | 0.100759 | -0.285005 | -0.095002 |
| 12 | 14 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.018335 | +0.007395 | 33.333333 | +8.333333 | -0.027010 | 0.116114 | -0.051582 | 0.089876 | 0.273504 | 0.157908 |
| 12 | 15 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 12 | short | -0.002530 | +0.010018 | 25.000000 | -5.769231 | -0.039026 | 0.110009 | -0.102457 | 0.092599 | -0.079660 | -0.022996 |
| 12 | 16 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | long | 0.001416 | -0.008666 | 50.000000 | 0.000000 | 0.044153 | 0.188703 | -0.175715 | 0.138960 | 0.015010 | 0.007505 |
| 24 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.106935 | +0.031109 | 76.666667 | +10.877193 | 0.084516 | 0.153221 | -0.052285 | 0.206998 | 3.822640 | 0.697915 |
| 24 | 2 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 10 | long | 0.049934 | +0.044037 | 70.000000 | +15.454545 | 0.068139 | 0.083579 | -0.089000 | 0.125524 | 1.889286 | 0.597445 |
| 24 | 3 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 9 | long | 0.201569 | -0.098503 | 55.555556 | -30.158730 | 0.050416 | 0.353397 | -0.159526 | 0.279706 | 1.711123 | 0.570374 |
| 24 | 4 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 12 | long | 0.155399 | +0.037903 | 58.333333 | +4.487179 | 0.067365 | 0.322915 | -0.130772 | 0.211556 | 1.667051 | 0.481236 |
| 24 | 5 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.052052 | +0.029009 | 72.727273 | +12.727273 | 0.047841 | 0.110651 | -0.058682 | 0.129135 | 1.560204 | 0.470419 |
| 24 | 6 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.017646 | +0.000889 | 66.666667 | -8.333333 | 0.017556 | 0.023763 | -0.062714 | 0.116805 | 1.286185 | 0.742579 |
| 24 | 7 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.049477 | -0.011940 | 60.000000 | +10.000000 | 0.037931 | 0.086039 | -0.047808 | 0.160992 | 1.285859 | 0.575054 |
| 24 | 8 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 8 | long | 0.099504 | +0.109552 | 62.500000 | +7.954545 | 0.053797 | 0.289396 | -0.095376 | 0.217856 | 0.972508 | 0.343833 |
| 24 | 9 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | long | 0.065867 | -0.009227 | 55.555556 | -24.444444 | 0.082342 | 0.205882 | -0.111126 | 0.150965 | 0.959783 | 0.319928 |
| 24 | 10 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | short | -0.038225 | -0.017572 | 50.000000 | -10.000000 | -0.046255 | 0.086989 | -0.153218 | 0.108669 | -0.878853 | -0.439426 |
| 24 | 11 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 10 | long | 0.034971 | -0.025385 | 60.000000 | -3.636364 | 0.036356 | 0.127012 | -0.116095 | 0.142873 | 0.870698 | 0.275339 |
| 24 | 12 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | long | 0.190001 | +0.057207 | 50.000000 | -7.142857 | 0.018054 | 0.473527 | -0.140379 | 0.269152 | 0.802493 | 0.401247 |
| 24 | 13 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 8 | long | 0.069624 | +0.145052 | 50.000000 | +7.142857 | 0.016861 | 0.355047 | -0.126769 | 0.203031 | 0.554652 | 0.196099 |
| 24 | 14 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 11 | long | 0.021192 | -0.009313 | 54.545455 | -14.685314 | 0.009864 | 0.165549 | -0.207802 | 0.174433 | 0.424571 | 0.128013 |
| 24 | 15 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.022821 | -0.029418 | 47.368421 | -7.631579 | -0.001445 | 0.377474 | -0.164824 | 0.179209 | 0.263522 | 0.060456 |
| 24 | 16 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.002484 | -0.017161 | 50.000000 | 0.000000 | 0.096487 | 0.310966 | -0.187989 | 0.151639 | -0.015978 | -0.007989 |

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.052897 | 70.000000 | 3.958173 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.043847 | 80.000000 | 2.495200 |
| 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.036635 | 63.636364 | 2.363694 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.036589 | 75.000000 | 1.428719 |
| 5 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 8 | long | 0.032682 | 75.000000 | 1.254513 |
| 6 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 13 | short | -0.047092 | 38.461538 | -1.248988 |
| 7 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.033977 | 52.631579 | 1.215232 |
| 8 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | short | -0.021674 | 55.555556 | -0.733445 |
| 9 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 10 | long | 0.006622 | 60.000000 | 0.620811 |
| 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 10 | short | -0.010376 | 50.000000 | -0.410954 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.067619 | 70.000000 | 3.809493 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.088087 | 80.000000 | 2.683849 |
| 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.052318 | 72.727273 | 2.533849 |
| 4 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.024348 | 25.000000 | -1.580122 |
| 5 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.027685 | 75.000000 | 1.518603 |
| 6 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.050116 | 100.000000 | 1.448544 |
| 7 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.050442 | 68.421053 | 1.336908 |
| 8 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 10 | long | 0.034311 | 60.000000 | 1.225445 |
| 9 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 8 | long | 0.047706 | 75.000000 | 1.107105 |
| 10 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | short | -0.028207 | 33.333333 | -1.042090 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.087959 | 70.000000 | 4.250594 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.106761 | 80.000000 | 2.698977 |
| 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.058457 | 72.727273 | 2.307825 |
| 4 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.059300 | 0.000000 | -1.942439 |
| 5 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 8 | long | 0.104599 | 87.500000 | 1.291413 |
| 6 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | long | 0.066535 | 66.666667 | 1.173177 |
| 7 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | short | -0.049429 | 25.000000 | -0.765042 |
| 8 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 10 | long | 0.016075 | 60.000000 | 0.735420 |
| 9 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.037360 | 62.500000 | -0.600516 |
| 10 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 11 | long | 0.037140 | 54.545455 | 0.472352 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.106935 | 76.666667 | 3.822640 |
| 2 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 10 | long | 0.049934 | 70.000000 | 1.889286 |
| 3 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 9 | long | 0.201569 | 55.555556 | 1.711123 |
| 4 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 12 | long | 0.155399 | 58.333333 | 1.667051 |
| 5 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.052052 | 72.727273 | 1.560204 |
| 6 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.017646 | 66.666667 | 1.286185 |
| 7 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.049477 | 60.000000 | 1.285859 |
| 8 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 8 | long | 0.099504 | 62.500000 | 0.972508 |
| 9 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | long | 0.065867 | 55.555556 | 0.959783 |
| 10 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | short | -0.038225 | 50.000000 | -0.878853 |

## slow fast / slow context

- Study ID: `1c314f44-2640-49b0-a07f-a369e2c40738`
- Variant: `horizon-slow-fast-slow-context`
- Description: timeHorizon grid: 1m=16, 2m=14, 5m=12, 15m=12.
- Observed transitions: 149
- Result rows: 64
- Occurrence rows: 593
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Family Summary By Horizon

| Horizon | Family | Patterns | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | ---: | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | 1 | 30 | 0.060926 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.695398 | long |
| 3 | bear_confluence | 1 | 6 | -0.031214 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.415994 | short |
| 3 | fast_bullish_reversal | 1 | 7 | -0.019267 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.531769 | short |
| 3 | fast_bearish_reversal | 1 | 14 | 0.021092 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.152319 | long |
| 3 | mixed_divergence | 12 | 92 | 0.006161 | `1m:buy|2m:sell|5m:buy|15m:sell` | 1.141762 | long |
| 3 | inactive | 0 | 0 |  | `` |  |  |
| 6 | bull_confluence | 1 | 30 | 0.074972 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.274613 | long |
| 6 | bear_confluence | 1 | 6 | 0.003000 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.032594 | long |
| 6 | fast_bullish_reversal | 1 | 7 | -0.021443 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.631867 | short |
| 6 | fast_bearish_reversal | 1 | 14 | 0.031893 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.083399 | long |
| 6 | mixed_divergence | 12 | 91 | 0.006493 | `1m:sell|2m:sell|5m:sell|15m:buy` | 2.046421 | short |
| 6 | inactive | 0 | 0 |  | `` |  |  |
| 12 | bull_confluence | 1 | 30 | 0.100540 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.793140 | long |
| 12 | bear_confluence | 1 | 6 | 0.124900 | `1m:sell|2m:sell|5m:sell|15m:sell` | 1.244375 | long |
| 12 | fast_bullish_reversal | 1 | 7 | 0.008587 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.258797 | long |
| 12 | fast_bearish_reversal | 1 | 14 | 0.070413 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.357750 | long |
| 12 | mixed_divergence | 12 | 91 | 0.004056 | `1m:buy|2m:buy|5m:sell|15m:buy` | 1.435266 | long |
| 12 | inactive | 0 | 0 |  | `` |  |  |
| 24 | bull_confluence | 1 | 30 | 0.116132 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.275670 | long |
| 24 | bear_confluence | 1 | 6 | 0.024614 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.284542 | long |
| 24 | fast_bullish_reversal | 1 | 7 | -0.015020 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.309675 | short |
| 24 | fast_bearish_reversal | 1 | 14 | 0.187677 | `1m:sell|2m:sell|5m:buy|15m:buy` | 2.034846 | long |
| 24 | mixed_divergence | 12 | 91 | 0.042869 | `1m:sell|2m:buy|5m:buy|15m:sell` | 1.658595 | long |
| 24 | inactive | 0 | 0 |  | `` |  |  |

### All Observed Combination Outcomes

| Horizon | Rank | Pattern | Family | n | Bias | Mean% | Delta Mean% | Win% | Delta Win% | Median% | Std% | MAE% | MFE% | t-stat | Score |
| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.060926 | +0.016127 | 76.666667 | +8.245614 | 0.041637 | 0.071070 | -0.017505 | 0.087374 | 4.695398 | 0.857259 |
| 3 | 2 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 14 | long | 0.021092 | -0.001542 | 57.142857 | +2.597402 | 0.008721 | 0.068487 | -0.043945 | 0.055483 | 1.152319 | 0.307970 |
| 3 | 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.033510 | -0.014716 | 66.666667 | -8.333333 | 0.053474 | 0.050834 | -0.033273 | 0.054313 | 1.141762 | 0.659197 |
| 3 | 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.026145 | +0.003872 | 50.000000 | -25.000000 | 0.002205 | 0.110891 | -0.050871 | 0.065930 | 1.105863 | 0.235771 |
| 3 | 5 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.028859 | +0.015405 | 33.333333 | -3.030303 | -0.030717 | 0.065100 | -0.068206 | 0.029384 | -1.085860 | -0.443301 |
| 3 | 6 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 12 | long | 0.008600 | +0.003343 | 50.000000 | +9.090909 | 0.004031 | 0.034401 | -0.046924 | 0.046068 | 0.865999 | 0.249992 |
| 3 | 7 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.019633 | +0.006978 | 38.461538 | +7.692307 | -0.008797 | 0.081780 | -0.076985 | 0.040192 | -0.865593 | -0.240072 |
| 3 | 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.013120 | -0.020628 | 42.857143 | -17.142857 | -0.008121 | 0.048358 | -0.034774 | 0.044203 | 0.717799 | 0.271303 |
| 3 | 9 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 7 | short | -0.019267 | -0.030565 | 57.142857 | -2.857143 | 0.038708 | 0.095861 | -0.049929 | 0.034029 | -0.531769 | -0.200990 |
| 3 | 10 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 6 | short | -0.031214 | -0.009601 | 50.000000 | -3.333333 | 0.001063 | 0.183795 | -0.114015 | 0.070484 | -0.415994 | -0.169829 |
| 3 | 11 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.011847 | -0.020171 | 50.000000 | -30.000000 | 0.011847 | 0.042609 | -0.053074 | 0.034285 | 0.393209 | 0.278041 |
| 3 | 12 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.012723 | +0.033184 | 50.000000 | 0.000000 | -0.016243 | 0.092911 | -0.064294 | 0.102173 | -0.273871 | -0.136936 |
| 3 | 13 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 9 | long | 0.004872 | +0.014119 | 66.666667 | +23.809524 | 0.007001 | 0.065477 | -0.046723 | 0.038829 | 0.223225 | 0.074408 |
| 3 | 14 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.004684 | +0.008251 | 50.000000 | +21.428571 | 0.011248 | 0.057875 | -0.032441 | 0.043321 | 0.198238 | 0.080930 |
| 3 | 15 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.000865 | -0.011201 | 57.142857 | 0.000000 | 0.018869 | 0.047389 | -0.045638 | 0.045463 | 0.048277 | 0.018247 |
| 3 | 16 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 1 | long | 0.073622 | +0.069953 | 100.000000 | +75.000000 | 0.073622 | 0.000000 | -0.003036 | 0.107777 | 0.000000 | 0.000000 |
| 6 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.074972 | +0.029724 | 73.333333 | +12.807017 | 0.055241 | 0.096064 | -0.030466 | 0.123731 | 4.274613 | 0.780434 |
| 6 | 2 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 12 | short | -0.042934 | -0.005868 | 25.000000 | +1.923077 | -0.021250 | 0.072677 | -0.095527 | 0.043941 | -2.046421 | -0.590751 |
| 6 | 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.050622 | -0.032248 | 66.666667 | -8.333333 | 0.075990 | 0.068862 | -0.033273 | 0.086809 | 1.273260 | 0.735117 |
| 6 | 4 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 12 | long | 0.031926 | -0.026311 | 58.333333 | -14.393940 | 0.015005 | 0.087462 | -0.062739 | 0.075141 | 1.264483 | 0.365025 |
| 6 | 5 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.037006 | -0.002726 | 68.181818 | -11.818182 | 0.018101 | 0.145482 | -0.070291 | 0.084838 | 1.193101 | 0.254370 |
| 6 | 6 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 14 | long | 0.031893 | +0.063587 | 64.285714 | +9.740259 | 0.024278 | 0.110146 | -0.056845 | 0.079808 | 1.083399 | 0.289551 |
| 6 | 7 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.026661 | -0.006366 | 57.142857 | -2.857143 | 0.025342 | 0.072203 | -0.045131 | 0.064183 | 0.976958 | 0.369255 |
| 6 | 8 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.012372 | -0.017139 | 57.142857 | +14.285714 | 0.017758 | 0.048781 | -0.059956 | 0.046260 | -0.671029 | -0.253625 |
| 6 | 9 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 7 | short | -0.021443 | +0.002168 | 42.857143 | -7.142857 | -0.004083 | 0.089788 | -0.071639 | 0.047755 | -0.631867 | -0.238823 |
| 6 | 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.017333 | +0.010983 | 16.666667 | -10.606060 | -0.008800 | 0.078538 | -0.080657 | 0.037336 | -0.540605 | -0.220701 |
| 6 | 11 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.077769 | -0.038286 | 50.000000 | 0.000000 | 0.000763 | 0.289967 | -0.170158 | 0.130294 | -0.536397 | -0.268198 |
| 6 | 12 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.004969 | -0.033465 | 50.000000 | -30.000000 | 0.004969 | 0.040845 | -0.053074 | 0.043086 | 0.172065 | 0.121668 |
| 6 | 13 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | short | -0.003686 | +0.008028 | 50.000000 | +7.142857 | 0.003663 | 0.059954 | -0.045500 | 0.050208 | -0.150602 | -0.061483 |
| 6 | 14 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 9 | short | -0.003805 | +0.076692 | 55.555556 | +41.269842 | 0.001481 | 0.149045 | -0.084230 | 0.063639 | -0.076590 | -0.025530 |
| 6 | 15 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 6 | long | 0.003000 | +0.016027 | 66.666667 | +16.666667 | 0.040036 | 0.225491 | -0.130056 | 0.101109 | 0.032594 | 0.013307 |
| 6 | 16 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 1 | long | 0.118402 | +0.086793 | 100.000000 | +25.000000 | 0.118402 | 0.000000 | -0.003036 | 0.151798 | 0.000000 | 0.000000 |
| 12 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.100540 | +0.028322 | 73.333333 | +12.807017 | 0.082209 | 0.114890 | -0.042647 | 0.166362 | 4.793140 | 0.875104 |
| 12 | 2 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.106824 | +0.119104 | 66.666667 | +9.523810 | 0.058509 | 0.182310 | -0.052405 | 0.131896 | 1.435266 | 0.585945 |
| 12 | 3 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 14 | long | 0.070413 | +0.091541 | 57.142857 | -1.948052 | 0.027079 | 0.194042 | -0.083126 | 0.164537 | 1.357750 | 0.362874 |
| 12 | 4 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.068305 | -0.046626 | 66.666667 | -33.333333 | 0.057696 | 0.092276 | -0.041365 | 0.101480 | 1.282120 | 0.740232 |
| 12 | 5 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 6 | long | 0.124900 | +0.084829 | 66.666667 | +5.128205 | 0.121261 | 0.245859 | -0.132431 | 0.180372 | 1.244375 | 0.508014 |
| 12 | 6 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 12 | short | -0.047782 | -0.035234 | 25.000000 | -5.769231 | -0.055135 | 0.157660 | -0.133838 | 0.067550 | -1.049865 | -0.303070 |
| 12 | 7 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 6 | long | 0.025993 | +0.048575 | 66.666667 | +12.121212 | 0.013372 | 0.070778 | -0.088634 | 0.076313 | 0.899558 | 0.367243 |
| 12 | 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.013461 | -0.039075 | 57.142857 | -12.857143 | 0.020302 | 0.041027 | -0.049642 | 0.073356 | 0.868047 | 0.328091 |
| 12 | 9 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 9 | short | -0.045778 | +0.072082 | 44.444444 | +30.158730 | -0.001400 | 0.164221 | -0.103001 | 0.082388 | -0.836269 | -0.278756 |
| 12 | 10 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.042785 | +0.087365 | 50.000000 | +30.000000 | 0.042785 | 0.076410 | -0.053074 | 0.060012 | 0.791875 | 0.559940 |
| 12 | 11 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.009465 | -0.042992 | 28.571429 | -14.285714 | -0.014541 | 0.063554 | -0.075781 | 0.066133 | -0.394018 | -0.148925 |
| 12 | 12 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 12 | long | 0.009998 | -0.023637 | 66.666667 | -1.515151 | 0.028498 | 0.121825 | -0.075564 | 0.095137 | 0.284302 | 0.082071 |
| 12 | 13 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 7 | long | 0.008587 | -0.060559 | 57.142857 | -12.857143 | 0.049968 | 0.087787 | -0.080551 | 0.073127 | 0.258797 | 0.097816 |
| 12 | 14 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | short | -0.001672 | -0.064538 | 45.454545 | -19.545455 | -0.004801 | 0.285732 | -0.146280 | 0.124108 | -0.027449 | -0.005852 |
| 12 | 15 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | long | 0.001416 | -0.008666 | 50.000000 | 0.000000 | 0.044153 | 0.188703 | -0.175715 | 0.138960 | 0.015010 | 0.007505 |
| 12 | 16 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 1 | long | 0.150280 | +0.139340 | 100.000000 | +75.000000 | 0.150280 | 0.000000 | -0.003036 | 0.197337 | 0.000000 | 0.000000 |
| 24 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.116132 | +0.040306 | 83.333333 | +17.543859 | 0.090718 | 0.148768 | -0.050084 | 0.217599 | 4.275670 | 0.780627 |
| 24 | 2 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 14 | long | 0.187677 | +0.197725 | 71.428571 | +16.883116 | 0.102593 | 0.345099 | -0.122051 | 0.277265 | 2.034846 | 0.543836 |
| 24 | 3 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.035479 | +0.056132 | 100.000000 | +40.000000 | 0.035479 | 0.030251 | -0.071371 | 0.068867 | 1.658595 | 1.172804 |
| 24 | 4 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.130511 | -0.002283 | 83.333333 | +26.190476 | 0.107084 | 0.213359 | -0.078307 | 0.188850 | 1.498349 | 0.611698 |
| 24 | 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 12 | long | 0.098163 | +0.037807 | 66.666667 | +3.030303 | 0.039609 | 0.247456 | -0.114937 | 0.202422 | 1.374165 | 0.396687 |
| 24 | 6 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 6 | long | 0.040692 | +0.034795 | 66.666667 | +12.121212 | 0.057024 | 0.085737 | -0.088634 | 0.112513 | 1.162578 | 0.474620 |
| 24 | 7 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.077871 | +0.025632 | 50.000000 | -5.000000 | 0.034522 | 0.412168 | -0.182906 | 0.224005 | 0.886160 | 0.188930 |
| 24 | 8 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.022485 | -0.322557 | 28.571429 | -57.142857 | -0.054256 | 0.087748 | -0.104803 | 0.077494 | -0.677977 | -0.256251 |
| 24 | 9 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 12 | long | 0.017290 | -0.100206 | 50.000000 | -3.846154 | 0.004932 | 0.096499 | -0.183971 | 0.095387 | 0.620684 | 0.179176 |
| 24 | 10 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 9 | short | -0.024834 | +0.050594 | 44.444444 | +1.587301 | -0.006961 | 0.182888 | -0.120755 | 0.091787 | -0.407372 | -0.135791 |
| 24 | 11 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.015785 | -0.007258 | 57.142857 | -2.857143 | 0.004554 | 0.120286 | -0.075046 | 0.093618 | 0.347195 | 0.131227 |
| 24 | 12 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 7 | short | -0.015020 | -0.090114 | 42.857143 | -37.142857 | -0.013670 | 0.128323 | -0.111737 | 0.085682 | -0.309675 | -0.117046 |
| 24 | 13 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 6 | long | 0.024614 | -0.005891 | 66.666667 | -2.564102 | 0.046869 | 0.211892 | -0.142134 | 0.201916 | 0.284542 | 0.116164 |
| 24 | 14 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | short | -0.003094 | -0.064511 | 33.333333 | -16.666667 | -0.010624 | 0.037826 | -0.071864 | 0.135068 | -0.141659 | -0.081787 |
| 24 | 15 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.002484 | -0.017161 | 50.000000 | 0.000000 | 0.096487 | 0.310966 | -0.187989 | 0.151639 | -0.015978 | -0.007989 |
| 24 | 16 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 1 | short | -0.006072 | -0.022829 | 0.000000 | -75.000000 | -0.006072 | 0.000000 | -0.036432 | 0.210999 | 0.000000 | 0.000000 |

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.060926 | 76.666667 | 4.695398 |
| 2 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 14 | long | 0.021092 | 57.142857 | 1.152319 |
| 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.033510 | 66.666667 | 1.141762 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.026145 | 50.000000 | 1.105863 |
| 5 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.028859 | 33.333333 | -1.085860 |
| 6 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 12 | long | 0.008600 | 50.000000 | 0.865999 |
| 7 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.019633 | 38.461538 | -0.865593 |
| 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.013120 | 42.857143 | 0.717799 |
| 9 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 7 | short | -0.019267 | 57.142857 | -0.531769 |
| 10 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 6 | short | -0.031214 | 50.000000 | -0.415994 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.074972 | 73.333333 | 4.274613 |
| 2 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 12 | short | -0.042934 | 25.000000 | -2.046421 |
| 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.050622 | 66.666667 | 1.273260 |
| 4 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 12 | long | 0.031926 | 58.333333 | 1.264483 |
| 5 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.037006 | 68.181818 | 1.193101 |
| 6 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 14 | long | 0.031893 | 64.285714 | 1.083399 |
| 7 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.026661 | 57.142857 | 0.976958 |
| 8 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.012372 | 57.142857 | -0.671029 |
| 9 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 7 | short | -0.021443 | 42.857143 | -0.631867 |
| 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.017333 | 16.666667 | -0.540605 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.100540 | 73.333333 | 4.793140 |
| 2 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.106824 | 66.666667 | 1.435266 |
| 3 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 14 | long | 0.070413 | 57.142857 | 1.357750 |
| 4 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.068305 | 66.666667 | 1.282120 |
| 5 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 6 | long | 0.124900 | 66.666667 | 1.244375 |
| 6 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 12 | short | -0.047782 | 25.000000 | -1.049865 |
| 7 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 6 | long | 0.025993 | 66.666667 | 0.899558 |
| 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.013461 | 57.142857 | 0.868047 |
| 9 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 9 | short | -0.045778 | 44.444444 | -0.836269 |
| 10 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.042785 | 50.000000 | 0.791875 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.116132 | 83.333333 | 4.275670 |
| 2 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 14 | long | 0.187677 | 71.428571 | 2.034846 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.035479 | 100.000000 | 1.658595 |
| 4 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.130511 | 83.333333 | 1.498349 |
| 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 12 | long | 0.098163 | 66.666667 | 1.374165 |
| 6 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 6 | long | 0.040692 | 66.666667 | 1.162578 |
| 7 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.077871 | 50.000000 | 0.886160 |
| 8 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.022485 | 28.571429 | -0.677977 |
| 9 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 12 | long | 0.017290 | 50.000000 | 0.620684 |
| 10 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 9 | short | -0.024834 | 44.444444 | -0.407372 |

