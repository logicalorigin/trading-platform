# Whole-Repo Code Review And Quality Audit

Date: 2026-06-04

Scope: review the current repository state for correctness, security, architecture, performance, and verification risk. This audit was run against the dirty workspace state, not only the last signal-monitor change.

## Bottom Line

The Signal Monitor / STA exact-cell path currently looks healthy under direct scoped tests. The blocking issues are broader backend safety and quality-gate failures:

- The main API lacks a default authentication boundary while exposing trading, settings, and automation mutations.
- Order cancellation does not carry or resolve the target order mode before live-confirm gating.
- Several API unit suites fail in isolation and should be fixed before using the repo as a clean merge base.

## Findings

### 1. Main API Has No Default Auth Boundary

Severity: critical

Evidence:

- `artifacts/api-server/src/app.ts:102` enables default `cors()` with no origin restriction.
- `artifacts/api-server/src/app.ts:107` mounts `/api` without an authentication or authorization middleware in front of the main router.
- Sensitive mutation routes are reachable inside the main API tree:
  - `artifacts/api-server/src/routes/platform.ts:1553` posts broker orders.
  - `artifacts/api-server/src/routes/platform.ts:1600` cancels broker orders.
  - `artifacts/api-server/src/routes/settings.ts:354` applies backend settings.
  - `artifacts/api-server/src/routes/settings.ts:358` runs backend actions.
  - `artifacts/api-server/src/routes/automation.ts:162` creates algo deployments.
  - `artifacts/api-server/src/routes/automation.ts:192` enables deployments.

Impact:

If the API is reachable from a browser or network, any origin can invoke trading, settings, and automation actions. Some trading paths require `confirm: true`, but that is not authentication and does not stop cross-origin or direct unauthenticated calls.

Required fix:

Add a default API authentication and authorization middleware before sensitive routes. Restrict CORS to trusted origins. Keep only explicitly public routes, such as health/readiness/static assets, outside the auth boundary.

### 2. Cancel Order Safety Depends On Runtime Mode Instead Of Order Mode

Severity: required

Evidence:

- `lib/api-zod/src/generated/api.ts:2370` defines `CancelOrderBody` without `mode`.
- `artifacts/api-server/src/routes/platform.ts:1600` parses that body and forwards no mode to `cancelOrder`.
- `artifacts/api-server/src/services/platform.ts:4605` gates cancellation with `assertLiveOrderConfirmed(getRuntimeMode(), input.confirm)`.
- The account-scoped cancel path has the same runtime-mode pattern at `artifacts/api-server/src/services/account.ts:4960`.
- Place and replace paths do carry mode:
  - `artifacts/api-server/src/services/platform.ts:4549`
  - `artifacts/api-server/src/services/platform.ts:4586`

Impact:

Cancel behavior can be wrong whenever the target order/account mode differs from process runtime mode. A paper cancel can be forced through live confirmation, or a live cancel can avoid live confirmation if runtime mode is paper.

Required fix:

Carry `mode` through the cancel request schema, client, route, and service, or resolve the target order's actual mode server-side before the confirmation guard. The guard should operate on the order being canceled, not global runtime state.

### 3. Flow Premium Distribution Tests Disable Their Own Massive Mock Path

Severity: required

Evidence:

- `artifacts/api-server/src/services/flow-premium-distribution.test.ts:26` defines `configureMassiveEnv`.
- The helper sets `process.env.MASSIVE_API_KEY = "test-massive-key"` at line 27, then immediately deletes `MASSIVE_API_KEY` at line 29.
- `artifacts/api-server/src/services/platform.ts:12395` returns the unconfigured response when Massive runtime config is absent.
- Direct isolated run fails all seven tests in this file with `status: "unconfigured"` instead of the expected configured path.

Impact:

The flow premium distribution test file cannot validate the intended Massive-backed behavior. It currently fails in isolation and blocks the API unit gate.

Required fix:

Fix `configureMassiveEnv` so it leaves exactly one Massive key configured for tests. Then rerun the isolated file and the API unit suite.

### 4. Option Chain And Bars Fallback Tests Fail In Isolation

Severity: required

Evidence from direct isolated `option-chain-batch.test.ts` run:

- `artifacts/api-server/src/services/option-chain-batch.test.ts:544` expected full broker recovery to return 120 bars; actual result returned 2.
- `artifacts/api-server/src/services/option-chain-batch.test.ts:875` expected broker live-edge backfill to merge to 4 bars; actual result returned 2.
- `artifacts/api-server/src/services/option-chain-batch.test.ts:894` expected a retry after a quick empty broker result; actual broker call count was 1 instead of 2.
- `artifacts/api-server/src/services/option-chain-batch.test.ts:1452` expected visible chart cache status to be `miss`; actual status was `hit`.
- `artifacts/api-server/src/services/option-chain-batch.test.ts:1672` expected batch option-chain concurrency cap of 1; actual max active count was 2.

Impact:

The historical bars and option-chain fallback rules are not matching the current tests. This affects live chart hydration, Massive fallback, broker recovery, and upstream concurrency expectations.

Required fix:

Decide whether the implementation or tests are stale. If behavior changed intentionally, update the tests and document the new fallback contract. If not, restore the broker recovery, retry, cache-scope, and concurrency behavior expected by the tests.

### 5. Retained Flow Scanner Option Quote Stream Leases Fail In Isolation

Severity: required

Evidence from direct isolated `bridge-option-quote-stream.test.ts` run:

- `artifacts/api-server/src/services/bridge-option-quote-stream.test.ts:613` expected retained snapshot demand to open a bridge stream for matching contracts; diagnostics never reached the expected union count.
- `artifacts/api-server/src/services/bridge-option-quote-stream.test.ts:640` expected stream reconfiguration from `["2211"]` to `["2211", "2212"]`; actual stream requests became `["2211"]`, then `["2212"]`.
- `artifacts/api-server/src/services/bridge-option-quote-stream.test.ts:696` expected retained leases to open streams while hydration was in flight; diagnostics did not reach the expected union count.

Impact:

Flow scanner option quote demand may not retain or union active provider-contract streams correctly. That can reduce quote freshness for scanner-owned contracts and cause avoidable churn in bridge subscriptions.

Required fix:

Audit retained snapshot demand lease ownership and stream union reconciliation. The retained scanner lease should keep previous contracts active while adding new scanner demand, unless the lease expired or was explicitly released.

### 6. Route Timeout Wrappers Are Mixed Abortable And Non-Abortable

Severity: consider

Evidence:

- `artifacts/api-server/src/routes/automation.ts:53` implements `withSignalOptionsRouteTimeout` with `Promise.race` and no abort signal.
- `artifacts/api-server/src/routes/automation.ts:81` implements an abortable variant.
- State and cockpit routes use the non-abortable helper:
  - `artifacts/api-server/src/routes/automation.ts:229`
  - `artifacts/api-server/src/routes/automation.ts:257`
- Shadow scan and overnight scan routes use the abortable helper:
  - `artifacts/api-server/src/routes/automation.ts:297`
  - `artifacts/api-server/src/routes/automation.ts:335`

Impact:

State and cockpit requests can return a 504 while underlying dashboard/state work continues. Some dashboard builders intentionally continue and serve stale/cold fallbacks, so this is not automatically a bug. It is still worth tightening if route pressure and long-running background work are known operational problems.

Recommended fix:

Document which dashboard routes are allowed to continue in the background. For routes that should stop at the route budget, pass an `AbortSignal` through the state/cockpit builders and use the abortable helper.

## Not Elevated

### Signal Monitor / STA Exact-Cell Path

The current `artifacts/api-server/src/services/signal-monitor.ts` source includes `cells` in the exact-cell cap input and tests cover the foreground leader and STA-visible exceptions.

Direct scoped tests passed:

- `node --import tsx --test src/services/signal-monitor.test.ts` from `artifacts/api-server`: 77 passed.
- `node --import tsx --test src/screens/algo/OperationsSignalRow.test.js` from `artifacts/pyrus`: 27 passed.

### Photonics Observatory Tooltip `innerHTML`

`artifacts/pyrus/src/features/research/PhotonicsObservatory.jsx:3807` is the only frontend `innerHTML` occurrence found. The strings in that tooltip appear to come from authored research data plus formatted numeric values. This is worth replacing with DOM/text nodes eventually, but it was not elevated above the backend blockers in this pass.

## Verification Run

Passed:

- `pnpm --filter @workspace/api-server run typecheck`
- `pnpm --filter @workspace/pyrus run typecheck`
- `node --import tsx --test src/services/signal-monitor.test.ts` from `artifacts/api-server`
- `node --import tsx --test src/screens/algo/OperationsSignalRow.test.js` from `artifacts/pyrus`
- `pnpm run audit:replit-startup` as part of root `pnpm run typecheck`

Blocked by runtime guard:

- `pnpm run typecheck` stopped before `typecheck:libs` with exit code 75 because live PYRUS/Replit runtime was hot. I did not override `PYRUS_ALLOW_HOT_VALIDATION`.

Failed:

- `node --import tsx --test src/services/flow-premium-distribution.test.ts`: 7 failed, all caused by Massive config being deleted in the test helper.
- `node --import tsx --test src/services/option-chain-batch.test.ts`: 5 failed around broker/Massive bar recovery, cache scope, and upstream concurrency.
- `node --import tsx --test src/services/bridge-option-quote-stream.test.ts`: 3 failed around retained flow-scanner quote leases and stream unioning.
- Package `test:unit` scripts run hard-coded full suites and ignore file arguments. They reproduced the same API failures, plus the frontend full suite includes brittle source-shape checks in `TradeScreen.search-handlers.test.mjs`.

## Recommended Fix Order

1. Add the main API auth/CORS boundary.
2. Fix cancel-order mode propagation or server-side mode resolution.
3. Repair `flow-premium-distribution.test.ts` Massive test setup.
4. Resolve option-chain/bars fallback test failures.
5. Resolve retained flow-scanner option quote lease failures.
6. Decide and document route timeout continuation rules.
