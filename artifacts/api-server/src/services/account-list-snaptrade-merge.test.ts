import assert from "node:assert/strict";
import test from "node:test";

import type { BrokerAccountSnapshot } from "../providers/ibkr/client";

import { applySnapTradeAccountBalances, listAccounts } from "./account";
import type { SnapTradeAccountPortfolioResponse } from "./snaptrade-account-portfolio";

function snapshot(
  id: string,
  provider: "ibkr" | "snaptrade",
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
      netLiquidation: input.netLiquidation,
      positionCount: input.positions?.length ?? 0,
    },
    dataFreshness: { asOf: null },
  };
}

function balanceRecord(id: string) {
  return { snapshot: snapshot(id, "snaptrade"), appUserId: "user-1" };
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

test("listAccounts leaves IBKR list unchanged when SnapTrade is empty", async () => {
  const result = await listAccounts(
    { mode: "live" },
    {
      listLiveAccounts: async () => [snapshot("U1", "ibkr")],
      getPersistedAccounts: emptyPersisted,
      getFlexAccounts: emptyFlex,
      recordSnapshots: noopRecordSnapshots,
      getSnapTradeAccounts: async () => [],
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
    },
  );

  assert.deepEqual(
    result.accounts.map((a) => a.provider),
    ["snaptrade", "snaptrade", "snaptrade"],
  );
  assert.equal(result.accounts.length, 3);
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
