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
import { getSnapTradeAccountHistory } from "./snaptrade-account-history";
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

      const result = await getSnapTradeAccountHistory({
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

      const result = await getSnapTradeAccountHistory({
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

      assert.equal(result.closedTrades.trades.length, 0);
      assert.equal(result.equityHistory.points.length, 0);
      assert.equal(result.balanceHistory.available, false);
      assert.equal(result.balanceHistory.reason, "snaptrade_balance_history_unavailable");
    }),
  );
});
