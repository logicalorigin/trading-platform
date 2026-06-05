# Rust Market Data Worker Forward Audit - 2026-05-29

## Scope

- Audited and fixed the forward-only Rust worker path for `stock_snapshot`, `option_chain_snapshot`, and `gex_snapshot`.
- Historical jobs remain out of scope: `stock_bars`, `option_flow_events`, `flow_summary`, and backfill.
- IBKR market-data lines are not used by this worker path; this path uses Massive/Polygon REST snapshots plus persisted DB compute.

## Findings

- The worker heartbeat only covered the option-chain provider fetch. Large option-chain persistence could exceed the 60s lease while the process was still writing rows.
- SPY option-chain persistence was row-by-row and took roughly five minutes before the fix.
- The API was enqueueing one GEX refresh bucket per minute. When the old worker could not drain SPY quickly enough, stale per-minute buckets accumulated.
- Massive/Polygon SPY option-chain fetches intermittently returned `error decoding response body`; retries made the stale backlog worse.

## Changes

- `crates/market-data-worker/src/main.rs`
  - Wrapped the full `stock_snapshot`, `option_chain_snapshot`, and `gex_snapshot` job bodies in `with_job_heartbeat`.
  - This keeps leases current during fetch, provider logging, validation, DB persistence, and GEX compute.

- `crates/market-data-worker/src/ingest.rs`
  - Replaced row-by-row option-chain persistence with one transaction and set-based upserts/inserts for option instruments, option contracts, and snapshots.
  - Deduplicates incoming option-chain rows by ticker, keeping the last row for a ticker in a provider response.
  - Added focused tests for ticker dedupe and expiration parsing.

- `artifacts/api-server/src/services/market-data-ingest.ts`
  - Added enqueue-time supersede logic for numeric forward refresh buckets.
  - A newer `dedupeBucket` cancels older queued/running/failed `stock_snapshot`, `option_chain_snapshot`, and `gex_snapshot` jobs for the same symbol.
  - Completed older jobs remain as historical evidence.

- `artifacts/api-server/src/services/market-data-ingest.validation.ts`
  - Added coverage that only numeric minute buckets are supersedable.

## Live Validation

- `pnpm run fmt:market-data-worker` passed.
- `pnpm run market-data-worker validation` passed: 17 tests.
- `pnpm run build:market-data-worker` passed.
- `pnpm --dir artifacts/api-server exec node JS validation runner src/services/market-data-ingest.validation.ts src/services/gex.validation.ts` passed: 21 tests after supersede patch.
- `pnpm --dir artifacts/api-server run typecheck` passed.
- `pnpm run db:market-data:audit` passed before live drain.
- `pnpm run market-data-worker:doctor` passed after live drain.

## Live Outcome

- Initial full drain proved batched SPY persistence dropped from minutes to seconds, but draining every stale SPY bucket was still too slow.
- Stopped the long drain and cancelled superseded stale buckets, keeping only latest buckets per symbol.
- Final short worker pass processed the latest SPY option-chain job plus F/QQQ/SPY GEX jobs.
- Final DB status for forward jobs: no queued, running, or failed `stock_snapshot`, `option_chain_snapshot`, or `gex_snapshot` jobs.
- Latest persisted GEX snapshots:
  - `SPY` at `2026-05-29T18:41:10.942Z`, `option_count=15098`, `usable_option_count=14330`.
  - `F` at `2026-05-29T18:41:08.673Z`, `option_count=1046`, `usable_option_count=843`.
  - `QQQ` at `2026-05-29T18:41:07.246Z`, `option_count=12916`, `usable_option_count=11845`.

## Remaining Work

- Build the broader API-side market data work planner from `LIVE_DATA_WORK_PLANNER_HANDOFF_2026-05-29.md`.
- The planner should decide provider ownership, scanner horizon, IBKR desired lines, release generations, diagnostics, and memory pressure actions before callers enqueue or subscribe.
- Keep IBKR lines reserved for live/trading/account/visible work; persisted forward jobs should remain Massive/Polygon + Rust worker owned.
