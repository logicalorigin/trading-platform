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
- `--timeframes`: comma-separated `2m,5m,15m,1h,1d` subset. The KPI service
  intentionally resolves 1m previews to 5m, so an exact 1m artifact is not
  supported.
- `--output-dir`: directory for `observations-<timeframe>.jsonl`.

The script writes each refresh to a private same-directory staging file. It
replaces the canonical dump only after the service returns clean calibration
coverage and the artifact's timeframe, header count, and JSON framing validate.
Refresh failure, `coverage_degraded`, timeframe fallback, or an empty dump leave
the prior canonical file untouched.

Published dumps use schema version 2. Their header records a shared run ID,
deployment, as-of day, requested/resolved timeframe, signal and MTF settings,
coverage counts/ratios, generation time, horizon, and row count. All timeframes
from one invocation share the same run ID. Older unversioned dumps must be
regenerated before fitting. Version 2 rows include the exact completed
`audit.outcomeExitBarAt` boundary required for leakage-safe embargoes and the
signal-time MTF timeframe/direction arrays required to reproduce the Algo entry
cohort.

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
points, score-decile quantiles, and a three-fold rolling-origin audit. Each
observation records the exact exit bar of its completed forward window. A test
slice trains only on earlier observations whose exact outcome-end precedes the
test boundary, so no training outcome can consume a bar from the held-out
period—even across overnight closures or exchange holidays.

The raw dump preserves every detected signal for auditability. The fitter grades
only the subset admitted by the deployment's Algo MTF controls: when the gate is
enabled, every configured timeframe must match the signal direction, mirroring
the live STA table and Signal Options entry contract. Reports include detected,
admitted, and filtered counts so cohort changes cannot be mistaken for score
changes.

Held-out ordering is reported separately for:

- expected-move magnitude (`MFE`), and
- directional correctness (positive directional return / hit rate), and
- signed directional return.

That distinction is load-bearing: an expected-move score may correctly rank
large moves while being uninformative or inverted on correctness or return
magnitude. None of these underlying-price outcomes is net option P&L after
contract selection, spread, slippage, or execution.

The fitter fails closed on unknown scorer names, malformed/non-finite rows,
degraded or inconsistent coverage, filename/header timeframe drift, count drift,
missing requested timeframes, and mixed run/deployment/day/settings/horizon
inputs. Request an explicit smaller `--timeframes` subset for a partial report.
JSON and Markdown outputs are each replaced atomically.

The report is still not sufficient by itself to activate a score model. Scorer
formulas may have prior exposure to overlapping research windows, and the
underlying-move outcomes are not net trading returns. Activation requires a
separately dated shadow run with the same immutable model/objective/horizon
provenance.
