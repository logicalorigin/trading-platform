# DB and Runtime Data Cleanup Audit

Generated: 2026-03-20

## Local Ignored Data Footprint

- `server/data/massive-cache/`: about 3.2G
- `server/data/massive-flat-files/`: about 10G
- `server/data/runtime-state.json`: about 18K
- `server/data/runtime-state.corrupt-1773416096404.json`: about 18K
- `server/data/runtime-state.corrupt-1773416199641.json`: about 18K

## Runtime State Source Tags Observed

- `etrade-live-summary`: 14
- `ibkr-summary`: 1
- `webull-cached`: 1

## PostgreSQL-Owned Tables From Code

Account history layer:
- `account_equity_history`
- `account_native_history_rows`
- `account_position_snapshots`
- `account_position_snapshot_rows`

Massive cache layer:
- `massive_options_bars_cache`
- `massive_equity_bars_cache`
- `research_spot_bars_1m`
- `research_spot_bars_coverage`
- `research_spot_warm_state`

Flat-file ingest layer:
- `massive_flat_file_registry`
- `massive_flat_file_ingest_state`
- `research_option_bars_1m`
- `research_option_bars_coverage`

## PostgreSQL Footprint Snapshot

Read-only SQL snapshot captured against the local configured PostgreSQL database on 2026-03-20.

| Table | Exact rows | Total size |
| --- | ---: | ---: |
| account_equity_history | 16 | 104 kB |
| account_native_history_rows | 0 | 32 kB |
| account_position_snapshots | 0 | 32 kB |
| account_position_snapshot_rows | 0 | 32 kB |
| massive_options_bars_cache | 14,689 | 362 MB |
| massive_equity_bars_cache | 166 | 80 MB |
| research_spot_bars_1m | 430,751 | 168 MB |
| research_spot_bars_coverage | 4 | 80 kB |
| research_spot_warm_state | 1 | 80 kB |
| massive_flat_file_registry | 4 | 64 kB |
| massive_flat_file_ingest_state | 540 | 480 kB |
| research_option_bars_1m | 32,197 | 14 MB |
| research_option_bars_coverage | 40 | 64 kB |

## Cleanup Classification

Keep:
- PostgreSQL table families above; they are still referenced by live services.
- Active `server/data/runtime-state.json` unless a deliberate reset is planned.

Empty but still code-referenced:
- `account_native_history_rows`
- `account_position_snapshots`
- `account_position_snapshot_rows`

These are not safe drop candidates yet; they are empty in the current database snapshot but still have live service references.

Purge candidates on local disk:
- `server/data/runtime-state.corrupt-*.json` backups after manual review.
- `server/data/massive-cache/` if cache warm-up cost is acceptable.
- `server/data/massive-flat-files/` if the flat-file ingest path is no longer needed locally or can be rehydrated on demand.

Rows to review before any purge:
- `ibkr-summary` in local runtime state
- `webull-cached` in local runtime state

Not performed in this pass:
- No database row deletes
- No table drops
- No runtime-state reset

## Recommended Next DB Actions

1. Decide whether the zero-row but code-referenced account snapshot tables should remain, or remove their live service references before any drop discussion.
2. Confirm whether the local 10G flat-file store is still required for research ingestion.
3. Decide whether to reset or normalize the non-live runtime-state source tags.
4. Only after that, stage a separate destructive purge pass.
