# WO-P1-T1c3 Report

## Result

Updated `artifacts/api-server/src/routes/account-positions-route.test.ts` to replace the brittle admission-guard source regex with request-level coverage.

Observed behavior now tested:

- Forced-deny account admission returns `503`.
- Protected account routes and account streams do not invoke their underlying account/stream service function after denial.
- A leaked service invocation increments the tracked service call counter and fails the test.

Included protected `POST /accounts/:accountId/orders/:orderId/cancel` because it uses the same admission guard before `cancelAccountOrder`.

## Validation

Command:

```sh
pnpm --filter @workspace/api-server exec node --experimental-test-module-mocks --import tsx --test src/routes/account-positions-route.test.ts
```

Output:

```text
(node:82194) ExperimentalWarning: Module mocking is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
✔ account positions route supports explicit quote and fast-detail controls (0.737528ms)
✔ real account routes and streams short-circuit account services when admission is denied (375.965909ms)
✔ public Trade option-chain routes avoid artificial metadata waits (0.389657ms)
✔ option-chain stream announces readiness before background snapshots (0.125683ms)
✔ session route re-merges runtime.ibkr passthrough fields stripped by zod (0.199145ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2428.13596
```

No browser, Playwright, e2e, project-wide typecheck, or full-suite test was run.
