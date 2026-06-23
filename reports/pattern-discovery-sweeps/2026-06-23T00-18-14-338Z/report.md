# MTF Pattern Discovery Settings Sweep

- Symbols: SPY, QQQ
- Timeframes: 1m, 2m, 5m, 15m
- Horizons: 3, 6, 12, 24
- Study window: 2026-04-24T00:00:00.000Z through latest loaded bar
- Min sample threshold: 1

## Baseline calibrated defaults

- Study ID: `595ec21e-e925-401e-8eed-f3211e82c6f7`
- Variant: `baseline-calibrated-defaults`
- Description: Current per-timeframe defaults from pattern-discovery.ts.
- Observed transitions: 199
- Result rows: 64
- Occurrence rows: 791
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.044799 | 68.421053 | 3.859992 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.048226 | 75 | 2.83294 |
| 3 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.033748 | 60 | 2.383484 |
| 4 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.026611 | 30.769231 | -1.669475 |
| 5 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 11 | short | -0.044264 | 36.363636 | -1.634309 |
| 6 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.032018 | 80 | 1.563723 |
| 7 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.022273 | 75 | 1.374286 |
| 8 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.009247 | 42.857143 | -1.3415 |
| 9 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 22 | long | 0.022634 | 54.545455 | 0.893825 |
| 10 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 4 | short | -0.045907 | 50 | -0.617037 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.038434 | 80 | 3.368174 |
| 2 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.045248 | 60.526316 | 3.093057 |
| 3 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.058237 | 72.727273 | 2.484614 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.039732 | 80 | 2.415745 |
| 5 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | short | -0.037066 | 23.076923 | -2.351953 |
| 6 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.08287 | 75 | 2.087142 |
| 7 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.080497 | 14.285714 | -1.696356 |
| 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.033027 | 60 | 1.372284 |
| 9 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.031609 | 75 | 1.030425 |
| 10 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.011714 | 42.857143 | -1.011385 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.072218 | 60.526316 | 3.424105 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.114931 | 100 | 2.771812 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.062866 | 65 | 2.255449 |
| 4 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.11786 | 14.285714 | -1.835027 |
| 5 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 10 | long | 0.052536 | 70 | 1.610151 |
| 6 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | long | 0.069146 | 70 | 1.162843 |
| 7 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.04458 | 20 | -0.886464 |
| 8 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.033527 | 42.857143 | 0.809862 |
| 9 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.033635 | 68.181818 | 0.654818 |
| 10 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 13 | long | 0.040071 | 61.538462 | 0.605227 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 38 | long | 0.075826 | 65.789474 | 2.946292 |
| 2 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.300072 | 85.714286 | 2.256215 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.052239 | 55 | 1.822973 |
| 4 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.016757 | 75 | 1.720036 |
| 5 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 22 | long | 0.060356 | 63.636364 | 1.365942 |
| 6 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | long | 0.117496 | 53.846154 | 1.328148 |
| 7 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.061417 | 50 | 1.190158 |
| 8 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.075428 | 42.857143 | -1.053205 |
| 9 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.132794 | 57.142857 | 1.050533 |
| 10 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 10 | long | 0.075094 | 80 | 1.015361 |

## Fast sensitive horizons

- Study ID: `e599d551-f189-4083-9497-d5d99120f301`
- Variant: `fast-sensitive-horizons`
- Description: Shorter 1m/2m horizons for early reversal sensitivity.
- Observed transitions: 339
- Result rows: 64
- Occurrence rows: 1348
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 61 | long | 0.030357 | 65.57377 | 3.534065 |
| 2 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.024622 | 64.444444 | 2.635271 |
| 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.029022 | 16.666667 | -2.227644 |
| 4 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 20 | short | -0.026901 | 35 | -2.034838 |
| 5 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 15 | long | 0.019549 | 53.333333 | 1.348023 |
| 6 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 12 | long | 0.019368 | 58.333333 | 1.293608 |
| 7 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 12 | short | -0.029751 | 50 | -0.934946 |
| 8 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 37 | long | 0.014114 | 54.054054 | 0.897282 |
| 9 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 22 | short | -0.021027 | 45.454545 | -0.894347 |
| 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 16 | short | -0.011742 | 43.75 | -0.826019 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 61 | long | 0.038001 | 68.852459 | 3.901758 |
| 2 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 20 | short | -0.033254 | 25 | -2.661397 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.018803 | 71.111111 | 1.610038 |
| 4 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 19 | long | 0.025382 | 52.631579 | 1.518452 |
| 5 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.03632 | 45.454545 | -1.11967 |
| 6 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.032631 | 50 | -1.06172 |
| 7 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 36 | short | -0.04104 | 55.555556 | -0.937241 |
| 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 15 | long | 0.016455 | 53.333333 | 0.759406 |
| 9 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 21 | short | -0.02136 | 38.095238 | -0.728913 |
| 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 16 | short | -0.024211 | 43.75 | -0.643446 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.118343 | 0 | -5.291004 |
| 2 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 61 | long | 0.040598 | 57.377049 | 2.748549 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.034921 | 68.888889 | 2.672069 |
| 4 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 19 | long | 0.063894 | 78.947368 | 2.25593 |
| 5 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 11 | short | -0.051877 | 27.272727 | -1.246295 |
| 6 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 36 | short | -0.071555 | 55.555556 | -1.233708 |
| 7 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 12 | short | -0.046069 | 41.666667 | -1.02364 |
| 8 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 20 | short | -0.020942 | 30 | -0.808146 |
| 9 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.039644 | 16.666667 | -0.794329 |
| 10 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.023682 | 71.428571 | 0.697431 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | long | 0.068449 | 85.714286 | 3.211292 |
| 2 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 61 | long | 0.066886 | 65.57377 | 3.104379 |
| 3 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 19 | long | 0.105624 | 84.210526 | 3.083977 |
| 4 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 5 | short | -0.145406 | 20 | -2.830469 |
| 5 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 45 | long | 0.039963 | 68.888889 | 2.34188 |
| 6 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 36 | short | -0.113928 | 52.777778 | -1.678315 |
| 7 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 6 | short | -0.035674 | 33.333333 | -1.356775 |
| 8 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 20 | long | 0.087852 | 50 | 1.330461 |
| 9 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 13 | long | 0.015683 | 61.538462 | 0.933975 |
| 10 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 12 | long | 0.022861 | 50 | 0.895712 |

## Balanced longer horizons

- Study ID: `60e9e218-fac3-4e93-b98d-9775e4cf9c6d`
- Variant: `balanced-longer-horizons`
- Description: Longer lookbacks across fast and medium frames.
- Observed transitions: 153
- Result rows: 64
- Occurrence rows: 607
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 29 | long | 0.057849 | 72.413793 | 4.273388 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.042509 | 75 | 1.879246 |
| 3 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.027573 | 25 | -1.442026 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.036589 | 75 | 1.428719 |
| 5 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 12 | long | 0.028503 | 66.666667 | 1.382508 |
| 6 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 9 | long | 0.021288 | 55.555556 | 1.317956 |
| 7 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 11 | short | -0.054623 | 36.363636 | -1.244413 |
| 8 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.029024 | 55 | 1.150247 |
| 9 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.018182 | 57.142857 | -0.894769 |
| 10 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | long | 0.01132 | 50 | 0.820761 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 29 | long | 0.073453 | 72.413793 | 4.036323 |
| 2 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | short | -0.040049 | 25 | -2.715333 |
| 3 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.08096 | 75 | 1.957404 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.027685 | 75 | 1.518603 |
| 5 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 9 | long | 0.035827 | 66.666667 | 1.493893 |
| 6 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.050116 | 100 | 1.448544 |
| 7 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.043071 | 75 | 1.28063 |
| 8 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.054562 | 42.857143 | -1.117129 |
| 9 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 9 | long | 0.028436 | 44.444444 | 0.840913 |
| 10 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 12 | long | 0.02625 | 66.666667 | 0.814045 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 29 | long | 0.09782 | 72.413793 | 4.552544 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.102298 | 75 | 2.01609 |
| 3 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | long | 0.170784 | 60 | 1.714599 |
| 4 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 9 | long | 0.028639 | 66.666667 | 1.432007 |
| 5 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 12 | long | 0.07373 | 66.666667 | 1.304364 |
| 6 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 9 | long | 0.029096 | 55.555556 | 1.270002 |
| 7 | `1m:buy|2m:sell|5m:sell|15m:buy` | mixed_divergence | 7 | short | -0.070725 | 42.857143 | -1.043679 |
| 8 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | short | -0.049429 | 25 | -0.765042 |
| 9 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 8 | long | 0.018129 | 62.5 | 0.598756 |
| 10 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 9 | long | 0.030148 | 55.555556 | 0.351077 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 29 | long | 0.112247 | 79.310345 | 3.891475 |
| 2 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 9 | long | 0.061188 | 77.777778 | 2.288488 |
| 3 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 12 | long | 0.181533 | 66.666667 | 1.722475 |
| 4 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 10 | long | 0.079165 | 60 | 1.562994 |
| 5 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | long | 0.143886 | 80 | 1.379604 |
| 6 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.017646 | 66.666667 | 1.286185 |
| 7 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 8 | long | 0.085566 | 50 | 1.186261 |
| 8 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 4 | long | 0.04348 | 50 | 0.886136 |
| 9 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 4 | short | -0.038225 | 50 | -0.878853 |
| 10 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 20 | long | 0.057275 | 50 | 0.613449 |

## Slow context horizons

- Study ID: `061f1904-c3fd-4791-9328-9924dc38cf36`
- Variant: `slow-context-horizons`
- Description: Keeps fast frames close to defaults while slowing 5m/15m.
- Observed transitions: 225
- Result rows: 64
- Occurrence rows: 897
- Family rows: `{"mixed_divergence":48,"bull_confluence":4,"bear_confluence":4,"fast_bullish_reversal":4,"fast_bearish_reversal":4}`

### Horizon 3 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 48 | long | 0.034889 | 64.583333 | 3.710167 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.041133 | 66.666667 | 1.879485 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 34 | long | 0.024241 | 64.705882 | 1.847789 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.018499 | 80 | 1.638359 |
| 5 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 8 | short | -0.035289 | 50 | -1.26323 |
| 6 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.051027 | 16.666667 | -1.247812 |
| 7 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 7 | long | 0.024457 | 71.428571 | 0.86893 |
| 8 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 25 | long | 0.010766 | 44 | 0.633287 |
| 9 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.02767 | 50 | 0.60215 |
| 10 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 28 | long | 0.009636 | 46.428571 | 0.492755 |

### Horizon 6 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 48 | long | 0.0306 | 60.416667 | 2.796601 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 25 | long | 0.044918 | 68 | 1.840832 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 34 | long | 0.02211 | 70.588235 | 1.539783 |
| 4 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 8 | short | -0.039266 | 37.5 | -1.428287 |
| 5 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.053169 | 66.666667 | 1.426783 |
| 6 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | short | -0.031425 | 28.571429 | -1.326789 |
| 7 | `1m:sell|2m:buy|5m:sell|15m:sell` | mixed_divergence | 6 | short | -0.067307 | 33.333333 | -1.155411 |
| 8 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.047245 | 50 | 0.663954 |
| 9 | `1m:sell|2m:sell|5m:buy|15m:buy` | fast_bearish_reversal | 28 | short | -0.038522 | 50 | -0.661102 |
| 10 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 17 | short | -0.011966 | 41.176471 | -0.566739 |

### Horizon 12 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 48 | long | 0.055629 | 60.416667 | 3.285198 |
| 2 | `1m:buy|2m:sell|5m:buy|15m:sell` | mixed_divergence | 3 | long | 0.08515 | 100 | 2.086953 |
| 3 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.118663 | 85.714286 | 1.936805 |
| 4 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 34 | long | 0.032475 | 61.764706 | 1.894358 |
| 5 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.036229 | 60 | 1.548629 |
| 6 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 8 | long | 0.096585 | 62.5 | 1.270152 |
| 7 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 17 | short | -0.040678 | 29.411765 | -1.163654 |
| 8 | `1m:buy|2m:buy|5m:buy|15m:sell` | mixed_divergence | 7 | short | -0.020281 | 42.857143 | -0.89366 |
| 9 | `1m:sell|2m:sell|5m:buy|15m:sell` | mixed_divergence | 2 | long | 0.069517 | 50 | 0.860765 |
| 10 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 8 | long | 0.020626 | 75 | 0.819622 |

### Horizon 24 bars

| Rank | Pattern | Family | n | Bias | Mean% | Win% | t-stat |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | `1m:sell|2m:buy|5m:buy|15m:sell` | mixed_divergence | 5 | long | 0.047836 | 100 | 3.59912 |
| 2 | `1m:buy|2m:buy|5m:buy|15m:buy` | bull_confluence | 48 | long | 0.057262 | 64.583333 | 3.130996 |
| 3 | `1m:sell|2m:buy|5m:buy|15m:buy` | mixed_divergence | 34 | long | 0.081827 | 64.705882 | 2.201792 |
| 4 | `1m:buy|2m:buy|5m:sell|15m:buy` | mixed_divergence | 7 | long | 0.134657 | 71.428571 | 2.072051 |
| 5 | `1m:buy|2m:sell|5m:sell|15m:sell` | mixed_divergence | 8 | long | 0.035574 | 75 | 1.107797 |
| 6 | `1m:sell|2m:sell|5m:sell|15m:buy` | mixed_divergence | 17 | short | -0.038564 | 52.941176 | -1.087027 |
| 7 | `1m:buy|2m:sell|5m:buy|15m:buy` | mixed_divergence | 25 | long | 0.045631 | 68 | 1.077452 |
| 8 | `1m:sell|2m:buy|5m:sell|15m:buy` | mixed_divergence | 5 | long | 0.057359 | 60 | 0.970271 |
| 9 | `1m:sell|2m:sell|5m:sell|15m:sell` | bear_confluence | 8 | long | 0.040474 | 75 | 0.622098 |
| 10 | `1m:buy|2m:buy|5m:sell|15m:sell` | fast_bullish_reversal | 7 | short | -0.046989 | 57.142857 | -0.561431 |

