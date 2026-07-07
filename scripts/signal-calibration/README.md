# Signal Calibration Scripts

Deterministic offline tools for the signal-score recalibration lane. They call
the existing KPI service/scorer code; they do not flip the active model.

## Regenerate Observation Dumps

```bash
pnpm --filter @workspace/scripts run signal-calibration:dump -- \
  --deployment-id 7e2e4e6f-749f-4e65-a011-87d3559a23b0 \
  --timeframes 5m,15m,1h \
  --output-dir .pyrus-runtime/calibration/2026-07-07
```

Flags:

- `--deployment-id`: algo deployment id to refresh.
- `--timeframes`: comma-separated `1m,2m,5m,15m,1h,1d` subset.
- `--output-dir`: directory for `observations-<timeframe>.jsonl`.

The script sets `SIGNAL_QUALITY_OBSERVATION_DUMP_PATH` for each timeframe and
removes any prior file at that path before recomputing.

## Fit Calibration Report

```bash
pnpm --filter @workspace/scripts run signal-calibration:fit -- \
  --input-dir .pyrus-runtime/calibration/2026-07-07 \
  --output-dir .pyrus-runtime/calibration/2026-07-07
```

Flags:

- `--input-dir`: directory containing `observations-<timeframe>.jsonl`.
- `--output-dir`: directory for `calibration-fit.json` and
  `calibration-fit.md`.
- `--timeframes`: optional comma-separated timeframe subset.
- `--scorers`: optional comma-separated score-model keys.
- `--score-threshold`: high-score threshold for recall/precision, default `90`.
- `--mfe-thresholds`: comma-separated MFE thresholds, default `10,20,30`.

The report includes `P(score >= T | MFE >= M)`, precision, isotonic PAVA fit
points for score-to-MFE calibration, and score-decile quantile calibration.
