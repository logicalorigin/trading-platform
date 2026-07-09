# Warmup Sensitivity Report - 2026-07-09

Observed consumer window: `SIGNAL_MONITOR_MATRIX_BARS_LIMIT = 240` at `artifacts/api-server/src/services/signal-monitor.ts:474`; backfilled-base storage keeps `input.bars.slice(-SIGNAL_MONITOR_MATRIX_BARS_LIMIT)` at `:5968`; the live stream path evaluates `mergedBars.slice(-SIGNAL_MONITOR_MATRIX_BARS_LIMIT)` at `:10584`; production evaluation passes `includeProvisionalSignals: !settings.waitForBarClose` and `lastBarClosed` at `:8582-8587`.

Projection rule: per-bar arrays are compared over the last 240 bars. Tail events are filtered to the same window and normalized to tail-local `barIndex`/`id`, because the signal monitor consumes relative positions from the provided completed-bar series.

Default settings source: `lib/pyrus-signals-core/src/index.ts:172-206`; warmup constant remains `PYRUS_SIGNALS_SIGNAL_WARMUP_BARS = 1000` at `:164`.

| Fixture | Bars | 240 | 300 | 380 | 460 | 540 | 700 | 1000 |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| steady-uptrend | 1000 | first divergent: $.adx[0] index=0 | first divergent: $.atrRaw[0] index=0 absDelta=0.0005920000000000369 | first divergent: $.atrRaw[0] index=0 absDelta=0.0000010000000000287557 | IDENTICAL | IDENTICAL | IDENTICAL | IDENTICAL |
| downtrend | 1000 | first divergent: $.adx[0] index=0 | first divergent: $.atrRaw[0] index=0 absDelta=0.0015279999999999738 | first divergent: $.atrRaw[0] index=0 absDelta=0.000001999999999946489 | IDENTICAL | IDENTICAL | IDENTICAL | IDENTICAL |
| choppy-mean-reverting | 1000 | first divergent: $.adx[0] index=0 | first divergent: $.adx[0] index=0 absDelta=0.190097999999999 | first divergent: $.adx[0] index=0 absDelta=0.0022050000000000125 | first divergent: $.adx[0] index=0 absDelta=0.0000049999999980343546 | first divergent: $.signalEvents[0].filterState.directionalFeatures.mtfAlignment index=0 absDelta=0.5 | IDENTICAL | IDENTICAL |
| gappy | 1000 | first divergent: $.adx[0] index=0 | first divergent: $.adx[0] index=0 absDelta=2.145980999999999 | first divergent: $.adx[0] index=0 absDelta=0.012980000000002434 | first divergent: $.adx[0] index=0 absDelta=0.000021000000000270802 | first divergent: $.signalEvents[0].filterState.directionalFeatures.mtfAlignment index=0 absDelta=1 | IDENTICAL | IDENTICAL |
| low-liquidity | 1000 | first divergent: $.adx[0] index=0 | first divergent: $.adx[0] index=0 absDelta=0.19659700000000058 | first divergent: $.adx[0] index=0 absDelta=0.018603999999999843 | first divergent: $.adx[0] index=0 absDelta=0.000026999999999333113 | first divergent: $.signalEvents[0].filterState.directionalFeatures.mtfAlignment index=0 absDelta=0.5 | IDENTICAL | IDENTICAL |
| extreme-values | 1000 | first divergent: $.adx[0] index=0 | first divergent: $.adx[0] index=0 absDelta=3.1061830000000015 | first divergent: $.adx[0] index=0 absDelta=5.408664000000002 | first divergent: $.adx[0] index=0 absDelta=5.400836999999999 | first divergent: $.adx[0] index=0 absDelta=0.00042999999999793204 | IDENTICAL | IDENTICAL |
| flat | 1000 | first divergent: $.atrRaw[0] index=0 | first divergent: $.basis[0] index=0 | first divergent: $.volatilityScore[0] index=0 absDelta=10 | IDENTICAL | IDENTICAL | IDENTICAL | IDENTICAL |
| short-adx-period-minus-1 | 13 | IDENTICAL | IDENTICAL | IDENTICAL | IDENTICAL | IDENTICAL | IDENTICAL | IDENTICAL |
| short-adx-period | 14 | IDENTICAL | IDENTICAL | IDENTICAL | IDENTICAL | IDENTICAL | IDENTICAL | IDENTICAL |
| short-adx-guard-plus-1 | 29 | IDENTICAL | IDENTICAL | IDENTICAL | IDENTICAL | IDENTICAL | IDENTICAL | IDENTICAL |
| non-finite | 1000 | first divergent: $.adx[27] index=27 | first divergent: $.adx[0] index=0 | first divergent: $.adx[0] index=0 | first divergent: $.adx[0] index=0 | first divergent: $.adx[0] index=0 | first divergent: $.adx[0] index=0 | IDENTICAL |

## Conclusion

Smallest N byte-identical across all fixtures: none below 1000; 1000 bars is the first identical sample.
Compared surface: the last 240 bars, matching the signal-monitor matrix consumer window.
Runtime action: report only; no warmup constant changed.
