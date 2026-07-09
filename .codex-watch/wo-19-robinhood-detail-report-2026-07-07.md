# WO-19 Robinhood Account Detail Report - 2026-07-07

## Summary

- Wired Robinhood account-list snapshots to live `get_portfolio` balances through `RobinhoodMcpSession`.
- Fixed account detail resolution for Robinhood broker account UUIDs by adding a provider-backed resolver branch before Flex fallback.
- Removed the default legacy persisted balance-snapshot fallback that mapped arbitrary persisted broker accounts through the IBKR-labeled snapshot mapper.
- Commit: `d580b00c0c466608dcd77ebd1bd2662b98c0af47`

## Balance Wiring

- `getRobinhoodBackedAccounts("live")` now reads connected Robinhood `broker_accounts`, keeps the local broker account UUID as `id`, and hydrates balances with `applyRobinhoodAccountBalances`.
- MCP call shape used: one `RobinhoodMcpSession` per app user per hydration pass, calling:

```ts
await session.callTool({
  name: "get_portfolio",
  arguments: { account_number },
});
```

- Stored `providerAccountId` values with the local `robinhood:` prefix are stripped only for the MCP `account_number` argument.
- Parsed balance shape: `data.total_value` -> `netLiquidation`, `data.cash` -> `cash`, `data.buying_power.buying_power` -> `buyingPower`, `data.currency` or `data.buying_power.display_currency` -> `currency`.
- Failures degrade per account to the zero-filled snapshot and log once per 45s cache window. Successful balances are cached per local broker account UUID for 45s.

## Detail Resolver

- `readLiveAccountUniverseUncached` no longer tries the legacy persisted snapshot branch after IBKR-live misses.
- It now resolves provider-backed accounts from SnapTrade and Robinhood before Flex.
- Robinhood detail matching is by `BrokerAccountSnapshot.id` (the `broker_accounts.id` UUID used by `listAccounts`), not by `providerAccountId`.
- Provider-backed Robinhood/SnapTrade universes return empty positions/orders instead of calling the IBKR bridge with non-IBKR IDs.

## Positions

- Deferred. The clean fix for WO-19 was to stop the 404 and surface balances. Wiring `get_equity_positions` and `get_option_positions` needs a Robinhood position normalizer into `BrokerPositionSnapshot` and quote/open-date behavior decisions; that would touch a wider positions path.

## IBKR Fallback Removal

- Removed production use of `getPersistedBackedAccounts`, the fallback that selected persisted `balance_snapshots` for any broker account and converted them via `persistedAccountRowsToSnapshots`, which hardcodes `provider: "ibkr"`.
- `listAccounts` now defaults that fallback to empty and still merges proper provider sources: live IBKR, SnapTrade, Robinhood, then Flex where applicable.
- The persisted snapshot mapper remains available for existing history/model internals tests, but it is no longer the default list/detail source for broker accounts.

## Verification

- `pnpm --filter @workspace/api-server run typecheck` passed.
- `pnpm --filter @workspace/api-server exec tsx --test src/services/account-list-snaptrade-merge.test.ts` passed: 16 tests.
- `pnpm --filter @workspace/api-server exec tsx --test src/services/account-list-snaptrade-merge.test.ts src/services/robinhood-account-sync.test.ts src/services/snaptrade-account-portfolio.test.ts` passed: 23 tests.
- Scope check: `git diff --check -- artifacts/api-server/src/services/account.ts artifacts/api-server/src/services/account-list-snaptrade-merge.test.ts` passed.

## Live Read-Only Probe

Command used the actual `getRobinhoodBackedAccounts("live")`, then resolved the agentic account by returned broker-account UUID through the uncached detail resolver.

Observed:

```json
{
  "count": 2,
  "accounts": [
    {
      "id": "31b5eff1-e7df-48fe-b49b-5c9f3a79298b",
      "providerAccountId": "robinhood:560316630",
      "provider": "robinhood",
      "netLiquidation": 10,
      "cash": 10,
      "buyingPower": 10,
      "currency": "USD"
    },
    {
      "id": "73025d5d-2a63-4700-ad48-fb84aa08fa6f",
      "providerAccountId": "robinhood:727958282",
      "provider": "robinhood",
      "netLiquidation": 40,
      "cash": 40,
      "buyingPower": 40,
      "currency": "USD"
    }
  ],
  "detail": {
    "requestedAccountId": "73025d5d-2a63-4700-ad48-fb84aa08fa6f",
    "accountIds": ["73025d5d-2a63-4700-ad48-fb84aa08fa6f"],
    "source": "robinhood",
    "netLiquidation": 40,
    "cash": 40,
    "buyingPower": 40,
    "currency": "USD"
  }
}
```

## Lane Collisions

- No overlapping foreign hunks in `artifacts/api-server/src/services/account.ts` before editing.
- Pre-existing dirty worktree changes remain in unrelated handoff, signal, platform, backtest, UI, db schema, and market-calendar files. They were not touched.
