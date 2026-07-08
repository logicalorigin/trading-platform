import assert from "node:assert/strict";
import test from "node:test";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  robinhoodAccountActivitiesTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { bootstrapInitialUser } from "./auth";
import {
  ingestRobinhoodAccountHistory,
  readRobinhoodAccountActivities,
  type RobinhoodHistorySession,
} from "./robinhood-account-history";

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

async function createRobinhoodAccount(
  email: string,
  accountNumber = "560316630",
) {
  const auth = await bootstrapInitialUser({
    email,
    password: "correct horse battery staple",
    bootstrapToken: "setup-token",
  });
  const [connection] = await db
    .insert(brokerConnectionsTable)
    .values({
      appUserId: auth.user.id,
      name: `robinhood:${email}`,
      connectionType: "broker",
      brokerProvider: "robinhood",
      mode: "live",
      status: "connected",
      capabilities: ["accounts", "robinhood"],
    })
    .returning({ id: brokerConnectionsTable.id });
  const [account] = await db
    .insert(brokerAccountsTable)
    .values({
      appUserId: auth.user.id,
      connectionId: connection.id,
      providerAccountId: `robinhood:${accountNumber}`,
      displayName: "Robinhood Individual",
      mode: "live",
      baseCurrency: "USD",
    })
    .returning({ id: brokerAccountsTable.id });
  return { auth, account, accountNumber };
}

// Fake MCP session: serves get_pnl_trade_history as paged responses keyed by the
// cursor, so the ingest's pagination + dedup are exercised without a live server.
function fakePnlSession(
  pages: Array<{ trades: unknown[]; next_cursor?: string | null }>,
  opts: {
    expectAccountNumber?: string;
    calls?: string[];
    portfolioTotalValue?: string | null;
  } = {},
): RobinhoodHistorySession {
  return {
    async callTool(call) {
      opts.calls?.push(call.name);
      const args = call.arguments ?? {};
      // The ingest also snapshots the current balance via get_portfolio.
      if (call.name === "get_portfolio") {
        return {
          data: {
            total_value:
              opts.portfolioTotalValue === undefined
                ? "1000.00"
                : opts.portfolioTotalValue,
          },
        };
      }
      assert.equal(call.name, "get_pnl_trade_history");
      assert.equal(args["span"], "all");
      if (opts.expectAccountNumber) {
        assert.equal(args["account_number"], opts.expectAccountNumber);
      }
      const cursor = (args["cursor"] as string | undefined) ?? null;
      const index = cursor ? Number(cursor) : 0;
      const page = pages[index] ?? { trades: [], next_cursor: null };
      return {
        data: {
          account_number: args["account_number"],
          span: "all",
          trades: page.trades,
          next_cursor: page.next_cursor ?? null,
        },
      };
    },
  };
}

const TRADE_A = {
  timestamp: "2026-06-01T14:30:00Z",
  symbol: "AAPL",
  side: "sell",
  quantity: "10",
  price: "195.25",
  realized_gain: "142.50",
};
const TRADE_B = {
  timestamp: "2026-06-05T18:00:00Z",
  symbol: "MSFT",
  side: "sell",
  quantity: "5",
  price: "410.00",
  realized_gain: "-31.20",
};

test("Robinhood history backfills realized-P&L trades across pages", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const { auth, account, accountNumber } =
        await createRobinhoodAccount("rh-history@example.com");
      const calls: string[] = [];
      const session = fakePnlSession(
        [
          { trades: [TRADE_A], next_cursor: "1" },
          { trades: [TRADE_B], next_cursor: null },
        ],
        { expectAccountNumber: accountNumber, calls },
      );

      const result = await ingestRobinhoodAccountHistory({
        appUserId: auth.user.id,
        accountId: account.id,
        session,
      });

      assert.equal(result.tradesFetched, 2);
      assert.equal(result.activitiesStored, 2);
      assert.equal(
        calls.filter((c) => c === "get_pnl_trade_history").length,
        2,
      ); // paged twice (cursor followed)
      assert.equal(result.balanceSnapshotStored, true); // equity-curve point written

      const stored = await readRobinhoodAccountActivities(account.id);
      assert.equal(stored.length, 2);
      // Newest first.
      assert.equal(stored[0]!.symbol, "MSFT");
      assert.equal(stored[0]!.realizedGain, "-31.200000");
      assert.equal(stored[1]!.symbol, "AAPL");
      assert.equal(stored[1]!.side, "sell");
      assert.equal(stored[1]!.realizedGain, "142.500000");
    }),
  );
});

test("Robinhood history ingest is idempotent (re-run upserts, no duplicates)", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const { auth, account } = await createRobinhoodAccount(
        "rh-idempotent@example.com",
      );
      const pages = [{ trades: [TRADE_A, TRADE_B], next_cursor: null }];

      const first = await ingestRobinhoodAccountHistory({
        appUserId: auth.user.id,
        accountId: account.id,
        session: fakePnlSession(pages),
      });
      assert.equal(first.activitiesStored, 2);

      // Second run with the same data must not create duplicate rows.
      await ingestRobinhoodAccountHistory({
        appUserId: auth.user.id,
        accountId: account.id,
        session: fakePnlSession(pages),
      });

      const rows = await db
        .select()
        .from(robinhoodAccountActivitiesTable);
      assert.equal(rows.length, 2);
    }),
  );
});

test("Robinhood history rejects a non-Robinhood / unknown account", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const { auth } = await createRobinhoodAccount("rh-guard@example.com");
      await assert.rejects(
        ingestRobinhoodAccountHistory({
          appUserId: auth.user.id,
          accountId: "00000000-0000-0000-0000-000000000000",
          session: fakePnlSession([{ trades: [], next_cursor: null }]),
        }),
        /Robinhood account was not found/,
      );
    }),
  );
});
