# MTF Pattern Discovery Settings Sweep

- Symbols: SPY, QQQ
- Timeframes: 1m, 2m, 5m, 15m
- Horizons: 3, 6, 12, 24
- Study window: 2026-04-24T00:00:00.000Z through latest loaded bar
- Min sample threshold: 1
- Possible direction combinations per horizon: 81
- Variants: 17

## Cross-Variant Best By Family/Horizon

| Horizon | Family | Variant | Study ID | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | --- | --- | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | slow fast / slow context | `e724bbad-0341-4d61-8585-66a0ad4e03a1` | 30 | 0.060926 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.695398 | long |
| 3 | bear_confluence | fast fast / tight context | `51afa2ad-2e1e-4d08-80e7-11f5dac22d4f` | 28 | -0.033016 | `1m:sell|2m:sell|5m:sell|15m:sell` | 1.711857 | short |
| 3 | fast_bullish_reversal | slow fast / tight context | `021dd608-5d65-4ed2-ad50-360bb5d62dd2` | 6 | -0.089980 | `1m:buy|2m:buy|5m:sell|15m:sell` | 2.016143 | short |
| 3 | fast_bearish_reversal | 2m fast only | `93a32831-1ae9-4fda-8d9c-c6fcf257cd56` | 32 | 0.026658 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.468652 | long |
| 3 | mixed_divergence | 2m slow only | `4c5581f4-001c-4027-b496-e6c04a6343e2` | 117 | 0.008656 | `1m:buy|2m:sell|5m:buy|15m:sell` | 9.475817 | long |
| 6 | bull_confluence | slow fast / slow context | `e724bbad-0341-4d61-8585-66a0ad4e03a1` | 30 | 0.074972 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.274613 | long |
| 6 | bear_confluence | fast fast / tight context | `51afa2ad-2e1e-4d08-80e7-11f5dac22d4f` | 28 | -0.027340 | `1m:sell|2m:sell|5m:sell|15m:sell` | 1.185857 | short |
| 6 | fast_bullish_reversal | slow fast / tight context | `021dd608-5d65-4ed2-ad50-360bb5d62dd2` | 6 | -0.085987 | `1m:buy|2m:buy|5m:sell|15m:sell` | 1.840257 | short |
| 6 | fast_bearish_reversal | slow fast / base context | `9f734bc6-8597-4ad4-be3b-290638a86e42` | 8 | 0.047706 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.107105 | long |
| 6 | mixed_divergence | base fast / tight context | `c3dd6d8f-2e42-4322-bfd8-1088d05a429e` | 123 | 0.016239 | `1m:sell|2m:sell|5m:buy|15m:sell` | 28.834061 | short |
| 12 | bull_confluence | slow fast / slow context | `e724bbad-0341-4d61-8585-66a0ad4e03a1` | 30 | 0.100540 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.793140 | long |
| 12 | bear_confluence | 15m slow only | `fc20ad1b-f842-42f9-b693-0f0cc6820ec4` | 6 | 0.124900 | `1m:sell|2m:sell|5m:sell|15m:sell` | 1.244375 | long |
| 12 | fast_bullish_reversal | fast fast / slow context | `c3c3106c-ed4a-4af4-b970-b0686395c44c` | 8 | 0.057735 | `1m:buy|2m:buy|5m:sell|15m:sell` | 2.854347 | long |
| 12 | fast_bearish_reversal | slow fast / slow context | `e724bbad-0341-4d61-8585-66a0ad4e03a1` | 14 | 0.070413 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.357750 | long |
| 12 | mixed_divergence | fast fast / base context | `367ebc7e-f1ad-47f6-a9ca-3c21dede7527` | 199 | -0.016745 | `1m:buy|2m:sell|5m:buy|15m:sell` | 5.291004 | short |
| 24 | bull_confluence | slow fast / slow context | `e724bbad-0341-4d61-8585-66a0ad4e03a1` | 30 | 0.116132 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.275670 | long |
| 24 | bear_confluence | 2m fast only | `93a32831-1ae9-4fda-8d9c-c6fcf257cd56` | 15 | 0.035980 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.849234 | long |
| 24 | fast_bullish_reversal | fast fast / base context | `367ebc7e-f1ad-47f6-a9ca-3c21dede7527` | 19 | 0.105624 | `1m:buy|2m:buy|5m:sell|15m:sell` | 3.083977 | long |
| 24 | fast_bearish_reversal | slow fast / slow context | `e724bbad-0341-4d61-8585-66a0ad4e03a1` | 14 | 0.187677 | `1m:sell|2m:sell|5m:buy|15m:buy` | 2.034846 | long |
| 24 | mixed_divergence | fast fast / base context | `367ebc7e-f1ad-47f6-a9ca-3c21dede7527` | 198 | -0.001396 | `1m:sell|2m:buy|5m:buy|15m:sell` | 3.211292 | long |

## Baseline calibrated defaults

- Study ID: `9ad8f0b5-4373-4e4e-a4c0-20765b721e2f`
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

## 1m fast only

- Study ID: `34a49681-df05-4963-b8d0-895ff18b8b2d`
- Variant: `horizon-1m-fast-only`
- Description: One-factor timeHorizon change: 1m=6, all other timeframe settings use defaults.
- Observed transitions: 311
- Result rows: 64
- Occurrence rows: 1236
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"fast_bearish_reversal":4,"bear_confluence":4,"fast_bullish_reversal":4}`

### Family Summary By Horizon

| Horizon | Family | Patterns | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | ---: | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | 1 | 59 | 0.033484 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.753934 | long |
| 3 | bear_confluence | 1 | 23 | -0.031562 | `1m:sell|2m:sell|5m:sell|15m:sell` | 1.212991 | short |
| 3 | fast_bullish_reversal | 1 | 13 | 0.007924 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.430645 | long |
| 3 | fast_bearish_reversal | 1 | 28 | 0.005596 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.283069 | long |
| 3 | mixed_divergence | 12 | 188 | 0.005163 | `1m:sell|2m:buy|5m:buy|15m:buy` | 2.650634 | long |
| 3 | inactive | 0 | 0 |  | `` |  |  |
| 6 | bull_confluence | 1 | 59 | 0.033413 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.432462 | long |
| 6 | bear_confluence | 1 | 22 | -0.030664 | `1m:sell|2m:sell|5m:sell|15m:sell` | 1.028313 | short |
| 6 | fast_bullish_reversal | 1 | 13 | -0.009802 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.225994 | short |
| 6 | fast_bearish_reversal | 1 | 28 | -0.037345 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.646051 | short |
| 6 | mixed_divergence | 12 | 188 | 0.006033 | `1m:sell|2m:buy|5m:buy|15m:buy` | 2.216334 | long |
| 6 | inactive | 0 | 0 |  | `` |  |  |
| 12 | bull_confluence | 1 | 59 | 0.035387 | `1m:buy|2m:buy|5m:buy|15m:buy` | 2.255768 | long |
| 12 | bear_confluence | 1 | 21 | 0.002808 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.065447 | long |
| 12 | fast_bullish_reversal | 1 | 13 | 0.068414 | `1m:buy|2m:buy|5m:sell|15m:sell` | 1.577311 | long |
| 12 | fast_bearish_reversal | 1 | 28 | -0.021032 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.286627 | short |
| 12 | mixed_divergence | 12 | 187 | 0.005710 | `1m:buy|2m:buy|5m:sell|15m:buy` | 2.493330 | long |
| 12 | inactive | 0 | 0 |  | `` |  |  |
| 24 | bull_confluence | 1 | 59 | 0.036731 | `1m:buy|2m:buy|5m:buy|15m:buy` | 1.202107 | long |
| 24 | bear_confluence | 1 | 21 | 0.011121 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.352284 | long |
| 24 | fast_bullish_reversal | 1 | 13 | 0.086964 | `1m:buy|2m:buy|5m:sell|15m:sell` | 1.498179 | long |
| 24 | fast_bearish_reversal | 1 | 28 | -0.053933 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.630285 | short |
| 24 | mixed_divergence | 12 | 186 | 0.026861 | `1m:sell|2m:buy|5m:sell|15m:buy` | 2.060201 | long |
| 24 | inactive | 0 | 0 |  | `` |  |  |

### All Observed Combination Outcomes

| Horizon | Rank | Pattern | Family | n | Bias | Mean% | Delta Mean% | Win% | Delta Win% | Median% | Std% | MAE% | MFE% | t-stat | Score |
| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 59 | long | 0.033484 | -0.011315 | 64.406780 | -4.014273 | 0.012642 | 0.068514 | -0.020335 | 0.065217 | 3.753934 | 0.488721 |
| 3 | 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 50 | long | 0.026891 | +0.004618 | 66.000000 | -9.000000 | 0.030415 | 0.071737 | -0.037911 | 0.054194 | 2.650634 | 0.374856 |
| 3 | 3 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 19 | short | -0.019990 | +0.006621 | 36.842105 | +6.072874 | -0.009498 | 0.047972 | -0.054329 | 0.027220 | -1.816339 | -0.416697 |
| 3 | 4 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.009629 | -0.000382 | 46.153846 | +3.296703 | -0.010931 | 0.023160 | -0.038428 | 0.022179 | -1.499097 | -0.415775 |
| 3 | 5 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 23 | short | -0.031562 | -0.009949 | 43.478261 | -9.855072 | -0.007865 | 0.124788 | -0.097128 | 0.052516 | -1.212991 | -0.252926 |
| 3 | 6 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 9 | short | -0.048733 | -0.002826 | 55.555556 | +5.555556 | 0.019769 | 0.135102 | -0.095606 | 0.027563 | -1.082139 | -0.360713 |
| 3 | 7 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 16 | long | 0.013141 | -0.020607 | 50.000000 | -10.000000 | 0.004953 | 0.058453 | -0.043503 | 0.049114 | 0.899272 | 0.224818 |
| 3 | 8 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 8 | long | 0.014106 | -0.017912 | 75.000000 | -5.000000 | 0.022850 | 0.057799 | -0.040926 | 0.070824 | 0.690281 | 0.244051 |
| 3 | 9 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.010826 | -0.001240 | 45.454545 | -11.688312 | -0.012531 | 0.060788 | -0.035877 | 0.035598 | 0.590647 | 0.178087 |
| 3 | 10 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.009203 | -0.012872 | 16.666667 | -8.333333 | -0.016874 | 0.042961 | -0.060209 | 0.039704 | -0.524702 | -0.214209 |
| 3 | 11 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.005025 | +0.008592 | 50.000000 | +21.428571 | 0.007712 | 0.023661 | -0.024078 | 0.029949 | 0.520165 | 0.212356 |
| 3 | 12 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 19 | long | 0.006539 | +0.050803 | 63.157895 | +26.794259 | 0.009856 | 0.056804 | -0.041323 | 0.050173 | 0.501754 | 0.115110 |
| 3 | 13 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 13 | long | 0.007924 | -0.003374 | 53.846154 | -6.153846 | 0.020072 | 0.066346 | -0.036463 | 0.056909 | 0.430645 | 0.119439 |
| 3 | 14 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 28 | long | 0.005596 | -0.017038 | 42.857143 | -11.688312 | -0.004752 | 0.104605 | -0.058205 | 0.048826 | 0.283069 | 0.053495 |
| 3 | 15 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 26 | long | 0.000982 | -0.004275 | 42.307692 | +1.398601 | -0.004044 | 0.082537 | -0.045921 | 0.043643 | 0.060686 | 0.011901 |
| 3 | 16 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.000561 | -0.047665 | 40.000000 | -35.000000 | -0.001406 | 0.060738 | -0.038663 | 0.044234 | 0.020639 | 0.009230 |
| 6 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 59 | long | 0.033413 | -0.011835 | 67.796610 | +7.270294 | 0.011970 | 0.074772 | -0.028907 | 0.082898 | 3.432462 | 0.446868 |
| 6 | 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 50 | long | 0.026508 | -0.013224 | 74.000000 | -6.000000 | 0.022052 | 0.084571 | -0.049705 | 0.072659 | 2.216334 | 0.313437 |
| 6 | 3 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 19 | short | -0.022128 | +0.014938 | 31.578947 | +8.502024 | -0.020511 | 0.052564 | -0.079333 | 0.036723 | -1.835017 | -0.420982 |
| 6 | 4 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.041101 | +0.039396 | 38.461538 | +24.175824 | -0.017762 | 0.105693 | -0.079051 | 0.027653 | -1.402104 | -0.388874 |
| 6 | 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 26 | long | 0.029719 | -0.028518 | 65.384615 | -7.342658 | 0.018728 | 0.124129 | -0.058531 | 0.071130 | 1.220814 | 0.239421 |
| 6 | 6 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 16 | long | 0.019338 | -0.013689 | 62.500000 | +2.500000 | 0.029596 | 0.071449 | -0.052560 | 0.065422 | 1.082635 | 0.270659 |
| 6 | 7 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 22 | short | -0.030664 | -0.017637 | 36.363636 | -13.636364 | -0.027321 | 0.139865 | -0.122988 | 0.068728 | -1.028313 | -0.219237 |
| 6 | 8 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 9 | short | -0.036987 | +0.002496 | 44.444444 | -5.555556 | -0.002973 | 0.137682 | -0.131841 | 0.053017 | -0.805915 | -0.268638 |
| 6 | 9 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 28 | short | -0.037345 | -0.005651 | 50.000000 | -4.545455 | 0.003773 | 0.305877 | -0.127224 | 0.064747 | -0.646051 | -0.122092 |
| 6 | 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 19 | long | 0.009424 | +0.037740 | 47.368421 | +20.095694 | 0.000000 | 0.086356 | -0.060908 | 0.069544 | 0.475663 | 0.109125 |
| 6 | 11 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.006209 | -0.010976 | 27.272727 | -15.584416 | -0.026350 | 0.057464 | -0.050150 | 0.050196 | -0.358386 | -0.108058 |
| 6 | 12 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.008218 | -0.039827 | 50.000000 | -25.000000 | -0.008812 | 0.074811 | -0.083457 | 0.050256 | -0.269089 | -0.109855 |
| 6 | 13 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | short | -0.002523 | +0.009191 | 66.666667 | +23.809524 | 0.005268 | 0.026530 | -0.033522 | 0.034505 | -0.232919 | -0.095089 |
| 6 | 14 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 13 | short | -0.009802 | +0.013809 | 53.846154 | +3.846154 | 0.026054 | 0.156380 | -0.072170 | 0.070950 | -0.225994 | -0.062680 |
| 6 | 15 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 8 | short | -0.002496 | -0.040930 | 50.000000 | -30.000000 | 0.014258 | 0.091962 | -0.071482 | 0.087987 | -0.076772 | -0.027143 |
| 6 | 16 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.002410 | -0.085280 | 40.000000 | -35.000000 | -0.019686 | 0.127584 | -0.062604 | 0.076829 | -0.042242 | -0.018891 |
| 12 | 1 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.023130 | +0.035410 | 83.333333 | +26.190476 | 0.026762 | 0.022723 | -0.034243 | 0.049386 | 2.493330 | 1.017898 |
| 12 | 2 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 59 | long | 0.035387 | -0.036831 | 54.237288 | -6.289028 | 0.011161 | 0.120498 | -0.052274 | 0.108667 | 2.255768 | 0.293676 |
| 12 | 3 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 13 | long | 0.068414 | -0.000732 | 76.923077 | +6.923077 | 0.069895 | 0.156387 | -0.079800 | 0.133310 | 1.577311 | 0.437467 |
| 12 | 4 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.051994 | +0.065866 | 30.769231 | +16.483517 | -0.014415 | 0.144861 | -0.107091 | 0.038601 | -1.294115 | -0.358923 |
| 12 | 5 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 19 | long | 0.019808 | +0.042390 | 73.684211 | +19.138756 | 0.032791 | 0.084882 | -0.079123 | 0.099028 | 1.017192 | 0.233360 |
| 12 | 6 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 50 | long | 0.020796 | -0.042070 | 64.000000 | -1.000000 | 0.045290 | 0.184956 | -0.083252 | 0.099129 | 0.795040 | 0.112436 |
| 12 | 7 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.016024 | -0.017503 | 45.454545 | +2.597402 | -0.005425 | 0.108134 | -0.080869 | 0.082270 | 0.491481 | 0.148187 |
| 12 | 8 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 28 | short | -0.021032 | +0.000096 | 60.714286 | +1.623377 | 0.017778 | 0.388281 | -0.152667 | 0.113851 | -0.286627 | -0.054167 |
| 12 | 9 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.012683 | -0.023623 | 20.000000 | -5.000000 | -0.027010 | 0.108445 | -0.084883 | 0.054456 | -0.261524 | -0.116957 |
| 12 | 10 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 16 | long | 0.007454 | -0.045082 | 43.750000 | -26.250000 | -0.007423 | 0.115648 | -0.090102 | 0.076929 | 0.257823 | 0.064456 |
| 12 | 11 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 8 | short | -0.009208 | +0.035372 | 50.000000 | +30.000000 | -0.000517 | 0.111658 | -0.104871 | 0.098109 | -0.233236 | -0.082461 |
| 12 | 12 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 19 | short | -0.006206 | +0.006342 | 42.105263 | +11.336032 | -0.030180 | 0.129662 | -0.109266 | 0.081980 | -0.208633 | -0.047864 |
| 12 | 13 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 26 | long | 0.008505 | -0.025130 | 69.230769 | +1.048951 | 0.051528 | 0.242462 | -0.107451 | 0.102866 | 0.178867 | 0.035079 |
| 12 | 14 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 9 | short | -0.004188 | -0.014270 | 55.555556 | +5.555556 | 0.001273 | 0.105980 | -0.139394 | 0.093103 | -0.118560 | -0.039520 |
| 12 | 15 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.007061 | -0.121992 | 60.000000 | -40.000000 | 0.032327 | 0.158305 | -0.093786 | 0.084136 | -0.099731 | -0.044601 |
| 12 | 16 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 21 | long | 0.002808 | -0.037263 | 47.619048 | -13.919414 | -0.022555 | 0.196643 | -0.154834 | 0.110864 | 0.065447 | 0.014282 |
| 24 | 1 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.181334 | -0.118738 | 72.727273 | -12.987013 | 0.116390 | 0.291922 | -0.104434 | 0.252806 | 2.060201 | 0.621174 |
| 24 | 2 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 13 | long | 0.086964 | +0.011870 | 84.615385 | +4.615385 | 0.082342 | 0.209289 | -0.089707 | 0.171879 | 1.498179 | 0.415520 |
| 24 | 3 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 59 | long | 0.036731 | -0.039095 | 64.406780 | -1.382694 | 0.024165 | 0.234698 | -0.095757 | 0.157832 | 1.202107 | 0.156501 |
| 24 | 4 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.145222 | +0.012428 | 50.000000 | -7.142857 | 0.017555 | 0.327088 | -0.075754 | 0.199371 | 1.087533 | 0.443984 |
| 24 | 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 19 | long | 0.059668 | -0.057828 | 52.631579 | -1.214575 | 0.025231 | 0.304756 | -0.155768 | 0.164633 | 0.853428 | 0.195790 |
| 24 | 6 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 50 | long | 0.022446 | -0.029793 | 64.000000 | +9.000000 | 0.041262 | 0.220024 | -0.108028 | 0.129316 | 0.721373 | 0.102018 |
| 24 | 7 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.043014 | -0.018403 | 50.000000 | 0.000000 | 0.036544 | 0.124667 | -0.076433 | 0.132573 | 0.690071 | 0.345036 |
| 24 | 8 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 28 | short | -0.053933 | -0.043885 | 53.571429 | -0.974026 | 0.024337 | 0.452792 | -0.237368 | 0.154072 | -0.630285 | -0.119113 |
| 24 | 9 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 19 | long | 0.023013 | +0.017116 | 63.157895 | +8.612440 | 0.058038 | 0.162205 | -0.104175 | 0.133103 | 0.618419 | 0.141875 |
| 24 | 10 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 9 | short | -0.029355 | -0.044032 | 33.333333 | -16.666667 | -0.016365 | 0.147072 | -0.169971 | 0.101832 | -0.598791 | -0.199597 |
| 24 | 11 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.023528 | +0.051900 | 61.538462 | +18.681319 | 0.019670 | 0.150537 | -0.125129 | 0.066922 | -0.563532 | -0.156296 |
| 24 | 12 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.006308 | -0.010449 | 60.000000 | -15.000000 | 0.014088 | 0.027820 | -0.097413 | 0.071479 | 0.507025 | 0.226748 |
| 24 | 13 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 8 | long | 0.013986 | +0.034639 | 62.500000 | +2.500000 | 0.042827 | 0.089697 | -0.126170 | 0.139539 | 0.441039 | 0.155931 |
| 24 | 14 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 21 | long | 0.011121 | -0.019384 | 61.904762 | -7.326007 | 0.028482 | 0.144667 | -0.187145 | 0.141262 | 0.352284 | 0.076875 |
| 24 | 15 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 26 | short | -0.008788 | -0.069144 | 65.384615 | +1.748251 | 0.042010 | 0.311406 | -0.185819 | 0.145364 | -0.143891 | -0.028219 |
| 24 | 16 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 16 | short | -0.005000 | -0.028043 | 56.250000 | -3.750000 | 0.026198 | 0.141074 | -0.126396 | 0.107601 | -0.141764 | -0.035441 |

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 59 | long | 0.033484 | 64.406780 | 3.753934 |
| 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 50 | long | 0.026891 | 66.000000 | 2.650634 |
| 3 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 19 | short | -0.019990 | 36.842105 | -1.816339 |
| 4 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.009629 | 46.153846 | -1.499097 |
| 5 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 23 | short | -0.031562 | 43.478261 | -1.212991 |
| 6 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 9 | short | -0.048733 | 55.555556 | -1.082139 |
| 7 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 16 | long | 0.013141 | 50.000000 | 0.899272 |
| 8 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 8 | long | 0.014106 | 75.000000 | 0.690281 |
| 9 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.010826 | 45.454545 | 0.590647 |
| 10 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.009203 | 16.666667 | -0.524702 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 59 | long | 0.033413 | 67.796610 | 3.432462 |
| 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 50 | long | 0.026508 | 74.000000 | 2.216334 |
| 3 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 19 | short | -0.022128 | 31.578947 | -1.835017 |
| 4 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.041101 | 38.461538 | -1.402104 |
| 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 26 | long | 0.029719 | 65.384615 | 1.220814 |
| 6 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 16 | long | 0.019338 | 62.500000 | 1.082635 |
| 7 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 22 | short | -0.030664 | 36.363636 | -1.028313 |
| 8 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 9 | short | -0.036987 | 44.444444 | -0.805915 |
| 9 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 28 | short | -0.037345 | 50.000000 | -0.646051 |
| 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 19 | long | 0.009424 | 47.368421 | 0.475663 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.023130 | 83.333333 | 2.493330 |
| 2 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 59 | long | 0.035387 | 54.237288 | 2.255768 |
| 3 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 13 | long | 0.068414 | 76.923077 | 1.577311 |
| 4 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.051994 | 30.769231 | -1.294115 |
| 5 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 19 | long | 0.019808 | 73.684211 | 1.017192 |
| 6 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 50 | long | 0.020796 | 64.000000 | 0.795040 |
| 7 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.016024 | 45.454545 | 0.491481 |
| 8 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 28 | short | -0.021032 | 60.714286 | -0.286627 |
| 9 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.012683 | 20.000000 | -0.261524 |
| 10 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 16 | long | 0.007454 | 43.750000 | 0.257823 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.181334 | 72.727273 | 2.060201 |
| 2 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 13 | long | 0.086964 | 84.615385 | 1.498179 |
| 3 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 59 | long | 0.036731 | 64.406780 | 1.202107 |
| 4 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.145222 | 50.000000 | 1.087533 |
| 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 19 | long | 0.059668 | 52.631579 | 0.853428 |
| 6 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 50 | long | 0.022446 | 64.000000 | 0.721373 |
| 7 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.043014 | 50.000000 | 0.690071 |
| 8 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 28 | short | -0.053933 | 53.571429 | -0.630285 |
| 9 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 19 | long | 0.023013 | 63.157895 | 0.618419 |
| 10 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 9 | short | -0.029355 | 33.333333 | -0.598791 |

## 1m slow only

- Study ID: `05a2b75e-bebe-4dd7-a12d-47f77a2ae284`
- Variant: `horizon-1m-slow-only`
- Description: One-factor timeHorizon change: 1m=16, all other timeframe settings use defaults.
- Observed transitions: 167
- Result rows: 64
- Occurrence rows: 663
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Family Summary By Horizon

| Horizon | Family | Patterns | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | ---: | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | 1 | 30 | 0.058034 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.299280 | long |
| 3 | bear_confluence | 1 | 13 | -0.047092 | `1m:sell|2m:sell|5m:sell|15m:sell` | 1.248988 | short |
| 3 | fast_bullish_reversal | 1 | 10 | 0.010403 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.432626 | long |
| 3 | fast_bearish_reversal | 1 | 19 | 0.026262 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.896590 | long |
| 3 | mixed_divergence | 12 | 95 | 0.005625 | `1m:buy|2m:buy|5m:buy|15m:sell` | 1.931784 | long |
| 3 | inactive | 0 | 0 |  | `` |  |  |
| 6 | bull_confluence | 1 | 30 | 0.061076 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.528687 | long |
| 6 | bear_confluence | 1 | 12 | -0.042454 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.883993 | short |
| 6 | fast_bullish_reversal | 1 | 10 | 0.019699 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.788105 | long |
| 6 | fast_bearish_reversal | 1 | 19 | 0.040008 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.046322 | long |
| 6 | mixed_divergence | 12 | 95 | 0.012786 | `1m:sell|2m:buy|5m:buy|15m:sell` | 2.534040 | long |
| 6 | inactive | 0 | 0 |  | `` |  |  |
| 12 | bull_confluence | 1 | 30 | 0.096943 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.939055 | long |
| 12 | bear_confluence | 1 | 11 | 0.037140 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.472352 | long |
| 12 | fast_bullish_reversal | 1 | 10 | 0.105562 | `1m:buy|2m:buy|5m:sell|15m:sell` | 2.248769 | long |
| 12 | fast_bearish_reversal | 1 | 19 | 0.069590 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.325880 | long |
| 12 | mixed_divergence | 12 | 95 | 0.010511 | `1m:buy|2m:buy|5m:buy|15m:sell` | 2.277729 | long |
| 12 | inactive | 0 | 0 |  | `` |  |  |
| 24 | bull_confluence | 1 | 30 | 0.101027 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.336731 | long |
| 24 | bear_confluence | 1 | 11 | 0.021192 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.424571 | long |
| 24 | fast_bullish_reversal | 1 | 10 | 0.117447 | `1m:buy|2m:buy|5m:sell|15m:sell` | 2.376667 | long |
| 24 | fast_bearish_reversal | 1 | 19 | 0.074462 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.104265 | long |
| 24 | mixed_divergence | 12 | 95 | 0.065043 | `1m:sell|2m:buy|5m:sell|15m:buy` | 2.192287 | long |
| 24 | inactive | 0 | 0 |  | `` |  |  |

### All Observed Combination Outcomes

| Horizon | Rank | Pattern | Family | n | Bias | Mean% | Delta Mean% | Win% | Delta Win% | Median% | Std% | MAE% | MFE% | t-stat | Score |
| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.058034 | +0.013235 | 73.333333 | +4.912280 | 0.041513 | 0.073934 | -0.015697 | 0.085763 | 4.299280 | 0.784938 |
| 3 | 2 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.028970 | -0.004778 | 60.000000 | 0.000000 | 0.032190 | 0.047424 | -0.034808 | 0.051083 | 1.931784 | 0.610884 |
| 3 | 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.041205 | -0.007021 | 75.000000 | 0.000000 | 0.061490 | 0.047809 | -0.022624 | 0.066447 | 1.723718 | 0.861859 |
| 3 | 4 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.036228 | +0.004210 | 75.000000 | -5.000000 | 0.030422 | 0.051738 | -0.031616 | 0.084831 | 1.400418 | 0.700209 |
| 3 | 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.019728 | +0.006883 | 27.272727 | -3.496504 | -0.009498 | 0.052130 | -0.056143 | 0.025389 | -1.255130 | -0.378436 |
| 3 | 6 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 13 | short | -0.047092 | -0.025479 | 38.461538 | -14.871795 | -0.013515 | 0.135945 | -0.103282 | 0.058235 | -1.248988 | -0.346407 |
| 3 | 7 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.007889 | -0.004322 | 28.571429 | 0.000000 | -0.020368 | 0.023187 | -0.029819 | 0.017853 | -0.900210 | -0.340247 |
| 3 | 8 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | long | 0.026262 | +0.003628 | 52.631579 | -1.913876 | 0.002005 | 0.127675 | -0.050222 | 0.068793 | 0.896590 | 0.205692 |
| 3 | 9 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 8 | short | -0.031261 | +0.013003 | 50.000000 | +13.636364 | -0.011717 | 0.101695 | -0.082413 | 0.047893 | -0.869457 | -0.307399 |
| 3 | 10 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | long | 0.017759 | +0.005693 | 62.500000 | +5.357143 | 0.017385 | 0.061051 | -0.038857 | 0.042209 | 0.822772 | 0.290894 |
| 3 | 11 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.006757 | +0.002490 | 50.000000 | +7.142857 | 0.000913 | 0.020049 | -0.031591 | 0.019047 | -0.673988 | -0.336994 |
| 3 | 12 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 12 | long | 0.015929 | -0.006344 | 66.666667 | -8.333333 | 0.011439 | 0.091229 | -0.049644 | 0.057454 | 0.604862 | 0.174609 |
| 3 | 13 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.009855 | +0.004598 | 42.105263 | +1.196172 | -0.002702 | 0.088914 | -0.058982 | 0.053068 | 0.483110 | 0.110833 |
| 3 | 14 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | long | 0.010403 | -0.000895 | 60.000000 | 0.000000 | 0.035042 | 0.076039 | -0.038957 | 0.051262 | 0.432626 | 0.136808 |
| 3 | 15 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.012723 | +0.033184 | 50.000000 | 0.000000 | -0.016243 | 0.092911 | -0.064294 | 0.102173 | -0.273871 | -0.136936 |
| 3 | 16 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.003669 | 0.000000 | 25.000000 | 0.000000 | -0.011166 | 0.048503 | -0.059442 | 0.045825 | 0.151269 | 0.075634 |
| 6 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.061076 | +0.015828 | 66.666667 | +6.140351 | 0.043600 | 0.094802 | -0.025800 | 0.110767 | 3.528687 | 0.644247 |
| 6 | 2 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.033242 | -0.005192 | 75.000000 | -5.000000 | 0.036469 | 0.026237 | -0.031616 | 0.096595 | 2.534040 | 1.267020 |
| 6 | 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.045848 | +0.012821 | 70.000000 | +10.000000 | 0.051405 | 0.065367 | -0.039811 | 0.075416 | 2.218000 | 0.701393 |
| 6 | 4 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.080243 | -0.002627 | 75.000000 | 0.000000 | 0.089596 | 0.083976 | -0.028241 | 0.118194 | 1.911089 | 0.955545 |
| 6 | 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.051875 | -0.006362 | 68.421053 | -4.306220 | 0.031768 | 0.119670 | -0.068296 | 0.087846 | 1.889519 | 0.433485 |
| 6 | 6 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.030218 | +0.006848 | 27.272727 | +4.195804 | -0.020511 | 0.057882 | -0.085704 | 0.025389 | -1.731462 | -0.522056 |
| 6 | 7 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.013670 | -0.001956 | 42.857143 | 0.000000 | -0.018985 | 0.028180 | -0.038884 | 0.021758 | -1.283427 | -0.485090 |
| 6 | 8 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | long | 0.040008 | +0.071702 | 57.894737 | +3.349282 | 0.040986 | 0.166670 | -0.067295 | 0.090564 | 1.046322 | 0.240043 |
| 6 | 9 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.031609 | 0.000000 | 75.000000 | 0.000000 | 0.015974 | 0.061352 | -0.059442 | 0.061655 | 1.030425 | 0.515212 |
| 6 | 10 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 12 | short | -0.042454 | -0.029427 | 41.666667 | -8.333333 | -0.064873 | 0.166365 | -0.134129 | 0.075001 | -0.883993 | -0.255187 |
| 6 | 11 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | long | 0.019699 | +0.043310 | 50.000000 | 0.000000 | 0.008098 | 0.079041 | -0.048949 | 0.065794 | 0.788105 | 0.249221 |
| 6 | 12 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.071229 | +0.009268 | 25.000000 | +10.714286 | -0.011421 | 0.184805 | -0.109721 | 0.036713 | -0.770858 | -0.385429 |
| 6 | 13 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.077769 | -0.038286 | 50.000000 | 0.000000 | 0.000763 | 0.289967 | -0.170158 | 0.130294 | -0.536397 | -0.268198 |
| 6 | 14 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 12 | long | 0.015496 | -0.024236 | 75.000000 | -5.000000 | 0.010999 | 0.136256 | -0.076751 | 0.080732 | 0.393968 | 0.113729 |
| 6 | 15 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | long | 0.007412 | +0.002645 | 50.000000 | +7.142857 | -0.003730 | 0.053769 | -0.047050 | 0.050567 | 0.389890 | 0.137847 |
| 6 | 16 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 8 | short | -0.003878 | +0.024438 | 37.500000 | +10.227273 | -0.004986 | 0.127324 | -0.101461 | 0.068298 | -0.086150 | -0.030459 |
| 12 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.096943 | +0.024725 | 66.666667 | +6.140351 | 0.059909 | 0.134799 | -0.042353 | 0.153384 | 3.939055 | 0.719170 |
| 12 | 2 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.063231 | +0.010695 | 70.000000 | 0.000000 | 0.035874 | 0.087787 | -0.045326 | 0.095314 | 2.277729 | 0.720281 |
| 12 | 3 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | long | 0.105562 | +0.036416 | 80.000000 | +10.000000 | 0.084157 | 0.148444 | -0.057394 | 0.144555 | 2.248769 | 0.711123 |
| 12 | 4 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.096131 | -0.018800 | 75.000000 | -25.000000 | 0.111561 | 0.111501 | -0.033859 | 0.133058 | 1.724302 | 0.862151 |
| 12 | 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.052595 | +0.018960 | 63.157895 | -5.023923 | 0.053356 | 0.153175 | -0.082970 | 0.125458 | 1.496685 | 0.343363 |
| 12 | 6 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | long | 0.069590 | +0.090718 | 63.157895 | +4.066986 | 0.021520 | 0.228781 | -0.081405 | 0.147843 | 1.325880 | 0.304178 |
| 12 | 7 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | long | 0.034557 | +0.001030 | 50.000000 | +7.142857 | 0.018173 | 0.101447 | -0.066698 | 0.093481 | 0.963490 | 0.340645 |
| 12 | 8 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.101201 | +0.016659 | 25.000000 | +10.714286 | -0.020313 | 0.246880 | -0.143188 | 0.056072 | -0.819842 | -0.409921 |
| 12 | 9 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | short | -0.049273 | -0.004693 | 25.000000 | +5.000000 | -0.040355 | 0.129281 | -0.095566 | 0.105058 | -0.762272 | -0.381136 |
| 12 | 10 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.015573 | -0.003293 | 57.142857 | 0.000000 | 0.002034 | 0.067279 | -0.067314 | 0.034513 | -0.612418 | -0.231472 |
| 12 | 11 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 11 | long | 0.037140 | -0.002931 | 54.545455 | -6.993007 | 0.051345 | 0.260782 | -0.169787 | 0.149086 | 0.472352 | 0.142419 |
| 12 | 12 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 12 | short | -0.041762 | -0.104628 | 50.000000 | -15.000000 | 0.014321 | 0.351681 | -0.183035 | 0.105676 | -0.411357 | -0.118748 |
| 12 | 13 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.011477 | +0.001071 | 27.272727 | -3.496504 | -0.040707 | 0.143063 | -0.123656 | 0.092683 | -0.266079 | -0.080226 |
| 12 | 14 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.010940 | 0.000000 | 25.000000 | 0.000000 | -0.019127 | 0.095954 | -0.060146 | 0.073040 | 0.228032 | 0.114016 |
| 12 | 15 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 8 | short | -0.000644 | +0.021938 | 50.000000 | -4.545455 | 0.005923 | 0.080304 | -0.109540 | 0.098639 | -0.022669 | -0.008015 |
| 12 | 16 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | long | 0.001416 | -0.008666 | 50.000000 | 0.000000 | 0.044153 | 0.188703 | -0.175715 | 0.138960 | 0.015010 | 0.007505 |
| 24 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.101027 | +0.025201 | 73.333333 | +7.543859 | 0.084631 | 0.165836 | -0.053722 | 0.202109 | 3.336731 | 0.609201 |
| 24 | 2 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | long | 0.117447 | +0.042353 | 80.000000 | 0.000000 | 0.094437 | 0.156270 | -0.063336 | 0.180463 | 2.376667 | 0.751568 |
| 24 | 3 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | long | 0.264364 | -0.035708 | 87.500000 | +1.785714 | 0.133927 | 0.341074 | -0.097022 | 0.324980 | 2.192287 | 0.775091 |
| 24 | 4 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.071639 | +0.011283 | 63.157895 | -0.478469 | 0.067310 | 0.162208 | -0.102087 | 0.159301 | 1.925106 | 0.441650 |
| 24 | 5 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.048603 | +0.025560 | 80.000000 | +20.000000 | 0.052527 | 0.086713 | -0.061423 | 0.122583 | 1.772469 | 0.560504 |
| 24 | 6 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.016757 | 0.000000 | 75.000000 | 0.000000 | 0.015822 | 0.019484 | -0.077643 | 0.093940 | 1.720036 | 0.860018 |
| 24 | 7 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.246128 | +0.113334 | 57.142857 | 0.000000 | 0.040683 | 0.412860 | -0.106551 | 0.297503 | 1.577271 | 0.596152 |
| 24 | 8 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.137966 | +0.020470 | 54.545455 | +0.699301 | 0.025231 | 0.344761 | -0.154869 | 0.212668 | 1.327244 | 0.400179 |
| 24 | 9 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | long | 0.074462 | +0.084510 | 57.894737 | +3.349282 | 0.029083 | 0.293925 | -0.120839 | 0.186746 | 1.104265 | 0.253336 |
| 24 | 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 8 | long | 0.027688 | +0.021791 | 62.500000 | +7.954545 | 0.068139 | 0.098052 | -0.115184 | 0.116681 | 0.798693 | 0.282381 |
| 24 | 11 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 12 | short | -0.083815 | -0.136054 | 33.333333 | -21.666667 | -0.025444 | 0.409546 | -0.218376 | 0.140904 | -0.708936 | -0.204652 |
| 24 | 12 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | short | -0.026955 | -0.006302 | 50.000000 | -10.000000 | -0.024865 | 0.098221 | -0.138165 | 0.130183 | -0.548857 | -0.274429 |
| 24 | 13 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 11 | long | 0.021192 | -0.009313 | 54.545455 | -14.685314 | 0.009864 | 0.165549 | -0.207802 | 0.174433 | 0.424571 | 0.128013 |
| 24 | 14 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.061118 | +0.014310 | 50.000000 | +7.142857 | 0.022579 | 0.288964 | -0.166054 | 0.141191 | -0.423015 | -0.211508 |
| 24 | 15 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.013986 | -0.047431 | 25.000000 | -25.000000 | -0.023606 | 0.116391 | -0.060947 | 0.147732 | 0.240320 | 0.120160 |
| 24 | 16 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.002484 | -0.017161 | 50.000000 | 0.000000 | 0.096487 | 0.310966 | -0.187989 | 0.151639 | -0.015978 | -0.007989 |

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.058034 | 73.333333 | 4.299280 |
| 2 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.028970 | 60.000000 | 1.931784 |
| 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.041205 | 75.000000 | 1.723718 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.036228 | 75.000000 | 1.400418 |
| 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.019728 | 27.272727 | -1.255130 |
| 6 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 13 | short | -0.047092 | 38.461538 | -1.248988 |
| 7 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.007889 | 28.571429 | -0.900210 |
| 8 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | long | 0.026262 | 52.631579 | 0.896590 |
| 9 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 8 | short | -0.031261 | 50.000000 | -0.869457 |
| 10 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | long | 0.017759 | 62.500000 | 0.822772 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.061076 | 66.666667 | 3.528687 |
| 2 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.033242 | 75.000000 | 2.534040 |
| 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.045848 | 70.000000 | 2.218000 |
| 4 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.080243 | 75.000000 | 1.911089 |
| 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.051875 | 68.421053 | 1.889519 |
| 6 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.030218 | 27.272727 | -1.731462 |
| 7 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.013670 | 42.857143 | -1.283427 |
| 8 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | long | 0.040008 | 57.894737 | 1.046322 |
| 9 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.031609 | 75.000000 | 1.030425 |
| 10 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 12 | short | -0.042454 | 41.666667 | -0.883993 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.096943 | 66.666667 | 3.939055 |
| 2 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.063231 | 70.000000 | 2.277729 |
| 3 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | long | 0.105562 | 80.000000 | 2.248769 |
| 4 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.096131 | 75.000000 | 1.724302 |
| 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.052595 | 63.157895 | 1.496685 |
| 6 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | long | 0.069590 | 63.157895 | 1.325880 |
| 7 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | long | 0.034557 | 50.000000 | 0.963490 |
| 8 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.101201 | 25.000000 | -0.819842 |
| 9 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | short | -0.049273 | 25.000000 | -0.762272 |
| 10 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.015573 | 57.142857 | -0.612418 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 30 | long | 0.101027 | 73.333333 | 3.336731 |
| 2 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | long | 0.117447 | 80.000000 | 2.376667 |
| 3 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | long | 0.264364 | 87.500000 | 2.192287 |
| 4 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.071639 | 63.157895 | 1.925106 |
| 5 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.048603 | 80.000000 | 1.772469 |
| 6 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.016757 | 75.000000 | 1.720036 |
| 7 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.246128 | 57.142857 | 1.577271 |
| 8 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.137966 | 54.545455 | 1.327244 |
| 9 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | long | 0.074462 | 57.894737 | 1.104265 |
| 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 8 | long | 0.027688 | 62.500000 | 0.798693 |

## 2m fast only

- Study ID: `93a32831-1ae9-4fda-8d9c-c6fcf257cd56`
- Variant: `horizon-2m-fast-only`
- Description: One-factor timeHorizon change: 2m=6, all other timeframe settings use defaults.
- Observed transitions: 220
- Result rows: 64
- Occurrence rows: 875
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Family Summary By Horizon

| Horizon | Family | Patterns | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | ---: | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | 1 | 40 | 0.039665 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.613582 | long |
| 3 | bear_confluence | 1 | 17 | -0.009831 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.348731 | short |
| 3 | fast_bullish_reversal | 1 | 14 | -0.004975 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.213456 | short |
| 3 | fast_bearish_reversal | 1 | 32 | 0.026658 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.468652 | long |
| 3 | mixed_divergence | 12 | 117 | -0.000759 | `1m:buy|2m:sell|5m:sell|15m:sell` | 3.873698 | short |
| 3 | inactive | 0 | 0 |  | `` |  |  |
| 6 | bull_confluence | 1 | 40 | 0.052716 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.720025 | long |
| 6 | bear_confluence | 1 | 16 | -0.009530 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.249604 | short |
| 6 | fast_bullish_reversal | 1 | 14 | -0.002584 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.084829 | short |
| 6 | fast_bearish_reversal | 1 | 32 | 0.000364 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.006964 | long |
| 6 | mixed_divergence | 12 | 117 | -0.012323 | `1m:sell|2m:sell|5m:sell|15m:buy` | 2.699620 | short |
| 6 | inactive | 0 | 0 |  | `` |  |  |
| 12 | bull_confluence | 1 | 40 | 0.077688 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.094995 | long |
| 12 | bear_confluence | 1 | 15 | 0.039810 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.692451 | long |
| 12 | fast_bullish_reversal | 1 | 14 | 0.042800 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.937078 | long |
| 12 | fast_bearish_reversal | 1 | 32 | 0.011746 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.177936 | long |
| 12 | mixed_divergence | 12 | 117 | -0.029729 | `1m:sell|2m:buy|5m:buy|15m:buy` | 2.423179 | long |
| 12 | inactive | 0 | 0 |  | `` |  |  |
| 24 | bull_confluence | 1 | 40 | 0.090620 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.572285 | long |
| 24 | bear_confluence | 1 | 15 | 0.035980 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.849234 | long |
| 24 | fast_bullish_reversal | 1 | 14 | 0.082994 | `1m:buy|2m:buy|5m:sell|15m:sell` | 1.860008 | long |
| 24 | fast_bearish_reversal | 1 | 32 | 0.020933 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.309247 | long |
| 24 | mixed_divergence | 12 | 117 | 0.014458 | `1m:sell|2m:buy|5m:buy|15m:sell` | 2.381061 | long |
| 24 | inactive | 0 | 0 |  | `` |  |  |

### All Observed Combination Outcomes

| Horizon | Rank | Pattern | Family | n | Bias | Mean% | Delta Mean% | Win% | Delta Win% | Median% | Std% | MAE% | MFE% | t-stat | Score |
| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 8 | short | -0.066979 | -0.022715 | 0.000000 | -36.363636 | -0.059929 | 0.048905 | -0.105358 | 0.017149 | -3.873698 | -1.369559 |
| 3 | 2 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.039665 | -0.005134 | 70.000000 | +1.578947 | 0.029126 | 0.069422 | -0.018990 | 0.069195 | 3.613582 | 0.571357 |
| 3 | 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 11 | long | 0.028874 | +0.006601 | 81.818182 | +6.818182 | 0.023705 | 0.034881 | -0.017894 | 0.045911 | 2.745460 | 0.827787 |
| 3 | 4 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.030129 | -0.001889 | 100.000000 | +20.000000 | 0.030129 | 0.016754 | -0.016484 | 0.034973 | 2.543175 | 1.798297 |
| 3 | 5 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.029156 | -0.004592 | 54.545455 | -5.454545 | 0.040195 | 0.041975 | -0.025950 | 0.051106 | 2.303726 | 0.694599 |
| 3 | 6 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.038637 | +0.034968 | 80.000000 | +55.000000 | 0.018869 | 0.049118 | -0.049937 | 0.084113 | 1.758922 | 0.786614 |
| 3 | 7 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 16 | short | -0.020992 | +0.005619 | 37.500000 | +6.730769 | -0.014846 | 0.054439 | -0.066524 | 0.027247 | -1.542433 | -0.385608 |
| 3 | 8 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 32 | long | 0.026658 | +0.004024 | 62.500000 | +7.954545 | 0.009043 | 0.102679 | -0.044424 | 0.060005 | 1.468652 | 0.259623 |
| 3 | 9 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.029117 | +0.017051 | 66.666667 | +9.523810 | 0.017385 | 0.051952 | -0.012797 | 0.048902 | 1.372861 | 0.560468 |
| 3 | 10 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 6 | short | -0.035278 | -0.026031 | 33.333333 | -9.523810 | -0.011107 | 0.069889 | -0.068027 | 0.011159 | -1.236436 | -0.504773 |
| 3 | 11 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | long | 0.031204 | +0.077111 | 75.000000 | +25.000000 | 0.051032 | 0.076995 | -0.049291 | 0.084288 | 0.810541 | 0.405270 |
| 3 | 12 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 34 | short | -0.009627 | -0.014884 | 38.235294 | -2.673797 | -0.005709 | 0.071530 | -0.059628 | 0.032031 | -0.784763 | -0.134586 |
| 3 | 13 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.028650 | -0.019576 | 50.000000 | -25.000000 | 0.028650 | 0.060360 | -0.063775 | 0.049613 | 0.671259 | 0.474652 |
| 3 | 14 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 12 | long | 0.006107 | +0.009674 | 41.666667 | +13.095238 | -0.006259 | 0.040012 | -0.021505 | 0.030722 | 0.528701 | 0.152623 |
| 3 | 15 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 17 | short | -0.009831 | +0.011782 | 52.941176 | -0.392157 | 0.006504 | 0.116230 | -0.084768 | 0.078422 | -0.348731 | -0.084580 |
| 3 | 16 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 14 | short | -0.004975 | -0.016273 | 57.142857 | -2.857143 | 0.024700 | 0.087198 | -0.061686 | 0.053912 | -0.213456 | -0.057048 |
| 6 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.052716 | +0.007468 | 65.000000 | +4.473684 | 0.042354 | 0.089625 | -0.028578 | 0.096639 | 3.720025 | 0.588188 |
| 6 | 2 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 16 | short | -0.035427 | +0.001639 | 25.000000 | +1.923077 | -0.044733 | 0.052492 | -0.089553 | 0.029853 | -2.699620 | -0.674905 |
| 6 | 3 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.050899 | +0.019290 | 80.000000 | +5.000000 | 0.059203 | 0.051183 | -0.049937 | 0.110041 | 2.223660 | 0.994451 |
| 6 | 4 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 6 | short | -0.051858 | +0.028639 | 33.333333 | +19.047619 | -0.015308 | 0.076889 | -0.100200 | 0.013593 | -1.652050 | -0.674446 |
| 6 | 5 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 11 | long | 0.024245 | -0.015487 | 72.727273 | -7.272727 | 0.017831 | 0.050651 | -0.026700 | 0.066384 | 1.587546 | 0.478663 |
| 6 | 6 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.062107 | -0.020763 | 100.000000 | +25.000000 | 0.062107 | 0.058117 | -0.063775 | 0.109465 | 1.511303 | 1.068653 |
| 6 | 7 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.035078 | +0.002051 | 54.545455 | -5.454545 | 0.025342 | 0.081656 | -0.041221 | 0.080442 | 1.424776 | 0.429586 |
| 6 | 8 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | long | 0.075056 | +0.114539 | 75.000000 | +25.000000 | 0.096212 | 0.117160 | -0.059473 | 0.129613 | 1.281253 | 0.640627 |
| 6 | 9 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 12 | short | -0.036771 | -0.025057 | 33.333333 | -9.523810 | -0.021004 | 0.101430 | -0.067982 | 0.039266 | -1.255815 | -0.362523 |
| 6 | 10 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.026440 | +0.021673 | 66.666667 | +23.809524 | 0.005620 | 0.051613 | -0.018494 | 0.056062 | 1.254790 | 0.512266 |
| 6 | 11 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 8 | short | -0.069209 | -0.040893 | 25.000000 | -2.272727 | -0.055636 | 0.194002 | -0.165383 | 0.042659 | -1.009020 | -0.356742 |
| 6 | 12 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.016223 | -0.022211 | 50.000000 | -30.000000 | 0.016223 | 0.024930 | -0.016484 | 0.050806 | 0.920243 | 0.650710 |
| 6 | 13 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 34 | short | -0.032102 | -0.090339 | 50.000000 | -22.727273 | 0.001345 | 0.267274 | -0.119950 | 0.051907 | -0.700356 | -0.120110 |
| 6 | 14 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 16 | short | -0.009530 | +0.003497 | 50.000000 | 0.000000 | -0.001224 | 0.152730 | -0.117864 | 0.098800 | -0.249604 | -0.062401 |
| 6 | 15 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 14 | short | -0.002584 | +0.021027 | 42.857143 | -7.142857 | -0.008800 | 0.113997 | -0.076933 | 0.068596 | -0.084829 | -0.022672 |
| 6 | 16 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 32 | long | 0.000364 | +0.032058 | 65.625000 | +11.079545 | 0.018101 | 0.295387 | -0.105103 | 0.082128 | 0.006964 | 0.001231 |
| 12 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.077688 | +0.005470 | 65.000000 | +4.473684 | 0.048725 | 0.119986 | -0.041222 | 0.129439 | 4.094995 | 0.647476 |
| 12 | 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 11 | long | 0.060099 | -0.002767 | 72.727273 | +7.727273 | 0.053290 | 0.082258 | -0.033152 | 0.094061 | 2.423179 | 0.730616 |
| 12 | 3 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.067393 | +0.111973 | 100.000000 | +80.000000 | 0.067393 | 0.041609 | -0.019297 | 0.071247 | 2.290565 | 1.619674 |
| 12 | 4 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.053585 | +0.001049 | 72.727273 | +2.727273 | 0.032327 | 0.100992 | -0.048023 | 0.098297 | 1.759776 | 0.530592 |
| 12 | 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 6 | short | -0.073053 | +0.044807 | 16.666667 | +2.380953 | -0.046943 | 0.101691 | -0.126175 | 0.037755 | -1.759661 | -0.718379 |
| 12 | 6 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 8 | short | -0.058987 | -0.036405 | 25.000000 | -29.545455 | -0.055316 | 0.107878 | -0.172990 | 0.062896 | -1.546573 | -0.546796 |
| 12 | 7 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 12 | short | -0.059155 | -0.046875 | 33.333333 | -23.809524 | -0.017266 | 0.135828 | -0.096840 | 0.040916 | -1.508674 | -0.435517 |
| 12 | 8 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 34 | short | -0.066792 | -0.100427 | 50.000000 | -18.181818 | 0.002415 | 0.350185 | -0.164519 | 0.075262 | -1.112154 | -0.190733 |
| 12 | 9 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | short | -0.078954 | -0.112481 | 16.666667 | -26.190476 | -0.012864 | 0.185244 | -0.117561 | 0.061647 | -1.044012 | -0.426216 |
| 12 | 10 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 14 | long | 0.042800 | -0.026346 | 71.428571 | +1.428571 | 0.048208 | 0.170897 | -0.094047 | 0.119083 | 0.937078 | 0.250445 |
| 12 | 11 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 16 | short | -0.021184 | -0.008636 | 25.000000 | -5.769231 | -0.035444 | 0.115925 | -0.120299 | 0.069933 | -0.730956 | -0.182739 |
| 12 | 12 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 15 | long | 0.039810 | -0.000261 | 60.000000 | -1.538462 | 0.048613 | 0.222663 | -0.141217 | 0.158279 | 0.692451 | 0.178790 |
| 12 | 13 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.034011 | -0.044951 | 20.000000 | -5.000000 | -0.025806 | 0.130344 | -0.098063 | 0.119149 | -0.583468 | -0.260935 |
| 12 | 14 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 32 | long | 0.011746 | +0.032874 | 59.375000 | +0.284091 | 0.034753 | 0.373428 | -0.123019 | 0.130419 | 0.177936 | 0.031455 |
| 12 | 15 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.005619 | -0.109312 | 50.000000 | -50.000000 | 0.005619 | 0.226003 | -0.100219 | 0.131472 | 0.035161 | 0.024863 |
| 12 | 16 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.000277 | -0.010359 | 50.000000 | 0.000000 | 0.016054 | 0.159726 | -0.099153 | 0.150423 | -0.003465 | -0.001733 |
| 24 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.090620 | +0.014794 | 67.500000 | +1.710526 | 0.079315 | 0.160438 | -0.052487 | 0.180430 | 3.572285 | 0.564828 |
| 24 | 2 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.098048 | +0.118701 | 100.000000 | +40.000000 | 0.098048 | 0.058235 | -0.019297 | 0.129323 | 2.381061 | 1.683664 |
| 24 | 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 11 | long | 0.053167 | +0.000928 | 72.727273 | +17.727273 | 0.063219 | 0.074631 | -0.036432 | 0.121026 | 2.362777 | 0.712404 |
| 24 | 4 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 14 | long | 0.082994 | +0.007900 | 78.571429 | -1.428571 | 0.080291 | 0.166954 | -0.108703 | 0.163106 | 1.860008 | 0.497108 |
| 24 | 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 16 | long | 0.125931 | +0.008435 | 50.000000 | -3.846154 | 0.014016 | 0.296204 | -0.144720 | 0.187292 | 1.700606 | 0.425151 |
| 24 | 6 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.042258 | -0.059015 | 40.000000 | -35.000000 | -0.006072 | 0.064111 | -0.151605 | 0.122445 | -1.473877 | -0.659138 |
| 24 | 7 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 8 | short | -0.074219 | -0.080116 | 25.000000 | -29.545455 | -0.033417 | 0.158940 | -0.187114 | 0.069646 | -1.320772 | -0.466963 |
| 24 | 8 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 6 | short | -0.028465 | +0.046963 | 33.333333 | -9.523810 | -0.049818 | 0.059579 | -0.146127 | 0.054809 | -1.170284 | -0.477766 |
| 24 | 9 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | short | -0.100636 | -0.162053 | 0.000000 | -50.000000 | -0.100636 | 0.127296 | -0.194888 | 0.139061 | -1.118029 | -0.790566 |
| 24 | 10 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.037625 | +0.014582 | 63.636364 | +3.636364 | 0.057212 | 0.119514 | -0.079092 | 0.127446 | 1.044138 | 0.314819 |
| 24 | 11 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 15 | long | 0.035980 | +0.005475 | 66.666667 | -2.564102 | 0.031036 | 0.164091 | -0.175940 | 0.177741 | 0.849234 | 0.219271 |
| 24 | 12 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 34 | short | -0.044799 | -0.105155 | 50.000000 | -13.636364 | 0.005206 | 0.318114 | -0.196440 | 0.100641 | -0.821153 | -0.140827 |
| 24 | 13 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.125140 | -0.174932 | 66.666667 | -19.047619 | 0.053112 | 0.471914 | -0.151486 | 0.258897 | 0.649545 | 0.265176 |
| 24 | 14 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | long | 0.031638 | +0.016961 | 50.000000 | 0.000000 | 0.065355 | 0.189119 | -0.159182 | 0.158919 | 0.334589 | 0.167294 |
| 24 | 15 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 32 | long | 0.020933 | +0.030981 | 53.125000 | -1.420455 | 0.012574 | 0.382913 | -0.162968 | 0.170878 | 0.309247 | 0.054668 |
| 24 | 16 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 12 | long | 0.025398 | -0.107396 | 41.666667 | -15.476190 | -0.023145 | 0.307279 | -0.136279 | 0.141431 | 0.286329 | 0.082656 |

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 8 | short | -0.066979 | 0.000000 | -3.873698 |
| 2 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.039665 | 70.000000 | 3.613582 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 11 | long | 0.028874 | 81.818182 | 2.745460 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.030129 | 100.000000 | 2.543175 |
| 5 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.029156 | 54.545455 | 2.303726 |
| 6 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.038637 | 80.000000 | 1.758922 |
| 7 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 16 | short | -0.020992 | 37.500000 | -1.542433 |
| 8 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 32 | long | 0.026658 | 62.500000 | 1.468652 |
| 9 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.029117 | 66.666667 | 1.372861 |
| 10 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 6 | short | -0.035278 | 33.333333 | -1.236436 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.052716 | 65.000000 | 3.720025 |
| 2 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 16 | short | -0.035427 | 25.000000 | -2.699620 |
| 3 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.050899 | 80.000000 | 2.223660 |
| 4 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 6 | short | -0.051858 | 33.333333 | -1.652050 |
| 5 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 11 | long | 0.024245 | 72.727273 | 1.587546 |
| 6 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.062107 | 100.000000 | 1.511303 |
| 7 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.035078 | 54.545455 | 1.424776 |
| 8 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | long | 0.075056 | 75.000000 | 1.281253 |
| 9 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 12 | short | -0.036771 | 33.333333 | -1.255815 |
| 10 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.026440 | 66.666667 | 1.254790 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.077688 | 65.000000 | 4.094995 |
| 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 11 | long | 0.060099 | 72.727273 | 2.423179 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.067393 | 100.000000 | 2.290565 |
| 4 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.053585 | 72.727273 | 1.759776 |
| 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 6 | short | -0.073053 | 16.666667 | -1.759661 |
| 6 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 8 | short | -0.058987 | 25.000000 | -1.546573 |
| 7 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 12 | short | -0.059155 | 33.333333 | -1.508674 |
| 8 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 34 | short | -0.066792 | 50.000000 | -1.112154 |
| 9 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | short | -0.078954 | 16.666667 | -1.044012 |
| 10 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 14 | long | 0.042800 | 71.428571 | 0.937078 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.090620 | 67.500000 | 3.572285 |
| 2 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.098048 | 100.000000 | 2.381061 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 11 | long | 0.053167 | 72.727273 | 2.362777 |
| 4 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 14 | long | 0.082994 | 78.571429 | 1.860008 |
| 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 16 | long | 0.125931 | 50.000000 | 1.700606 |
| 6 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.042258 | 40.000000 | -1.473877 |
| 7 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 8 | short | -0.074219 | 25.000000 | -1.320772 |
| 8 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 6 | short | -0.028465 | 33.333333 | -1.170284 |
| 9 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | short | -0.100636 | 0.000000 | -1.118029 |
| 10 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.037625 | 63.636364 | 1.044138 |

## 2m slow only

- Study ID: `4c5581f4-001c-4027-b496-e6c04a6343e2`
- Variant: `horizon-2m-slow-only`
- Description: One-factor timeHorizon change: 2m=14, all other timeframe settings use defaults.
- Observed transitions: 190
- Result rows: 64
- Occurrence rows: 755
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Family Summary By Horizon

| Horizon | Family | Patterns | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | ---: | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | 1 | 40 | 0.038246 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.490395 | long |
| 3 | bear_confluence | 1 | 15 | -0.021613 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.591072 | short |
| 3 | fast_bullish_reversal | 1 | 9 | -0.020680 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.709847 | short |
| 3 | fast_bearish_reversal | 1 | 9 | 0.029888 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.291395 | long |
| 3 | mixed_divergence | 12 | 117 | 0.008656 | `1m:buy|2m:sell|5m:buy|15m:sell` | 9.475817 | long |
| 3 | inactive | 0 | 0 |  | `` |  |  |
| 6 | bull_confluence | 1 | 40 | 0.048740 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.387438 | long |
| 6 | bear_confluence | 1 | 14 | -0.013027 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.291830 | short |
| 6 | fast_bullish_reversal | 1 | 9 | -0.076329 | `1m:buy|2m:buy|5m:sell|15m:sell` | 1.305567 | short |
| 6 | fast_bearish_reversal | 1 | 9 | 0.038886 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.996746 | long |
| 6 | mixed_divergence | 12 | 117 | 0.005415 | `1m:buy|2m:sell|5m:buy|15m:sell` | 3.110981 | long |
| 6 | inactive | 0 | 0 |  | `` |  |  |
| 12 | bull_confluence | 1 | 40 | 0.063510 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.692066 | long |
| 12 | bear_confluence | 1 | 13 | 0.040071 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.605227 | long |
| 12 | fast_bullish_reversal | 1 | 9 | 0.026073 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.390122 | long |
| 12 | fast_bearish_reversal | 1 | 9 | 0.078563 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.033337 | long |
| 12 | mixed_divergence | 12 | 117 | 0.000785 | `1m:buy|2m:sell|5m:buy|15m:sell` | 2.481095 | long |
| 12 | inactive | 0 | 0 |  | `` |  |  |
| 24 | bull_confluence | 1 | 40 | 0.075379 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.237627 | long |
| 24 | bear_confluence | 1 | 13 | 0.030505 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.722684 | long |
| 24 | fast_bullish_reversal | 1 | 9 | 0.018809 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.212151 | long |
| 24 | fast_bearish_reversal | 1 | 9 | 0.105879 | `1m:sell|2m:sell|5m:buy|15m:buy` | 1.170449 | long |
| 24 | mixed_divergence | 12 | 117 | 0.050187 | `1m:buy|2m:buy|5m:buy|15m:sell` | 2.134181 | long |
| 24 | inactive | 0 | 0 |  | `` |  |  |

### All Observed Combination Outcomes

| Horizon | Rank | Pattern | Family | n | Bias | Mean% | Delta Mean% | Win% | Delta Win% | Median% | Std% | MAE% | MFE% | t-stat | Score |
| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.056741 | +0.008515 | 100.000000 | +25.000000 | 0.053474 | 0.013389 | -0.019038 | 0.072935 | 9.475817 | 4.237714 |
| 3 | 2 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.038246 | -0.006553 | 65.000000 | -3.421053 | 0.023350 | 0.069301 | -0.020135 | 0.065041 | 3.490395 | 0.551880 |
| 3 | 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.037671 | +0.003923 | 54.545455 | -5.454545 | 0.051708 | 0.049480 | -0.022304 | 0.061994 | 2.525062 | 0.761335 |
| 3 | 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 29 | long | 0.030734 | +0.008461 | 62.068966 | -12.931034 | 0.012595 | 0.099637 | -0.043026 | 0.058438 | 1.661131 | 0.308464 |
| 3 | 5 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.032307 | +0.000289 | 80.000000 | 0.000000 | 0.018869 | 0.045379 | -0.053392 | 0.071765 | 1.591957 | 0.711945 |
| 3 | 6 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.033607 | +0.010657 | 33.333333 | -3.030303 | -0.042026 | 0.075679 | -0.083057 | 0.037970 | -1.538298 | -0.444068 |
| 3 | 7 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 9 | long | 0.029888 | +0.007254 | 77.777778 | +23.232323 | 0.015028 | 0.069433 | -0.031056 | 0.059761 | 1.291395 | 0.430465 |
| 3 | 8 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.007153 | +0.002094 | 40.000000 | -2.857143 | -0.004498 | 0.018175 | -0.036246 | 0.013061 | -1.244511 | -0.393549 |
| 3 | 9 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | short | -0.020680 | -0.031978 | 55.555556 | -4.444444 | 0.031375 | 0.087397 | -0.055549 | 0.037392 | -0.709847 | -0.236616 |
| 3 | 10 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.045907 | 0.000000 | 50.000000 | 0.000000 | -0.016243 | 0.148797 | -0.102693 | 0.096799 | -0.617037 | -0.308518 |
| 3 | 11 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 15 | short | -0.021613 | 0.000000 | 53.333333 | 0.000000 | 0.006504 | 0.141619 | -0.095610 | 0.068838 | -0.591072 | -0.152614 |
| 3 | 12 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 14 | short | -0.006890 | +0.019721 | 42.857143 | +12.087912 | -0.008439 | 0.054981 | -0.063051 | 0.029888 | -0.468874 | -0.125312 |
| 3 | 13 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.010985 | +0.007316 | 33.333333 | +8.333333 | -0.004051 | 0.056636 | -0.050644 | 0.053589 | 0.335956 | 0.193964 |
| 3 | 14 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.006075 | -0.002508 | 25.000000 | -3.571429 | -0.021030 | 0.038843 | -0.028425 | 0.018636 | -0.312786 | -0.156393 |
| 3 | 15 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 11 | long | 0.001190 | -0.004067 | 54.545455 | +13.636364 | 0.002816 | 0.036152 | -0.052674 | 0.040190 | 0.109138 | 0.032906 |
| 3 | 16 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 9 | short | -0.000552 | -0.012618 | 44.444444 | -12.698413 | -0.009054 | 0.070575 | -0.054205 | 0.042562 | -0.023455 | -0.007818 |
| 6 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.048740 | +0.003492 | 65.000000 | +4.473684 | 0.021788 | 0.091001 | -0.032318 | 0.094023 | 3.387438 | 0.535601 |
| 6 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.091886 | +0.009016 | 80.000000 | +5.000000 | 0.103202 | 0.066045 | -0.025257 | 0.131441 | 3.110981 | 1.391273 |
| 6 | 3 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 11 | long | 0.054979 | -0.003258 | 63.636364 | -9.090909 | 0.072624 | 0.082475 | -0.058406 | 0.085259 | 2.210890 | 0.666608 |
| 6 | 4 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.033989 | -0.004445 | 80.000000 | 0.000000 | 0.039087 | 0.034580 | -0.053392 | 0.092410 | 2.197861 | 0.982913 |
| 6 | 5 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.039891 | +0.006864 | 63.636364 | +3.636364 | 0.043607 | 0.079509 | -0.034748 | 0.079817 | 1.664002 | 0.501716 |
| 6 | 6 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.024348 | -0.012634 | 25.000000 | -17.857143 | -0.035749 | 0.030819 | -0.039727 | 0.018810 | -1.580122 | -0.790061 |
| 6 | 7 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.055314 | +0.025183 | 30.000000 | +15.714286 | -0.015638 | 0.110792 | -0.089229 | 0.019590 | -1.578785 | -0.499256 |
| 6 | 8 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.050116 | +0.018507 | 100.000000 | +25.000000 | 0.025659 | 0.059925 | -0.050644 | 0.074696 | 1.448544 | 0.836317 |
| 6 | 9 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | short | -0.076329 | -0.052718 | 33.333333 | -16.666667 | -0.013548 | 0.175393 | -0.116322 | 0.048068 | -1.305567 | -0.435189 |
| 6 | 10 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 14 | short | -0.020550 | +0.016516 | 21.428571 | -1.648352 | -0.021250 | 0.075204 | -0.078762 | 0.045175 | -1.022451 | -0.273261 |
| 6 | 11 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 9 | long | 0.038886 | +0.070580 | 66.666667 | +12.121212 | 0.040986 | 0.117039 | -0.039011 | 0.080462 | 0.996746 | 0.332249 |
| 6 | 12 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.015881 | +0.012435 | 25.000000 | -2.272727 | -0.017202 | 0.108409 | -0.098376 | 0.051574 | -0.507456 | -0.146490 |
| 6 | 13 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.039483 | 0.000000 | 50.000000 | 0.000000 | 0.000763 | 0.218289 | -0.157459 | 0.124920 | -0.361755 | -0.180877 |
| 6 | 14 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 14 | short | -0.013027 | 0.000000 | 50.000000 | 0.000000 | -0.001224 | 0.167027 | -0.120150 | 0.090911 | -0.291830 | -0.077995 |
| 6 | 15 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 9 | short | -0.004923 | -0.009690 | 55.555556 | +12.698413 | 0.002933 | 0.064692 | -0.074911 | 0.043883 | -0.228293 | -0.076098 |
| 6 | 16 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 29 | long | 0.004874 | -0.034858 | 72.413793 | -7.586207 | 0.024334 | 0.302405 | -0.100943 | 0.082042 | 0.086793 | 0.016117 |
| 12 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.063510 | -0.008708 | 65.000000 | +4.473684 | 0.042616 | 0.108793 | -0.044567 | 0.125442 | 3.692066 | 0.583767 |
| 12 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.103880 | -0.011051 | 80.000000 | -20.000000 | 0.124615 | 0.093621 | -0.025712 | 0.145331 | 2.481095 | 1.109579 |
| 12 | 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.056881 | +0.004345 | 81.818182 | +11.818182 | 0.046420 | 0.092263 | -0.041344 | 0.099824 | 2.044708 | 0.616503 |
| 12 | 4 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.059300 | -0.047020 | 0.000000 | -57.142857 | -0.043006 | 0.061057 | -0.091878 | 0.018810 | -1.942439 | -0.971220 |
| 12 | 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.073781 | +0.044079 | 40.000000 | +25.714286 | -0.024191 | 0.156280 | -0.115708 | 0.035205 | -1.492947 | -0.472111 |
| 12 | 6 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 9 | long | 0.078563 | +0.099691 | 77.777778 | +18.686869 | 0.047055 | 0.228086 | -0.061454 | 0.161580 | 1.033337 | 0.344446 |
| 12 | 7 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.044704 | -0.000124 | 20.000000 | 0.000000 | -0.025806 | 0.112405 | -0.101518 | 0.099180 | -0.889306 | -0.397710 |
| 12 | 8 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 13 | long | 0.040071 | 0.000000 | 61.538462 | 0.000000 | 0.048613 | 0.238714 | -0.147272 | 0.158934 | 0.605227 | 0.167860 |
| 12 | 9 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.014372 | +0.008210 | 58.333333 | +3.787878 | 0.013372 | 0.123754 | -0.116049 | 0.078628 | -0.402293 | -0.116132 |
| 12 | 10 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | long | 0.026073 | -0.043073 | 55.555556 | -14.444444 | 0.049968 | 0.200495 | -0.128781 | 0.107209 | 0.390122 | 0.130041 |
| 12 | 11 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 9 | short | -0.013046 | -0.046573 | 33.333333 | -9.523810 | -0.014541 | 0.137329 | -0.123003 | 0.100759 | -0.285005 | -0.095002 |
| 12 | 12 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.018335 | +0.007395 | 33.333333 | +8.333333 | -0.027010 | 0.116114 | -0.051582 | 0.089876 | 0.273504 | 0.157908 |
| 12 | 13 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 29 | long | 0.017782 | -0.045084 | 58.620690 | -6.379310 | 0.051159 | 0.369671 | -0.114490 | 0.119510 | 0.259038 | 0.048102 |
| 12 | 14 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 14 | short | -0.004803 | +0.007745 | 28.571429 | -2.197802 | -0.039026 | 0.109621 | -0.108696 | 0.087916 | -0.163925 | -0.043811 |
| 12 | 15 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | long | 0.010082 | 0.000000 | 50.000000 | 0.000000 | 0.044153 | 0.172867 | -0.157459 | 0.133586 | 0.116645 | 0.058322 |
| 12 | 16 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 11 | short | -0.009873 | -0.043508 | 63.636364 | -4.545454 | 0.053356 | 0.311681 | -0.145681 | 0.130525 | -0.105055 | -0.031675 |
| 24 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.075379 | -0.000447 | 67.500000 | +1.710526 | 0.072446 | 0.147249 | -0.058865 | 0.168922 | 3.237627 | 0.511914 |
| 24 | 2 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.067093 | +0.044050 | 72.727273 | +12.727273 | 0.057212 | 0.104266 | -0.057201 | 0.136245 | 2.134181 | 0.643480 |
| 24 | 3 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 9 | long | 0.201569 | -0.098503 | 55.555556 | -30.158730 | 0.050416 | 0.353397 | -0.159526 | 0.279706 | 1.711123 | 0.570374 |
| 24 | 4 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 14 | long | 0.133900 | +0.016404 | 57.142857 | +3.296703 | 0.033492 | 0.302319 | -0.132966 | 0.191837 | 1.657210 | 0.442908 |
| 24 | 5 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.017646 | +0.000889 | 66.666667 | -8.333333 | 0.017556 | 0.023763 | -0.062714 | 0.116805 | 1.286185 | 0.742579 |
| 24 | 6 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 9 | long | 0.105879 | +0.115927 | 66.666667 | +12.121212 | 0.098486 | 0.271380 | -0.100030 | 0.211583 | 1.170449 | 0.390150 |
| 24 | 7 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.053427 | +0.022001 | 40.000000 | -2.857143 | -0.023478 | 0.159864 | -0.149612 | 0.057998 | -1.056846 | -0.334204 |
| 24 | 8 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.029669 | -0.009016 | 60.000000 | 0.000000 | 0.004554 | 0.077726 | -0.148380 | 0.102722 | -0.853548 | -0.381718 |
| 24 | 9 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | long | 0.190001 | +0.057207 | 50.000000 | -7.142857 | 0.018054 | 0.473527 | -0.140379 | 0.269152 | 0.802493 | 0.401247 |
| 24 | 10 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 13 | long | 0.030505 | 0.000000 | 69.230769 | 0.000000 | 0.031036 | 0.152193 | -0.183561 | 0.180103 | 0.722684 | 0.200437 |
| 24 | 11 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 12 | long | 0.015723 | +0.009826 | 58.333333 | +3.787878 | 0.046622 | 0.117689 | -0.133147 | 0.112078 | 0.462787 | 0.133595 |
| 24 | 12 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 11 | long | 0.032715 | -0.027641 | 63.636364 | 0.000000 | 0.038535 | 0.235305 | -0.164028 | 0.169634 | 0.461124 | 0.139034 |
| 24 | 13 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 29 | long | 0.023843 | -0.028396 | 55.172414 | +0.172414 | 0.063219 | 0.362237 | -0.141674 | 0.159797 | 0.354464 | 0.065822 |
| 24 | 14 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | long | 0.018809 | -0.056285 | 55.555556 | -24.444444 | 0.082342 | 0.265969 | -0.153037 | 0.137089 | 0.212151 | 0.070717 |
| 24 | 15 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | long | 0.014677 | 0.000000 | 50.000000 | 0.000000 | 0.096487 | 0.279257 | -0.181227 | 0.146266 | 0.105113 | 0.052557 |
| 24 | 16 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.003212 | -0.058205 | 40.000000 | -10.000000 | -0.010624 | 0.139427 | -0.088605 | 0.157070 | 0.051519 | 0.023040 |

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.056741 | 100.000000 | 9.475817 |
| 2 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.038246 | 65.000000 | 3.490395 |
| 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.037671 | 54.545455 | 2.525062 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 29 | long | 0.030734 | 62.068966 | 1.661131 |
| 5 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.032307 | 80.000000 | 1.591957 |
| 6 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.033607 | 33.333333 | -1.538298 |
| 7 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 9 | long | 0.029888 | 77.777778 | 1.291395 |
| 8 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.007153 | 40.000000 | -1.244511 |
| 9 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | short | -0.020680 | 55.555556 | -0.709847 |
| 10 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.045907 | 50.000000 | -0.617037 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.048740 | 65.000000 | 3.387438 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.091886 | 80.000000 | 3.110981 |
| 3 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 11 | long | 0.054979 | 63.636364 | 2.210890 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.033989 | 80.000000 | 2.197861 |
| 5 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.039891 | 63.636364 | 1.664002 |
| 6 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.024348 | 25.000000 | -1.580122 |
| 7 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.055314 | 30.000000 | -1.578785 |
| 8 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.050116 | 100.000000 | 1.448544 |
| 9 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | short | -0.076329 | 33.333333 | -1.305567 |
| 10 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 14 | short | -0.020550 | 21.428571 | -1.022451 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.063510 | 65.000000 | 3.692066 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.103880 | 80.000000 | 2.481095 |
| 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.056881 | 81.818182 | 2.044708 |
| 4 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.059300 | 0.000000 | -1.942439 |
| 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.073781 | 40.000000 | -1.492947 |
| 6 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 9 | long | 0.078563 | 77.777778 | 1.033337 |
| 7 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.044704 | 20.000000 | -0.889306 |
| 8 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 13 | long | 0.040071 | 61.538462 | 0.605227 |
| 9 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.014372 | 58.333333 | -0.402293 |
| 10 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | long | 0.026073 | 55.555556 | 0.390122 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.075379 | 67.500000 | 3.237627 |
| 2 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 11 | long | 0.067093 | 72.727273 | 2.134181 |
| 3 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 9 | long | 0.201569 | 55.555556 | 1.711123 |
| 4 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 14 | long | 0.133900 | 57.142857 | 1.657210 |
| 5 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.017646 | 66.666667 | 1.286185 |
| 6 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 9 | long | 0.105879 | 66.666667 | 1.170449 |
| 7 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.053427 | 40.000000 | -1.056846 |
| 8 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.029669 | 60.000000 | -0.853548 |
| 9 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | long | 0.190001 | 50.000000 | 0.802493 |
| 10 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 13 | long | 0.030505 | 69.230769 | 0.722684 |

## 5m tight only

- Study ID: `2dd6fdd8-9f87-4d5d-af89-cf18cb4b10ae`
- Variant: `horizon-5m-tight-only`
- Description: One-factor timeHorizon change: 5m=6, all other timeframe settings use defaults.
- Observed transitions: 208
- Result rows: 64
- Occurrence rows: 832
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Family Summary By Horizon

| Horizon | Family | Patterns | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | ---: | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | 1 | 40 | 0.044943 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.078654 | long |
| 3 | bear_confluence | 1 | 16 | -0.015792 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.456351 | short |
| 3 | fast_bullish_reversal | 1 | 9 | -0.015520 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.428485 | short |
| 3 | fast_bearish_reversal | 1 | 19 | 0.018470 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.651760 | long |
| 3 | mixed_divergence | 12 | 124 | 0.003495 | `1m:buy|2m:sell|5m:buy|15m:sell` | 3.807823 | long |
| 3 | inactive | 0 | 0 |  | `` |  |  |
| 6 | bull_confluence | 1 | 40 | 0.044605 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.199479 | long |
| 6 | bear_confluence | 1 | 16 | 0.003744 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.095225 | long |
| 6 | fast_bullish_reversal | 1 | 9 | -0.058780 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.889961 | short |
| 6 | fast_bearish_reversal | 1 | 19 | -0.047846 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.561375 | short |
| 6 | mixed_divergence | 12 | 124 | 0.014700 | `1m:sell|2m:buy|5m:buy|15m:sell` | 2.784790 | long |
| 6 | inactive | 0 | 0 |  | `` |  |  |
| 12 | bull_confluence | 1 | 40 | 0.068887 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.412636 | long |
| 12 | bear_confluence | 1 | 16 | 0.035995 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.660893 | long |
| 12 | fast_bullish_reversal | 1 | 9 | 0.050520 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.733094 | long |
| 12 | fast_bearish_reversal | 1 | 19 | -0.054067 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.527823 | short |
| 12 | mixed_divergence | 12 | 124 | 0.018077 | `1m:buy|2m:sell|5m:buy|15m:buy` | 2.573695 | long |
| 12 | inactive | 0 | 0 |  | `` |  |  |
| 24 | bull_confluence | 1 | 40 | 0.073234 | `1m:buy|2m:buy|5m:buy|15m:buy` | 2.944222 | long |
| 24 | bear_confluence | 1 | 16 | 0.028094 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.823265 | long |
| 24 | fast_bullish_reversal | 1 | 9 | 0.015489 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.181495 | long |
| 24 | fast_bearish_reversal | 1 | 19 | -0.059036 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.565068 | short |
| 24 | mixed_divergence | 12 | 124 | 0.068181 | `1m:buy|2m:sell|5m:buy|15m:sell` | 2.784728 | long |
| 24 | inactive | 0 | 0 |  | `` |  |  |

### All Observed Combination Outcomes

| Horizon | Rank | Pattern | Family | n | Bias | Mean% | Delta Mean% | Win% | Delta Win% | Median% | Std% | MAE% | MFE% | t-stat | Score |
| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.044943 | +0.000144 | 70.000000 | +1.578947 | 0.030180 | 0.069691 | -0.016957 | 0.071451 | 4.078654 | 0.644892 |
| 3 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.049121 | +0.000895 | 80.000000 | +5.000000 | 0.059990 | 0.028846 | -0.015948 | 0.064341 | 3.807823 | 1.702910 |
| 3 | 3 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.051768 | +0.019750 | 100.000000 | +20.000000 | 0.023804 | 0.044646 | -0.044711 | 0.090568 | 2.592755 | 1.159515 |
| 3 | 4 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 13 | long | 0.022880 | -0.010868 | 53.846154 | -6.153846 | 0.031375 | 0.037888 | -0.019494 | 0.057987 | 2.177304 | 0.603876 |
| 3 | 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.012156 | -0.002909 | 40.000000 | -2.857143 | -0.011107 | 0.020868 | -0.051358 | 0.024221 | -1.842079 | -0.582516 |
| 3 | 6 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.023082 | +0.000809 | 77.272727 | +2.272727 | 0.022550 | 0.069091 | -0.041396 | 0.046834 | 1.566998 | 0.334085 |
| 3 | 7 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.034631 | +0.009633 | 41.666667 | +5.303031 | -0.042026 | 0.091918 | -0.085726 | 0.043663 | -1.305122 | -0.376756 |
| 3 | 8 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.056319 | -0.010412 | 40.000000 | -10.000000 | -0.019728 | 0.112121 | -0.095803 | 0.061007 | -1.123178 | -0.502301 |
| 3 | 9 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 17 | short | -0.010957 | +0.015654 | 41.176471 | +10.407240 | -0.009054 | 0.067714 | -0.060905 | 0.037707 | -0.667197 | -0.161819 |
| 3 | 10 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | long | 0.018470 | -0.004164 | 52.631579 | -1.913876 | 0.002005 | 0.123522 | -0.050584 | 0.061132 | 0.651760 | 0.149524 |
| 3 | 11 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.004922 | -0.001355 | 25.000000 | -3.571429 | -0.017386 | 0.029872 | -0.041085 | 0.023642 | -0.466010 | -0.164759 |
| 3 | 12 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 16 | short | -0.015792 | +0.005821 | 50.000000 | -3.333333 | 0.001227 | 0.138423 | -0.094691 | 0.065626 | -0.456351 | -0.114088 |
| 3 | 13 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.009078 | +0.003821 | 42.105263 | +1.196172 | -0.002702 | 0.089001 | -0.053260 | 0.047339 | 0.444612 | 0.102001 |
| 3 | 14 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | short | -0.015520 | -0.026818 | 55.555556 | -4.444444 | 0.038708 | 0.108664 | -0.069120 | 0.049664 | -0.428485 | -0.142828 |
| 3 | 15 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.001986 | -0.010080 | 42.857143 | -14.285714 | -0.020194 | 0.063439 | -0.044749 | 0.031299 | 0.082826 | 0.031305 |
| 3 | 16 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 1 | short | -0.018282 | -0.021951 | 0.000000 | -25.000000 | -0.018282 | 0.000000 | -0.085837 | 0.022532 | 0.000000 | 0.000000 |
| 6 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.044605 | -0.000643 | 62.500000 | +1.973684 | 0.013884 | 0.088172 | -0.026016 | 0.091744 | 3.199479 | 0.505882 |
| 6 | 2 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.074582 | +0.036148 | 100.000000 | +20.000000 | 0.059203 | 0.059886 | -0.044711 | 0.130190 | 2.784790 | 1.245396 |
| 6 | 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.038472 | -0.001260 | 81.818182 | +1.818182 | 0.021924 | 0.070109 | -0.044003 | 0.074011 | 2.573839 | 0.548744 |
| 6 | 4 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.080999 | -0.001871 | 80.000000 | +5.000000 | 0.075990 | 0.073318 | -0.016933 | 0.111388 | 2.470349 | 1.104774 |
| 6 | 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.048920 | -0.009317 | 73.684211 | +0.956938 | 0.025660 | 0.110537 | -0.056230 | 0.077842 | 1.929091 | 0.442564 |
| 6 | 6 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.079678 | -0.040195 | 0.000000 | -50.000000 | -0.023162 | 0.145493 | -0.139617 | 0.063618 | -1.224555 | -0.547638 |
| 6 | 7 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 13 | long | 0.021220 | -0.011807 | 53.846154 | -6.153846 | 0.025342 | 0.071557 | -0.035697 | 0.073543 | 1.069205 | 0.296544 |
| 6 | 8 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | short | -0.058780 | -0.035169 | 44.444444 | -5.555556 | -0.008327 | 0.198145 | -0.124312 | 0.060580 | -0.889961 | -0.296654 |
| 6 | 9 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 17 | short | -0.014565 | +0.022501 | 29.411765 | +6.334842 | -0.031677 | 0.098715 | -0.084343 | 0.045204 | -0.608325 | -0.147540 |
| 6 | 10 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | short | -0.047846 | -0.016152 | 57.894737 | +3.349282 | 0.032318 | 0.371507 | -0.147157 | 0.076878 | -0.561375 | -0.128788 |
| 6 | 11 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.017356 | +0.010960 | 33.333333 | +6.060606 | -0.016144 | 0.124706 | -0.105617 | 0.060934 | -0.482118 | -0.139176 |
| 6 | 12 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.021174 | +0.059323 | 30.000000 | +15.714286 | -0.015104 | 0.148502 | -0.103497 | 0.055850 | -0.450894 | -0.142585 |
| 6 | 13 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | long | 0.005766 | +0.017480 | 50.000000 | +7.142857 | -0.008752 | 0.057003 | -0.049017 | 0.042970 | 0.286084 | 0.101146 |
| 6 | 14 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.005285 | +0.000518 | 42.857143 | 0.000000 | -0.010393 | 0.057683 | -0.054113 | 0.041552 | 0.242413 | 0.091623 |
| 6 | 15 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 16 | long | 0.003744 | +0.016771 | 62.500000 | +12.500000 | 0.022731 | 0.157288 | -0.105838 | 0.090680 | 0.095225 | 0.023806 |
| 6 | 16 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 1 | short | -0.023912 | -0.055521 | 0.000000 | -75.000000 | -0.023912 | 0.000000 | -0.085837 | 0.022532 | 0.000000 | 0.000000 |
| 12 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.068887 | -0.003331 | 60.000000 | -0.526316 | 0.029171 | 0.127667 | -0.043165 | 0.124937 | 3.412636 | 0.539585 |
| 12 | 2 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.075600 | +0.041965 | 73.684211 | +5.502393 | 0.059404 | 0.128038 | -0.066384 | 0.117542 | 2.573695 | 0.590446 |
| 12 | 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.082969 | -0.031962 | 100.000000 | 0.000000 | 0.057696 | 0.076565 | -0.017929 | 0.133965 | 2.423080 | 1.083634 |
| 12 | 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.057975 | -0.004891 | 63.636364 | -1.363636 | 0.038895 | 0.119796 | -0.053060 | 0.104772 | 2.269923 | 0.483949 |
| 12 | 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.152145 | -0.034285 | 20.000000 | +5.714286 | -0.048785 | 0.312545 | -0.215101 | 0.076579 | -1.539375 | -0.486793 |
| 12 | 6 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 13 | long | 0.030842 | -0.021694 | 69.230769 | -0.769231 | 0.025327 | 0.081521 | -0.054079 | 0.090295 | 1.364071 | 0.378325 |
| 12 | 7 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.033739 | +0.000212 | 42.857143 | 0.000000 | -0.005425 | 0.109429 | -0.076567 | 0.089568 | 0.815731 | 0.308317 |
| 12 | 8 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | long | 0.050520 | -0.018626 | 55.555556 | -14.444444 | 0.049968 | 0.206739 | -0.131651 | 0.126182 | 0.733094 | 0.244365 |
| 12 | 9 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 16 | long | 0.035995 | -0.004076 | 56.250000 | -5.288462 | 0.033420 | 0.217858 | -0.129330 | 0.145985 | 0.660893 | 0.165223 |
| 12 | 10 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | short | -0.054067 | -0.032939 | 57.894737 | -1.196172 | 0.014035 | 0.446498 | -0.168635 | 0.102898 | -0.527823 | -0.121091 |
| 12 | 11 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.027591 | -0.037673 | 40.000000 | -10.000000 | -0.010623 | 0.118255 | -0.160810 | 0.064428 | -0.521706 | -0.233314 |
| 12 | 12 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 17 | long | 0.021590 | +0.034138 | 35.294118 | +4.524887 | -0.032293 | 0.202764 | -0.115206 | 0.132224 | 0.439026 | 0.106479 |
| 12 | 13 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.027071 | +0.017509 | 20.000000 | 0.000000 | -0.025806 | 0.140183 | -0.092837 | 0.137122 | -0.431806 | -0.193110 |
| 12 | 14 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.006914 | +0.015668 | 58.333333 | +3.787878 | 0.029063 | 0.136644 | -0.121764 | 0.091422 | -0.175285 | -0.050600 |
| 12 | 15 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | neutral | -0.000038 | +0.012242 | 62.500000 | +5.357143 | 0.018420 | 0.073278 | -0.073353 | 0.062091 | -0.001476 | -0.000522 |
| 12 | 16 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 1 | short | -0.011245 | -0.022185 | 0.000000 | -25.000000 | -0.011245 | 0.000000 | -0.085837 | 0.022532 | 0.000000 | 0.000000 |
| 24 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.073234 | -0.002592 | 65.000000 | -0.789474 | 0.061699 | 0.157316 | -0.058841 | 0.167785 | 2.944222 | 0.465522 |
| 24 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.106833 | +0.045416 | 80.000000 | +30.000000 | 0.116977 | 0.085784 | -0.032283 | 0.175188 | 2.784728 | 1.245368 |
| 24 | 3 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.311983 | +0.011911 | 100.000000 | +14.285714 | 0.151463 | 0.340884 | -0.097045 | 0.348431 | 2.421439 | 0.915218 |
| 24 | 4 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.076675 | +0.016319 | 68.421053 | +4.784689 | 0.067310 | 0.158496 | -0.081523 | 0.151602 | 2.108703 | 0.483770 |
| 24 | 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 17 | long | 0.146214 | +0.028718 | 64.705882 | +10.859728 | 0.028031 | 0.316684 | -0.144559 | 0.225486 | 1.903645 | 0.461702 |
| 24 | 6 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.047142 | -0.005097 | 54.545455 | -0.454545 | 0.009071 | 0.123024 | -0.070373 | 0.135723 | 1.797355 | 0.383197 |
| 24 | 7 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 13 | long | 0.051271 | +0.028228 | 61.538462 | +1.538462 | 0.057212 | 0.128267 | -0.082685 | 0.124814 | 1.441216 | 0.399721 |
| 24 | 8 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | long | 0.102738 | -0.030056 | 50.000000 | -7.142857 | 0.003721 | 0.321089 | -0.125600 | 0.204453 | 0.905001 | 0.319966 |
| 24 | 9 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 16 | long | 0.028094 | -0.002411 | 68.750000 | -0.480769 | 0.024632 | 0.136500 | -0.160902 | 0.168235 | 0.823265 | 0.205816 |
| 24 | 10 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.065699 | +0.009729 | 40.000000 | -2.857143 | -0.069103 | 0.264654 | -0.249698 | 0.108376 | -0.785024 | -0.248247 |
| 24 | 11 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | short | -0.059036 | -0.048988 | 47.368421 | -7.177034 | -0.013198 | 0.455397 | -0.220595 | 0.135186 | -0.565068 | -0.129635 |
| 24 | 12 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.023335 | -0.038012 | 40.000000 | -10.000000 | -0.019970 | 0.219299 | -0.170568 | 0.084896 | -0.237932 | -0.106406 |
| 24 | 13 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | long | 0.015489 | -0.059605 | 66.666667 | -13.333333 | 0.078101 | 0.256021 | -0.156425 | 0.145980 | 0.181495 | 0.060498 |
| 24 | 14 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 12 | long | 0.004520 | -0.001377 | 50.000000 | -4.545455 | 0.023707 | 0.122306 | -0.140507 | 0.117101 | 0.128028 | 0.036959 |
| 24 | 15 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.005266 | +0.015387 | 40.000000 | -20.000000 | -0.016365 | 0.131421 | -0.142200 | 0.143919 | -0.089602 | -0.040071 |
| 24 | 16 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 1 | long | 0.014088 | -0.002669 | 100.000000 | +25.000000 | 0.014088 | 0.000000 | -0.122430 | 0.025347 | 0.000000 | 0.000000 |

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.044943 | 70.000000 | 4.078654 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.049121 | 80.000000 | 3.807823 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.051768 | 100.000000 | 2.592755 |
| 4 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 13 | long | 0.022880 | 53.846154 | 2.177304 |
| 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.012156 | 40.000000 | -1.842079 |
| 6 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.023082 | 77.272727 | 1.566998 |
| 7 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.034631 | 41.666667 | -1.305122 |
| 8 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.056319 | 40.000000 | -1.123178 |
| 9 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 17 | short | -0.010957 | 41.176471 | -0.667197 |
| 10 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | long | 0.018470 | 52.631579 | 0.651760 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.044605 | 62.500000 | 3.199479 |
| 2 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.074582 | 100.000000 | 2.784790 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.038472 | 81.818182 | 2.573839 |
| 4 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.080999 | 80.000000 | 2.470349 |
| 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.048920 | 73.684211 | 1.929091 |
| 6 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.079678 | 0.000000 | -1.224555 |
| 7 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 13 | long | 0.021220 | 53.846154 | 1.069205 |
| 8 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | short | -0.058780 | 44.444444 | -0.889961 |
| 9 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 17 | short | -0.014565 | 29.411765 | -0.608325 |
| 10 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | short | -0.047846 | 57.894737 | -0.561375 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.068887 | 60.000000 | 3.412636 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.075600 | 73.684211 | 2.573695 |
| 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.082969 | 100.000000 | 2.423080 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.057975 | 63.636364 | 2.269923 |
| 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.152145 | 20.000000 | -1.539375 |
| 6 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 13 | long | 0.030842 | 69.230769 | 1.364071 |
| 7 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.033739 | 42.857143 | 0.815731 |
| 8 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 9 | long | 0.050520 | 55.555556 | 0.733094 |
| 9 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 16 | long | 0.035995 | 56.250000 | 0.660893 |
| 10 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 19 | short | -0.054067 | 57.894737 | -0.527823 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.073234 | 65.000000 | 2.944222 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.106833 | 80.000000 | 2.784728 |
| 3 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.311983 | 100.000000 | 2.421439 |
| 4 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 19 | long | 0.076675 | 68.421053 | 2.108703 |
| 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 17 | long | 0.146214 | 64.705882 | 1.903645 |
| 6 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.047142 | 54.545455 | 1.797355 |
| 7 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 13 | long | 0.051271 | 61.538462 | 1.441216 |
| 8 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | long | 0.102738 | 50.000000 | 0.905001 |
| 9 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 16 | long | 0.028094 | 68.750000 | 0.823265 |
| 10 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.065699 | 40.000000 | -0.785024 |

## 5m slow only

- Study ID: `c8903f92-203d-44c6-ae63-2a2af3ebdc93`
- Variant: `horizon-5m-slow-only`
- Description: One-factor timeHorizon change: 5m=12, all other timeframe settings use defaults.
- Observed transitions: 191
- Result rows: 64
- Occurrence rows: 761
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Family Summary By Horizon

| Horizon | Family | Patterns | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | ---: | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | 1 | 38 | 0.040299 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.821374 | long |
| 3 | bear_confluence | 1 | 15 | -0.018278 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.500665 | short |
| 3 | fast_bullish_reversal | 1 | 10 | 0.011298 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.480820 | long |
| 3 | fast_bearish_reversal | 1 | 26 | 0.017641 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.810415 | long |
| 3 | mixed_divergence | 12 | 102 | 0.000915 | `1m:buy|2m:sell|5m:buy|15m:sell` | 2.832940 | long |
| 3 | inactive | 0 | 0 |  | `` |  |  |
| 6 | bull_confluence | 1 | 38 | 0.034035 | `1m:buy|2m:buy|5m:buy|15m:buy` | 2.734039 | long |
| 6 | bear_confluence | 1 | 14 | -0.004627 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.104480 | short |
| 6 | fast_bullish_reversal | 1 | 10 | -0.023611 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.413707 | short |
| 6 | fast_bearish_reversal | 1 | 26 | -0.031776 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.499905 | short |
| 6 | mixed_divergence | 12 | 102 | 0.011536 | `1m:sell|2m:buy|5m:buy|15m:sell` | 2.598167 | long |
| 6 | inactive | 0 | 0 |  | `` |  |  |
| 12 | bull_confluence | 1 | 38 | 0.060040 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.056704 | long |
| 12 | bear_confluence | 1 | 14 | 0.035279 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.573800 | long |
| 12 | fast_bullish_reversal | 1 | 10 | 0.069146 | `1m:buy|2m:buy|5m:sell|15m:sell` | 1.162843 | long |
| 12 | fast_bearish_reversal | 1 | 26 | -0.003020 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.037651 | short |
| 12 | mixed_divergence | 12 | 102 | 0.008723 | `1m:buy|2m:sell|5m:buy|15m:sell` | 2.771812 | long |
| 12 | inactive | 0 | 0 |  | `` |  |  |
| 24 | bull_confluence | 1 | 38 | 0.057028 | `1m:buy|2m:buy|5m:buy|15m:buy` | 2.642141 | long |
| 24 | bear_confluence | 1 | 14 | 0.029580 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.756708 | long |
| 24 | fast_bullish_reversal | 1 | 10 | 0.075094 | `1m:buy|2m:buy|5m:sell|15m:sell` | 1.015361 | long |
| 24 | fast_bearish_reversal | 1 | 26 | 0.055383 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.594993 | long |
| 24 | mixed_divergence | 12 | 102 | 0.034644 | `1m:sell|2m:buy|5m:buy|15m:buy` | 2.119804 | long |
| 24 | inactive | 0 | 0 |  | `` |  |  |

### All Observed Combination Outcomes

| Horizon | Rank | Pattern | Family | n | Bias | Mean% | Delta Mean% | Win% | Delta Win% | Median% | Std% | MAE% | MFE% | t-stat | Score |
| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.040299 | -0.004500 | 68.421053 | 0.000000 | 0.029061 | 0.065008 | -0.016743 | 0.067379 | 3.821374 | 0.619909 |
| 3 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.048226 | 0.000000 | 75.000000 | 0.000000 | 0.061490 | 0.034047 | -0.021228 | 0.067156 | 2.832940 | 1.416470 |
| 3 | 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 8 | long | 0.029571 | -0.004177 | 50.000000 | -10.000000 | 0.019339 | 0.049774 | -0.026687 | 0.057967 | 1.680405 | 0.594113 |
| 3 | 4 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 11 | short | -0.044264 | 0.000000 | 36.363636 | 0.000000 | -0.043141 | 0.089827 | -0.090208 | 0.039630 | -1.634309 | -0.492763 |
| 3 | 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.015110 | -0.005863 | 40.000000 | -2.857143 | -0.028037 | 0.022532 | -0.032452 | 0.010578 | -1.499511 | -0.670602 |
| 3 | 6 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.035306 | +0.003288 | 75.000000 | -5.000000 | 0.028578 | 0.052182 | -0.042972 | 0.054159 | 1.353167 | 0.676584 |
| 3 | 7 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.012284 | -0.009989 | 69.565217 | -5.434783 | 0.012595 | 0.060207 | -0.044185 | 0.038551 | 0.978476 | 0.204026 |
| 3 | 8 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.007993 | -0.004426 | 25.000000 | -3.571429 | -0.014623 | 0.019250 | -0.025760 | 0.017064 | -0.830452 | -0.415226 |
| 3 | 9 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 26 | long | 0.017641 | -0.004993 | 50.000000 | -4.545455 | -0.000394 | 0.110993 | -0.050824 | 0.062279 | 0.810415 | 0.158935 |
| 3 | 10 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.032951 | +0.012956 | 60.000000 | +10.000000 | 0.018869 | 0.132078 | -0.091589 | 0.106531 | -0.557866 | -0.249485 |
| 3 | 11 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.013725 | +0.012886 | 37.500000 | +6.730769 | -0.017309 | 0.077123 | -0.074460 | 0.033529 | -0.503358 | -0.177964 |
| 3 | 12 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 15 | short | -0.018278 | +0.003335 | 53.333333 | 0.000000 | 0.006504 | 0.141389 | -0.095785 | 0.067574 | -0.500665 | -0.129271 |
| 3 | 13 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | long | 0.011298 | 0.000000 | 60.000000 | 0.000000 | 0.035042 | 0.074306 | -0.038949 | 0.051836 | 0.480820 | 0.152049 |
| 3 | 14 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.008324 | -0.020390 | 50.000000 | -7.142857 | -0.007067 | 0.050862 | -0.055965 | 0.026331 | -0.327337 | -0.163668 |
| 3 | 15 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.005377 | +0.000120 | 39.130435 | -1.778656 | -0.004929 | 0.081380 | -0.058017 | 0.046082 | 0.316847 | 0.066067 |
| 3 | 16 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.006242 | +0.002573 | 33.333333 | +8.333333 | -0.018282 | 0.059069 | -0.060350 | 0.052097 | 0.183022 | 0.105668 |
| 6 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.034035 | -0.011213 | 57.894737 | -2.631579 | 0.009606 | 0.076738 | -0.026838 | 0.083377 | 2.734039 | 0.443520 |
| 6 | 2 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.038271 | -0.000163 | 75.000000 | -5.000000 | 0.046527 | 0.029460 | -0.042972 | 0.079965 | 2.598167 | 1.299084 |
| 6 | 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.082870 | 0.000000 | 75.000000 | 0.000000 | 0.089596 | 0.079410 | -0.022458 | 0.118903 | 2.087142 | 1.043571 |
| 6 | 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.022237 | -0.017495 | 69.565217 | -10.434783 | 0.010518 | 0.051469 | -0.049410 | 0.055801 | 2.072007 | 0.432043 |
| 6 | 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.047830 | -0.010407 | 69.565217 | -3.162056 | 0.025616 | 0.114713 | -0.065244 | 0.081101 | 1.999634 | 0.416952 |
| 6 | 6 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.091535 | -0.011038 | 0.000000 | -14.285714 | -0.032867 | 0.140248 | -0.114774 | 0.015990 | -1.459408 | -0.652667 |
| 6 | 7 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.029661 | +0.007405 | 25.000000 | +1.923077 | -0.025327 | 0.057773 | -0.092952 | 0.033529 | -1.452145 | -0.513411 |
| 6 | 8 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.033593 | +0.001984 | 66.666667 | -8.333333 | 0.006288 | 0.074983 | -0.060350 | 0.070052 | 0.775963 | 0.448003 |
| 6 | 9 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 11 | short | -0.028316 | 0.000000 | 27.272727 | 0.000000 | -0.024546 | 0.124584 | -0.111907 | 0.054470 | -0.753813 | -0.227283 |
| 6 | 10 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 8 | long | 0.018885 | -0.014142 | 50.000000 | -10.000000 | 0.012671 | 0.078077 | -0.047069 | 0.069124 | 0.684128 | 0.241876 |
| 6 | 11 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.014129 | -0.018896 | 50.000000 | +7.142857 | 0.003683 | 0.048168 | -0.056648 | 0.032551 | -0.586664 | -0.293332 |
| 6 | 12 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 26 | short | -0.031776 | -0.000082 | 50.000000 | -4.545455 | 0.004863 | 0.324110 | -0.129203 | 0.077690 | -0.499905 | -0.098039 |
| 6 | 13 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | short | -0.023611 | 0.000000 | 50.000000 | 0.000000 | 0.008098 | 0.180480 | -0.084446 | 0.066369 | -0.413707 | -0.130826 |
| 6 | 14 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.023769 | +0.015714 | 60.000000 | +10.000000 | 0.033474 | 0.192282 | -0.135402 | 0.129028 | -0.276418 | -0.123618 |
| 6 | 15 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | long | 0.002639 | +0.014353 | 75.000000 | +32.142857 | 0.014663 | 0.035220 | -0.033486 | 0.027314 | 0.149860 | 0.074930 |
| 6 | 16 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 14 | short | -0.004627 | +0.008400 | 57.142857 | +7.142857 | 0.022731 | 0.165705 | -0.114157 | 0.090232 | -0.104480 | -0.027924 |
| 12 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.060040 | -0.012178 | 60.526316 | 0.000000 | 0.020509 | 0.121083 | -0.043183 | 0.116352 | 3.056704 | 0.495863 |
| 12 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.114931 | 0.000000 | 100.000000 | 0.000000 | 0.111561 | 0.082929 | -0.022634 | 0.139040 | 2.771812 | 1.385906 |
| 12 | 3 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | long | 0.031187 | +0.043467 | 75.000000 | +17.857143 | 0.040965 | 0.026676 | -0.033486 | 0.053643 | 2.338185 | 1.169092 |
| 12 | 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.042637 | -0.020229 | 60.869565 | -4.130435 | 0.040925 | 0.093001 | -0.064907 | 0.091553 | 2.198680 | 0.458456 |
| 12 | 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.056109 | -0.043561 | 12.500000 | -18.269231 | -0.061414 | 0.077040 | -0.127603 | 0.048598 | -2.059949 | -0.728302 |
| 12 | 6 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | long | 0.033445 | -0.000082 | 50.000000 | +7.142857 | 0.028389 | 0.050886 | -0.056648 | 0.072526 | 1.314494 | 0.657247 |
| 12 | 7 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.113578 | +0.004282 | 20.000000 | +5.714286 | -0.039227 | 0.195489 | -0.141824 | 0.017955 | -1.299140 | -0.580993 |
| 12 | 8 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | long | 0.069146 | 0.000000 | 70.000000 | 0.000000 | 0.074122 | 0.188037 | -0.095114 | 0.134041 | 1.162843 | 0.367723 |
| 12 | 9 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 8 | long | 0.043970 | -0.008566 | 62.500000 | -7.500000 | 0.022815 | 0.113401 | -0.053613 | 0.094226 | 1.096690 | 0.387738 |
| 12 | 10 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | short | -0.038203 | +0.006377 | 25.000000 | +5.000000 | -0.018215 | 0.128799 | -0.101113 | 0.088428 | -0.593221 | -0.296611 |
| 12 | 11 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 14 | long | 0.035279 | -0.004792 | 57.142857 | -4.395605 | 0.033420 | 0.230049 | -0.140804 | 0.150186 | 0.573800 | 0.153355 |
| 12 | 12 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 11 | short | -0.022582 | 0.000000 | 54.545455 | 0.000000 | 0.025336 | 0.131524 | -0.129523 | 0.083728 | -0.569438 | -0.171692 |
| 12 | 13 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.023590 | +0.012650 | 33.333333 | +8.333333 | -0.011245 | 0.113360 | -0.061288 | 0.085232 | 0.360441 | 0.208101 |
| 12 | 14 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.009393 | -0.024242 | 60.869565 | -7.312253 | 0.049810 | 0.235849 | -0.114317 | 0.114218 | 0.191006 | 0.039828 |
| 12 | 15 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.005952 | -0.016034 | 40.000000 | -10.000000 | -0.002975 | 0.153940 | -0.141872 | 0.135960 | -0.086453 | -0.038663 |
| 12 | 16 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 26 | short | -0.003020 | +0.018108 | 57.692308 | -1.398601 | 0.017778 | 0.408974 | -0.150837 | 0.140998 | -0.037651 | -0.007384 |
| 24 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.057028 | -0.018798 | 65.789474 | 0.000000 | 0.041953 | 0.133053 | -0.060365 | 0.153726 | 2.642141 | 0.428612 |
| 24 | 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.104661 | +0.052422 | 60.869565 | +5.869565 | 0.063219 | 0.236785 | -0.084939 | 0.179977 | 2.119804 | 0.442010 |
| 24 | 3 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | long | 0.080102 | -0.219970 | 75.000000 | -10.714286 | 0.089350 | 0.076210 | -0.068495 | 0.118391 | 2.102120 | 1.051060 |
| 24 | 4 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.016490 | -0.000267 | 66.666667 | -8.333333 | 0.014088 | 0.023854 | -0.084617 | 0.109948 | 1.197353 | 0.691292 |
| 24 | 5 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.061417 | 0.000000 | 50.000000 | 0.000000 | 0.049527 | 0.103208 | -0.045509 | 0.178673 | 1.190158 | 0.595079 |
| 24 | 6 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | long | 0.041803 | -0.090991 | 50.000000 | -7.142857 | 0.034238 | 0.080820 | -0.050541 | 0.088877 | 1.034482 | 0.517241 |
| 24 | 7 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.042850 | -0.017506 | 60.869565 | -2.766799 | 0.037449 | 0.199046 | -0.138342 | 0.143778 | 1.032438 | 0.215278 |
| 24 | 8 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | long | 0.075094 | 0.000000 | 80.000000 | 0.000000 | 0.094437 | 0.233877 | -0.101056 | 0.167975 | 1.015361 | 0.321085 |
| 24 | 9 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.025777 | -0.143273 | 37.500000 | -16.346154 | -0.041698 | 0.074994 | -0.159016 | 0.057021 | -0.972199 | -0.343724 |
| 24 | 10 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.093318 | -0.017890 | 40.000000 | -2.857143 | -0.061252 | 0.224238 | -0.158028 | 0.041220 | -0.930556 | -0.416157 |
| 24 | 11 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 14 | long | 0.029580 | -0.000925 | 71.428571 | +2.197802 | 0.024632 | 0.146263 | -0.174501 | 0.170519 | 0.756708 | 0.202239 |
| 24 | 12 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 26 | long | 0.055383 | +0.065431 | 57.692308 | +3.146853 | 0.034018 | 0.474629 | -0.201842 | 0.220043 | 0.594993 | 0.116688 |
| 24 | 13 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 11 | long | 0.005897 | 0.000000 | 54.545455 | 0.000000 | 0.058038 | 0.128178 | -0.148175 | 0.110362 | 0.152586 | 0.046006 |
| 24 | 14 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.011711 | -0.026388 | 40.000000 | -10.000000 | -0.016365 | 0.248937 | -0.185147 | 0.146104 | -0.105190 | -0.047042 |
| 24 | 15 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.003499 | +0.024152 | 75.000000 | +15.000000 | 0.030712 | 0.077611 | -0.120217 | 0.113553 | 0.090161 | 0.045081 |
| 24 | 16 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 8 | long | 0.001336 | -0.021707 | 50.000000 | -10.000000 | 0.014058 | 0.120009 | -0.101604 | 0.101966 | 0.031482 | 0.011130 |

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.040299 | 68.421053 | 3.821374 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.048226 | 75.000000 | 2.832940 |
| 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 8 | long | 0.029571 | 50.000000 | 1.680405 |
| 4 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 11 | short | -0.044264 | 36.363636 | -1.634309 |
| 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.015110 | 40.000000 | -1.499511 |
| 6 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.035306 | 75.000000 | 1.353167 |
| 7 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.012284 | 69.565217 | 0.978476 |
| 8 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | short | -0.007993 | 25.000000 | -0.830452 |
| 9 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 26 | long | 0.017641 | 50.000000 | 0.810415 |
| 10 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.032951 | 60.000000 | -0.557866 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.034035 | 57.894737 | 2.734039 |
| 2 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.038271 | 75.000000 | 2.598167 |
| 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.082870 | 75.000000 | 2.087142 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.022237 | 69.565217 | 2.072007 |
| 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.047830 | 69.565217 | 1.999634 |
| 6 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.091535 | 0.000000 | -1.459408 |
| 7 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.029661 | 25.000000 | -1.452145 |
| 8 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.033593 | 66.666667 | 0.775963 |
| 9 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 11 | short | -0.028316 | 27.272727 | -0.753813 |
| 10 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 8 | long | 0.018885 | 50.000000 | 0.684128 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.060040 | 60.526316 | 3.056704 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.114931 | 100.000000 | 2.771812 |
| 3 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | long | 0.031187 | 75.000000 | 2.338185 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.042637 | 60.869565 | 2.198680 |
| 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.056109 | 12.500000 | -2.059949 |
| 6 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | long | 0.033445 | 50.000000 | 1.314494 |
| 7 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.113578 | 20.000000 | -1.299140 |
| 8 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | long | 0.069146 | 70.000000 | 1.162843 |
| 9 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 8 | long | 0.043970 | 62.500000 | 1.096690 |
| 10 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | short | -0.038203 | 25.000000 | -0.593221 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.057028 | 65.789474 | 2.642141 |
| 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.104661 | 60.869565 | 2.119804 |
| 3 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | long | 0.080102 | 75.000000 | 2.102120 |
| 4 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.016490 | 66.666667 | 1.197353 |
| 5 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.061417 | 50.000000 | 1.190158 |
| 6 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 4 | long | 0.041803 | 50.000000 | 1.034482 |
| 7 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.042850 | 60.869565 | 1.032438 |
| 8 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | long | 0.075094 | 80.000000 | 1.015361 |
| 9 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.025777 | 37.500000 | -0.972199 |
| 10 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.093318 | 40.000000 | -0.930556 |

## 15m tight only

- Study ID: `ef4e286f-72c1-4854-a8cd-208c54bc6807`
- Variant: `horizon-15m-tight-only`
- Description: One-factor timeHorizon change: 15m=6, all other timeframe settings use defaults.
- Observed transitions: 202
- Result rows: 64
- Occurrence rows: 803
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Family Summary By Horizon

| Horizon | Family | Patterns | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | ---: | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | 1 | 38 | 0.045350 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.908707 | long |
| 3 | bear_confluence | 1 | 18 | -0.031332 | `1m:sell|2m:sell|5m:sell|15m:sell` | 1.011828 | short |
| 3 | fast_bullish_reversal | 1 | 12 | 0.009188 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.468213 | long |
| 3 | fast_bearish_reversal | 1 | 22 | 0.022634 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.893825 | long |
| 3 | mixed_divergence | 12 | 112 | 0.004324 | `1m:buy|2m:sell|5m:buy|15m:sell` | 2.832940 | long |
| 3 | inactive | 0 | 0 |  | `` |  |  |
| 6 | bull_confluence | 1 | 38 | 0.046390 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.200526 | long |
| 6 | bear_confluence | 1 | 17 | -0.024688 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.665303 | short |
| 6 | fast_bullish_reversal | 1 | 12 | -0.017232 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.363936 | short |
| 6 | fast_bearish_reversal | 1 | 22 | -0.031694 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.421825 | short |
| 6 | mixed_divergence | 12 | 112 | 0.014316 | `1m:sell|2m:buy|5m:buy|15m:sell` | 2.700407 | long |
| 6 | inactive | 0 | 0 |  | `` |  |  |
| 12 | bull_confluence | 1 | 38 | 0.074520 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.581544 | long |
| 12 | bear_confluence | 1 | 16 | 0.016076 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.292301 | long |
| 12 | fast_bullish_reversal | 1 | 12 | 0.064719 | `1m:buy|2m:buy|5m:sell|15m:sell` | 1.315436 | long |
| 12 | fast_bearish_reversal | 1 | 22 | -0.021128 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.225118 | short |
| 12 | mixed_divergence | 12 | 112 | 0.015605 | `1m:buy|2m:sell|5m:buy|15m:sell` | 2.771812 | long |
| 12 | inactive | 0 | 0 |  | `` |  |  |
| 24 | bull_confluence | 1 | 38 | 0.079906 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.133881 | long |
| 24 | bear_confluence | 1 | 16 | 0.008915 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.245976 | long |
| 24 | fast_bullish_reversal | 1 | 12 | 0.058666 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.944716 | long |
| 24 | fast_bearish_reversal | 1 | 22 | -0.010048 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.103414 | short |
| 24 | mixed_divergence | 12 | 112 | 0.062797 | `1m:sell|2m:buy|5m:sell|15m:buy` | 2.337030 | long |
| 24 | inactive | 0 | 0 |  | `` |  |  |

### All Observed Combination Outcomes

| Horizon | Rank | Pattern | Family | n | Bias | Mean% | Delta Mean% | Win% | Delta Win% | Median% | Std% | MAE% | MFE% | t-stat | Score |
| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.045350 | +0.000551 | 68.421053 | 0.000000 | 0.030180 | 0.071522 | -0.017549 | 0.073578 | 3.908707 | 0.634076 |
| 3 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.048226 | 0.000000 | 75.000000 | 0.000000 | 0.061490 | 0.034047 | -0.021228 | 0.067156 | 2.832940 | 1.416470 |
| 3 | 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.037363 | +0.003615 | 70.000000 | +10.000000 | 0.044697 | 0.042416 | -0.023604 | 0.058909 | 2.785544 | 0.880866 |
| 3 | 4 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 13 | short | -0.039253 | +0.005011 | 38.461538 | +2.097902 | -0.040910 | 0.083492 | -0.080805 | 0.035341 | -1.695128 | -0.470144 |
| 3 | 5 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 21 | long | 0.023211 | +0.000938 | 76.190476 | +1.190476 | 0.025954 | 0.070775 | -0.041642 | 0.047533 | 1.502889 | 0.327957 |
| 3 | 6 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.008268 | +0.000979 | 40.000000 | -2.857143 | -0.004929 | 0.014248 | -0.045018 | 0.012854 | -1.297497 | -0.580258 |
| 3 | 7 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.029529 | -0.002489 | 75.000000 | -5.000000 | 0.017025 | 0.052476 | -0.049688 | 0.079014 | 1.125427 | 0.562714 |
| 3 | 8 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 18 | short | -0.031332 | -0.009719 | 44.444444 | -8.888889 | -0.027774 | 0.131377 | -0.097603 | 0.059431 | -1.011828 | -0.238490 |
| 3 | 9 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.013932 | +0.012679 | 36.363636 | +5.594405 | -0.009054 | 0.050621 | -0.057635 | 0.030823 | -0.912822 | -0.275226 |
| 3 | 10 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 22 | long | 0.022634 | 0.000000 | 54.545455 | 0.000000 | 0.004773 | 0.118774 | -0.047741 | 0.064624 | 0.893825 | 0.190564 |
| 3 | 11 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.030084 | +0.015823 | 50.000000 | 0.000000 | -0.008143 | 0.120743 | -0.085110 | 0.075092 | -0.610314 | -0.249159 |
| 3 | 12 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.014460 | +0.002394 | 66.666667 | +9.523810 | 0.009829 | 0.064179 | -0.041045 | 0.037610 | 0.551875 | 0.225302 |
| 3 | 13 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 12 | long | 0.009188 | -0.002110 | 58.333333 | -1.666667 | 0.025433 | 0.067977 | -0.037701 | 0.045749 | 0.468213 | 0.135161 |
| 3 | 14 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.005257 | 0.000000 | 40.909091 | 0.000000 | -0.004044 | 0.083478 | -0.056466 | 0.047903 | 0.295387 | 0.062977 |
| 3 | 15 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.004448 | -0.000881 | 20.000000 | -8.571429 | -0.020368 | 0.036263 | -0.025707 | 0.020025 | -0.274290 | -0.122666 |
| 3 | 16 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.003476 | -0.000193 | 40.000000 | +15.000000 | -0.004051 | 0.042007 | -0.047824 | 0.041392 | 0.185008 | 0.082738 |
| 6 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.046390 | +0.001142 | 60.526316 | 0.000000 | 0.015549 | 0.089350 | -0.026264 | 0.093274 | 3.200526 | 0.519194 |
| 6 | 2 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.039580 | +0.001146 | 75.000000 | -5.000000 | 0.049145 | 0.029314 | -0.049688 | 0.100419 | 2.700407 | 1.350204 |
| 6 | 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 21 | long | 0.039452 | -0.000280 | 80.952381 | +0.952381 | 0.024334 | 0.071702 | -0.044373 | 0.071305 | 2.521405 | 0.550216 |
| 6 | 4 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.058237 | 0.000000 | 72.727273 | 0.000000 | 0.028714 | 0.109938 | -0.059920 | 0.086899 | 2.484614 | 0.529722 |
| 6 | 5 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.082870 | 0.000000 | 75.000000 | 0.000000 | 0.089596 | 0.079410 | -0.022458 | 0.118903 | 2.087142 | 1.043571 |
| 6 | 6 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.022265 | -0.010551 | 20.000000 | -22.857143 | -0.031189 | 0.028891 | -0.037953 | 0.026346 | -1.723242 | -0.770657 |
| 6 | 7 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.027885 | +0.009181 | 27.272727 | +4.195804 | -0.020511 | 0.056637 | -0.083416 | 0.030823 | -1.632933 | -0.492348 |
| 6 | 8 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 13 | short | -0.054231 | -0.025915 | 23.076923 | -4.195804 | -0.035524 | 0.142828 | -0.127465 | 0.049979 | -1.369011 | -0.379695 |
| 6 | 9 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.033989 | +0.046508 | 20.000000 | +5.714286 | -0.015434 | 0.061551 | -0.071809 | 0.015034 | -1.234776 | -0.552209 |
| 6 | 10 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.029019 | -0.004008 | 60.000000 | 0.000000 | 0.034474 | 0.079038 | -0.042579 | 0.078724 | 1.161019 | 0.367146 |
| 6 | 11 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.020826 | -0.010783 | 60.000000 | -15.000000 | 0.006288 | 0.058348 | -0.056207 | 0.054056 | 0.798100 | 0.356921 |
| 6 | 12 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 17 | short | -0.024688 | -0.011661 | 41.176471 | -8.823529 | -0.061494 | 0.152998 | -0.123404 | 0.077055 | -0.665303 | -0.161360 |
| 6 | 13 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 22 | short | -0.031694 | 0.000000 | 54.545455 | 0.000000 | 0.021695 | 0.352415 | -0.134214 | 0.084017 | -0.421825 | -0.089933 |
| 6 | 14 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 12 | short | -0.017232 | +0.006379 | 58.333333 | +8.333333 | 0.013768 | 0.164025 | -0.075801 | 0.060025 | -0.363936 | -0.105059 |
| 6 | 15 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.024802 | +0.014681 | 50.000000 | 0.000000 | 0.004561 | 0.170871 | -0.121621 | 0.097986 | -0.355548 | -0.145152 |
| 6 | 16 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.008556 | +0.003789 | 50.000000 | +7.142857 | -0.003959 | 0.062946 | -0.051969 | 0.041598 | 0.332952 | 0.135927 |
| 12 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.074520 | +0.002302 | 63.157895 | +2.631579 | 0.031872 | 0.128261 | -0.041752 | 0.128055 | 3.581544 | 0.581003 |
| 12 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.114931 | 0.000000 | 100.000000 | 0.000000 | 0.111561 | 0.082929 | -0.022634 | 0.139040 | 2.771812 | 1.385906 |
| 12 | 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 21 | long | 0.064482 | +0.001616 | 66.666667 | +1.666667 | 0.051159 | 0.121721 | -0.053862 | 0.105142 | 2.427655 | 0.529758 |
| 12 | 4 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | short | -0.079929 | -0.035349 | 0.000000 | -20.000000 | -0.047946 | 0.092359 | -0.115915 | 0.100419 | -1.730833 | -0.865417 |
| 12 | 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.064153 | +0.053707 | 20.000000 | +5.714286 | -0.039227 | 0.093862 | -0.102978 | 0.029848 | -1.528316 | -0.683484 |
| 12 | 6 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 12 | long | 0.064719 | -0.004427 | 75.000000 | +5.000000 | 0.060130 | 0.170432 | -0.084690 | 0.123146 | 1.315436 | 0.379734 |
| 12 | 7 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.043832 | -0.008704 | 60.000000 | -10.000000 | 0.035874 | 0.109667 | -0.053249 | 0.094750 | 1.263915 | 0.399685 |
| 12 | 8 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 13 | short | -0.057896 | -0.035314 | 46.153846 | -8.391609 | -0.013490 | 0.170708 | -0.150750 | 0.074736 | -1.222831 | -0.339152 |
| 12 | 9 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.050707 | +0.017180 | 66.666667 | +23.809524 | 0.046165 | 0.115530 | -0.078166 | 0.104085 | 1.075097 | 0.438907 |
| 12 | 10 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.034226 | -0.021946 | 40.000000 | -17.142857 | -0.007544 | 0.071843 | -0.076891 | 0.028057 | -1.065263 | -0.476400 |
| 12 | 11 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.033635 | 0.000000 | 68.181818 | 0.000000 | 0.056380 | 0.240924 | -0.107383 | 0.127240 | 0.654818 | 0.139608 |
| 12 | 12 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 16 | long | 0.016076 | -0.023995 | 50.000000 | -11.538462 | -0.004122 | 0.219997 | -0.147588 | 0.131457 | 0.292301 | 0.073075 |
| 12 | 13 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 22 | short | -0.021128 | 0.000000 | 59.090909 | 0.000000 | 0.017778 | 0.440208 | -0.157635 | 0.135750 | -0.225118 | -0.047995 |
| 12 | 14 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.005309 | -0.016249 | 20.000000 | -5.000000 | -0.027010 | 0.090695 | -0.065694 | 0.063164 | -0.130902 | -0.058541 |
| 12 | 15 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | long | 0.003484 | -0.006598 | 33.333333 | -16.666667 | -0.005200 | 0.134299 | -0.121621 | 0.107228 | 0.063542 | 0.025941 |
| 12 | 16 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.001933 | +0.014481 | 36.363636 | +5.594405 | -0.030180 | 0.145011 | -0.118540 | 0.102446 | 0.044221 | 0.013333 |
| 24 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.079906 | +0.004080 | 68.421053 | +2.631579 | 0.067397 | 0.157177 | -0.054586 | 0.171990 | 3.133881 | 0.508383 |
| 24 | 2 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.344187 | +0.044115 | 100.000000 | +14.285714 | 0.242972 | 0.360749 | -0.102057 | 0.390351 | 2.337030 | 0.954088 |
| 24 | 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 21 | long | 0.052460 | +0.000221 | 57.142857 | +2.142857 | 0.056870 | 0.124913 | -0.068975 | 0.138276 | 1.924546 | 0.419970 |
| 24 | 4 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.150484 | +0.032988 | 63.636364 | +9.790210 | 0.028031 | 0.337736 | -0.149754 | 0.224923 | 1.477777 | 0.445566 |
| 24 | 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.060356 | 0.000000 | 63.636364 | 0.000000 | 0.052922 | 0.207253 | -0.127880 | 0.163400 | 1.365942 | 0.291220 |
| 24 | 6 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.061417 | 0.000000 | 50.000000 | 0.000000 | 0.049527 | 0.103208 | -0.045509 | 0.178673 | 1.190158 | 0.595079 |
| 24 | 7 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | long | 0.195303 | +0.062509 | 80.000000 | +22.857143 | 0.040683 | 0.387999 | -0.115303 | 0.255837 | 1.125543 | 0.503358 |
| 24 | 8 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 12 | long | 0.058666 | -0.016428 | 66.666667 | -13.333333 | 0.080222 | 0.215116 | -0.095327 | 0.151424 | 0.944716 | 0.272716 |
| 24 | 9 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | short | -0.040034 | -0.019381 | 50.000000 | -10.000000 | -0.051022 | 0.086070 | -0.165345 | 0.121820 | -0.930257 | -0.465129 |
| 24 | 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 13 | short | -0.036406 | -0.042303 | 46.153846 | -8.391609 | -0.051350 | 0.177631 | -0.169543 | 0.097273 | -0.738979 | -0.204956 |
| 24 | 11 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | long | 0.033402 | +0.018725 | 50.000000 | 0.000000 | 0.070853 | 0.224123 | -0.145365 | 0.133003 | 0.365059 | 0.149035 |
| 24 | 12 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.010352 | -0.012691 | 50.000000 | -10.000000 | 0.014058 | 0.119321 | -0.094159 | 0.113461 | 0.274352 | 0.086758 |
| 24 | 13 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 16 | long | 0.008915 | -0.021590 | 56.250000 | -12.980769 | 0.014045 | 0.144975 | -0.181142 | 0.148657 | 0.245976 | 0.061494 |
| 24 | 14 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.003901 | -0.020658 | 60.000000 | -15.000000 | 0.014088 | 0.049178 | -0.099973 | 0.079884 | -0.177393 | -0.079332 |
| 24 | 15 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 22 | short | -0.010048 | 0.000000 | 54.545455 | 0.000000 | 0.019095 | 0.455723 | -0.209202 | 0.174462 | -0.103414 | -0.022048 |
| 24 | 16 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 5 | long | 0.002031 | +0.077459 | 60.000000 | +17.142857 | 0.037449 | 0.077530 | -0.131688 | 0.063771 | 0.058565 | 0.026191 |

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.045350 | 68.421053 | 3.908707 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.048226 | 75.000000 | 2.832940 |
| 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.037363 | 70.000000 | 2.785544 |
| 4 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 13 | short | -0.039253 | 38.461538 | -1.695128 |
| 5 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 21 | long | 0.023211 | 76.190476 | 1.502889 |
| 6 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.008268 | 40.000000 | -1.297497 |
| 7 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.029529 | 75.000000 | 1.125427 |
| 8 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 18 | short | -0.031332 | 44.444444 | -1.011828 |
| 9 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.013932 | 36.363636 | -0.912822 |
| 10 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 22 | long | 0.022634 | 54.545455 | 0.893825 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.046390 | 60.526316 | 3.200526 |
| 2 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.039580 | 75.000000 | 2.700407 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 21 | long | 0.039452 | 80.952381 | 2.521405 |
| 4 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.058237 | 72.727273 | 2.484614 |
| 5 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.082870 | 75.000000 | 2.087142 |
| 6 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.022265 | 20.000000 | -1.723242 |
| 7 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.027885 | 27.272727 | -1.632933 |
| 8 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 13 | short | -0.054231 | 23.076923 | -1.369011 |
| 9 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.033989 | 20.000000 | -1.234776 |
| 10 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.029019 | 60.000000 | 1.161019 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.074520 | 63.157895 | 3.581544 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.114931 | 100.000000 | 2.771812 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 21 | long | 0.064482 | 66.666667 | 2.427655 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | short | -0.079929 | 0.000000 | -1.730833 |
| 5 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.064153 | 20.000000 | -1.528316 |
| 6 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 12 | long | 0.064719 | 75.000000 | 1.315436 |
| 7 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.043832 | 60.000000 | 1.263915 |
| 8 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 13 | short | -0.057896 | 46.153846 | -1.222831 |
| 9 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.050707 | 66.666667 | 1.075097 |
| 10 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | short | -0.034226 | 40.000000 | -1.065263 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.079906 | 68.421053 | 3.133881 |
| 2 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 6 | long | 0.344187 | 100.000000 | 2.337030 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 21 | long | 0.052460 | 57.142857 | 1.924546 |
| 4 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 11 | long | 0.150484 | 63.636364 | 1.477777 |
| 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.060356 | 63.636364 | 1.365942 |
| 6 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.061417 | 50.000000 | 1.190158 |
| 7 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | long | 0.195303 | 80.000000 | 1.125543 |
| 8 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 12 | long | 0.058666 | 66.666667 | 0.944716 |
| 9 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | short | -0.040034 | 50.000000 | -0.930257 |
| 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 13 | short | -0.036406 | 46.153846 | -0.738979 |

## 15m slow only

- Study ID: `fc20ad1b-f842-42f9-b693-0f0cc6820ec4`
- Variant: `horizon-15m-slow-only`
- Description: One-factor timeHorizon change: 15m=12, all other timeframe settings use defaults.
- Observed transitions: 196
- Result rows: 64
- Occurrence rows: 779
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Family Summary By Horizon

| Horizon | Family | Patterns | Samples | Weighted Mean% | Best Pattern | Best Abs T | Bias |
| ---: | --- | ---: | ---: | ---: | --- | ---: | --- |
| 3 | bull_confluence | 1 | 40 | 0.047354 | `1m:buy|2m:buy|5m:buy|15m:buy` | 4.248019 | long |
| 3 | bear_confluence | 1 | 6 | -0.031214 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.415994 | short |
| 3 | fast_bullish_reversal | 1 | 7 | 0.015879 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.542466 | long |
| 3 | fast_bearish_reversal | 1 | 24 | 0.019054 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.817075 | long |
| 3 | mixed_divergence | 12 | 119 | -0.000712 | `1m:buy|2m:sell|5m:sell|15m:sell` | 2.096415 | short |
| 3 | inactive | 0 | 0 |  | `` |  |  |
| 6 | bull_confluence | 1 | 40 | 0.050611 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.553036 | long |
| 6 | bear_confluence | 1 | 6 | 0.003000 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.032594 | long |
| 6 | fast_bullish_reversal | 1 | 7 | -0.036824 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.463424 | short |
| 6 | fast_bearish_reversal | 1 | 24 | -0.027722 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.402959 | short |
| 6 | mixed_divergence | 12 | 118 | 0.007777 | `1m:buy|2m:sell|5m:buy|15m:buy` | 2.754686 | long |
| 6 | inactive | 0 | 0 |  | `` |  |  |
| 12 | bull_confluence | 1 | 40 | 0.080324 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.895057 | long |
| 12 | bear_confluence | 1 | 6 | 0.124900 | `1m:sell|2m:sell|5m:sell|15m:sell` | 1.244375 | long |
| 12 | fast_bullish_reversal | 1 | 7 | -0.000525 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.009951 | short |
| 12 | fast_bearish_reversal | 1 | 24 | -0.023337 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.271727 | short |
| 12 | mixed_divergence | 12 | 117 | 0.016508 | `1m:buy|2m:sell|5m:buy|15m:sell` | 2.086953 | long |
| 12 | inactive | 0 | 0 |  | `` |  |  |
| 24 | bull_confluence | 1 | 40 | 0.081768 | `1m:buy|2m:buy|5m:buy|15m:buy` | 3.335863 | long |
| 24 | bear_confluence | 1 | 6 | 0.024614 | `1m:sell|2m:sell|5m:sell|15m:sell` | 0.284542 | long |
| 24 | fast_bullish_reversal | 1 | 7 | -0.007647 | `1m:buy|2m:buy|5m:sell|15m:sell` | 0.097356 | short |
| 24 | fast_bearish_reversal | 1 | 24 | -0.006752 | `1m:sell|2m:sell|5m:buy|15m:buy` | 0.075930 | short |
| 24 | mixed_divergence | 12 | 117 | 0.064177 | `1m:sell|2m:buy|5m:sell|15m:buy` | 2.256215 | long |
| 24 | inactive | 0 | 0 |  | `` |  |  |

### All Observed Combination Outcomes

| Horizon | Rank | Pattern | Family | n | Bias | Mean% | Delta Mean% | Win% | Delta Win% | Median% | Std% | MAE% | MFE% | t-stat | Score |
| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.047354 | +0.002555 | 70.000000 | +1.578947 | 0.030180 | 0.070501 | -0.018389 | 0.074275 | 4.248019 | 0.671671 |
| 3 | 2 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.072078 | -0.027814 | 20.000000 | -16.363636 | -0.043141 | 0.076879 | -0.089833 | 0.020141 | -2.096415 | -0.937545 |
| 3 | 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.041133 | -0.007093 | 66.666667 | -8.333333 | 0.053474 | 0.037906 | -0.022923 | 0.060295 | 1.879485 | 1.085121 |
| 3 | 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.025824 | +0.003551 | 77.272727 | +2.272727 | 0.022412 | 0.071111 | -0.041926 | 0.055438 | 1.703310 | 0.363147 |
| 3 | 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 21 | short | -0.020163 | +0.006448 | 42.857143 | +12.087912 | -0.009054 | 0.086549 | -0.075904 | 0.045370 | -1.067562 | -0.232961 |
| 3 | 6 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 24 | long | 0.019054 | -0.003580 | 50.000000 | -4.545455 | -0.000394 | 0.114240 | -0.049967 | 0.061447 | 0.817075 | 0.166785 |
| 3 | 7 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.014711 | -0.005464 | 46.153846 | +3.296703 | -0.004929 | 0.066084 | -0.063568 | 0.032538 | -0.802636 | -0.222611 |
| 3 | 8 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.012476 | -0.019542 | 66.666667 | -13.333333 | 0.015180 | 0.030941 | -0.050283 | 0.031536 | 0.698402 | 0.403222 |
| 3 | 9 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.045907 | 0.000000 | 50.000000 | 0.000000 | -0.016243 | 0.148797 | -0.102693 | 0.096799 | -0.617037 | -0.308518 |
| 3 | 10 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.027670 | +0.024001 | 50.000000 | +25.000000 | 0.027670 | 0.064986 | -0.044436 | 0.065155 | 0.602150 | 0.425784 |
| 3 | 11 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | long | 0.007198 | -0.026550 | 33.333333 | -26.666667 | -0.004819 | 0.031976 | -0.025722 | 0.039324 | 0.551416 | 0.225115 |
| 3 | 12 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 7 | long | 0.015879 | +0.004581 | 57.142857 | -2.857143 | 0.038708 | 0.077444 | -0.032018 | 0.050615 | 0.542466 | 0.205033 |
| 3 | 13 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.012066 | 0.000000 | 57.142857 | 0.000000 | 0.014240 | 0.063607 | -0.044614 | 0.038773 | 0.501878 | 0.189692 |
| 3 | 14 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.008051 | +0.002794 | 43.478261 | +2.569170 | -0.002702 | 0.082652 | -0.054712 | 0.049636 | 0.467130 | 0.097403 |
| 3 | 15 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 6 | short | -0.031214 | -0.009601 | 50.000000 | -3.333333 | 0.001063 | 0.183795 | -0.114015 | 0.070484 | -0.415994 | -0.169829 |
| 3 | 16 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.002314 | +0.001253 | 40.000000 | +11.428571 | -0.012218 | 0.046425 | -0.035682 | 0.029481 | -0.157601 | -0.049838 |
| 6 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.050611 | +0.005363 | 62.500000 | +1.973684 | 0.021097 | 0.090090 | -0.027336 | 0.096548 | 3.553036 | 0.561784 |
| 6 | 2 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.063182 | +0.004945 | 73.913043 | +1.185770 | 0.031768 | 0.109998 | -0.058017 | 0.091696 | 2.754686 | 0.574392 |
| 6 | 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.040702 | +0.000970 | 81.818182 | +1.818182 | 0.024611 | 0.070121 | -0.044534 | 0.078668 | 2.722570 | 0.580454 |
| 6 | 4 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.071155 | -0.042839 | 0.000000 | -27.272727 | -0.024546 | 0.084192 | -0.116836 | 0.020141 | -1.889817 | -0.845152 |
| 6 | 5 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.030457 | -0.007977 | 66.666667 | -13.333333 | 0.033851 | 0.030585 | -0.050283 | 0.056126 | 1.724778 | 0.995801 |
| 6 | 6 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 20 | short | -0.031037 | +0.006029 | 30.000000 | +6.923077 | -0.033127 | 0.087155 | -0.102602 | 0.050460 | -1.592590 | -0.356114 |
| 6 | 7 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.053169 | -0.029701 | 66.666667 | -8.333333 | 0.075990 | 0.064544 | -0.024563 | 0.092791 | 1.426783 | 0.823754 |
| 6 | 8 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.039937 | +0.040560 | 30.769231 | +16.483517 | -0.015842 | 0.138311 | -0.110147 | 0.048015 | -1.041082 | -0.288744 |
| 6 | 9 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.015943 | -0.048970 | 33.333333 | -26.666667 | -0.004163 | 0.051951 | -0.052898 | 0.042007 | -0.751731 | -0.306893 |
| 6 | 10 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.047245 | +0.015636 | 50.000000 | -25.000000 | 0.047245 | 0.100631 | -0.044436 | 0.087165 | 0.663954 | 0.469487 |
| 6 | 11 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 7 | short | -0.036824 | -0.013213 | 57.142857 | +7.142857 | 0.026054 | 0.210234 | -0.091310 | 0.063478 | -0.463424 | -0.175158 |
| 6 | 12 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 24 | short | -0.027722 | +0.003972 | 58.333333 | +3.787878 | 0.018365 | 0.337025 | -0.129233 | 0.080027 | -0.402959 | -0.082254 |
| 6 | 13 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.039483 | 0.000000 | 50.000000 | 0.000000 | 0.000763 | 0.218289 | -0.157459 | 0.124920 | -0.361755 | -0.180877 |
| 6 | 14 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 10 | short | -0.006035 | +0.005679 | 40.000000 | -2.857143 | -0.016266 | 0.058004 | -0.046020 | 0.040768 | -0.328997 | -0.104038 |
| 6 | 15 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.004767 | 0.000000 | 42.857143 | 0.000000 | -0.010393 | 0.057512 | -0.053978 | 0.044004 | 0.219298 | 0.082887 |
| 6 | 16 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 6 | long | 0.003000 | +0.016027 | 66.666667 | +16.666667 | 0.040036 | 0.225491 | -0.130056 | 0.101109 | 0.032594 | 0.013307 |
| 12 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.080324 | +0.008106 | 62.500000 | +1.973684 | 0.042616 | 0.130425 | -0.043408 | 0.132767 | 3.895057 | 0.615863 |
| 12 | 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.085150 | -0.029781 | 100.000000 | 0.000000 | 0.057696 | 0.070670 | -0.024798 | 0.114492 | 2.086953 | 1.204903 |
| 12 | 3 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.087889 | +0.029971 | 30.769231 | +16.483517 | -0.039227 | 0.161699 | -0.143147 | 0.061009 | -1.959758 | -0.543539 |
| 12 | 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.044274 | -0.018592 | 59.090909 | -5.909091 | 0.038895 | 0.134785 | -0.064114 | 0.109429 | 1.540710 | 0.328481 |
| 12 | 5 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 6 | long | 0.124900 | +0.084829 | 66.666667 | +5.128205 | 0.121261 | 0.245859 | -0.132431 | 0.180372 | 1.244375 | 0.508014 |
| 12 | 6 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 10 | long | 0.060917 | +0.073197 | 70.000000 | +12.857143 | 0.038288 | 0.164073 | -0.068240 | 0.102319 | 1.174092 | 0.371280 |
| 12 | 7 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.069517 | +0.058577 | 50.000000 | +25.000000 | 0.069517 | 0.114215 | -0.044436 | 0.109935 | 0.860765 | 0.608652 |
| 12 | 8 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.041054 | +0.007419 | 69.565217 | +1.383399 | 0.059404 | 0.238059 | -0.103416 | 0.130955 | 0.827056 | 0.172453 |
| 12 | 9 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.033527 | 0.000000 | 42.857143 | 0.000000 | -0.005425 | 0.109530 | -0.076432 | 0.092020 | 0.809862 | 0.306099 |
| 12 | 10 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.020129 | +0.064709 | 33.333333 | +13.333333 | -0.010623 | 0.066845 | -0.061413 | 0.067409 | 0.521565 | 0.301125 |
| 12 | 11 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.010523 | -0.063059 | 50.000000 | -20.000000 | 0.008039 | 0.059384 | -0.061623 | 0.054374 | -0.434046 | -0.177198 |
| 12 | 12 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 5 | long | 0.013829 | +0.036411 | 60.000000 | +5.454545 | 0.025336 | 0.092139 | -0.122748 | 0.065538 | 0.335613 | 0.150091 |
| 12 | 13 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 24 | short | -0.023337 | -0.002209 | 54.166667 | -4.924242 | 0.012293 | 0.420744 | -0.150820 | 0.127449 | -0.271727 | -0.055466 |
| 12 | 14 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 19 | short | -0.009967 | +0.002581 | 42.105263 | +11.336032 | -0.030180 | 0.165919 | -0.131389 | 0.106058 | -0.261834 | -0.060069 |
| 12 | 15 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | long | 0.010082 | 0.000000 | 50.000000 | 0.000000 | 0.044153 | 0.172867 | -0.157459 | 0.133586 | 0.116645 | 0.058322 |
| 12 | 16 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 7 | short | -0.000525 | -0.069671 | 57.142857 | -12.857143 | 0.049968 | 0.139579 | -0.102619 | 0.084977 | -0.009951 | -0.003761 |
| 24 | 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.081768 | +0.005942 | 70.000000 | +4.210526 | 0.078031 | 0.155027 | -0.056231 | 0.175622 | 3.335863 | 0.527446 |
| 24 | 2 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.300072 | 0.000000 | 85.714286 | 0.000000 | 0.151463 | 0.351880 | -0.103680 | 0.345274 | 2.256215 | 0.852769 |
| 24 | 3 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.040198 | +0.060851 | 100.000000 | +40.000000 | 0.056870 | 0.030890 | -0.070521 | 0.100910 | 2.253963 | 1.301326 |
| 24 | 4 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 10 | long | 0.173403 | +0.040609 | 70.000000 | +12.857143 | 0.058059 | 0.294951 | -0.094269 | 0.236288 | 1.859120 | 0.587905 |
| 24 | 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 19 | long | 0.096224 | -0.021272 | 63.157895 | +9.311741 | 0.025231 | 0.267048 | -0.171225 | 0.184647 | 1.570618 | 0.360324 |
| 24 | 6 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.065697 | +0.005341 | 65.217391 | +1.581027 | 0.067310 | 0.204101 | -0.123022 | 0.167435 | 1.543708 | 0.321885 |
| 24 | 7 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.037315 | -0.014924 | 50.000000 | -5.000000 | 0.007298 | 0.131131 | -0.086286 | 0.140380 | 1.334708 | 0.284561 |
| 24 | 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.045457 | -0.068500 | 33.333333 | -26.666667 | -0.032721 | 0.097154 | -0.125611 | 0.059065 | -1.146068 | -0.467880 |
| 24 | 9 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.044940 | +0.030488 | 46.153846 | +3.296703 | -0.051350 | 0.167680 | -0.172981 | 0.076791 | -0.966334 | -0.268013 |
| 24 | 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 5 | long | 0.024219 | +0.018322 | 60.000000 | +5.454545 | 0.078843 | 0.115478 | -0.122748 | 0.117023 | 0.468964 | 0.209727 |
| 24 | 11 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.020822 | -0.040595 | 33.333333 | -16.666667 | -0.010624 | 0.078038 | -0.055297 | 0.152829 | 0.462134 | 0.266813 |
| 24 | 12 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.004008 | -0.012749 | 50.000000 | -25.000000 | 0.004008 | 0.014255 | -0.079431 | 0.118173 | 0.397619 | 0.281159 |
| 24 | 13 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 6 | long | 0.024614 | -0.005891 | 66.666667 | -2.564102 | 0.046869 | 0.211892 | -0.142134 | 0.201916 | 0.284542 | 0.116164 |
| 24 | 14 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | long | 0.014677 | 0.000000 | 50.000000 | 0.000000 | 0.096487 | 0.279257 | -0.181227 | 0.146266 | 0.105113 | 0.052557 |
| 24 | 15 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 7 | short | -0.007647 | -0.082741 | 71.428571 | -8.571429 | 0.078101 | 0.207827 | -0.111108 | 0.104770 | -0.097356 | -0.036797 |
| 24 | 16 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 24 | short | -0.006752 | +0.003296 | 58.333333 | +3.787878 | 0.023319 | 0.435616 | -0.198090 | 0.165733 | -0.075930 | -0.015499 |

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.047354 | 70.000000 | 4.248019 |
| 2 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.072078 | 20.000000 | -2.096415 |
| 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.041133 | 66.666667 | 1.879485 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.025824 | 77.272727 | 1.703310 |
| 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 21 | short | -0.020163 | 42.857143 | -1.067562 |
| 6 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 24 | long | 0.019054 | 50.000000 | 0.817075 |
| 7 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.014711 | 46.153846 | -0.802636 |
| 8 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.012476 | 66.666667 | 0.698402 |
| 9 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.045907 | 50.000000 | -0.617037 |
| 10 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.027670 | 50.000000 | 0.602150 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.050611 | 62.500000 | 3.553036 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.063182 | 73.913043 | 2.754686 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.040702 | 81.818182 | 2.722570 |
| 4 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 5 | short | -0.071155 | 0.000000 | -1.889817 |
| 5 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.030457 | 66.666667 | 1.724778 |
| 6 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 20 | short | -0.031037 | 30.000000 | -1.592590 |
| 7 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.053169 | 66.666667 | 1.426783 |
| 8 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.039937 | 30.769231 | -1.041082 |
| 9 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.015943 | 33.333333 | -0.751731 |
| 10 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.047245 | 50.000000 | 0.663954 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.080324 | 62.500000 | 3.895057 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.085150 | 100.000000 | 2.086953 |
| 3 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.087889 | 30.769231 | -1.959758 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.044274 | 59.090909 | 1.540710 |
| 5 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 6 | long | 0.124900 | 66.666667 | 1.244375 |
| 6 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 10 | long | 0.060917 | 70.000000 | 1.174092 |
| 7 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.069517 | 50.000000 | 0.860765 |
| 8 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.041054 | 69.565217 | 0.827056 |
| 9 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.033527 | 42.857143 | 0.809862 |
| 10 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.020129 | 33.333333 | 0.521565 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 40 | long | 0.081768 | 70.000000 | 3.335863 |
| 2 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.300072 | 85.714286 | 2.256215 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.040198 | 100.000000 | 2.253963 |
| 4 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 10 | long | 0.173403 | 70.000000 | 1.859120 |
| 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 19 | long | 0.096224 | 63.157895 | 1.570618 |
| 6 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 23 | long | 0.065697 | 65.217391 | 1.543708 |
| 7 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.037315 | 50.000000 | 1.334708 |
| 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.045457 | 33.333333 | -1.146068 |
| 9 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.044940 | 46.153846 | -0.966334 |
| 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 5 | long | 0.024219 | 60.000000 | 0.468964 |

## fast fast / tight context

- Study ID: `51afa2ad-2e1e-4d08-80e7-11f5dac22d4f`
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

- Study ID: `367ebc7e-f1ad-47f6-a9ca-3c21dede7527`
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

- Study ID: `c3c3106c-ed4a-4af4-b970-b0686395c44c`
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

- Study ID: `c3dd6d8f-2e42-4322-bfd8-1088d05a429e`
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

- Study ID: `9da77b69-436c-4a07-85da-36cf034ad509`
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

- Study ID: `021dd608-5d65-4ed2-ad50-360bb5d62dd2`
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

- Study ID: `9f734bc6-8597-4ad4-be3b-290638a86e42`
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

- Study ID: `e724bbad-0341-4d61-8585-66a0ad4e03a1`
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

