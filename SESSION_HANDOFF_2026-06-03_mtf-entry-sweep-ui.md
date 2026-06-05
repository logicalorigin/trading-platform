# Signal Options MTF Entry Sweep + UI Handoff

- Last Updated (MT): `2026-06-02 20:05:44 MDT`
- Last Updated (UTC): `2026-06-03T02:05:44Z`
- Native Codex Session ID: `unavailable`
- Request: implement the MTF interval backtest/UI plan, including prior-two-day sweep organization and selectable alignment frames in algo controls.

## Implemented

- Added configurable Signal Options MTF alignment profile fields for `timeframes` and `preset`, with default live-compatible five-frame behavior: `1m,2m,5m,15m,1h`.
- Expanded live signal-matrix candidate enrichment to include `1d`, while preserving legacy five-frame `signal_matrix` retry semantics.
- Split entry-gate diagnostics so selected named frames missing from a candidate report `mtf_unavailable`; available but insufficient alignment reports `mtf_not_aligned`.
- Added historical backfill named-MTF reconstruction from 1-minute bars, aggregating selected frames up to `1h`/`1d` so sweeps can vary entry-gate alignment without changing other Pyrus signal factors.
- Added MTF sweep mode to `scripts/src/pyrus-signals-options-sweep.ts`:
  - `PYRUS_SIGNALS_SWEEP_MTF=true`
  - requires explicit `PYRUS_SIGNALS_SWEEP_START` and `PYRUS_SIGNALS_SWEEP_END`
  - runs 13 curated variants, including `diagnostic-no-mtf`, default five-frame baselines, scalp, balanced, higher-confirm, swing, fast+daily, and hour+daily.
  - keeps `pyrusSignalsSettingsPatch` empty for MTF variants so other algo/signal factors stay frozen unless separately overridden.
  - disables winner replay by default for MTF sweeps.
- Added Algo control UI fields:
  - MTF preset select
  - MTF timeframe chips for `1m,2m,5m,15m,1h,1d`
  - quorum max raised to 6
  - preset changes update frames/quorum together; manual chip changes reset preset to `custom`.

## Validation

- `pnpm --filter @workspace/api-server exec node JS validation runner --validation-name-pattern "selected MTF frames|six-frame matrix|entry-gate policy defaults|requires MTF alignment|seen signal keys" src/services/signal-options-automation.validation.ts`: pass, 5/5.
- `pnpm --filter @workspace/api-server exec node JS validation runner src/services/signal-options-automation.validation.ts`: pass, 136/136.
- `pnpm --filter @workspace/api-server exec node JS validation runner src/services/signal-options-worker.validation.ts`: pass, 25/25.
- `pnpm --filter @workspace/api-server exec node JS validation runner src/services/bridge-option-quote-stream.validation.ts`: pass, 33/33.
- `pnpm --filter pyrus exec node JS validation runner src/screens/algo/algoHelpers.validation.js`: pass, 36/36.
- `pnpm --filter @workspace/api-server exec node JS validation runner ../../scripts/src/pyrus-signals-options-sweep.validation.ts`: pass, 5/5.
- `pnpm --filter @workspace/api-server exec node JS validation runner --validation-name-pattern "MTF timeframe selection|profile normalization" ../../lib/backtest-core/src/signal-options.validation.ts`: pass, 8/8.
- `PYRUS_ALLOW_HOT_VALIDATION=1 pnpm exec tsc -b lib/db/tsconfig.json lib/api-zod/tsconfig.json lib/account-math/tsconfig.json lib/backtest-core/tsconfig.json lib/pyrus-signals-core/tsconfig.json lib/api-client-react/tsconfig.json`: pass.
- `pnpm --filter @workspace/api-server run typecheck`: pass.
- `pnpm --filter pyrus typecheck`: pass.

## Notes

- Root `pnpm exec node --import tsx ...` still fails because root does not provide `tsx`; tests using TypeScript were run through the API package where `tsx` is available.
- The repo has a broad pre-existing dirty worktree. I did not revert unrelated changes.
- No Replit startup config was touched, so `pnpm run audit:replit-startup` was not required.
- Clean extraction committed at `/home/runner/workspace-signal-options-mtf-entry-sweep` on branch `codex/signal-options-mtf-entry-sweep`, commit `a8f0a4d`.
- Branch base includes `codex/api-signal-monitor-pressure` plus cherry-picked data-quality commit `2735a89`.
- Applied the dirty-root MTF/UI patch, resolved the two conflicted automation files, trimmed two unrelated loading-state assertions from `algoHelpers.validation.js`, and added minimal bridge quote-stream `releaseLeasesOnAbort` support required by the extracted automation path.
- Final commit is 10 files, 3165 insertions, 516 deletions. The clean extraction worktree is clean.
- Initial full Pyrus helper validation failed because two dirty-root loading-state assertions targeted `AlgoScreen.jsx`/`AlgoLivePage.jsx`, which are intentionally outside this branch. Those assertions were reverted to the branch base; the remaining full helper suite passes.

## MTF Sweep Result

- Ran the explicit two-day MTF sweep from the dirty root with:
  - `PYRUS_SIGNALS_SWEEP_MTF=true`
  - `PYRUS_SIGNALS_SWEEP_START=2026-06-01`
  - `PYRUS_SIGNALS_SWEEP_END=2026-06-02`
  - `PYRUS_SIGNALS_SWEEP_LOCK_WAIT_MS=300000`
  - `PYRUS_SIGNALS_SWEEP_REPORT_DIR=../../reports/pyrus-signals-options-sweeps/2026-06-03-mtf-entry-two-day`
- Command:
  - `pnpm --filter @workspace/api-server exec tsx ../../scripts/src/pyrus-signals-options-sweep.ts`
- Result files:
  - `reports/pyrus-signals-options-sweeps/2026-06-03-mtf-entry-two-day/report.md`
  - `reports/pyrus-signals-options-sweeps/2026-06-03-mtf-entry-two-day/results.csv`
  - `reports/pyrus-signals-options-sweeps/2026-06-03-mtf-entry-two-day/results.json`
- Sweep completed with exit code 0:
  - Deployment: `Pyrus Signals Options Shadow Paper` / `7e2e4e6f-749f-4e65-a011-87d3559a23b0`
  - Symbols: `90`
  - Dry variants: `13`
  - Eligible variants: `7`
  - Replay committed: `false`
  - Eligible winner: `balanced-six-q2`
- Top eligible variants:
  - `balanced-six-q2`: PnL `4144`, score `8.288`, trades `36`, PF `2.521`, max DD `0`, open `8`, frames `1m,2m,5m,15m,1h,1d`, required `2`.
  - `baseline-live-five-q1`: PnL `4144`, score `8.288`, trades `36`, PF `2.521`, max DD `0`, open `8`, frames `1m,2m,5m,15m,1h`, required `1`.
  - `baseline-default-five-q2`: PnL `3103`, score `6.206`, trades `33`, PF `2.140`, max DD `0`, open `8`.
  - `balanced-six-q3`: PnL `3093`, score `6.186`, trades `31`, PF `2.202`, max DD `0`, open `8`.
- Diagnostic caveat:
  - `diagnostic-no-mtf` produced PnL `8103`, score `16.206`, trades `40`, PF `3.719`, max DD `0`, open `8`, but it is intentionally `winnerEligible=false` and excluded from ranking.
  - `balanced-six-q2` tied `baseline-live-five-q1` on PnL/score/trades/PF/max DD/open positions; the script ranked `balanced-six-q2` first by final variant-id tie-breaker.
- Ineligible successful variants: `intraday-q2`, `higher-confirm-q3`, `swing-q2`, `fast-plus-daily-q2`, and `hour-daily-q2`, all due to closed trades below `20`.
- Runtime warnings during the run:
  - `watchlist database refresh failed after stale list read` from shared platform/watchlist background refresh.
  - `IBKR bridge health request timed out` from shared platform bridge health background check.
  - These warnings did not fail the sweep and all 13 variants completed.

## Next Step

Push/open PRs in dependency order if they have not already been pushed:

1. `codex/api-signal-monitor-pressure` (`049aea2`)
2. `codex/signal-options-mtf-entry-sweep` (`a8f0a4d`, includes data-quality commit `2735a89` in its history)

Then decide whether `balanced-six-q2` is genuinely better than the tied live-five baseline, given the no-MTF diagnostic outperformed both but is intentionally not an eligible production setting.

## Daily-Heavy Variant Follow-Up

- Investigated recommendation 4 from the two-day MTF sweep because the daily-heavy variants looked suspiciously weak.
- Code inspection:
  - MTF selection treats any configured named timeframe missing from `filterState.mtfDirections` as `mtf_unavailable`, independent of whether the required quorum could otherwise be met.
  - Historical MTF directions are generated from aggregated bars and require at least 6 aggregated bars per selected timeframe.
  - The sweep/backfill code used for this check is clean against git in the relevant files:
    - `artifacts/api-server/src/services/signal-options-automation.ts`
    - `scripts/src/pyrus-signals-options-sweep.ts`
    - `lib/pyrus-signals-core/src/index.ts`
- Original sweep anomaly:
  - `swing-q2`, `fast-plus-daily-q2`, and `hour-daily-q2` each reported only 52 signals, 0 entries, and 52 `mtf_unavailable` skips, with runtimes under 10 seconds.
  - That conflicts with nearby variants that also include `1d` but evaluated ~212 signals.
- No-commit reproduction runs contradicted the original zero rows:
  - Standalone `swing-q2` rerun: 215 signals, 37 entries, 29 closed trades, realized PnL `3406`, skipped reasons led by `mtf_not_aligned: 103`; no `mtf_unavailable`.
  - Standalone `fast-plus-daily-q2` rerun: 216 signals, 41 entries, 33 closed trades, realized PnL `3721`, skipped reasons led by `mtf_not_aligned: 82`; no `mtf_unavailable`.
- Current interpretation:
  - Do not treat recommendation 4 as proven strategy evidence.
  - The original daily-heavy zero rows are likely a measurement/data-state/cache artifact or otherwise non-reproducible sweep anomaly.
  - Before deciding against daily profiles, rerun the daily variants in a fresh/instrumented pass and add per-variant diagnostics for signal count, MTF source, selected/missing frames, and historical bar coverage.

## MTF Sweep Rerun After Daily-Variant Probe

- Reran the explicit two-day MTF sweep into a separate report directory:
  - `reports/pyrus-signals-options-sweeps/2026-06-03-mtf-entry-two-day-rerun`
  - Window: `2026-06-01` through `2026-06-02`
  - Command: `PYRUS_SIGNALS_SWEEP_MTF=true PYRUS_SIGNALS_SWEEP_START=2026-06-01 PYRUS_SIGNALS_SWEEP_END=2026-06-02 PYRUS_SIGNALS_SWEEP_LOCK_WAIT_MS=300000 PYRUS_SIGNALS_SWEEP_REPORT_DIR=../../reports/pyrus-signals-options-sweeps/2026-06-03-mtf-entry-two-day-rerun pnpm --filter @workspace/api-server exec tsx ../../scripts/src/pyrus-signals-options-sweep.ts`
- Rerun completed with exit code 0:
  - Dry variants: `13`
  - Eligible variants: `7`
  - Winner: `balanced-six-q2`
  - Replay committed: `false`
- Top eligible rerun results:
  - `balanced-six-q2`: PnL `4144`, score `8.288`, trades `36`, PF `2.521`, open `8`.
  - `baseline-live-five-q1`: PnL `4144`, score `8.288`, trades `36`, PF `2.521`, open `8`.
  - `higher-confirm-q2`: PnL `3772`, score `7.544`, trades `28`, PF `2.834`, open `8`.
  - `baseline-default-five-q2`: PnL `3103`, score `6.206`, trades `33`, PF `2.140`, open `8`.
  - `balanced-six-q3`: PnL `3093`, score `6.186`, trades `31`, PF `2.202`, open `8`.
- Important comparison against the prior sweep:
  - `higher-confirm-q2` improved from PnL `1180`, `20` trades, `83` `mtf_unavailable` skips to PnL `3772`, `28` trades, and `0` `mtf_unavailable` skips.
  - `higher-confirm-q3` also dropped `mtf_unavailable` from `83` to `0`, but stayed ineligible with `8` closed trades.
  - `swing-q2`, `fast-plus-daily-q2`, and `hour-daily-q2` are still not clean in the full sweep:
    - `swing-q2`: `68` signals, `4` entries, `3` trades, `62` `mtf_unavailable`.
    - `fast-plus-daily-q2`: `68` signals, `3` entries, `2` trades, `62` `mtf_unavailable`.
    - `hour-daily-q2`: `66` signals, `1` entry/trade, `65` `mtf_unavailable`.
- Interpretation after rerun:
  - The issue is not fully fixed.
  - The daily-heavy full-sweep rows still conflict with standalone dry backfills, where `swing-q2` and `fast-plus-daily-q2` each evaluated ~215 signals and produced eligible trade counts.
  - Next investigation should focus on why the full sequential sweep produces low signal counts and `mtf_unavailable` for daily-plus-lower-frame variants while standalone backfills do not. Likely areas: historical signal/data caching, provider/cache state under sequential variant load, and missing-frame diagnostics.
- Runtime warnings during rerun:
  - Watchlist DB refresh timeout after stale list read.
  - IBKR bridge health timeout.
  - These matched prior background warning patterns and did not fail the sweep.
