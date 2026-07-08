# WO-P1-T4 Report

## Scope

Touched:
- `artifacts/pyrus/src/features/charting/useMassiveStockAggregateStream.ts`
- `.codex-watch/wo-p1-t4-report.md`

## Finding

Observed in `useMassiveStockAggregateStream.ts`:
- Per-symbol cache count was already capped by `MAX_MINUTE_AGGREGATES_PER_SYMBOL`, but trimming removed the oldest inserted key, not necessarily the oldest minute timestamp.
- `registerConsumer` removed stream consumers but did not evict `minuteCacheBySymbol` entries for symbols that no longer had live stream consumers or symbol-store listeners.

## Change

- Changed per-symbol trimming to drop the lowest `startMs` minute while size exceeds the cap.
- Added live-cache ownership checks using both `consumers` and `symbolStoreListeners`.
- Evicts a symbol cache when the last stream consumer and last symbol-store listener are gone.
- Prevents orphan/stale aggregate messages from recreating cache entries after a symbol has no live owner.
- Added a small module test hook export so the required unit assertions can run without adding another file, per the work-order edit constraint.

## Verification

Command:

```sh
pnpm --filter @workspace/pyrus exec tsx -e '<inline unit assertions for useMassiveStockAggregateStream minute cache>'
```

Output:

```text
useMassiveStockAggregateStream minute cache unit assertions passed
```

Note: an earlier attempt used a root-relative import while `pnpm --filter` executed from `artifacts/pyrus`; it failed before loading the target module with `Cannot find module './artifacts/pyrus/src/features/charting/useMassiveStockAggregateStream.ts'`. The command above reran the same assertions with the package-local import path and passed.
