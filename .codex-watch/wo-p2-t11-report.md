# WO-P2-T11 Report

## Result

Implemented.

## Observed

- `queueGexSnapshotRefresh` previously built the required `option_chain_snapshot` and `gex_snapshot` jobs, then enqueued them with one `enqueueMarketDataJob` call per job.
- `market-data-ingest.ts` already exposes `enqueueMarketDataJobs`, the bulk enqueue helper with ordered per-input results.

## Changed

- `artifacts/api-server/src/services/gex.ts` now routes on-demand GEX refresh jobs through one `enqueueMarketDataJobs(inputs)` call.
- The existing GEX ingest test facade accepts a bulk enqueue spy while preserving older single-job test facades through a compatibility wrapper.
- Result mapping preserves the same job set and job-kind association.

## Verification

Passed:

```text
pnpm --filter @workspace/api-server exec node --import tsx --input-type=module
ok - GEX stale refresh uses one batched enqueue for both jobs
```

The targeted inline unit check asserted:

- exactly one batched enqueue call for a stale multi-job GEX refresh
- zero single-job enqueue calls
- same scheduled job kinds: `option_chain_snapshot`, `gex_snapshot`
- same symbol and stale snapshot dedupe bucket on both jobs
