# Algo Flicker Investigation - 2026-07-07

## Observed render path

- `artifacts/pyrus/src/screens/AlgoScreen.jsx:563` calls `useListAlgoDeployments`.
- `artifacts/pyrus/src/screens/AlgoScreen.jsx:575` derives `deployments` from `deploymentsQuery.data?.deployments || EMPTY_ALGO_DEPLOYMENTS`.
- `artifacts/pyrus/src/screens/AlgoScreen.jsx:669` marks setup settled when the deployment query has data/is fetched/is error, except for the prior `cacheStatus: "unavailable"` empty-data guard.
- `artifacts/pyrus/src/screens/AlgoScreen.jsx:2015` passes `deployments`, `setupDataSettled`, `deploymentListUnavailable`, and `refreshPending={deploymentsQuery.isFetching || cockpitQuery.isFetching}` into `AlgoLivePage`.
- `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx:73` renders `EmptyOperationsState`; when `setupDataSettled` is true and no drafts/deployments exist, the user-facing branch is "Signal-Options Deployment Unavailable" / "No signal-options deployments are available yet...".
- Before this fix, `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx:834` returned that empty state whenever `setupDataSettled && !deployments.length`.

## Phase to query-state mapping

1. Old/cached control panel:
   - Observed source path: `deploymentsQuery.data?.deployments` can be present from React Query cache, and `focusedDeployment` falls back to `deployments[0]` in `AlgoScreen.jsx:591`.
   - Inferred state: cached deployment/settings payload paints the control panel before the fresh deployment read settles.

2. Blank / no deployment available:
   - Observed source path before fix: if `deployments` becomes `[]` while `setupDataSettled` is true, `AlgoLivePage` returns the no-deployment `EmptyOperationsState`.
   - Inferred state: a refetch/dependent transition temporarily exposes no deployment rows while the query is still fetching or carrying an empty fallback payload. The guard treated that transient as a final empty list.

3. Correct control panel:
   - Observed source path: once `deploymentsQuery.data.deployments` contains rows again, `showEmptyOperationsState` is false and `focusedDeployment` resolves to the selected/current deployment.
   - Inferred state: fresh live deployment/settings data wins after the transition.

## Prior fix

- Prior-fix commit found: `81ffd29e fix: stabilize pyrus startup and signal rows`.
- Mechanism observed in current blame/source: it added the deployment-list unavailable guard now at `AlgoScreen.jsx:577-580` and settlement logic at `AlgoScreen.jsx:669-673`, so an empty `cacheStatus: "unavailable"` deployment response does not immediately become the create/no-deployment branch.
- Current status: today's `62045a84` per-account-tabs change and `4feae5d4` auth-session dedupe did not directly remove that guard. The regression path bypassed it: the child empty-state guard still treated a transient empty `deployments` array as final whenever setup was otherwise settled. `b414fa0c` only changed app-shell chunk retry behavior, not this in-page deployment path.

## Applied diff

- `artifacts/pyrus/src/screens/AlgoScreen.jsx`: added `placeholderData: retainPreviousData` to `useListAlgoDeployments`, aligning the deployment list with the existing previous-data pattern used by other algo queries.
- `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx`: changed the no-deployment branch to pass `setupDataSettled && !refreshPending` into `EmptyOperationsState`. When the deployment list is empty during an in-flight refresh, the branch now renders "Loading Signal Operations" instead of "Signal-Options Deployment Unavailable".
- Tests added:
  - `artifacts/pyrus/src/screens/AlgoScreen.test.mjs`: pins `placeholderData: retainPreviousData` on the deployments query.
  - `artifacts/pyrus/src/screens/algo/AlgoLivePage.test.mjs`: pins that deployment refetch gaps are treated as loading, not settled no-deployment.

## Validation

- `pnpm --filter @workspace/pyrus exec tsx --test src/screens/AlgoScreen.test.mjs src/screens/algo/AlgoLivePage.test.mjs`
  - PASS: 19 tests, 19 pass, 0 fail.
- `pnpm --filter @workspace/pyrus run typecheck`
  - PASS: `tsc -p tsconfig.json --noEmit`, 0 errors.

## Scope notes

- No app restart.
- No DB writes.
- No commits or pushes.
