# WO-SO-06 Greek Evidence Pipeline Report

Generated: 2026-07-08T02:00Z

## What Changed

- `scripts/src/signal-options-greek-selector-smoke.ts`
  - Sets `PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED ??= "1"` for historical replay parity with the exit sweep.
  - Adds `gex_snapshots` lookup/re-score post-processing for the smoke script's visible selected/top candidates.
  - Adds explicit candidate provenance in the report: `source: gex_snapshot` or `source: bs_reconstruction`.
  - Keeps the service-owned candidate generator untouched. Observed limitation: only candidates exposed by `runSignalOptionsGreekSelectorSmoke` can be re-scored in this scripts lane.

- `scripts/src/signal-options-exit-policy-sweep.ts`
  - Replaced the 15s `greekMaxAgeMs` hardcode with the 45s source default.
  - Added override env: `SIGNAL_OPTIONS_EXIT_SWEEP_GREEK_MAX_AGE_MS`.

- `scripts/src/gex-historical-greeks.ts`
  - New read-only adapter: exact contract lookup by `(symbol, expirationDate, strike, right, timestamp)`.
  - Default tolerance: `SIGNAL_OPTIONS_GEX_GREEKS_TOLERANCE_MS` or 30 minutes.
  - Returns provenance and fallback reason.

- `scripts/src/signal-options-gex-match-rate-analysis.ts`
  - New bounded analysis script.
  - Full-window JSON expansion hit the DB statement timeout, so the working path reads eligible events once, expands GEX rows in daily slices filtered to that day's event symbols, and aggregates in-process.

## Verification

- `pnpm --filter @workspace/scripts run typecheck`: clean.
- Analysis command:
  - `pnpm --filter @workspace/scripts exec tsx ./src/signal-options-gex-match-rate-analysis.ts --start=2026-05-29 --end=2026-07-07 --max-events-per-scope=1000`
  - Observed census was below the 1,000/scope cap, so the reported event window was not cap-truncated.

## Match-Rate Tables

Event census:

| Scope | Total Events | Eligible | Missing Contract |
| --- | ---: | ---: | ---: |
| entry | 94 | 94 | 0 |
| exit | 92 | 72 | 20 |

Coverage by month/tier:

| Scope | Month | Tier | Eligible | 15m | 15m % | 30m | 30m % | 60m | 60m % | Nearest P50 Min | Nearest P90 Min |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| entry | 2026-05 | long_tail | 18 | 0 | 0.0% | 0 | 0.0% | 0 | 0.0% | - | - |
| entry | 2026-05 | SPY_QQQ_like | 1 | 1 | 100.0% | 1 | 100.0% | 1 | 100.0% | 7.9 | 7.9 |
| entry | 2026-06 | long_tail | 44 | 1 | 2.3% | 1 | 2.3% | 1 | 2.3% | 8.0 | 8.0 |
| entry | 2026-06 | SPY_QQQ_like | 4 | 0 | 0.0% | 0 | 0.0% | 1 | 25.0% | 56.5 | 56.5 |
| entry | 2026-07 | long_tail | 25 | 0 | 0.0% | 0 | 0.0% | 0 | 0.0% | - | - |
| entry | 2026-07 | SPY_QQQ_like | 2 | 0 | 0.0% | 0 | 0.0% | 0 | 0.0% | - | - |
| exit | 2026-05 | long_tail | 15 | 0 | 0.0% | 0 | 0.0% | 0 | 0.0% | - | - |
| exit | 2026-05 | SPY_QQQ_like | 1 | 1 | 100.0% | 1 | 100.0% | 1 | 100.0% | 10.2 | 10.2 |
| exit | 2026-06 | long_tail | 32 | 0 | 0.0% | 0 | 0.0% | 0 | 0.0% | - | - |
| exit | 2026-06 | SPY_QQQ_like | 2 | 0 | 0.0% | 0 | 0.0% | 0 | 0.0% | - | - |
| exit | 2026-07 | long_tail | 20 | 0 | 0.0% | 0 | 0.0% | 0 | 0.0% | - | - |
| exit | 2026-07 | SPY_QQQ_like | 2 | 0 | 0.0% | 0 | 0.0% | 0 | 0.0% | - | - |

Rollup from the table:

| Scope | Eligible | 30m Matches | 30m % | 60m Matches | 60m % |
| --- | ---: | ---: | ---: | ---: | ---: |
| entry | 94 | 2 | 2.1% | 3 | 3.2% |
| exit | 72 | 1 | 1.4% | 1 | 1.4% |

Smoke suggestions from exact-contract 30m entry matches:

| Date | Symbol | Exact 30m Matches | Eligible Entries |
| --- | --- | ---: | ---: |
| 2026-06-09 | AAPL | 1 | 1 |
| 2026-05-29 | SPY | 1 | 1 |

## Smoke Run Evidence

Dry-check command:

```bash
SIGNAL_OPTIONS_GREEK_SMOKE_PROGRESS=1 pnpm --filter @workspace/scripts exec tsx ./src/signal-options-greek-selector-smoke.ts --date=2026-06-09 --symbols=AAPL --max-signals=1 --max-candidates-per-signal=1 --report-dir=/tmp/wo-so-06-greek-smoke-drycheck-aapl-2026-06-09
```

Report path:

```text
/tmp/wo-so-06-greek-smoke-drycheck-aapl-2026-06-09/report.md
```

Observed dry-check result:

- Action candidates: 0.
- Candidates scored: 0.
- Visible candidates with `gex_snapshot` greeks: 0.
- The process logged a Postgres statement timeout from `loadStoredMarketBars` and fell back to the provider:
  - `canceling statement due to statement timeout`
  - `durable market data store temporarily unavailable (loadStoredMarketBars); serving provider fallback`

Decision: aborted the larger bounded smoke run per the work-order guard. This is the precise blocker for smoke proof; I did not run additional backfill/API work after the dry-check showed DB pressure.

Read-only adapter spot-check, not a smoke substitute:

- Event: `104b52f6-d113-42a8-8402-8befeb25088b`
- Contract: `AAPL 2026-06-12 CALL 290`
- Entry time: `2026-06-09T18:42:23.956Z`
- Adapter result: `source: gex_snapshot`
- Snapshot: `b0b836ec-ef0d-4282-9e50-50a31662ec72`
- Snapshot time: `2026-06-09T18:50:23.056Z`, age `479100ms` / `8.0m`
- Greeks: `delta=0.547598`, `gamma=0.045895`, `iv=0.319919`, `sourceStatus=partial`

## Verdict

Observed: `gex_snapshots` can return real historical greeks for isolated contracts, but match-rate coverage is too thin for the evidence program.

- Entry-selection A/B (G3): not supported broadly now. Only `2/94` eligible entry events had a 30m match, and `3/94` had a 60m match. SPY/QQQ-like entries were better but still tiny sample size: `1/7` at 30m and `2/7` at 60m.
- Exit-management replay: not supported now. Only `1/72` eligible exits had a 30m/60m match. This confirms the expected thinness from median 1 snapshot per symbol-day.
- Verdict: (c) neither, without ingestion upgrade.

## Recommendation

Cheapest ingestion improvement:

- On signal-options entry, snapshot the selected underlying immediately and persist the exact selected contract row.
- While a signal-options position is open during RTH, snapshot that position's underlying every 5-15 minutes and at exit evaluation/exit.
- Prioritize symbols with open positions and current signal candidates before broad universe refreshes.
- Persist enough fields for replay directly: expiration, strike, right, delta, gamma, theta, vega, IV, bid/ask/mark, option updatedAt, snapshot computedAt, and source status.

This should turn exit-management replay from mostly unmatched to measurable without requiring a full-universe high-cadence GEX feed.

## DB/Runtime Notes

- Full-window GEX JSON expansion with a 15s statement timeout failed.
- The daily-sliced analysis path avoided full-window expansion and completed for the 1,000/scope cap.
- The smoke dry-check still showed DB pressure in the backfill bar-cache read, so no further smoke/backfill run was attempted.

## Diff Stat

`git diff --stat` for tracked scoped files:

```text
 scripts/src/signal-options-exit-policy-sweep.ts    |   6 +-
 scripts/src/signal-options-greek-selector-smoke.ts | 256 ++++++++++++++++++++-
 2 files changed, 258 insertions(+), 4 deletions(-)
```

New scoped files:

```text
scripts/src/gex-historical-greeks.ts
scripts/src/signal-options-gex-match-rate-analysis.ts
.codex-watch/wo-so-06-greek-evidence-report-2026-07-07.md
```

## Deferred Items

- Service-lane follow-up: expose a hook or adapter injection point in the service-owned smoke candidate resolver if GEX greeks must affect the full candidate universe, not only selected/top visible candidates.
- Runtime follow-up: investigate why the dry-check `bar_cache` read timed out for AAPL 5m bars on `2026-06-09`.
- Ingestion follow-up: add position-symbol RTH snapshots before attempting G3 or exit replay conclusions from real greeks.
