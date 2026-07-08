import assert from "node:assert/strict";
import test from "node:test";

import {
  balanceSnapshotsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  snapTradeAccountActivitiesTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { bootstrapInitialUser } from "./auth";
import {
  getSnapTradeAccountHistory,
  ingestSnapTradeAccountHistory,
} from "./snaptrade-account-history";
import {
  deriveSnapTradeUserId,
  recordSnapTradeUserCredential,
} from "./snaptrade-user-custody";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString("base64url");

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

async function createSnapTradeAccount(email: string) {
  const auth = await bootstrapInitialUser({
    email,
    password: "correct horse battery staple",
    bootstrapToken: "setup-token",
  });
  const snapTradeUserId = deriveSnapTradeUserId(auth.user.id);
  await recordSnapTradeUserCredential({
    appUserId: auth.user.id,
    snapTradeUserId,
    userSecret: "snaptrade-user-secret",
    encryptionKey: TEST_ENCRYPTION_KEY,
  });

  const [connection] = await db
    .insert(brokerConnectionsTable)
    .values({
      appUserId: auth.user.id,
      name: `snaptrade:${email}`,
      connectionType: "broker",
      brokerProvider: "snaptrade",
      mode: "live",
      status: "connected",
      capabilities: ["accounts", "positions", "snaptrade"],
    })
    .returning({ id: brokerConnectionsTable.id });
  const [account] = await db
    .insert(brokerAccountsTable)
    .values({
      appUserId: auth.user.id,
      connectionId: connection.id,
      providerAccountId: "snaptrade:acct-history-1",
      displayName: "E*TRADE History",
      mode: "live",
      baseCurrency: "USD",
      lastSyncedAt: "2026-07-01T19:10:00.000Z",
    })
    .returning({ id: brokerAccountsTable.id });

  return { auth, account, snapTradeUserId };
}

test("SnapTrade account history backfills activities and beta balance history", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const { auth, account, snapTradeUserId } =
        await createSnapTradeAccount("history@example.com");
      const requestedUrls: string[] = [];
      const fetchImpl: typeof fetch = async (url, init) => {
        requestedUrls.push(String(url));
        assert.equal(init?.method, "GET");
        const requestUrl = new URL(String(url));
        assert.equal(requestUrl.origin, "https://api.snaptrade.com");
        assert.equal(requestUrl.searchParams.get("clientId"), "client-123");
        assert.equal(requestUrl.searchParams.get("timestamp"), "1782936000");
        assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
        assert.equal(
          requestUrl.searchParams.get("userSecret"),
          "snaptrade-user-secret",
        );

        if (requestUrl.pathname === "/api/v1/accounts/acct-history-1/activities") {
          assert.equal(requestUrl.searchParams.get("limit"), "1000");
          assert.equal(requestUrl.searchParams.get("offset"), "0");
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "act-option-open",
                  symbol: {
                    symbol: "BLDP260821C00005000",
                    raw_symbol: "BLDP260821C00005000",
                    description: "BLDP Aug 21 2026 5 Call",
                    currency: { code: "USD" },
                  },
                  price: 0.8,
                  units: 2,
                  amount: -160,
                  currency: { code: "USD" },
                  type: "BUY",
                  option_type: "BUY_TO_OPEN",
                  description: "Bought BLDP calls",
                  trade_date: "2026-06-01T00:00:00.000Z",
                  settlement_date: "2026-06-02T00:00:00.000Z",
                  fee: 1,
                  external_reference_id: "order-1",
                },
                {
                  id: "act-option-close",
                  symbol: {
                    symbol: "BLDP260821C00005000",
                    raw_symbol: "BLDP260821C00005000",
                    description: "BLDP Aug 21 2026 5 Call",
                    currency: { code: "USD" },
                  },
                  price: 1.25,
                  units: -2,
                  amount: 250,
                  currency: { code: "USD" },
                  type: "SELL",
                  option_type: "SELL_TO_CLOSE",
                  description: "Sold BLDP calls",
                  trade_date: "2026-06-15T00:00:00.000Z",
                  settlement_date: "2026-06-16T00:00:00.000Z",
                  fee: 1,
                  external_reference_id: "order-2",
                },
                {
                  id: "act-dividend",
                  symbol: null,
                  price: null,
                  units: null,
                  amount: 5,
                  currency: { code: "USD" },
                  type: "DIVIDEND",
                  description: "Cash dividend",
                  trade_date: "2026-06-20T00:00:00.000Z",
                  settlement_date: "2026-06-20T00:00:00.000Z",
                  fee: 0,
                },
              ],
              pagination: { offset: 0, limit: 1000, total: 3 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (requestUrl.pathname === "/api/v1/accounts/acct-history-1/balanceHistory") {
          return new Response(
            JSON.stringify({
              history: [
                { date: "2026-06-01", total_value: "1000.00" },
                { date: "2026-06-15", total_value: "1090.00" },
              ],
              currency: "USD",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ message: "unexpected path" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      };

      // Background/scheduler path: the ingest does the live SnapTrade pull + store.
      const ingest = await ingestSnapTradeAccountHistory({
        appUserId: auth.user.id,
        accountId: account.id,
        env: {
          SNAPTRADE_CLIENTID: "client-123",
          SNAPTRADE_API_KEY: "consumer-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T20:00:00.000Z"),
        fetchImpl,
      });

      assert.deepEqual(
        requestedUrls.map((url) => new URL(url).pathname).sort(),
        [
          "/api/v1/accounts/acct-history-1/activities",
          "/api/v1/accounts/acct-history-1/balanceHistory",
        ],
      );
      assert.doesNotMatch(requestedUrls.join("\n"), /consumer-secret/);
      assert.equal(ingest.activitiesStored, 3);
      assert.equal(ingest.balanceSnapshotsStored, 2);

      // Read path is STORED-FIRST: it serves persisted data and makes NO blocking
      // live SnapTrade call (the ~17s ingest that used to time out is gone).
      requestedUrls.length = 0;
      const result = await getSnapTradeAccountHistory({
        appUserId: auth.user.id,
        accountId: account.id,
        now: new Date("2026-07-01T20:00:00.000Z"),
      });
      assert.equal(requestedUrls.length, 0);

      assert.equal(result.provider, "snaptrade");
      assert.equal(result.closedTrades.trades.length, 1);
      assert.equal(result.closedTrades.trades[0]?.symbol, "BLDP");
      assert.equal(result.closedTrades.trades[0]?.positionType, "option");
      assert.equal(result.closedTrades.trades[0]?.avgOpen, 0.805);
      assert.equal(result.closedTrades.trades[0]?.avgClose, 1.245);
      assert.equal(result.closedTrades.trades[0]?.realizedPnl, 88);
      assert.equal(result.closedTrades.summary.realizedPnl, 88);
      assert.equal(result.equityHistory.points.length, 2);
      assert.equal(result.equityHistory.points[1]?.netLiquidation, 1090);
      assert.equal(result.equityHistory.points[1]?.returnPercent, 9);
      assert.equal(result.equityHistory.events.length, 1);
      assert.equal(result.equityHistory.events[0]?.type, "dividend");
      assert.equal(result.balanceHistory.available, true);
      assert.equal(result.backfill.activitiesStored, 3);
      assert.equal(result.backfill.balanceSnapshotsStored, 2);

      const storedActivities = await db
        .select()
        .from(snapTradeAccountActivitiesTable);
      assert.equal(storedActivities.length, 3);
      assert.equal(storedActivities[0]?.snapTradeActivityId, "act-option-open");

      const storedSnapshots = await db.select().from(balanceSnapshotsTable);
      assert.equal(storedSnapshots.length, 2);
      assert.equal(storedSnapshots[0]?.netLiquidation, "1000.000000");
    }),
  );
});

test("SnapTrade account history degrades gracefully when beta balance history is disabled", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const { auth, account } =
        await createSnapTradeAccount("history-beta-disabled@example.com");
      const fetchImpl: typeof fetch = async (url) => {
        const requestUrl = new URL(String(url));
        if (requestUrl.pathname === "/api/v1/accounts/acct-history-1/activities") {
          return new Response(
            JSON.stringify({ data: [], pagination: { offset: 0, limit: 1000, total: 0 } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (requestUrl.pathname === "/api/v1/accounts/acct-history-1/balanceHistory") {
          return new Response(JSON.stringify({ detail: "disabled" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ message: "unexpected path" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      };

      // Seed via the background ingest: activities empty, balanceHistory 403.
      const ingest = await ingestSnapTradeAccountHistory({
        appUserId: auth.user.id,
        accountId: account.id,
        env: {
          SNAPTRADE_CLIENTID: "client-123",
          SNAPTRADE_API_KEY: "consumer-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T20:00:00.000Z"),
        fetchImpl,
      });
      assert.equal(ingest.activitiesStored, 0);
      assert.equal(ingest.balanceSnapshotsStored, 0);

      const result = await getSnapTradeAccountHistory({
        appUserId: auth.user.id,
        accountId: account.id,
        now: new Date("2026-07-01T20:00:00.000Z"),
      });

      assert.equal(result.closedTrades.trades.length, 0);
      assert.equal(result.equityHistory.points.length, 0);
      assert.equal(result.balanceHistory.available, false);
      assert.equal(
        result.balanceHistory.reason,
        "snaptrade_balance_history_unavailable",
      );
    }),
  );
});

test("SnapTrade account history reconstructs sparse equity from the activity ledger", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const { auth, account } =
        await createSnapTradeAccount("history-reconstructed@example.com");
      await db.insert(snapTradeAccountActivitiesTable).values([
        {
          accountId: account.id,
          snapTradeActivityId: "cash-contribution",
          tradeDate: new Date("2024-01-01T15:00:00.000Z"),
          settlementDate: new Date("2024-01-01T15:00:00.000Z"),
          type: "CONTRIBUTION",
          optionType: null,
          symbol: null,
          rawSymbol: null,
          description: "Cash contribution",
          optionTicker: null,
          quantity: null,
          price: null,
          amount: "1000.000000",
          fee: "0.000000",
          currency: "USD",
          externalReferenceId: null,
          rawPayload: {},
          updatedAt: new Date("2024-01-01T15:00:00.000Z"),
        },
        {
          accountId: account.id,
          snapTradeActivityId: "aapl-open",
          tradeDate: new Date("2024-01-02T15:00:00.000Z"),
          settlementDate: new Date("2024-01-03T15:00:00.000Z"),
          type: "TRADE",
          optionType: null,
          symbol: "AAPL",
          rawSymbol: "AAPL",
          description: "Bought AAPL",
          optionTicker: null,
          quantity: "10.000000",
          price: "50.000000",
          amount: "-500.000000",
          fee: "1.000000",
          currency: "USD",
          externalReferenceId: null,
          rawPayload: {},
          updatedAt: new Date("2024-01-02T15:00:00.000Z"),
        },
        {
          accountId: account.id,
          snapTradeActivityId: "aapl-close",
          tradeDate: new Date("2024-01-10T15:00:00.000Z"),
          settlementDate: new Date("2024-01-11T15:00:00.000Z"),
          type: "TRADE",
          optionType: null,
          symbol: "AAPL",
          rawSymbol: "AAPL",
          description: "Sold AAPL",
          optionTicker: null,
          quantity: "-10.000000",
          price: "70.000000",
          amount: "700.000000",
          fee: "1.000000",
          currency: "USD",
          externalReferenceId: null,
          rawPayload: {},
          updatedAt: new Date("2024-01-10T15:00:00.000Z"),
        },
        {
          accountId: account.id,
          snapTradeActivityId: "cash-dividend",
          tradeDate: new Date("2024-01-15T15:00:00.000Z"),
          settlementDate: new Date("2024-01-15T15:00:00.000Z"),
          type: "DIVIDEND",
          optionType: null,
          symbol: "AAPL",
          rawSymbol: "AAPL",
          description: "Cash dividend",
          optionTicker: null,
          quantity: null,
          price: null,
          amount: "10.000000",
          fee: "0.000000",
          currency: "USD",
          externalReferenceId: null,
          rawPayload: {},
          updatedAt: new Date("2024-01-15T15:00:00.000Z"),
        },
        {
          accountId: account.id,
          snapTradeActivityId: "account-fee",
          tradeDate: new Date("2024-01-20T15:00:00.000Z"),
          settlementDate: new Date("2024-01-20T15:00:00.000Z"),
          type: "FEE",
          optionType: null,
          symbol: null,
          rawSymbol: null,
          description: "Account fee",
          optionTicker: null,
          quantity: null,
          price: null,
          amount: "-3.000000",
          fee: "0.000000",
          currency: "USD",
          externalReferenceId: null,
          rawPayload: {},
          updatedAt: new Date("2024-01-20T15:00:00.000Z"),
        },
        {
          accountId: account.id,
          snapTradeActivityId: "cash-withdrawal",
          tradeDate: new Date("2024-01-25T15:00:00.000Z"),
          settlementDate: new Date("2024-01-25T15:00:00.000Z"),
          type: "WITHDRAWAL",
          optionType: null,
          symbol: null,
          rawSymbol: null,
          description: "Outgoing funds transfer",
          optionTicker: null,
          quantity: null,
          price: null,
          amount: "-100.000000",
          fee: "0.000000",
          currency: "USD",
          externalReferenceId: null,
          rawPayload: {},
          updatedAt: new Date("2024-01-25T15:00:00.000Z"),
        },
      ]);
      await db.insert(balanceSnapshotsTable).values({
        accountId: account.id,
        currency: "USD",
        cash: "0.000000",
        buyingPower: "0.000000",
        netLiquidation: "1105.000000",
        maintenanceMargin: null,
        asOf: new Date("2024-01-31T21:00:00.000Z"),
      });

      const result = await getSnapTradeAccountHistory({
        appUserId: auth.user.id,
        accountId: account.id,
        now: new Date("2024-02-01T12:00:00.000Z"),
      });

      assert.equal(result.closedTrades.summary.count, 1);
      assert.equal(result.closedTrades.summary.realizedPnl, 198);
      assert.equal(result.equityHistory.selectedSnapshotSource, "SNAPTRADE_ACTIVITY_LEDGER_RECONSTRUCTION");
      assert.equal(result.equityHistory.points.length, 31);
      assert.equal(result.equityHistory.points[0]?.netLiquidation, 1000);
      assert.equal(result.equityHistory.points.at(-1)?.netLiquidation, 1105);
      assert.equal(result.equityHistory.points[0]?.deposits, 1000);
      assert.equal(result.equityHistory.points[24]?.withdrawals, 100);
      assert.equal(result.equityHistory.points.at(-1)?.returnPercent, 20.5);

      const realizedByDay = new Map<string, number>();
      for (const trade of result.closedTrades.trades) {
        const key = trade.closeDate?.toISOString().slice(0, 10);
        if (!key) continue;
        realizedByDay.set(key, (realizedByDay.get(key) ?? 0) + (trade.realizedPnl ?? 0));
      }
      const dailyRealizedSum = Array.from(realizedByDay.values()).reduce(
        (sum, value) => sum + value,
        0,
      );
      assert.equal(dailyRealizedSum, result.closedTrades.summary.realizedPnl);
    }),
  );
});
