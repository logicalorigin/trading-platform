import assert from "node:assert/strict";
import test from "node:test";

import {
  balanceSnapshotsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import type { BrokerAccountSnapshot } from "../providers/ibkr/client";

import {
  __accountPositionInternalsForTests,
  __accountUniverseInternalsForTests,
  applyRobinhoodAccountBalances,
  applySnapTradeAccountBalances,
  listAccounts,
} from "./account";
import { runAsAppUser } from "./app-user-context";
import {
  __snapTradeAccountPortfolioInternalsForTests,
  type SnapTradeAccountPortfolioResponse,
} from "./snaptrade-account-portfolio";

function snapshot(
  id: string,
  provider: "ibkr" | "snaptrade" | "robinhood",
): BrokerAccountSnapshot {
  return {
    id,
    providerAccountId: id,
    provider,
    mode: "live",
    displayName: `${provider} ${id}`,
    currency: "USD",
    buyingPower: 0,
    cash: 0,
    netLiquidation: 0,
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
  };
}

function portfolio(input: {
  cash: number | null;
  buyingPower: number | null;
  netLiquidation: number | null;
  positionMarketValue?: number | null;
  unrealizedPnl?: number | null;
  positions?: SnapTradeAccountPortfolioResponse["positions"];
  baseCurrency?: string;
}): SnapTradeAccountPortfolioResponse {
  return {
    provider: "snaptrade",
    syncedAt: "2026-07-02T00:00:00.000Z",
    account: {
      id: "acct",
      connectionId: "conn",
      snapTradeAccountId: "st-acct",
      displayName: "SnapTrade account",
      baseCurrency: input.baseCurrency ?? "USD",
      mode: "live",
      lastSyncedAt: null,
    },
    balances: [],
    positions: input.positions ?? [],
    totals: {
      cash: input.cash,
      buyingPower: input.buyingPower,
      positionMarketValue: input.positionMarketValue ?? null,
      unrealizedPnl: input.unrealizedPnl ?? null,
      netLiquidation: input.netLiquidation,
      positionCount: input.positions?.length ?? 0,
    },
    dataFreshness: { asOf: null },
  };
}

function balanceRecord(id: string) {
  return { snapshot: snapshot(id, "snaptrade"), appUserId: "user-1" };
}

function robinhoodBalanceRecord(id: string, providerAccountId = id) {
  return {
    snapshot: {
      ...snapshot(id, "robinhood"),
      providerAccountId,
    },
    appUserId: "user-1",
  };
}

const noopRecordSnapshots = async () => {};
const emptyPersisted = async () => ({ accounts: [], latestSnapshotAt: null });
const emptyFlex = async () => [] as BrokerAccountSnapshot[];

test("listAccounts merges SnapTrade accounts onto the live IBKR branch", async () => {
  const result = await listAccounts(
    { mode: "live" },
    {
      listLiveAccounts: async () => [snapshot("U1", "ibkr")],
      getPersistedAccounts: emptyPersisted,
      getFlexAccounts: emptyFlex,
      recordSnapshots: noopRecordSnapshots,
      getSnapTradeAccounts: async () => [
        snapshot("etrade-a", "snaptrade"),
        snapshot("etrade-b", "snaptrade"),
      ],
      getRobinhoodAccounts: async () => [],
    },
  );

  assert.deepEqual(
    result.accounts.map((a) => a.id),
    ["U1", "etrade-a", "etrade-b"],
  );
  assert.deepEqual(
    result.accounts.map((a) => a.provider),
    ["ibkr", "snaptrade", "snaptrade"],
  );
});

test("listAccounts lets direct IBKR supersede SnapTrade-linked IBKR accounts", async () => {
  const result = await listAccounts(
    { mode: "live" },
    {
      listLiveAccounts: async () => [snapshot("U1", "ibkr")],
      getPersistedAccounts: emptyPersisted,
      getFlexAccounts: emptyFlex,
      recordSnapshots: noopRecordSnapshots,
      getSnapTradeAccounts: async () => [
        {
          ...snapshot("snaptrade-ibkr", "snaptrade"),
          displayName: "Interactive Brokers Individual",
        },
        {
          ...snapshot("etrade-a", "snaptrade"),
          displayName: "E*TRADE RETIREMENT ROTH IRA",
        },
      ],
      getRobinhoodAccounts: async () => [],
    },
  );

  assert.deepEqual(
    result.accounts.map((a) => `${a.provider}:${a.id}`),
    ["ibkr:U1", "snaptrade:etrade-a"],
  );
});

test("listAccounts hydrates account day P&L from persisted balance snapshots", async () => {
  await withTestDb(async () => {
    const [connection] = await db
      .insert(brokerConnectionsTable)
      .values({
        name: "IBKR",
        connectionType: "broker",
        brokerProvider: "ibkr",
        mode: "live",
        status: "connected",
      })
      .returning({ id: brokerConnectionsTable.id });
    const [account] = await db
      .insert(brokerAccountsTable)
      .values({
        connectionId: connection.id,
        providerAccountId: "U1",
        displayName: "IBKR Individual",
        mode: "live",
        baseCurrency: "USD",
      })
      .returning({ id: brokerAccountsTable.id });
    await db.insert(balanceSnapshotsTable).values([
      {
        accountId: account.id,
        currency: "USD",
        cash: "1000",
        buyingPower: "1000",
        netLiquidation: "1000",
        asOf: new Date("2026-07-07T20:00:00.000Z"),
      },
      {
        accountId: account.id,
        currency: "USD",
        cash: "1050",
        buyingPower: "1050",
        netLiquidation: "1050",
        asOf: new Date("2026-07-08T15:00:00.000Z"),
      },
    ]);

    const result = await listAccounts(
      { mode: "live" },
      {
        listLiveAccounts: async () => [
          {
            ...snapshot("U1", "ibkr"),
            netLiquidation: 1075,
            updatedAt: new Date("2026-07-08T16:00:00.000Z"),
          },
        ],
        getPersistedAccounts: emptyPersisted,
        getFlexAccounts: emptyFlex,
        recordSnapshots: noopRecordSnapshots,
        getSnapTradeAccounts: async () => [],
        getRobinhoodAccounts: async () => [],
      },
    );

    assert.equal(result.accounts[0].dayPnl, 75);
    assert.equal(result.accounts[0].dayPnlPercent, 7.5);
  });
});

test("listAccounts leaves IBKR list unchanged when SnapTrade is empty", async () => {
  const result = await listAccounts(
    { mode: "live" },
    {
      listLiveAccounts: async () => [snapshot("U1", "ibkr")],
      getPersistedAccounts: emptyPersisted,
      getFlexAccounts: emptyFlex,
      recordSnapshots: noopRecordSnapshots,
      getSnapTradeAccounts: async () => [],
      getRobinhoodAccounts: async () => [],
    },
  );

  assert.deepEqual(
    result.accounts.map((a) => a.id),
    ["U1"],
  );
  assert.equal(result.accounts[0].provider, "ibkr");
});

test("listAccounts degrades to IBKR-only when SnapTrade read throws", async () => {
  const result = await listAccounts(
    { mode: "live" },
    {
      listLiveAccounts: async () => [snapshot("U1", "ibkr")],
      getPersistedAccounts: emptyPersisted,
      getFlexAccounts: emptyFlex,
      recordSnapshots: noopRecordSnapshots,
      getSnapTradeAccounts: async () => {
        throw new Error("snaptrade outage");
      },
      getRobinhoodAccounts: async () => [],
    },
  );

  assert.deepEqual(
    result.accounts.map((a) => a.id),
    ["U1"],
  );
});

test("listAccounts merges SnapTrade onto the persisted branch when IBKR is empty", async () => {
  const result = await listAccounts(
    { mode: "live" },
    {
      listLiveAccounts: async () => [],
      getPersistedAccounts: async () => ({
        accounts: [snapshot("U-persisted", "ibkr")],
        latestSnapshotAt: null,
      }),
      getFlexAccounts: emptyFlex,
      recordSnapshots: noopRecordSnapshots,
      getSnapTradeAccounts: async () => [snapshot("etrade-a", "snaptrade")],
      getRobinhoodAccounts: async () => [],
    },
  );

  assert.deepEqual(
    result.accounts.map((a) => `${a.provider}:${a.id}`),
    ["ibkr:U-persisted", "snaptrade:etrade-a"],
  );
});

test("listAccounts returns SnapTrade-only when no IBKR source has accounts", async () => {
  const result = await listAccounts(
    { mode: "live" },
    {
      listLiveAccounts: async () => [],
      getPersistedAccounts: emptyPersisted,
      getFlexAccounts: emptyFlex,
      recordSnapshots: noopRecordSnapshots,
      getSnapTradeAccounts: async () => [
        snapshot("etrade-a", "snaptrade"),
        snapshot("etrade-b", "snaptrade"),
        snapshot("etrade-c", "snaptrade"),
      ],
      getRobinhoodAccounts: async () => [],
    },
  );

  assert.deepEqual(
    result.accounts.map((a) => a.provider),
    ["snaptrade", "snaptrade", "snaptrade"],
  );
  assert.equal(result.accounts.length, 3);
});

test("listAccounts merges Robinhood accounts with provider preserved", async () => {
  const result = await listAccounts(
    { mode: "live" },
    {
      listLiveAccounts: async () => [snapshot("U1", "ibkr")],
      getPersistedAccounts: emptyPersisted,
      getFlexAccounts: emptyFlex,
      recordSnapshots: noopRecordSnapshots,
      getSnapTradeAccounts: async () => [],
      getRobinhoodAccounts: async () => [
        snapshot("robinhood:727958282", "robinhood"),
      ],
    },
  );

  assert.deepEqual(
    result.accounts.map((a) => `${a.provider}:${a.id}`),
    ["ibkr:U1", "robinhood:robinhood:727958282"],
  );
  assert.equal(result.accounts[1].provider, "robinhood");
});

test("listAccounts returns Robinhood-only when no IBKR source has accounts", async () => {
  const result = await listAccounts(
    { mode: "live" },
    {
      listLiveAccounts: async () => [],
      getPersistedAccounts: emptyPersisted,
      getFlexAccounts: emptyFlex,
      recordSnapshots: noopRecordSnapshots,
      getSnapTradeAccounts: async () => [],
      getRobinhoodAccounts: async () => [
        {
          ...snapshot("rh-local-id", "robinhood"),
          providerAccountId: "727958282",
          cash: 40,
          buyingPower: 40,
          netLiquidation: 40,
        },
      ],
    },
  );

  assert.deepEqual(
    result.accounts.map((a) => `${a.provider}:${a.id}:${a.netLiquidation}`),
    ["robinhood:rh-local-id:40"],
  );
});

test("applyRobinhoodAccountBalances populates portfolio balances onto snapshots", async () => {
  const accounts = await applyRobinhoodAccountBalances(
    [robinhoodBalanceRecord("rh-local-id", "robinhood:727958282")],
    {
      fetchPortfolio: async ({ accountNumber }) => {
        assert.equal(accountNumber, "727958282");
        return {
          data: {
            total_value: "40",
            cash: "39.50",
            currency: "USD",
            buying_power: {
              buying_power: "38.25",
              display_currency: "USD",
            },
          },
        };
      },
      now: () => 1_000,
    },
  );

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].providerAccountId, "robinhood:727958282");
  assert.equal(accounts[0].cash, 39.5);
  assert.equal(accounts[0].buyingPower, 38.25);
  assert.equal(accounts[0].netLiquidation, 40);
  assert.equal(accounts[0].currency, "USD");
});

test("applyRobinhoodAccountBalances serves cached balances without a second MCP call", async () => {
  let calls = 0;
  const fetchPortfolio = async () => {
    calls += 1;
    return {
      data: {
        total_value: String(calls * 100),
        cash: "10",
        buying_power: { buying_power: "20" },
        currency: "USD",
      },
    };
  };

  const first = await applyRobinhoodAccountBalances(
    [robinhoodBalanceRecord("rh-cache-hit", "727958282")],
    { fetchPortfolio, now: () => 1_000 },
  );
  const second = await applyRobinhoodAccountBalances(
    [robinhoodBalanceRecord("rh-cache-hit", "727958282")],
    { fetchPortfolio, now: () => 10_000 },
  );

  assert.equal(calls, 1);
  assert.equal(first[0].netLiquidation, 100);
  assert.equal(second[0].netLiquidation, 100);
});

test("applyRobinhoodAccountBalances degrades to zero balances when portfolio fetch fails", async () => {
  const accounts = await applyRobinhoodAccountBalances(
    [robinhoodBalanceRecord("rh-fail", "727958282")],
    {
      fetchPortfolio: async () => {
        throw new Error("robinhood portfolio outage");
      },
      now: () => 1_000,
    },
  );

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].id, "rh-fail");
  assert.equal(accounts[0].cash, 0);
  assert.equal(accounts[0].buyingPower, 0);
  assert.equal(accounts[0].netLiquidation, 0);
});

test("account detail resolver resolves Robinhood accounts by local broker account id", async () => {
  const robinhood = {
    ...snapshot("broker-account-uuid", "robinhood"),
    providerAccountId: "727958282",
    cash: 40,
    buyingPower: 40,
    netLiquidation: 40,
  };

  const universe =
    await __accountUniverseInternalsForTests.readLiveAccountUniverseUncached(
      "broker-account-uuid",
      "live",
      {
        listLiveAccounts: async () => [],
        getSnapTradeAccounts: async () => [],
        getRobinhoodAccounts: async () => [robinhood],
      },
    );

  assert.equal(universe.requestedAccountId, "broker-account-uuid");
  assert.deepEqual(universe.accountIds, ["broker-account-uuid"]);
  assert.equal(universe.source, "robinhood");
  assert.equal(universe.accounts[0].netLiquidation, 40);
});

test("account detail resolver uses request app user for provider fallback", async () => {
  const snapTrade = {
    ...snapshot("snaptrade-local-account", "snaptrade"),
    cash: 50,
    buyingPower: 50,
    netLiquidation: 50,
  };
  const observedAppUserIds: Array<string | null> = [];

  const universe = await runAsAppUser("user-from-request", () =>
    __accountUniverseInternalsForTests.readLiveAccountUniverseUncached(
      "snaptrade-local-account",
      "live",
      {
        listLiveAccounts: async () => {
          throw new Error("IBKR unavailable");
        },
        getSnapTradeAccounts: async (_mode, appUserId) => {
          observedAppUserIds.push(appUserId);
          return [snapTrade];
        },
        getRobinhoodAccounts: async () => [],
      },
    ),
  );

  assert.deepEqual(observedAppUserIds, ["user-from-request"]);
  assert.equal(universe.requestedAccountId, "snaptrade-local-account");
  assert.deepEqual(universe.accountIds, ["snaptrade-local-account"]);
  assert.equal(universe.source, "snaptrade");
  assert.equal(universe.staleReason, "ibkr_unavailable_using_provider_accounts");
});

test("account universe cache keys include the request app user", () => {
  const first = __accountUniverseInternalsForTests.liveAccountUniverseCacheKey(
    "combined",
    "live",
    "user-1",
  );
  const second = __accountUniverseInternalsForTests.liveAccountUniverseCacheKey(
    "combined",
    "live",
    "user-2",
  );

  assert.notEqual(first, second);
});

test("combined account positions include normalized SnapTrade portfolio rows", async () => {
  const snapTradeAccount = snapshot("etrade-a", "snaptrade");
  const ibkrAccount = snapshot("U1", "ibkr");
  const positions = await __accountPositionInternalsForTests.readPositionsForUniverseUncached(
    {
      requestedAccountId: "combined",
      accountIds: [ibkrAccount.id, snapTradeAccount.id],
      isCombined: true,
      accounts: [ibkrAccount, snapTradeAccount],
      primaryCurrency: "USD",
      source: "live",
      latestSnapshotAt: null,
      staleReason: null,
    },
    "live",
    {
      listIbkrPositions: async ({ accountId }) => {
        assert.ok(accountId);
        return [
          {
            id: `${accountId}:AAPL`,
            accountId,
            symbol: "AAPL",
            assetClass: "equity" as const,
            quantity: 2,
            averagePrice: 200,
            marketPrice: 210,
            marketValue: 420,
            unrealizedPnl: 20,
            unrealizedPnlPercent: 5,
            optionContract: null,
          },
        ];
      },
      readSnapTradePortfolio: (accountId) => {
        assert.equal(accountId, snapTradeAccount.id);
        return portfolio({
          cash: 0,
          buyingPower: 0,
          netLiquidation: 340,
          positions: [
            {
              snapTradePositionId: "option:BLDP260821C00005000",
              symbol: "BLDP",
              rawSymbol: "BLDP  260821C00005000",
              description: "BLDP Aug 21 2026 5 Call",
              instrumentKind: "option",
              assetClass: "option",
              optionContract: {
                ticker: "BLDP260821C00005000",
                underlying: "BLDP",
                expirationDate: "2026-08-21",
                strike: 5,
                right: "call",
                multiplier: 100,
                sharesPerContract: 100,
                providerContractId: null,
                brokerContractId: null,
              },
              quantity: 20,
              side: "long",
              price: 0.17,
              averagePurchasePrice: 0.8351,
              marketValue: 340,
              costBasis: 1_670.2,
              unrealizedPnl: -1_330.2,
              currency: "USD",
              cashEquivalent: false,
            },
          ],
        });
      },
    },
  );

  assert.deepEqual(
    positions.map((position) => position.accountId),
    [ibkrAccount.id, snapTradeAccount.id],
  );
  assert.equal(positions[1]?.quantity, 20);
  assert.equal(positions[1]?.averagePrice, 0.8351);
  assert.equal(positions[1]?.marketPrice, 0.17);
  assert.equal(positions[1]?.marketValue, 340);
  assert.equal(positions[1]?.unrealizedPnl, -1_330.2);
  assert.equal(positions[1]?.optionContract?.ticker, "BLDP260821C00005000");
  assert.equal(
    positions[1]?.optionContract?.expirationDate.toISOString(),
    "2026-08-21T00:00:00.000Z",
  );
});

test("SnapTrade-only positions do not call the IBKR position reader", async () => {
  const snapTradeAccount = snapshot("etrade-only", "snaptrade");
  let ibkrReads = 0;

  const positions = await __accountPositionInternalsForTests.readPositionsForUniverseUncached(
    {
      requestedAccountId: snapTradeAccount.id,
      accountIds: [snapTradeAccount.id],
      isCombined: false,
      accounts: [snapTradeAccount],
      primaryCurrency: "USD",
      source: "snaptrade",
      latestSnapshotAt: null,
      staleReason: null,
    },
    "live",
    {
      listIbkrPositions: async () => {
        ibkrReads += 1;
        return [];
      },
      readSnapTradePortfolio: () =>
        portfolio({
          cash: 0,
          buyingPower: 0,
          netLiquidation: 0,
        }),
    },
  );

  assert.equal(ibkrReads, 0);
  assert.deepEqual(positions, []);
});

test("generic positions consume the latest user-scoped SnapTrade portfolio", async () => {
  const snapTradeAccount = snapshot("etrade-shared-cache", "snaptrade");
  const latestPortfolio = portfolio({
    cash: 0,
    buyingPower: 0,
    netLiquidation: 125,
    positions: [
      {
        snapTradePositionId: "stock:AAPL",
        symbol: "AAPL",
        rawSymbol: "AAPL",
        description: "Apple Inc.",
        instrumentKind: "stock",
        assetClass: "equity",
        optionContract: null,
        quantity: 1,
        side: "long",
        price: 125,
        averagePurchasePrice: 100,
        marketValue: 125,
        costBasis: 100,
        unrealizedPnl: 25,
        currency: "USD",
        cashEquivalent: false,
      },
    ],
  });
  __snapTradeAccountPortfolioInternalsForTests.rememberLatestPortfolio({
    appUserId: "user-1",
    accountId: snapTradeAccount.id,
    value: latestPortfolio,
  });
  const universe = {
    requestedAccountId: snapTradeAccount.id,
    accountIds: [snapTradeAccount.id],
    isCombined: false,
    accounts: [snapTradeAccount],
    primaryCurrency: "USD",
    source: "snaptrade" as const,
    latestSnapshotAt: null,
    staleReason: null,
  };

  const ownerPositions = await runAsAppUser("user-1", () =>
    __accountPositionInternalsForTests.readPositionsForUniverseUncached(
      universe,
      "live",
    ),
  );
  const otherUserPositions = await runAsAppUser("user-2", () =>
    __accountPositionInternalsForTests.readPositionsForUniverseUncached(
      universe,
      "live",
    ),
  );
  const balancedUniverse = await runAsAppUser("user-1", () =>
    __accountPositionInternalsForTests.applyLatestSnapTradeBalancesToUniverse(
      universe,
    ),
  );

  assert.equal(ownerPositions.length, 1);
  assert.equal(ownerPositions[0]?.id, `snaptrade:${snapTradeAccount.id}:stock:AAPL`);
  assert.deepEqual(otherUserPositions, []);
  assert.equal(balancedUniverse.accounts[0]?.cash, 0);
  assert.equal(balancedUniverse.accounts[0]?.netLiquidation, 125);
  assert.equal(balancedUniverse.accounts[0]?.updatedAt.toISOString(), latestPortfolio.syncedAt);
});

test("latest SnapTrade portfolio cache rejects out-of-order completions", () => {
  const accountId = "etrade-out-of-order";
  const newer = {
    ...portfolio({ cash: 200, buyingPower: 200, netLiquidation: 200 }),
    syncedAt: "2026-07-09T19:02:00.000Z",
    dataFreshness: { asOf: "2026-07-09T19:01:59.000Z" },
  };
  const older = {
    ...portfolio({ cash: 100, buyingPower: 100, netLiquidation: 100 }),
    syncedAt: "2026-07-09T19:01:00.000Z",
    dataFreshness: { asOf: "2026-07-09T19:00:59.000Z" },
  };

  __snapTradeAccountPortfolioInternalsForTests.rememberLatestPortfolio({
    appUserId: "user-1",
    accountId,
    value: newer,
  });
  __snapTradeAccountPortfolioInternalsForTests.rememberLatestPortfolio({
    appUserId: "user-1",
    accountId,
    value: older,
  });

  assert.equal(
    __snapTradeAccountPortfolioInternalsForTests.readLatestPortfolio({
      appUserId: "user-1",
      accountId,
    }),
    newer,
  );

  const mixedAccountId = `${accountId}-mixed-freshness`;
  const newerWithoutProviderAsOf = {
    ...newer,
    dataFreshness: { asOf: null },
  };
  __snapTradeAccountPortfolioInternalsForTests.rememberLatestPortfolio({
    appUserId: "user-1",
    accountId: mixedAccountId,
    value: newerWithoutProviderAsOf,
  });
  __snapTradeAccountPortfolioInternalsForTests.rememberLatestPortfolio({
    appUserId: "user-1",
    accountId: mixedAccountId,
    value: older,
  });
  assert.equal(
    __snapTradeAccountPortfolioInternalsForTests.readLatestPortfolio({
      appUserId: "user-1",
      accountId: mixedAccountId,
    }),
    newerWithoutProviderAsOf,
  );
});

test("applySnapTradeAccountBalances populates live balances onto snapshots", async () => {
  const accounts = await applySnapTradeAccountBalances([balanceRecord("bal-a")], {
    fetchPortfolio: async () =>
      portfolio({
        cash: 1_250.5,
        buyingPower: 2_500,
        netLiquidation: 9_999.75,
        baseCurrency: "CAD",
      }),
    now: () => 1_000,
  });

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].cash, 1_250.5);
  assert.equal(accounts[0].buyingPower, 2_500);
  assert.equal(accounts[0].netLiquidation, 9_999.75);
  assert.equal(accounts[0].currency, "CAD");
});

test("applySnapTradeAccountBalances uses normalized option totals for account tab NAV", async () => {
  const accounts = await applySnapTradeAccountBalances([balanceRecord("bal-option")], {
    fetchPortfolio: async () =>
      portfolio({
        cash: 7.98,
        buyingPower: 7.98,
        positionMarketValue: 3.4,
        netLiquidation: 11.38,
        positions: [
          {
            snapTradePositionId: "option:BLDP260821C00005000",
            symbol: "BLDP",
            rawSymbol: "BLDP  260821C00005000",
            description: "BLDP Aug 21 2026 5 Call",
            instrumentKind: "option",
            assetClass: "option",
            optionContract: {
              ticker: "BLDP260821C00005000",
              underlying: "BLDP",
              expirationDate: "2026-08-21",
              strike: 5,
              right: "call",
              multiplier: 100,
              sharesPerContract: 100,
              providerContractId: null,
              brokerContractId: null,
            },
            quantity: 20,
            side: "long",
            price: 0.17,
            averagePurchasePrice: 83.51,
            marketValue: 3.4,
            costBasis: 1670.2,
            unrealizedPnl: -1666.8,
            currency: "USD",
            cashEquivalent: false,
          },
        ],
      }),
    now: () => 1_000,
  });

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].cash, 7.98);
  assert.equal(accounts[0].buyingPower, 7.98);
  assert.equal(accounts[0].netLiquidation, 347.98);
});

test("applySnapTradeAccountBalances serves cached balances without a second upstream call", async () => {
  let calls = 0;
  const fetchPortfolio = async () => {
    calls += 1;
    return portfolio({ cash: 100, buyingPower: 200, netLiquidation: 300 });
  };

  const first = await applySnapTradeAccountBalances([balanceRecord("bal-hit")], {
    fetchPortfolio,
    now: () => 1_000,
  });
  const second = await applySnapTradeAccountBalances([balanceRecord("bal-hit")], {
    fetchPortfolio,
    now: () => 10_000,
  });

  assert.equal(calls, 1);
  assert.equal(first[0].netLiquidation, 300);
  assert.equal(second[0].netLiquidation, 300);
});

test("applySnapTradeAccountBalances degrades to zero balances when the fetch fails", async () => {
  const accounts = await applySnapTradeAccountBalances([balanceRecord("bal-fail")], {
    fetchPortfolio: async () => {
      throw new Error("snaptrade portfolio outage");
    },
    now: () => 1_000,
  });

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].id, "bal-fail");
  assert.equal(accounts[0].cash, 0);
  assert.equal(accounts[0].buyingPower, 0);
  assert.equal(accounts[0].netLiquidation, 0);
});

test("applySnapTradeAccountBalances refetches after the cache TTL expires", async () => {
  let calls = 0;
  const fetchPortfolio = async () => {
    calls += 1;
    return portfolio({
      cash: calls * 10,
      buyingPower: calls * 20,
      netLiquidation: calls * 30,
    });
  };

  const first = await applySnapTradeAccountBalances([balanceRecord("bal-ttl")], {
    fetchPortfolio,
    now: () => 1_000,
  });
  // Advance past the 45s balance cache TTL (1_000 + 45_000 = 46_000).
  const second = await applySnapTradeAccountBalances([balanceRecord("bal-ttl")], {
    fetchPortfolio,
    now: () => 50_000,
  });

  assert.equal(calls, 2);
  assert.equal(first[0].netLiquidation, 30);
  assert.equal(second[0].netLiquidation, 60);
});
