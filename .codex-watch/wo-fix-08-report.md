# WO-FIX-08 Report

## What / Why

Observed: `buildSignalMonitorActionability` used the current `marketClosed` input to label every action-paused row as `market_closed`. REST, matrix stream, and STA snapshots all supplied that input from the current wall-clock market session.

Inferred from the work-order trace: a signal that fired during an actionable live session but was first evaluated after the close could be truthfully blocked, but mislabeled as `market_closed`, masking an expired entry window.

Changed labeling only. `actionEligible` still derives from `actionBlocker == null`; both `market_closed` and `entry_window_expired` remain not actionable.

## Diff

- `artifacts/api-server/src/services/signal-monitor-actionability.ts:19` adds the typed blocker set with `entry_window_expired`.
- `artifacts/api-server/src/services/signal-monitor-actionability.ts:69` adds optional `signalFiredWhileMarketClosed`; the `marketClosed` branch now emits `entry_window_expired` only when that flag is explicitly `false` and a signal timestamp exists. `undefined` and `true` preserve `market_closed`.
- `artifacts/api-server/src/services/signal-monitor.ts:4244` exports `isSignalMonitorActionPausedMarketSessionAt(at)` as a thin wrapper over the existing private session helper.
- `artifacts/api-server/src/services/signal-monitor.ts:1264`, `artifacts/api-server/src/services/signal-monitor.ts:9994`, and `artifacts/api-server/src/services/signal-options-automation.ts:2634` pass fire-time session state from the signal timestamp into actionability.
- `artifacts/api-server/src/services/signal-monitor-actionability.test.ts:143` covers false -> `entry_window_expired` and undefined/true -> `market_closed`.

Diff stat:

```text
 .../services/signal-monitor-actionability.test.ts  | 33 ++++++++++++++++++++++
 .../src/services/signal-monitor-actionability.ts   | 25 ++++++++++++----
 .../api-server/src/services/signal-monitor.ts      | 16 +++++++++--
 .../src/services/signal-options-automation.ts      |  7 ++++-
 4 files changed, 73 insertions(+), 8 deletions(-)
```

## Test Output

Command:

```bash
pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-actionability.test.ts src/services/signal-monitor-completed-bars.test.ts
```

Output:

```text
✔ bars since signal normalizes to a non-negative integer or null (0.820564ms)
✔ signal age blocker matches the signal-options execution window (0.174069ms)
✔ fresh requires a bar age inside the profile window and current data (0.089192ms)
✔ actionability requires a directional signal, current data, and young age (0.615522ms)
✔ marketClosed outranks stale and age blockers, but not no_signal (0.283335ms)
✔ marketClosed labels expired live-session entries separately (0.1154ms)
✔ prior-session signal is blocked intra-session; same-session signal stays eligible (0.355668ms)
✔ market_closed and no_signal outrank the prior-session block (0.12014ms)
✔ prior-session block is gated by the constant and off when no session is open (0.327928ms)
{"level":40,"time":1783543502792,"pid":235200,"hostname":"repl","symbol":"AGZ","timeframe":"1m","rejectedCount":1,"samples":[{"source":"massive-websocket","close":76.91,"timestamp":"2026-06-18T08:00:00.000Z","referenceClose":109,"referenceTimestamp":"2026-06-17T20:00:00.000Z","referenceSource":"massive-history","deviationPercent":29.4404,"trusted":false,"reason":"deviates-from-reference"}],"msg":"Signal monitor rejected untrusted live-edge bars"}
✔ quiet market completed bars do not retry solely because wall clock moved (16.886645ms)
✔ quiet market completed bars still retry when far behind the previous close (0.331868ms)
✔ gappy intraday feed counts bars since signal by elapsed time, not present bars (0.765397ms)
✔ thin and liquid symbols with the same signal/latest times report the same bars (0.280689ms)
✔ bars since signal never reads fresher than the present-bar count (0.269004ms)
✔ signal monitor excursion uses bars after the signal close (1.786757ms)
✔ signal monitor excursion is direction-aware for sell signals (0.557375ms)
✔ cross-session intraday signal is counted as very old, not artificially fresh (0.57995ms)
✔ python signal matrix state recomputes elapsed bar age before freshness (2.705844ms)
✔ python signal matrix state keeps signal identity when the cell is stale (1.588078ms)
✔ python signal matrix unavailable cell defers to the JS fallback (1.058131ms)
✔ a delayed bar replay never displaces a live bar for the same bucket (0.536484ms)
✔ signal monitor rejects live-edge bars that conflict with trusted same-symbol history (2.85476ms)
✔ signal monitor does not persist live-edge signal identity without a trusted reference (0.443067ms)
✔ signal monitor still persists live-edge latest-bar metadata without a trusted reference (0.300355ms)
✔ daily bar completeness is consistent across the UTC/NY date boundary (0.511376ms)
✔ reconciliation keeps adopted 1d rows age-less until the next daily eval (10.114569ms)
✔ daily bars do not count weekends/holidays as elapsed bars (0.262571ms)
✔ active-session completed bars still require the expected live edge (0.189613ms)
✔ matrix cache latches the last signal when a re-eval finds no new signal (0.740089ms)
✔ matrix cache advances latched signal bar age from timestamps (0.179782ms)
✔ matrix cache flips direction when an opposite signal arrives (0.189385ms)
✔ matrix cache leaves a never-signaled cell directionless (0.135033ms)
✔ a newer real signal is not rejected by an existing row with newer bar metadata (0.227229ms)
✔ an incoming older signal cannot replace a newer stored signal (0.788243ms)
✔ a latched metadata refresh with newer bars still writes (0.242799ms)
✔ an incoming row with the same signal but older bars is preserved away (0.419244ms)
✔ signal monitor bar evaluation is passive by default (1.32341ms)
✔ signal monitor bar evaluation requires explicit opt-in (0.188413ms)
✔ signal matrix heavy evaluation cache keys identical completed-bar series only (7.166474ms)
✔ non-current signal state snapshots preserve last-known direction for display hydration (6.728384ms)
✔ trend-only signal state snapshots render a non-actionable display direction (1.491715ms)
✔ non-RTH aged signal snapshots are market-idle, not stale (3.122901ms)
✔ RTH aged signal snapshots stay stale (1.666698ms)
✔ matrix evaluation keeps configured capacity under high pressure (0.705023ms)
✔ signal monitor pressure defaults use resource pressure (8.193219ms)
✔ automatic stored-state matrix bootstrap keeps full universe breadth (0.281342ms)
✔ signal monitor evaluation batch keeps existing cursor rotation without priority (2.16088ms)
✔ signal monitor evaluation batch prioritizes visible symbols within the existing cap (0.264813ms)
✔ signal monitor evaluation batch rotates oversized priority symbols without expanding work (0.241656ms)
✔ signal matrix metadata reports pending exact cells from backend coverage (1.078749ms)
✔ signal matrix metadata does not expand broad requests into pending cells (2.113617ms)
✔ exact matrix evaluation is not capped by pressure (5.748637ms)
✔ fresh signal monitor events persist when first observed after the zero bar (0.374712ms)
✔ signal monitor event catch-up does not persist stale or out-of-window signals (0.214321ms)
✔ canonical signal monitor event eligibility is shared by matrix and symbol paths (0.158388ms)
✔ signal monitor event pagination reports source status (0.171961ms)
✔ signal monitor events fallback backoff latches transient read failures (19.36861ms)
✔ signal monitor events read checks fallback latch before retrying the database (18.736858ms)
✔ signal monitor state fallback carries its source through the API contract (51.204766ms)
✔ public signal monitor state responses do not drop state source (9.880265ms)
✔ signal monitor reconciliation trusts event integrity and websocket-backed bar cache rows (6.043862ms)
✔ disabled signal monitor profile symbols do not evaluate bars (1.308702ms)
✔ enabled signal monitor profile symbols stay passive by default (0.332956ms)
✔ signal monitor state snapshots fill missing universe cells as unavailable (0.381403ms)
✔ intraday bar age counts only regular-session bars (SMR regression: wall-clock counted nights, weekends, and the Jul-3 holiday) (0.6585ms)
✔ intraday bar age does not inflate across a single overnight gap (prior-session signals stay actionable at the open) (0.251047ms)
✔ intraday bar age keeps the present-bar floor (never fresher than actual) (0.165025ms)
ℹ tests 67
ℹ suites 0
ℹ pass 67
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4136.92466
```

Additional check:

```text
> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit
```
