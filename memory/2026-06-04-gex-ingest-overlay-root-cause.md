# GEX Overlay Data-Gathering Investigation

## Symptom

GEX overlay appears for `SPY` but not reliably for other tickers.

## Root Cause

The frontend chart path is not the primary failure. The API only draws a
zero-gamma overlay when `/api/gex/{ticker}/zero-gamma` returns a finite
`zeroGamma` value. The data behind that endpoint was stale or missing because
the Rust market-data worker was not being run, and when run manually it could
not persist option-chain prerequisites because the live database was still on
the old `option_contracts.polygon_ticker` column while the worker and schema
expect `option_contracts.massive_ticker`.

The API is enqueueing refresh jobs correctly:

- `stock_snapshot`
- `option_chain_snapshot`
- `gex_snapshot`

When the worker was absent, `stock_snapshot` and `option_chain_snapshot` jobs
were claimable while all `gex_snapshot` jobs were blocked waiting for those
same-bucket prerequisites. After the worker was started, stock jobs completed
but option-chain jobs failed until the database migration was repaired/applied.

## Evidence

- Process list showed API/web/Python compute, but no `market-data-worker` run
  process.
- `pnpm run market-data-worker:doctor` passed the DB check, so the worker can
  connect when invoked manually.
- `provider_request_log` latest `option_chain_snapshot` request was
  `2026-05-31T22:20:31Z`; there are no provider option-chain requests after
  that.
- `quote_cache` latest `massive` quote row was `2026-05-30T00:00:00Z`.
- `gex_snapshots` exists for only seven symbols: `SPY`, `QQQ`, `IWM`, `AAPL`,
  `TSLA`, `F`, `NVDA`; all are stale.
- Full-chain `massive` option snapshots exist only for `SPY`, `QQQ`, `IWM`,
  `AAPL`, and `TSLA`. Symbols such as `MSFT` and `DIA` have queued refresh
  jobs but no full-chain option rows, so they cannot produce a GEX snapshot.
- Read-only queue claimability check:
  - `stock_snapshot`: 23 claimable
  - `option_chain_snapshot`: 23 claimable
  - `gex_snapshot`: 23 not claimable, blocked by missing same-bucket completed
    stock/option-chain prerequisites
- Bounded worker drain before the schema fix persisted stock snapshots, then
  failed option-chain jobs with
  `column "massive_ticker" of relation "option_contracts" does not exist`.
- Live database check showed `option_contracts.polygon_ticker`, `polygon`
  provider enum/defaults, and `option_contracts_polygon_ticker_idx`.
- The provider rename migration had been blocked by mixed old/new duplicate
  rows in `bar_cache` and `flow_event_hydration_sessions`; it is now
  duplicate-safe and has been applied.

## Code Path

- `artifacts/pyrus/src/features/gex/useGexZeroGamma.js` fetches
  `/api/gex/{ticker}/zero-gamma`.
- `artifacts/pyrus/src/screens/TradeScreen.jsx` passes the zero-gamma reference
  line to the chart.
- `artifacts/pyrus/src/features/charting/ResearchChartSurface.tsx` only adds
  the line when `line.price` is finite.
- `artifacts/api-server/src/services/gex.ts` serves stale persisted snapshots
  and queues refreshes when snapshots are stale; it returns a pending empty
  overlay when no persisted snapshot exists.
- `crates/market-data-worker/src/jobs.rs` requires same-bucket completed
  `stock_snapshot` and `option_chain_snapshot` jobs before `gex_snapshot` can be
  claimed.
- `artifacts/pyrus/docs/architecture/market-data-ingest-worker.md` states that
  Replit startup does not start this worker automatically.

## Current Operational Conclusion

Fixed as of 2026-06-04 23:13 UTC for the live workspace DB. A bounded worker
drain completed the queued stock, option-chain, and GEX jobs. Final diagnostics:

- `claimableQueuedJobCount`: 0
- `workerLikelyInactive`: false
- `blockedGexJobCount`: 0
- Fresh `gex_snapshots` rows exist for 23 symbols:
  `AAOI`, `AAPL`, `AMZN`, `COHR`, `CRDO`, `DIA`, `F`, `FCEL`, `IEF`, `INDI`,
  `IONQ`, `IWM`, `JOBY`, `MSFT`, `NVDA`, `QQQ`, `SMCI`, `SPY`, `SQQQ`,
  `TQQQ`, `TSLA`, `USO`, `VXX`.

## Next Actions

- Keep the Rust worker running as the owned background-worker process in any
  environment expected to maintain fresh GEX data.
- Diagnostics now surface claimable queued jobs and an inactive-worker state,
  so future failures should show whether GEX is blocked by prerequisites or by
  an absent worker.
- Do not change Replit startup config casually; the repo rules require an
  explicit startup-config maintenance window.
