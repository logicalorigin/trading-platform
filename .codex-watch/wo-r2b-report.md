# WO-R2B Report

Worker: wo-r2b
Outcome: no commit created; verify failed before staging/commit.
HEAD at stop: 8e9504fb
Commit SHA: n/a

## Pre-commit Guards

Relocation-pair check:

```text
PASS matched backoff +/- pairs; matched_lines=0
```

Hunk floor:

```text
@@ -8340,0 +8341 @@ type GetBarsInput = {
@@ -8522,0 +8524 @@ const DEFAULT_BARS_LIMIT = 200;
@@ -9055,0 +9058 @@ const BARS_BACKGROUND_PERSIST_CONCURRENCY_MAX = 4;
```

Status for the five authorized paths:

```text
 M artifacts/api-server/src/routes/platform-sparkline-seed.test.ts
 M artifacts/api-server/src/routes/platform.ts
 M artifacts/api-server/src/services/market-data-store.ts
 M artifacts/api-server/src/services/platform-bars-background-persist.test.ts
 M artifacts/api-server/src/services/platform.ts
```

Cached diff at stop:

```text
```

## Verify

Typecheck:

```text
pnpm --filter @workspace/api-server run typecheck
EXIT=0
```

Targeted tests:

```text
pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/platform-bars-background-persist.test.ts src/routes/platform-sparkline-seed.test.ts
EXIT=1
```

Targeted test output tail:

```text
✔ sparkline seed reads live edge from memory instead of live bar_cache source (0.796738ms)
✔ sparkline seed cache stores history only and merges live memory per request (0.206362ms)
✔ sparkline seed coalesces duplicate in-flight backfills (0.23119ms)
✔ sparkline seed uses one bounded DB backfill path for cache misses (0.354896ms)
✔ sparkline seed DB batch size turns 96 symbols into 2 chunks (0.962711ms)
✔ sparkline seed returns live misses while scheduling historical backfill (0.202822ms)
✖ runtime diagnostics route supports compact polling (2.208575ms)
✔ background bar-cache persists drain one at a time by default (13.41077ms)
✔ background bar-cache persist contention skips are not counted as failures (0.413523ms)
✔ background bar-cache persist replaces duplicate pending windows (0.649121ms)
✔ background bar-cache persist queue drops oldest entry at the cap (7.128325ms)
ℹ tests 11
ℹ suites 0
ℹ pass 10
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8262.766488

✖ failing tests:

test at src/routes/platform-sparkline-seed.test.ts:1:4101
✖ runtime diagnostics route supports compact polling (2.208575ms)
  AssertionError [ERR_ASSERTION]: Missing runtime diagnostics route end marker
      at TestContext.<anonymous> (/home/runner/workspace/artifacts/api-server/src/routes/platform-sparkline-seed.test.ts:101:10)
      at Test.runInAsyncScope (node:async_hooks:214:14)
      at Test.run (node:internal/test_runner/test:1106:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:788:18)
      at Test.postRun (node:internal/test_runner/test:1235:19)
      at Test.run (node:internal/test_runner/test:1163:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:788:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: -1,
    expected: -1,
    operator: 'notStrictEqual',
    diff: 'simple'
  }
undefined
/home/runner/workspace/artifacts/api-server:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: tsx --test --test-force-exit src/services/platform-bars-background-persist.test.ts src/routes/platform-sparkline-seed.test.ts
```
