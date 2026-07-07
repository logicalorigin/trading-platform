# WO-18 Robinhood Accounts Report - 2026-07-07

## Source Added

- Added `getRobinhoodBackedAccounts(mode)` in `artifacts/api-server/src/services/account.ts`.
- The source reads `broker_accounts` joined to `broker_connections` with:
  - current app-user scope via `ownedBy(brokerAccountsTable)` and `ownedBy(brokerConnectionsTable)`;
  - `broker_connections.broker_provider = 'robinhood'`;
  - `broker_connections.status = 'connected'`;
  - matching `broker_accounts.mode`;
  - `broker_accounts.included_in_trading = true`.
- It maps rows to `BrokerAccountSnapshot` with `provider: "robinhood"`, persisted display/account metadata, `includedInTrading`, `accountStatus`, `capabilities`, `executionBlockers`, derived `agentic`, and derived `executionReady`.

## SnapTrade Parity

- Mirrors the SnapTrade backed-account pattern by using persisted `broker_accounts`/`broker_connections` as the account source, returning zero-filled snapshots when live balances are unavailable, and degrading merge failures to an empty provider list.
- Robinhood does not call a balance API. Observed existing sync source (`robinhood-account-sync.ts`) reads account metadata through MCP `get_accounts`; no implemented Robinhood balance source was found in this work path. Robinhood account-list balances therefore remain `0`/null fields rather than failing the account list.

## Mode Finding

- The source filters by the requested `mode`.
- Read-only DB check observed both verified Robinhood rows as `mode = 'live'`, so they will be returned for live account-list requests. I did not change mode semantics.

## Merge Points

- `listAccountsUncached` now resolves Robinhood accounts in parallel with SnapTrade accounts.
- Robinhood is merged into:
  - the live-IBKR-wins branch;
  - the persisted fallback branch;
  - the Flex fallback branch;
  - the provider-only final branch.
- The merge uses the same `.catch(() => [])` failure-tolerance pattern as SnapTrade.
- `withTradingInclusionDefault` still wraps the final merged list.

## Contract Note

- Updated `lib/ibkr-contracts/src/client.ts` so `BrokerAccountSnapshot.provider` includes `robinhood` and `schwab`, matching the already-generated `ListAccountsResponse` zod schema. Without this adjacent type update, `provider: "robinhood"` would compile only via an unsafe cast.

## Tests / Validation

- Passed: `pnpm --filter @workspace/api-server run typecheck`
- Passed: `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/account-list-snaptrade-merge.test.ts`
- Passed earlier combined account-related command:
  `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/account-list-snaptrade-merge.test.ts src/services/robinhood-account-sync.test.ts src/services/broker-account-inclusion.test.ts`
- Added unit coverage proving `listAccounts` includes a Robinhood account and preserves `provider: "robinhood"` instead of labeling it `ibkr`.

## DB Sanity

Read-only DB query for connection `b841980e-be3f-4546-820e-670982efaa6d` observed 2 connected live Robinhood accounts for app user `272b0024-e3a5-4edd-abac-e3bca9c8e125`:

- `robinhood:560316630`: `included_in_trading = true`, `account_status = open`, blockers `robinhood.order_tooling_unverified`, `robinhood.account.non_agentic`; derived non-agentic.
- `robinhood:727958282`: display name `Agentic`, `included_in_trading = true`, `account_status = open`, blocker `robinhood.order_tooling_unverified`; derived agentic.

Given the new source under the same current-user scope and `mode = live`, those two rows would be returned with `provider: "robinhood"`.

## Scope / Collision

- Required pre-edit `git diff -- artifacts/api-server/src/services/account.ts` was clean.
- Touched files for this work:
  - `artifacts/api-server/src/services/account.ts`
  - `artifacts/api-server/src/services/account-list-snaptrade-merge.test.ts`
  - `lib/ibkr-contracts/src/client.ts`
  - `.codex-watch/wo-18-robinhood-accounts-report-2026-07-07.md`
- Did not touch signal-options, signal-monitor, backtesting, or backtest-worker files. Existing dirty changes in those areas were present before this lane and were left untouched.

## Commit

- Committed as `feat(api): surface Robinhood accounts in the account list`.
- Exact final commit hash is reported out-of-band because embedding this commit's own final hash in this file would change that hash.
