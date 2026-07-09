# WO-R1 report

## Commits

- Commit A: `c3eae073b6a901f86bb38c7d2940763b55fcadfe`
  - `perf(db-retention): timeframe-aware bar_cache prune (60d intraday/400d daily), bounded probe + batched deletes (WO-R1)`
- Commit B: `5287fabf32f2bdb8456fc36d8b47a234cbc2a3d9`
  - `perf(db-pool): PYRUS_DB_PROFILE pool reservation, idle-in-tx timeout, application_name tagging; reserved trading lane (additive) (WO-R1)`

## Verification

### Work-order command check

`pnpm --filter @workspace/db run typecheck`

```text
None of the selected packages has a "typecheck" script
```

`pnpm --filter @workspace/db exec vitest run src/retention.test.ts`

```text
undefined
/home/runner/workspace/lib/db:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "vitest" not found
```

Observed source facts: `lib/db/package.json` names the package `@workspace/db` but has no `typecheck` script, and `lib/db/src/retention.test.ts` documents `pnpm --filter @workspace/db exec tsx --test --test-force-exit src/retention.test.ts`. I used the source-confirmed checks below before committing.

### Commit A

`pnpm --filter @workspace/db exec tsc --noEmit -p tsconfig.json`

```text
# no output; exit 0
```

`pnpm --filter @workspace/db exec tsx --test --test-force-exit src/retention.test.ts`

```text
✔ pruneBarCache is timeframe-aware: prunes stale intraday, keeps recent + daily+ (177.164952ms)
✔ pruneBarCache caps deletions per run so a sweep can't pin the DB (335.659173ms)
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 16620.012814
```

Sanity check: `pruneBarCache` uses a bounded candidate probe (`LIMIT 50_000`), timeframe-aware intraday/daily cutoffs, config/env overrides, `runAllSnapshotRetention` wiring, and batched deletes capped by `maxRowsPerRun`. I tightened the cap edge so a large batch cannot overshoot `maxRowsPerRun`.

### Commit B

`pnpm --filter @workspace/db exec tsc --noEmit -p tsconfig.json`

```text
# no output; exit 0
```

`rg -n 'dbTrading' --type ts`

```text
lib/db/src/index.ts:494:export const dbTrading: WorkspaceDatabase = drizzle(tradingPool, { schema });
```

Sanity check: diff is limited to `PYRUS_DB_PROFILE` pool reservation, `idle_in_transaction_session_timeout`, `application_name` tagging, advisory-lock client startup parameters, and additive `tradingPool` / `dbTrading` exports.

## Declined or excluded hunks

- Left `lib/db/src/schema/index.ts`, `lib/db/src/schema/universe.ts`, and `lib/db/src/schema/overnight-signal-expectancy.ts` uncommitted because the work order says `lib/db/src/schema/*` is owned by WO-R4.
- No hunks in the four WO-R1 files were declined as unrelated to SnapTrade, backtest, overnight, flow-universe, or another workstream.
