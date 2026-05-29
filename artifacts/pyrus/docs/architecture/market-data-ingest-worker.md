# Market Data Ingest Worker

## Runtime Ownership

Market-data ingestion and internal market-data calculations are Rust-first in v1.

- The Rust worker owns queue draining, provider snapshot hydration, option-chain snapshot persistence, retention dry-runs/execution, and persisted GEX snapshot calculation.
- The TypeScript API owns HTTP request handling, persisted GEX snapshot reads, and enqueueing refresh jobs.
- Python is not part of the app-owned v1 ingestion or calculation runtime. The workspace may include `python3` for unrelated scripts or tooling, but no Python service currently powers market-data ingestion or GEX calculation.

## Supported Jobs

Only these queue job kinds are supported by the Rust worker and accepted by the TypeScript enqueue facade:

- `stock_snapshot`
- `option_chain_snapshot`
- `gex_snapshot`

Historical bars, option-flow events, flow summaries, and backfills are reserved future work. The hidden `backfill` CLI command intentionally exits with a clear "not implemented" error until that work is designed.

## GEX Calculation

The persisted GEX path reads the latest stock quote from `quote_cache` and the latest option-chain snapshot per contract from `option_chain_snapshots`.

The contract exposure formula is:

```text
sign * gamma * open_interest * multiplier * spot^2 * 0.01
```

Calls use positive sign and puts use negative sign. The `0.01` factor expresses exposure for a 1% underlying move. Contracts missing gamma or open interest are excluded from the net exposure and make the source status partial. Zero gamma or zero open interest are valid inputs and contribute zero exposure.

## Operational Notes

- Option-chain fetches must complete all configured pages before snapshots are persisted. Truncated chains are logged as partial provider requests and fail the job without writing partial chain rows.
- Same-bucket `gex_snapshot` jobs are claimable only after the matching `stock_snapshot` and `option_chain_snapshot` jobs complete.
- Queue diagnostics expose GEX jobs blocked by missing or failed prerequisites.
- Retention is dry-run by default. Use `market-data-worker:retention -- --execute` only after reviewing the reported cutoff and eligible row counts.
- Replit startup config does not start this worker automatically; run it through the package scripts or the deployment process that owns background workers.

## Validation

Use these targeted checks after changing this subsystem:

```bash
pnpm run fmt:market-data-worker
pnpm run test:market-data-worker
pnpm run build:market-data-worker
pnpm --dir artifacts/api-server exec node --import tsx --test src/services/market-data-ingest.test.ts src/services/gex.test.ts
pnpm --dir artifacts/api-server run typecheck
pnpm --filter @workspace/scripts run typecheck
pnpm exec tsc --build lib/db
pnpm run db:market-data:audit
```
