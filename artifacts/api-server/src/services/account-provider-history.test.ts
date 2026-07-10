import assert from "node:assert/strict";
import test from "node:test";

import {
  barCacheTable,
  balanceSnapshotsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  instrumentsTable,
  robinhoodAccountActivitiesTable,
  snapTradeAccountActivitiesTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { HttpError } from "../lib/errors";
import { __setIbkrAccountBridgeDependenciesForTests } from "./ibkr-account-bridge";
import { bootstrapInitialUser } from "./auth";
import {
  __resetApiResourcePressureForTests,
  updateApiResourcePressure,
} from "./resource-pressure";
import {
  applyRobinhoodAccountBalances,
  applySnapTradeAccountBalances,
  getAccountClosedTrades,
  getAccountEquityHistory,
} from "./account";
import type { BrokerAccountSnapshot } from "../providers/ibkr/client";

async function withBootstrapToken<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"];
  process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"] = "setup-token";
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"];
    } else {
      process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"] = previous;
    }
  }
}

async function withEmptyIbkrAccounts<T>(fn: () => Promise<T>): Promise<T> {
  __setIbkrAccountBridgeDependenciesForTests({
    bridgeClient: {
      listAccounts: async () => [],
      listPositions: async () => [],
      listExecutions: async () => [],
    },
  });
  try {
    return await fn();
  } finally {
    __setIbkrAccountBridgeDependenciesForTests(null);
  }
}

async function withIbkrAccounts<T>(
  accounts: BrokerAccountSnapshot[],
  fn: () => Promise<T>,
): Promise<T> {
  const accountIds = new Set(accounts.map((account) => account.id));
  __setIbkrAccountBridgeDependenciesForTests({
    bridgeClient: {
      listAccounts: async () => accounts,
      listPositions: async (input) => {
        assert.ok(accountIds.has(input.accountId ?? ""));
        return [];
      },
      listExecutions: async (input) => {
        assert.ok(accountIds.has(input.accountId ?? ""));
        return [];
      },
    },
  });
  try {
    return await fn();
  } finally {
    __setIbkrAccountBridgeDependenciesForTests(null);
  }
}

function ibkrAccountSnapshot(id: string): BrokerAccountSnapshot {
  return {
    id,
    providerAccountId: id,
    provider: "ibkr",
    mode: "live",
    displayName: `IBKR ${id}`,
    currency: "USD",
    buyingPower: 5000,
    cash: 5000,
    netLiquidation: 5000,
    accountType: "Individual",
    totalCashValue: null,
    settledCash: null,
    accruedCash: null,
    initialMargin: null,
    maintenanceMargin: null,
    excessLiquidity: null,
    cushion: null,
    sma: null,
    dayTradingBuyingPower: null,
    regTInitialMargin: null,
    grossPositionValue: null,
    leverage: null,
    dayTradesRemaining: null,
    isPatternDayTrader: null,
    updatedAt: new Date("2026-06-20T20:00:00.000Z"),
  };
}

async function createProviderAccount(input: {
  email: string;
  provider: "snaptrade" | "robinhood";
  providerAccountId: string;
}) {
  const auth = await bootstrapInitialUser({
    email: input.email,
    password: "correct horse battery staple",
    bootstrapToken: "setup-token",
  });
  const [connection] = await db
    .insert(brokerConnectionsTable)
    .values({
      appUserId: auth.user.id,
      name: `${input.provider}:${input.email}`,
      connectionType: "broker",
      brokerProvider: input.provider,
      mode: "live",
      status: "connected",
      capabilities: ["accounts", input.provider],
    })
    .returning({ id: brokerConnectionsTable.id });
  const [account] = await db
    .insert(brokerAccountsTable)
    .values({
      appUserId: auth.user.id,
      connectionId: connection.id,
      providerAccountId: input.providerAccountId,
      displayName:
        input.provider === "snaptrade" ? "E*TRADE History" : "Robinhood History",
      mode: "live",
      baseCurrency: "USD",
      includedInTrading: true,
    })
    .returning({ id: brokerAccountsTable.id });
  const snapshot = {
    id: account.id,
    providerAccountId: input.providerAccountId,
    provider: input.provider,
    mode: "live" as const,
    displayName:
      input.provider === "snaptrade" ? "E*TRADE History" : "Robinhood History",
    currency: "USD",
    updatedAt: new Date("2026-06-20T20:00:00.000Z"),
  };
  if (input.provider === "snaptrade") {
    await applySnapTradeAccountBalances(
      [{ appUserId: auth.user.id, snapshot }],
      {
        fetchPortfolio: async () => ({
          provider: "snaptrade",
          syncedAt: "2026-06-20T20:00:00.000Z",
          account: {
            id: account.id,
            connectionId: connection.id,
            snapTradeAccountId: input.providerAccountId,
            displayName: snapshot.displayName,
            baseCurrency: "USD",
            mode: "live",
            lastSyncedAt: null,
          },
          balances: [],
          positions: [],
          totals: {
            cash: 1_000,
            buyingPower: 1_000,
            positionMarketValue: 0,
            unrealizedPnl: 0,
            netLiquidation: 1_000,
            positionCount: 0,
          },
          dataFreshness: { asOf: "2026-06-20T20:00:00.000Z" },
        }),
      },
    );
  } else {
    await applyRobinhoodAccountBalances(
      [{ appUserId: auth.user.id, snapshot }],
      {
        fetchPortfolio: async () => ({
          data: {
            total_value: "1000",
            cash: "1000",
            buying_power: { buying_power: "1000" },
            currency: "USD",
          },
        }),
      },
    );
  }
  return { auth, account };
}

test("generic account closed trades include SnapTrade activity backfill", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () =>
      withEmptyIbkrAccounts(async () => {
        const { auth, account } = await createProviderAccount({
          email: "generic-snaptrade-history@example.com",
          provider: "snaptrade",
          providerAccountId: "snaptrade:acct-generic-history",
        });

        await db.insert(snapTradeAccountActivitiesTable).values([
          {
            accountId: account.id,
            snapTradeActivityId: "snap-open",
            tradeDate: new Date("2026-06-01T14:30:00.000Z"),
            settlementDate: new Date("2026-06-02T14:30:00.000Z"),
            type: "BUY",
            optionType: "BUY_TO_OPEN",
            symbol: "BLDP260821C00005000",
            rawSymbol: "BLDP260821C00005000",
            description: "Bought BLDP calls",
            optionTicker: "BLDP260821C00005000",
            quantity: "2.000000",
            price: "0.800000",
            amount: "-160.000000",
            fee: "1.000000",
            currency: "USD",
            externalReferenceId: null,
            rawPayload: {},
          },
          {
            accountId: account.id,
            snapTradeActivityId: "snap-close",
            tradeDate: new Date("2026-06-15T14:30:00.000Z"),
            settlementDate: new Date("2026-06-16T14:30:00.000Z"),
            type: "SELL",
            optionType: "SELL_TO_CLOSE",
            symbol: "BLDP260821C00005000",
            rawSymbol: "BLDP260821C00005000",
            description: "Sold BLDP calls",
            optionTicker: "BLDP260821C00005000",
            quantity: "2.000000",
            price: "1.250000",
            amount: "250.000000",
            fee: "1.000000",
            currency: "USD",
            externalReferenceId: null,
            rawPayload: {},
          },
        ]);

        const result = await getAccountClosedTrades({
          accountId: account.id,
          appUserId: auth.user.id,
          from: new Date("2026-06-01T00:00:00.000Z"),
          to: new Date("2026-06-30T23:59:59.999Z"),
          mode: "live",
        });

        assert.equal(result.trades.length, 1);
        assert.equal(result.trades[0]?.source, "SNAPTRADE_ACTIVITY");
        assert.equal(result.trades[0]?.symbol, "BLDP");
        assert.equal(result.trades[0]?.positionType, "option");
        assert.equal(result.trades[0]?.realizedPnl, 88);
        assert.equal(result.summary.realizedPnl, 88);
      }),
    ),
  );
});

test("generic account equity history includes SnapTrade balance snapshots", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () =>
      withEmptyIbkrAccounts(async () => {
        const { auth, account } = await createProviderAccount({
          email: "generic-snaptrade-equity-history@example.com",
          provider: "snaptrade",
          providerAccountId: "snaptrade:acct-generic-equity-history",
        });

        await db.insert(balanceSnapshotsTable).values([
          {
            accountId: account.id,
            currency: "USD",
            cash: "100.000000",
            buyingPower: "100.000000",
            netLiquidation: "1000.000000",
            maintenanceMargin: null,
            asOf: new Date("2026-06-01T20:00:00.000Z"),
          },
          {
            accountId: account.id,
            currency: "USD",
            cash: "125.000000",
            buyingPower: "125.000000",
            netLiquidation: "1250.000000",
            maintenanceMargin: null,
            asOf: new Date("2026-06-02T20:00:00.000Z"),
          },
        ]);

        const result = await getAccountEquityHistory({
          accountId: account.id,
          appUserId: auth.user.id,
          range: "ALL",
          mode: "live",
        });

        assert.equal(result.points.length, 2);
        assert.equal(result.points[0]?.source, "LOCAL_LEDGER");
        assert.equal(result.points[0]?.netLiquidation, 1000);
        assert.equal(result.points[1]?.source, "LOCAL_LEDGER");
        assert.equal(result.points[1]?.netLiquidation, 1250);
        assert.equal(result.points[1]?.returnPercent, 25);
        assert.equal(result.terminalPointSource, "persisted_snapshot");
      }),
    ),
  );
});

test("generic account equity history reconstructs SnapTrade activity ledger when balance history is current-only", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () =>
      withEmptyIbkrAccounts(async () => {
        const { auth, account } = await createProviderAccount({
          email: "generic-snaptrade-reconstructed-equity@example.com",
          provider: "snaptrade",
          providerAccountId: "snaptrade:acct-generic-reconstructed-equity",
        });

        await db.insert(snapTradeAccountActivitiesTable).values([
          {
            accountId: account.id,
            snapTradeActivityId: "snap-reconstruct-open",
            tradeDate: new Date("2026-06-01T14:30:00.000Z"),
            settlementDate: new Date("2026-06-02T14:30:00.000Z"),
            type: "BUY",
            optionType: "BUY_TO_OPEN",
            symbol: "BLDP260821C00005000",
            rawSymbol: "BLDP260821C00005000",
            description: "Bought BLDP calls",
            optionTicker: "BLDP260821C00005000",
            quantity: "2.000000",
            price: "0.800000",
            amount: "-160.000000",
            fee: "1.000000",
            currency: "USD",
            externalReferenceId: null,
            rawPayload: {},
          },
          {
            accountId: account.id,
            snapTradeActivityId: "snap-reconstruct-close",
            tradeDate: new Date("2026-06-15T14:30:00.000Z"),
            settlementDate: new Date("2026-06-16T14:30:00.000Z"),
            type: "SELL",
            optionType: "SELL_TO_CLOSE",
            symbol: "BLDP260821C00005000",
            rawSymbol: "BLDP260821C00005000",
            description: "Sold BLDP calls",
            optionTicker: "BLDP260821C00005000",
            quantity: "2.000000",
            price: "1.250000",
            amount: "250.000000",
            fee: "1.000000",
            currency: "USD",
            externalReferenceId: null,
            rawPayload: {},
          },
        ]);
        await db.insert(balanceSnapshotsTable).values({
          accountId: account.id,
          currency: "USD",
          cash: "1100.000000",
          buyingPower: "1100.000000",
          netLiquidation: "1100.000000",
          maintenanceMargin: null,
          asOf: new Date("2026-06-20T20:00:00.000Z"),
        });

        const result = await getAccountEquityHistory({
          accountId: account.id,
          appUserId: auth.user.id,
          range: "ALL",
          mode: "live",
        });

        assert.equal(result.terminalPointSource, "snaptrade_balance_history");
        assert.ok(result.points.length > 1);
        assert.equal(result.points[0]?.source, "SNAPTRADE_BALANCE_HISTORY");
        assert.equal(result.points.at(-1)?.netLiquidation, 1100);
        assert.equal(result.points.at(-1)?.returnPercent, 8.695652173913043);
      }),
    ),
  );
});

test("generic account equity history rejects pressure-blocked marks instead of returning a partial curve", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () =>
      withEmptyIbkrAccounts(async () => {
        const { auth, account } = await createProviderAccount({
          email: "generic-snaptrade-marked-equity@example.com",
          provider: "snaptrade",
          providerAccountId: "snaptrade:acct-generic-marked-equity",
        });
        const [instrument] = await db
          .insert(instrumentsTable)
          .values({
            symbol: "AAPL",
            assetClass: "equity",
            name: "AAPL",
            currency: "USD",
            isActive: true,
          })
          .returning({ id: instrumentsTable.id });
        assert.ok(instrument);
        await db.insert(barCacheTable).values([
          {
            instrumentId: instrument.id,
            symbol: "AAPL",
            timeframe: "1d",
            startsAt: new Date("2026-06-01T00:00:00.000Z"),
            open: "50.000000",
            high: "55.000000",
            low: "50.000000",
            close: "55.000000",
            volume: "1000",
            source: "massive-history",
          },
          {
            instrumentId: instrument.id,
            symbol: "AAPL",
            timeframe: "1d",
            startsAt: new Date("2026-06-02T00:00:00.000Z"),
            open: "55.000000",
            high: "60.000000",
            low: "55.000000",
            close: "60.000000",
            volume: "1000",
            source: "massive-history",
          },
          {
            instrumentId: instrument.id,
            symbol: "AAPL",
            timeframe: "1d",
            startsAt: new Date("2026-06-03T00:00:00.000Z"),
            open: "60.000000",
            high: "70.000000",
            low: "60.000000",
            close: "70.000000",
            volume: "1000",
            source: "massive-history",
          },
          {
            instrumentId: instrument.id,
            symbol: "AAPL",
            timeframe: "1d",
            startsAt: new Date("2026-06-04T00:00:00.000Z"),
            open: "70.000000",
            high: "70.000000",
            low: "70.000000",
            close: "70.000000",
            volume: "1000",
            source: "massive-history",
          },
        ]);
        await db.insert(snapTradeAccountActivitiesTable).values({
          accountId: account.id,
          snapTradeActivityId: "snap-marked-equity-open",
          tradeDate: new Date("2026-06-01T14:30:00.000Z"),
          settlementDate: new Date("2026-06-02T14:30:00.000Z"),
          type: "BUY",
          optionType: null,
          symbol: "AAPL",
          rawSymbol: "AAPL",
          description: "Bought AAPL",
          optionTicker: null,
          quantity: "10.000000",
          price: "50.000000",
          amount: "-500.000000",
          fee: "0.000000",
          currency: "USD",
          externalReferenceId: null,
          rawPayload: {},
        });
        await db.insert(balanceSnapshotsTable).values({
          accountId: account.id,
          currency: "USD",
          cash: "500.000000",
          buyingPower: "500.000000",
          netLiquidation: "1200.000000",
          maintenanceMargin: null,
          asOf: new Date("2026-06-04T20:00:00.000Z"),
        });

        const historyInput = {
          accountId: account.id,
          appUserId: auth.user.id,
          range: "ALL" as const,
          mode: "live" as const,
        };
        __resetApiResourcePressureForTests();
        try {
          const saturatedPool = {
            dbPoolActive: 12,
            dbPoolWaiting: 8,
            dbPoolMax: 12,
          };
          updateApiResourcePressure(saturatedPool);
          updateApiResourcePressure(saturatedPool);
          await assert.rejects(
            () => getAccountEquityHistory(historyInput),
            (error: unknown) =>
              error instanceof HttpError &&
              error.statusCode === 503 &&
              error.code === "account_db_unavailable" &&
              error.detail?.includes("resource pressure") === true,
          );
        } finally {
          __resetApiResourcePressureForTests();
        }

        const result = await getAccountEquityHistory(historyInput);
        const byDay = new Map(
          result.points.map((point) => [
            point.timestamp.toISOString().slice(0, 10),
            point.netLiquidation,
          ]),
        );

        assert.equal(byDay.get("2026-06-01"), 1050);
        assert.equal(byDay.get("2026-06-02"), 1100);
        assert.equal(byDay.get("2026-06-03"), 1200);
        assert.equal(result.points.at(-1)?.netLiquidation, 1200);
      }),
    ),
  );
});

test("combined account equity history reconstructs SnapTrade activity ledger", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () =>
      withEmptyIbkrAccounts(async () => {
        const { auth, account } = await createProviderAccount({
          email: "combined-snaptrade-reconstructed-equity@example.com",
          provider: "snaptrade",
          providerAccountId: "snaptrade:acct-combined-reconstructed-equity",
        });

        await db.insert(snapTradeAccountActivitiesTable).values([
          {
            accountId: account.id,
            snapTradeActivityId: "combined-reconstruct-open",
            tradeDate: new Date("2026-06-01T14:30:00.000Z"),
            settlementDate: new Date("2026-06-02T14:30:00.000Z"),
            type: "BUY",
            optionType: "BUY_TO_OPEN",
            symbol: "BLDP260821C00005000",
            rawSymbol: "BLDP260821C00005000",
            description: "Bought BLDP calls",
            optionTicker: "BLDP260821C00005000",
            quantity: "2.000000",
            price: "0.800000",
            amount: "-160.000000",
            fee: "1.000000",
            currency: "USD",
            externalReferenceId: null,
            rawPayload: {},
          },
          {
            accountId: account.id,
            snapTradeActivityId: "combined-reconstruct-close",
            tradeDate: new Date("2026-06-15T14:30:00.000Z"),
            settlementDate: new Date("2026-06-16T14:30:00.000Z"),
            type: "SELL",
            optionType: "SELL_TO_CLOSE",
            symbol: "BLDP260821C00005000",
            rawSymbol: "BLDP260821C00005000",
            description: "Sold BLDP calls",
            optionTicker: "BLDP260821C00005000",
            quantity: "2.000000",
            price: "1.250000",
            amount: "250.000000",
            fee: "1.000000",
            currency: "USD",
            externalReferenceId: null,
            rawPayload: {},
          },
        ]);
        await db.insert(balanceSnapshotsTable).values({
          accountId: account.id,
          currency: "USD",
          cash: "1100.000000",
          buyingPower: "1100.000000",
          netLiquidation: "1100.000000",
          maintenanceMargin: null,
          asOf: new Date("2026-06-20T20:00:00.000Z"),
        });

        const result = await getAccountEquityHistory({
          accountId: "combined",
          appUserId: auth.user.id,
          range: "ALL",
          mode: "live",
          source: "combined-snaptrade-reconstruction-test",
        });

        assert.equal(result.terminalPointSource, "snaptrade_balance_history");
        assert.ok(result.points.length > 1);
        assert.equal(result.points[0]?.source, "SNAPTRADE_BALANCE_HISTORY");
        assert.equal(result.points.at(-1)?.netLiquidation, 1100);
      }),
    ),
  );
});

test("combined account equity history includes SnapTrade reconstruction alongside live accounts", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () =>
      withIbkrAccounts([ibkrAccountSnapshot("DU-MIXED-1")], async () => {
        const { auth, account } = await createProviderAccount({
          email: "combined-mixed-snaptrade-equity@example.com",
          provider: "snaptrade",
          providerAccountId: "snaptrade:acct-combined-mixed-equity",
        });

        await db.insert(snapTradeAccountActivitiesTable).values([
          {
            accountId: account.id,
            snapTradeActivityId: "combined-mixed-open",
            tradeDate: new Date("2026-06-01T14:30:00.000Z"),
            settlementDate: new Date("2026-06-02T14:30:00.000Z"),
            type: "BUY",
            optionType: "BUY_TO_OPEN",
            symbol: "BLDP260821C00005000",
            rawSymbol: "BLDP260821C00005000",
            description: "Bought BLDP calls",
            optionTicker: "BLDP260821C00005000",
            quantity: "2.000000",
            price: "0.800000",
            amount: "-160.000000",
            fee: "1.000000",
            currency: "USD",
            externalReferenceId: null,
            rawPayload: {},
          },
          {
            accountId: account.id,
            snapTradeActivityId: "combined-mixed-close",
            tradeDate: new Date("2026-06-15T14:30:00.000Z"),
            settlementDate: new Date("2026-06-16T14:30:00.000Z"),
            type: "SELL",
            optionType: "SELL_TO_CLOSE",
            symbol: "BLDP260821C00005000",
            rawSymbol: "BLDP260821C00005000",
            description: "Sold BLDP calls",
            optionTicker: "BLDP260821C00005000",
            quantity: "2.000000",
            price: "1.250000",
            amount: "250.000000",
            fee: "1.000000",
            currency: "USD",
            externalReferenceId: null,
            rawPayload: {},
          },
        ]);
        await db.insert(balanceSnapshotsTable).values({
          accountId: account.id,
          currency: "USD",
          cash: "1100.000000",
          buyingPower: "1100.000000",
          netLiquidation: "1100.000000",
          maintenanceMargin: null,
          asOf: new Date("2026-06-20T20:00:00.000Z"),
        });

        const result = await getAccountEquityHistory({
          accountId: "combined",
          appUserId: auth.user.id,
          range: "ALL",
          mode: "live",
          source: "combined-mixed-snaptrade-reconstruction-test",
        });

        assert.equal(result.terminalPointSource, "live_account_summary");
        assert.ok(
          result.points.some(
            (point) =>
              point.source === "SNAPTRADE_BALANCE_HISTORY" &&
              point.netLiquidation === 1100,
          ),
        );
      }),
    ),
  );
});

test("generic account closed trades include SnapTrade option expirations", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () =>
      withEmptyIbkrAccounts(async () => {
        const { auth, account } = await createProviderAccount({
          email: "generic-snaptrade-expiration-history@example.com",
          provider: "snaptrade",
          providerAccountId: "snaptrade:acct-generic-expiration-history",
        });

        await db.insert(snapTradeAccountActivitiesTable).values([
          {
            accountId: account.id,
            snapTradeActivityId: "snap-expiration-open",
            tradeDate: new Date("2026-06-01T14:30:00.000Z"),
            settlementDate: new Date("2026-06-02T14:30:00.000Z"),
            type: "BUY",
            optionType: "BUY_TO_OPEN",
            symbol: "NVDA260626C00205000",
            rawSymbol: "NVDA260626C00205000",
            description: "Bought NVDA calls",
            optionTicker: "NVDA260626C00205000",
            quantity: "2.000000",
            price: "0.800000",
            amount: "-160.000000",
            fee: "1.000000",
            currency: "USD",
            externalReferenceId: null,
            rawPayload: {},
          },
          {
            accountId: account.id,
            snapTradeActivityId: "snap-expiration-close",
            tradeDate: new Date("2026-06-29T07:00:00.000Z"),
            settlementDate: new Date("2026-06-29T07:00:00.000Z"),
            type: "OPTIONEXPIRATION",
            optionType: null,
            symbol: "NVDA",
            rawSymbol: null,
            description: "CALL NVDA 06/26/26 205.000",
            optionTicker: "NVDA260626C00205000",
            quantity: "-2.000000",
            price: "0.000000",
            amount: "0.000000",
            fee: "0.000000",
            currency: "USD",
            externalReferenceId: null,
            rawPayload: {},
          },
        ]);

        const result = await getAccountClosedTrades({
          accountId: account.id,
          appUserId: auth.user.id,
          from: new Date("2026-06-01T00:00:00.000Z"),
          to: new Date("2026-06-30T23:59:59.999Z"),
          mode: "live",
        });

        assert.equal(result.trades.length, 1);
        assert.equal(result.trades[0]?.source, "SNAPTRADE_ACTIVITY");
        assert.equal(result.trades[0]?.symbol, "NVDA");
        assert.equal(result.trades[0]?.positionType, "option");
        assert.equal(result.trades[0]?.avgClose, 0);
        assert.equal(
          new Date(result.trades[0]?.closeDate ?? "").toISOString().slice(0, 10),
          "2026-06-26",
        );
        assert.equal(result.trades[0]?.realizedPnl, -161);
        assert.equal(result.summary.realizedPnl, -161);
      }),
    ),
  );
});

test("combined account closed trades include SnapTrade option expirations", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () =>
      withEmptyIbkrAccounts(async () => {
        const { auth, account } = await createProviderAccount({
          email: "combined-snaptrade-expiration-history@example.com",
          provider: "snaptrade",
          providerAccountId: "snaptrade:acct-combined-expiration-history",
        });

        await db.insert(snapTradeAccountActivitiesTable).values([
          {
            accountId: account.id,
            snapTradeActivityId: "combined-expiration-open",
            tradeDate: new Date("2026-06-01T14:30:00.000Z"),
            settlementDate: new Date("2026-06-02T14:30:00.000Z"),
            type: "BUY",
            optionType: "BUY_TO_OPEN",
            symbol: "NVDA260626C00205000",
            rawSymbol: "NVDA260626C00205000",
            description: "Bought NVDA calls",
            optionTicker: "NVDA260626C00205000",
            quantity: "2.000000",
            price: "0.800000",
            amount: "-160.000000",
            fee: "1.000000",
            currency: "USD",
            externalReferenceId: null,
            rawPayload: {},
          },
          {
            accountId: account.id,
            snapTradeActivityId: "combined-expiration-close",
            tradeDate: new Date("2026-06-29T07:00:00.000Z"),
            settlementDate: new Date("2026-06-29T07:00:00.000Z"),
            type: "OPTIONEXPIRATION",
            optionType: null,
            symbol: "NVDA",
            rawSymbol: null,
            description: "CALL NVDA 06/26/26 205.000",
            optionTicker: "NVDA260626C00205000",
            quantity: "-2.000000",
            price: "0.000000",
            amount: "0.000000",
            fee: "0.000000",
            currency: "USD",
            externalReferenceId: null,
            rawPayload: {},
          },
        ]);

        const result = await getAccountClosedTrades({
          accountId: "combined",
          appUserId: auth.user.id,
          from: new Date("2026-06-01T00:00:00.000Z"),
          to: new Date("2026-06-30T23:59:59.999Z"),
          mode: "live",
          source: "combined-snaptrade-expiration-test",
        });

        assert.equal(result.trades.length, 1);
        assert.equal(result.trades[0]?.source, "SNAPTRADE_ACTIVITY");
        assert.equal(result.trades[0]?.symbol, "NVDA");
        assert.equal(result.trades[0]?.avgClose, 0);
        assert.equal(
          new Date(result.trades[0]?.closeDate ?? "").toISOString().slice(0, 10),
          "2026-06-26",
        );
        assert.equal(result.trades[0]?.realizedPnl, -161);
        assert.equal(result.summary.realizedPnl, -161);
      }),
    ),
  );
});

test("generic account closed trades include Robinhood realized-P&L backfill", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () =>
      withEmptyIbkrAccounts(async () => {
        const { auth, account } = await createProviderAccount({
          email: "generic-robinhood-history@example.com",
          provider: "robinhood",
          providerAccountId: "robinhood:560316630",
        });

        await db.insert(robinhoodAccountActivitiesTable).values({
          accountId: account.id,
          activityKey: "rh-aapl-close",
          closedAt: new Date("2026-06-05T18:00:00.000Z"),
          symbol: "AAPL",
          side: "sell",
          quantity: "10.000000",
          price: "195.250000",
          realizedGain: "142.500000",
          currency: "USD",
          rawPayload: {},
        });

        const result = await getAccountClosedTrades({
          accountId: account.id,
          appUserId: auth.user.id,
          from: new Date("2026-06-01T00:00:00.000Z"),
          to: new Date("2026-06-30T23:59:59.999Z"),
          mode: "live",
        });

        assert.equal(result.trades.length, 1);
        assert.equal(result.trades[0]?.source, "ROBINHOOD_ACTIVITY");
        assert.equal(result.trades[0]?.symbol, "AAPL");
        assert.equal(result.trades[0]?.realizedPnl, 142.5);
        assert.equal(result.summary.realizedPnl, 142.5);
      }),
    ),
  );
});
