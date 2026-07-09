# Task #3 Completion Report - 2026-07-07

Agent: codex-worker  
Leader: claude-lead  
Scope: broker account categorization/inclusion tests, algo per-account tab tests, env-mode evidence, retired generated IBKR lane/line-usage spec cleanup.

## Outcomes

1. Service tests
   - Added `artifacts/api-server/src/services/broker-account-inclusion.test.ts`.
   - Covered `listBrokerAccountInclusions` returning provider/mode/display/category/inclusion/update fields.
   - Covered `setBrokerAccountInclusions` ignoring duplicate, unknown, and foreign account IDs.
   - Covered persistence round-trip, including clearing all included accounts.

2. Route tests
   - Extended `artifacts/api-server/src/routes/broker-execution.test.ts`.
   - Covered `GET /broker-execution/included-accounts` authentication and entitlement gates.
   - Covered `POST /broker-execution/included-accounts` CSRF gate.
   - Covered authenticated broker-connect happy path for list and persisted selection update.

3. SnapTrade sync tests
   - Extended `artifacts/api-server/src/services/snaptrade-account-sync.test.ts`.
   - Covered newly inserted accounts:
     - `Webull Individual Cash` -> `accountType: equity`, `includedInTrading: true`.
     - `Webull Futures` -> `accountType: futures`, `includedInTrading: false`.
     - `Webull Events Cash` -> `accountType: prediction`, `includedInTrading: false`.
   - Covered re-sync preserving a manual `included_in_trading = false` choice.
   - Rename-reclassification flag: observed current behavior reclassifies on update. When the existing account display name changed from `Webull Individual Cash` to `Webull Crypto Cash`, the persisted and returned `accountType` changed from `equity` to `crypto`, while `includedInTrading` remained the manually set `false`. Therefore a renamed account that gains `Crypto` does not fail to reclassify under current code.

4. Frontend tests
   - Extended `artifacts/pyrus/src/screens/algo/AlgoLivePage.test.mjs`.
   - Extended `artifacts/pyrus/src/screens/algo/OperationsPositionsTable.test.mjs`.
   - Pinned:
     - Shadow tab passes `signalOptionsPositions`, `focusedDeploymentId`, `filterByDeployment`, and `Shadow algo positions`.
     - Live/broker tabs pass empty overlay positions, no deployment filter, and `Broker positions`.
     - `OperationsPositionsTable` filters account rows only when `filterByDeployment` is true and sends the selected source label into `PositionsPanel.rightRail`.

5. ENV-mode account evidence
   - Observed chain:
     - `artifacts/pyrus/src/features/platform/PlatformApp.jsx:1954-1964` fetches accounts with `{ mode: sessionQuery.data?.environment || "shadow" }`.
     - `artifacts/pyrus/src/features/platform/PlatformApp.jsx:5115-5124` passes that `accounts` array to `PlatformScreenRouter`.
     - `artifacts/pyrus/src/features/platform/PlatformScreenRouter.jsx:292-295` passes `accounts={accounts}` into `MemoAlgoScreen`.
     - `artifacts/pyrus/src/screens/AlgoScreen.jsx:428-443` defaults the algo account tab to `shadow` and derives live account IDs from the passed `accounts` list.
     - `artifacts/pyrus/src/screens/AlgoScreen.jsx:641-653` fetches positions with `mode: "shadow"` for the shadow tab and `mode: environment || "live"` for broker/live tabs.
     - `artifacts/pyrus/src/screens/AlgoScreen.jsx:2054-2059` passes `positionAccounts={accounts}` and `positionAccountUsesShadowOverlay={algoPositionsUseShadowOverlay}` to `AlgoLivePage`.
     - `artifacts/api-server/src/services/account.ts:4471-4498` keeps `/accounts` mode-scoped through `listAccounts`.
     - `artifacts/api-server/src/services/account.ts:4199-4224` includes SnapTrade-backed accounts only when `broker_accounts.mode = mode`, `included_in_trading = true`, provider is `snaptrade`, and connection is `connected`.
   - Conclusion: algo tabs use the environment-mode account list, and SnapTrade accounts reaching that list are already filtered by `included_in_trading`.

6. Retired generated IBKR lane/line-usage cleanup
   - Confirmed retired OpenAPI paths existed:
     - `/settings/ibkr-lanes`
     - `/settings/ibkr-line-usage`
     - `/settings/ibkr-line-usage/stream`
   - Removed those paths from `lib/api-spec/openapi.yaml`.
   - Regenerated clients via `pnpm --filter @workspace/api-spec run codegen`.
   - Confirmed no generated client/spec references remain for `getIbkrLineUsage`, `streamIbkrLineUsage`, `getIbkrLaneArchitecture`, `updateIbkrLaneArchitecture`, `ibkr-line-usage`, or `ibkr-lanes`.
   - `scripts/package.json` still has `ibkr:line-usage-monitor`, but `scripts/src/ibkr-line-usage-monitor.ts` exists, so I did not remove the script entry.
   - I did not remove IBKR portal/OAuth/account-bridge/bridge-stream schemas or routes. Broader desktop-agent/activation schemas are still referenced by `SessionIbkrRuntime` and removing them would affect kept surfaces.

## Validation

- `pnpm --filter @workspace/api-server exec tsx --test src/services/broker-account-inclusion.test.ts`
  - Pass: 3 tests.
- `pnpm --filter @workspace/api-server exec tsx --test src/services/snaptrade-account-sync.test.ts`
  - Pass: 4 tests.
- `pnpm --filter @workspace/api-server exec tsx --test src/routes/broker-execution.test.ts`
  - Pass: 43 tests.
- `pnpm --filter @workspace/pyrus exec tsx --test src/screens/algo/AlgoLivePage.test.mjs src/screens/algo/OperationsPositionsTable.test.mjs`
  - Pass: 11 tests.
- `pnpm --filter @workspace/api-server run typecheck`
  - Pass: 0 TypeScript errors.
- `pnpm --filter @workspace/pyrus run typecheck`
  - Pass: 0 TypeScript errors.
- `pnpm --filter @workspace/api-spec run codegen`
  - Pass. Orval regenerated clients and the command's built-in `typecheck:libs` completed successfully.

Note: I first tried `pnpm --filter @workspace/pyrus exec node --test ...`; that is not the correct runner for `AlgoLivePage.test.mjs` because it imports `.jsx`. The passing Pyrus command above uses `tsx --test`.

## Scoped Status

Observed scoped status for this lane includes only the requested test files plus OpenAPI/generated files:

- `artifacts/api-server/src/services/broker-account-inclusion.test.ts`
- `artifacts/api-server/src/routes/broker-execution.test.ts`
- `artifacts/api-server/src/services/snaptrade-account-sync.test.ts`
- `artifacts/pyrus/src/screens/algo/AlgoLivePage.test.mjs`
- `artifacts/pyrus/src/screens/algo/OperationsPositionsTable.test.mjs`
- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-zod/src/generated/api.ts`
- regenerated `lib/api-zod/src/generated/types/*` files
- `.codex-watch/task3-completion-report-2026-07-07.md`

The overall worktree remains dirty from other lanes, including out-of-lane files that I did not touch or revert.

## Blockers / Out-of-Scope Observations

- No blockers.
- Did not restart/rebuild the app.
- Did not kill processes.
- Did not run DDL or migrations.
- Did not commit.
