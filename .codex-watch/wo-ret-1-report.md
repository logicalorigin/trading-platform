# WO-RET-1 Report

## Summary

- `bar_cache` retention results now expose `hitCap` and `durationMs`; capped runs are detected when a non-dry run deletes exactly `maxRowsPerRun`.
- The API retention scheduler now uses one-shot scheduling: initial delay remains 5m by default and is env-overridable with `SNAPSHOT_RETENTION_INITIAL_DELAY_MS`; cap-hit sweeps reschedule after `SNAPSHOT_RETENTION_BACKLOG_INTERVAL_MS` defaulting to 10m; under-cap sweeps return to the normal 6h cadence.
- Each table sweep emits `snapshot-retention-sweep` to the runtime flight recorder with `{ table, deleted, hitCap, durationMs }`.
- Scheduled retention runs execute inside `runInDbLane("background", ...)`.

## Validation

- `pnpm --filter @workspace/api-server run typecheck` -> exit 0.
- `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/snapshot-retention-scheduler.test.ts ../../lib/db/src/retention.test.ts` -> 13 pass, 0 fail.

## Notes

- Did not restart, reload, signal, push, or manually delete database rows.
- Staged/commit scope should be limited to WO-RET-1 files plus this report; the worktree contains unrelated dirty files from other lanes.
