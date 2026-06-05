# Market Data Ingest Worker

## Runtime Ownership

Market-data ingestion and internal market-data calculations are Rust-first in v1.

- The Rust worker owns queue draining, provider snapshot hydration, option-chain snapshot persistence, retention dry-runs/execution, and persisted GEX snapshot calculation.
- The TypeScript API owns HTTP request handling, persisted GEX snapshot reads, and enqueueing refresh jobs.
- Python is not part of the app-owned v1 ingestion or GEX table hydration runtime. The workspace Python compute service is reserved for optional batch/scenario analytics; no Python service currently powers market-data ingestion or persisted GEX calculation.

## Supported Jobs

Only these queue job kinds are supported by the Rust worker and accepted by the TypeScript enqueue facade:

- `stock_snapshot`
- `option_chain_snapshot`
- `gex_snapshot`

Historical bars, option-flow events, flow summaries, and backfills are reserved future work. The hidden `backfill` CLI command intentionally exits with a clear "not implemented" error until that work is designed.

## GEX Calculation

The persisted GEX path reads the latest stock quote from `quote_cache` and the latest full-chain provider option snapshot per contract from `option_chain_snapshots`.
GEX compute intentionally limits option rows to worker-owned full-chain providers (`massive`/`massive`) so partial API-side IBKR metadata probes cannot collapse the expiration universe.
The API durable option metadata cache may also write to `option_chain_snapshots`, but its 24-hour pruning is scoped to API metadata sources and must not delete worker full-chain snapshots; worker retention remains controlled by `MARKET_DATA_OPTION_CHAIN_RETENTION_DAYS`.

```text
GEX page
  -> /api/gex/{symbol}
      -> fresh gex_snapshots.payload
      -> stale payload + queued stock/option/gex refresh
      -> pending refresh when no persisted snapshot exists
      -> live fan-out fallback when DB-first mode is disabled or unconfigured
```

The contract exposure formula is:

```text
sign * gamma * open_interest * multiplier * spot^2 * 0.01
```

Calls use positive sign and puts use negative sign. The `0.01` factor expresses exposure for a 1% underlying move. Contracts missing gamma or open interest are excluded from the net exposure and make the source status partial. Zero gamma or zero open interest are valid inputs and contribute zero exposure.

Persisted GEX payloads include `source.expirationCoverage` so the API and GEX page can tell whether all represented expirations loaded usable contracts. The worker marks persisted coverage as uncapped because upstream expiration-discovery cap metadata is not tracked in the persisted worker path yet.

## Operational Notes

- Option-chain fetches must complete all configured pages before snapshots are persisted. Truncated chains are logged as partial provider requests and fail the job without writing partial chain rows.
- Same-bucket `gex_snapshot` jobs are claimable only after the matching `stock_snapshot` and `option_chain_snapshot` jobs complete.
- Queue diagnostics expose two different failure modes:
  - blocked GEX jobs are waiting on missing or failed same-bucket stock/option-chain prerequisites.
  - inactive-worker jobs are claimable now, but no `market-data-worker` process is draining them.
- Retention is dry-run by default. Use `market-data-worker:retention -- --execute` only after reviewing the reported cutoff and eligible row counts.
- Replit dev startup starts this worker after the API becomes healthy when database config and a Massive provider key are present. Missing config emits a `worker-skipped` lifecycle event so the web app can still start. Production deployments still need the deployment process that owns background workers to run `market-data-worker:run`.

Before investigating stale or missing GEX, verify the worker can reach the queue:

```bash
pnpm run market-data-worker:doctor
```

Run the worker continuously in the background-worker environment:

```bash
pnpm run market-data-worker:run
```

For a bounded manual drain during diagnostics, cap the run:

```bash
pnpm run market-data-worker:run --max-jobs 30
```

After a successful drain, `stock_snapshot` and `option_chain_snapshot` jobs for each symbol should complete first, then same-bucket `gex_snapshot` jobs become claimable and populate `gex_snapshots`.

## Validation

Use these targeted checks after changing this subsystem:

```bash
pnpm run fmt:market-data-worker
pnpm run build:market-data-worker
pnpm --dir artifacts/api-server run typecheck
pnpm --filter @workspace/scripts run typecheck
pnpm exec tsc --build lib/db
pnpm run db:market-data:audit
```
