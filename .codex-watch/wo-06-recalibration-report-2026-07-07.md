# WO-06 Signal-Score Recalibration Report

Date: 2026-07-07
Worker: codex-worker for claude-lead session f68a9158

## Step 0 overlap

Observed:

- `git show --stat 7d5445f2` touches only `signal-options-*` service/test files. It does not modify `signal-quality-kpis-service.ts`, `signal-quality-kpis.ts`, or calibration scripts. No WO-06 signal-quality KPI work skipped because of this commit.
- `git log --since=2026-07-03 -- artifacts/api-server/src/services/signal-quality-kpis-service.ts artifacts/api-server/src/services/signal-quality-kpis.ts` found `0c284e27 chore(snapshot): consolidate in-flight working tree across interleaved workstreams`. That commit already implemented observation dump wiring, score-model comparisons, continuous feature summaries, expected-move-v2, and coverage-gated recommendations in the KPI service files.

Skipped as already covered by July 3+ KPI code:

- service-side observation dump hook via `SIGNAL_QUALITY_OBSERVATION_DUMP_PATH`
- service-side continuous feature folding into model comparisons
- service-side expected-move-v2 comparison/recommendation plumbing

Implemented in this follow-up:

- requested `scripts/signal-calibration/` dump + fit CLIs with documented flags
- explicit service-side `magnitudeAlignment` axis per score model
- deterministic report generation for big-mover metrics, isotonic PAVA points, and score-decile quantiles

## Directional-features live verdict

Observed source route:

- `/api/signal-monitor/state` is the finite matrix snapshot route.
- `/api/signal-monitor/matrix/stream` is the SSE matrix stream route.

Observed runtime:

- `/proc/net/tcp` showed listeners on API `8080`, web `18747`, compute `18768`, and compute `18770`.
- Direct HTTP snapshot probe returned `401 auth_required`; normal app session endpoint returned `{"user":null,"csrfToken":null}`.
- Read-only DB fallback against the live persisted matrix view `signal_monitor_symbol_states` found current rows with `filter_state.directionalFeatures`.

Sample persisted live row:

| symbol | timeframe | direction | lastEvaluatedAt | directionalFeatures version |
|---|---|---|---|---|
| MSFT | 1h | buy | 2026-07-07 20:21:29.595+00 | directional-features-v1 |

Feature keys observed: `atrPct`, `adxComponent`, `mtfAlignment`, `regimeAgeBars`, `volumeRatio20`, `rangeComponent`, `longMomentumPct`, `rangePosition20`, `volumeExpansion`, `shortMomentumPct`, `mediumMomentumPct`, `volatilityComponent`, `riskAdjustedMomentum`.

Verdict: live persisted STA rows include `filterState.directionalFeatures`; no compute-lane reload request is indicated from this evidence. Unknown: authenticated HTTP row inspection was blocked by the anonymous session, so the direct API payload was not inspected.

## Regenerated dumps

Command:

```bash
pnpm --filter @workspace/scripts run signal-calibration:dump -- --deployment-id 7e2e4e6f-749f-4e65-a011-87d3559a23b0 --timeframes 5m,15m,1h --output-dir .pyrus-runtime/calibration/2026-07-07-wo-06
```

Observed dump artifacts:

| timeframe | rows | resolved timeframe | horizon bars | path |
|---|---:|---|---:|---|
| 5m | 1016 | 5m | 26 | `.pyrus-runtime/calibration/2026-07-07-wo-06/observations-5m.jsonl` |
| 15m | 3059 | 15m | 26 | `.pyrus-runtime/calibration/2026-07-07-wo-06/observations-15m.jsonl` |
| 1h | 1600 | 1h | 26 | `.pyrus-runtime/calibration/2026-07-07-wo-06/observations-1h.jsonl` |

Coverage caveat: the service emitted repeated `57014 statement timeout` warnings during bar-cache reads, including 5-symbol retry chunks. These dumps are regenerated, but this run is a degraded-sample calibration artifact rather than a clean full-universe pass.

## Calibration fit

Command:

```bash
pnpm --filter @workspace/scripts run signal-calibration:fit -- --input-dir .pyrus-runtime/calibration/2026-07-07-wo-06 --output-dir .pyrus-runtime/calibration/2026-07-07-wo-06
```

Outputs:

- `.pyrus-runtime/calibration/2026-07-07-wo-06/calibration-fit.json`
- `.pyrus-runtime/calibration/2026-07-07-wo-06/calibration-fit.md`

The JSON includes per-timeframe/direction/scorer:

- `bigMoverMetrics`: `P(score >= 90 | MFE >= 10/20/30%)` plus precision
- `isotonicFit`: monotone PAVA score-to-MFE calibration points
- `quantileBuckets`: score-decile average/p50/p75/p90 MFE
- `magnitudeAlignment`: score-MFE Pearson, high-score MFE lift, and 90+ big-mover thresholds

## Expected-move-v2 big-mover metrics

`P(score >= 90 | MFE >= threshold)` / precision:

| timeframe | direction | n | high score n | MFE >= 10 | MFE >= 20 | MFE >= 30 |
|---|---|---:|---:|---|---|---|
| 5m | long | 478 | 9 | 5.0% / 11.1% | 0.0% / 0.0% | 0.0% / 0.0% |
| 5m | short | 538 | 17 | 3.7% / 5.9% | n/a / 0.0% | n/a / 0.0% |
| 15m | long | 1545 | 153 | 33.3% / 19.0% | 28.6% / 1.3% | 33.3% / 0.7% |
| 15m | short | 1514 | 174 | 31.6% / 17.8% | 30.0% / 1.7% | 0.0% / 0.0% |
| 1h | long | 853 | 23 | 8.3% / 56.5% | 12.2% / 26.1% | 23.5% / 17.4% |
| 1h | short | 747 | 9 | 4.1% / 44.4% | 6.3% / 11.1% | 20.0% / 11.1% |

## Magnitude fit quality

| timeframe | direction | scorer | score-MFE r | high-score MFE lift | top expectancy lift | inversions |
|---|---|---|---:|---:|---:|---:|
| 5m | long | expected-move-v1 | 0.225888 | 0 | -2.829288 | 5 |
| 5m | long | expected-move-v2 | 0.218851 | 2.664940 | -2.288922 | 12 |
| 5m | short | expected-move-v1 | 0.300353 | 0 | 1.184797 | 0 |
| 5m | short | expected-move-v2 | 0.176195 | 2.040475 | 1.308974 | 6 |
| 15m | long | expected-move-v1 | 0.292056 | 0 | -18.994893 | 8 |
| 15m | long | expected-move-v2 | 0.182098 | 2.480378 | -0.144579 | 17 |
| 15m | short | expected-move-v1 | 0.303164 | 0 | -13.433650 | 8 |
| 15m | short | expected-move-v2 | 0.181875 | 2.176189 | -0.161792 | 13 |
| 1h | long | expected-move-v1 | 0.336723 | 0 | 2.984657 | 1 |
| 1h | long | expected-move-v2 | 0.334866 | 12.380623 | 3.932636 | 5 |
| 1h | short | expected-move-v1 | 0.356501 | 0 | 18.787446 | 3 |
| 1h | short | expected-move-v2 | 0.322192 | 4.709067 | 4.489345 | 8 |

Interpretation:

- expected-move-v1 has the strongest raw score-MFE correlation in all six timeframe/direction cells.
- expected-move-v2 is the only compared scorer that produces `score >= 90` observations in this run because the conviction bonus opens the top band.
- expected-move-v2 top-band magnitude lift is positive in all six cells, strongest on 1h long.
- expected-move-v2 expectancy alignment is mixed: positive on 5m short and 1h both directions, weak/negative on 5m long and 15m both directions.

## Service/code changes

- Added `magnitudeAlignment` to each `SignalScoreModelComparison` in `artifacts/api-server/src/services/signal-quality-kpis.ts`.
- Added a focused unit test for the new magnitude axis in `signal-quality-kpis.test.ts`.
- Added `scripts/signal-calibration/observation-dump.ts`.
- Added `scripts/signal-calibration/calibration-fit.ts`.
- Added `scripts/signal-calibration/README.md`.
- Added package scripts `signal-calibration:dump` and `signal-calibration:fit`.

No active scorer/config flip was made. `signal-options-automation.ts`, scorer selection config, and `algoHelpers.js` were not touched.

## Verification

Observed passing:

```bash
pnpm --filter @workspace/api-server test -- signal-quality-kpis
pnpm run python-compute:test -- python/pyrus_compute/tests/test_signal_matrix_directional_features.py
pnpm --filter @workspace/scripts typecheck
```

Python output: `8 passed`.

## Recommendation

Recommendation: keep expected-move-v2 active for now, but adjust calibration/reporting before treating 90+ as a broad big-mover recall signal.

Reasoning:

- v2 is doing useful magnitude separation: positive high-score MFE lift in all six cells and high 1h precision.
- v2 is not yet a reliable broad-recall detector at `score >= 90`, especially 5m and 1h where recall is low despite better precision.
- v1 has better monotone score-MFE correlation but no 90+ top band in this scoring scale, so flipping back would remove the operational high-conviction band rather than recalibrate it.
- The regenerated dump run had degraded coverage from statement timeouts, so a cleaner full-universe run should precede any stronger active-model decision.

Decision pending user: no active-model/config flip was performed.
