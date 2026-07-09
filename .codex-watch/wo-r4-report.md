# WO-R4 gray-file provenance audit report

Worker: wo-r4

## Summary

| Unit | Verdict |
| --- | --- |
| Unit 1 - diagnostics storage census | Left dirty. Hunk provenance is mixed, and required focused `vitest` verify failed because `vitest` is not installed for `@workspace/api-server`. |
| Unit 2 - automation execution-events read coalescing | Left dirty. Hunk provenance matches the expected read coalescing, but required focused `vitest` verify failed because `vitest` is not installed for `@workspace/api-server`. |
| Unit 3 - universe optionability schema + migration | Committed `bef57303` (`feat(db-schema): universe catalog optionability columns + partial index migration, manual-apply (WO-R4)`). |

## Unit 1 - diagnostics storage census

Verdict: left dirty.

Observed hunks:
- `artifacts/api-server/src/services/diagnostics.ts` batches `buildMonitoredStorageTableStats()` into one `MONITORED_STORAGE_TABLES.map(...)` / `union all` query.
- `artifacts/api-server/src/services/diagnostics-ibkr-metrics.test.ts` adds a retired-IBKR bridge diagnostic test, not storage-census coverage.

Provenance evidence:
- `docs/plans/lane-classification.md:100` classifies `diagnostics-ibkr-metrics.test.ts` as `ibkr-datapath-removal` and says it does not depend on the session diffs.
- `docs/plans/lane-classification.md:153` classifies `diagnostics.ts` as batching `buildMonitoredStorageTableStats` N+1 queries into one query.
- `git diff` grep observed no SnapTrade/backtest/overnight/flow hunk content for the Unit 1 files, but the test file did not pair with the storage hunk.

Verify tails:

```text
$ pnpm --filter @workspace/api-server run typecheck
> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit
EXIT=0
```

```text
$ pnpm --filter @workspace/api-server exec vitest run src/services/diagnostics-ibkr-metrics.test.ts
undefined
/home/runner/workspace/artifacts/api-server:
ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "vitest" not found
EXIT=254
```

## Unit 2 - automation execution-events read coalescing

Verdict: left dirty.

Observed hunks:
- `artifacts/api-server/src/services/automation.ts` adds normalized list-event input, a 2s `executionEventsListCache`, `executionEventsListInFlight`, and test hooks.
- `artifacts/api-server/src/services/automation.merge-events.test.ts` adds cache sharing and cache-key tests for `listExecutionEvents`.

Provenance evidence:
- `docs/plans/lane-classification.md:152` classifies `automation.ts` plus `automation.merge-events.test.ts` as TTL cache + in-flight dedup for `listExecutionEvents`.
- `.codex-watch/db-census-2026-07-07.md:58` identifies the root read-fanout issue as 3 independent pollers with 0 sharing.
- `.codex-watch/db-census-2026-07-07.md:72` names S6 as shared cache on `listExecutionEvents`.

Verify tails:

```text
$ pnpm --filter @workspace/api-server run typecheck
> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit
EXIT=0
```

```text
$ pnpm --filter @workspace/api-server exec vitest run src/services/automation.merge-events.test.ts
undefined
/home/runner/workspace/artifacts/api-server:
ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "vitest" not found
EXIT=254
```

## Unit 3 - universe optionability schema + migration

Verdict: committed `bef57303`.

Committed paths:
- `lib/db/src/schema/universe.ts`
- `lib/db/migrations/20260707_universe_catalog_optionable_partial_idx.sql`

Left dirty by design:
- `lib/db/src/schema/index.ts` because its only dirty hunk is `export * from "./overnight-signal-expectancy";`, serving the held overnight lane.

Provenance evidence:
- `git status --porcelain=v1 -- lib/db/src/schema/universe.ts lib/db/src/schema/index.ts lib/db/migrations/20260707_universe_catalog_optionable_partial_idx.sql` confirmed the exact untracked universe migration path.
- `docs/plans/lane-classification.md:150` classifies `lib/db/src/schema/universe.ts` plus the new universe migration as Census S14 partial-index work.
- `.codex-watch/db-census-2026-07-07.md:80` describes S14 as an expression/partial index or maintained optionable boolean for the shared JSONB-regex optionability predicate.
- The migration was committed only; it was not applied to the DB.

Verify tails:

```text
$ pnpm run typecheck:libs
> workspace@0.0.0 typecheck:libs /home/runner/workspace
> node scripts/run-validation-command.mjs --label typecheck:libs -- tsc --build
EXIT=0
```

```text
$ pnpm --filter @workspace/api-server run typecheck
> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit
EXIT=0
```

Staging evidence before commit:

```text
$ git diff --cached --name-status
A	lib/db/migrations/20260707_universe_catalog_optionable_partial_idx.sql
M	lib/db/src/schema/universe.ts

$ git diff --cached --check
EXIT=0

$ git diff --cached | rg -i "password|secret|api_key|token"
EXIT=1 (no matches)
```

Commit:

```text
bef57303 feat(db-schema): universe catalog optionability columns + partial index migration, manual-apply (WO-R4)
2 files changed, 40 insertions(+)
```

## Final state notes

Observed after the Unit 3 commit, before a later unrelated commit landed:
- `git diff --cached --name-status` showed unrelated staged files outside WO-R4: `artifacts/api-server/src/services/option-chain-policy.test.ts` and `artifacts/api-server/src/services/platform.ts`. I did not stage, unstage, edit, or commit those files.

Observed in final sanity check:
- WO-R4 dirty files remaining: `diagnostics.ts`, `diagnostics-ibkr-metrics.test.ts`, `automation.ts`, `automation.merge-events.test.ts`, and `lib/db/src/schema/index.ts`.
- `git diff --cached --name-status` is empty.
- HEAD advanced to unrelated commit `24b18d9d`; WO-R4 Unit 3 commit `bef57303` remains in history immediately before it.
