import assert from "node:assert/strict";
import test from "node:test";

import { eq } from "drizzle-orm";
import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { bootstrapInitialUser } from "./auth";
import { syncRobinhoodConnections } from "./robinhood-account-sync";
import {
  beginRobinhoodConnectCustody,
  storeRobinhoodTokens,
} from "./robinhood-user-custody";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString("base64url");
const MCP_URL = "https://agent.robinhood.com/mcp/trading";

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

async function seedConnectedUser(email: string): Promise<string> {
  const auth = await bootstrapInitialUser({
    email,
    password: "correct horse battery staple",
    bootstrapToken: "setup-token",
  });
  await beginRobinhoodConnectCustody({
    appUserId: auth.user.id,
    oauthClientId: "client-abc",
    oauthState: "state-1",
    pkceVerifier: "verifier-1",
    encryptionKey: TEST_ENCRYPTION_KEY,
  });
  await storeRobinhoodTokens({
    appUserId: auth.user.id,
    accessToken: "access-1",
    refreshToken: "refresh-1",
    accessTokenExpiresAt: null,
    scope: "internal",
    encryptionKey: TEST_ENCRYPTION_KEY,
  });
  return auth.user.id;
}

function mcpFetch(accountsPayload: unknown): typeof fetch {
  return async (url, init) => {
    assert.equal(String(url), MCP_URL);
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (payload["method"] === "initialize") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: payload["id"],
          result: { protocolVersion: "2025-03-26" },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Mcp-Session-Id": "session-1",
          },
        },
      );
    }
    if (payload["method"] === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    assert.equal(payload["method"], "tools/call");
    assert.equal(
      (payload["params"] as Record<string, unknown>)["name"],
      "get_accounts",
    );
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer access-1");
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: payload["id"],
        result: { structuredContent: accountsPayload },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
}

const TWO_ACCOUNTS = {
  accounts: [
    {
      id: "agentic-acct-1",
      name: "Agentic account 12345678",
      account_number: "12345678",
      type: "agentic",
      status: "active",
      currency: "usd",
    },
    {
      id: "individual-acct-2",
      is_agentic: false,
      account_number: "87654321",
      status: "open",
    },
  ],
};

test("Robinhood sync reads accounts over MCP and upserts sanitized broker records", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const appUserId = await seedConnectedUser("owner@example.com");
      const syncedAt = new Date("2026-07-02T19:00:00.000Z");

      const result = await syncRobinhoodConnections({
        appUserId,
        fetchImpl: mcpFetch(TWO_ACCOUNTS),
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: syncedAt,
      });

      assert.equal(result.provider, "robinhood");
      assert.equal(result.connections.length, 1);
      assert.equal(result.connections[0]!.executionReady, false);
      assert.equal(result.accounts.length, 2);

      const agentic = result.accounts.find(
        (account) => account.robinhoodAccountId === "agentic-acct-1",
      );
      assert.ok(agentic);
      assert.equal(agentic.agentic, true);
      assert.equal(agentic.status, "open");
      assert.equal(agentic.baseCurrency, "USD");
      // Full account numbers are redacted before persistence.
      assert.ok(!agentic.displayName.includes("12345678"));
      assert.ok(
        agentic.executionBlockers.includes(
          "robinhood.order_tooling_unverified",
        ),
      );
      assert.ok(
        !agentic.executionBlockers.includes("robinhood.account.non_agentic"),
      );

      const individual = result.accounts.find(
        (account) => account.robinhoodAccountId === "individual-acct-2",
      );
      assert.ok(individual);
      assert.equal(individual.agentic, false);
      assert.ok(
        individual.executionBlockers.includes("robinhood.account.non_agentic"),
      );

      const connectionRows = await db
        .select()
        .from(brokerConnectionsTable)
        .where(eq(brokerConnectionsTable.brokerProvider, "robinhood"));
      assert.equal(connectionRows.length, 1);
      assert.equal(connectionRows[0]!.appUserId, appUserId);
      assert.equal(connectionRows[0]!.status, "connected");
      assert.equal(connectionRows[0]!.mode, "live");

      const accountRows = await db
        .select()
        .from(brokerAccountsTable)
        .where(eq(brokerAccountsTable.appUserId, appUserId));
      assert.equal(accountRows.length, 2);
      assert.ok(
        accountRows.every((row) =>
          row.providerAccountId.startsWith("robinhood:"),
        ),
      );
    }),
  );
});

test("Robinhood sync is idempotent across repeated runs", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const appUserId = await seedConnectedUser("owner@example.com");

      const first = await syncRobinhoodConnections({
        appUserId,
        fetchImpl: mcpFetch(TWO_ACCOUNTS),
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-02T19:00:00.000Z"),
      });
      const second = await syncRobinhoodConnections({
        appUserId,
        fetchImpl: mcpFetch(TWO_ACCOUNTS),
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-02T19:05:00.000Z"),
      });

      assert.equal(
        second.connections[0]!.id,
        first.connections[0]!.id,
      );
      assert.deepEqual(
        second.accounts.map((account) => account.id).sort(),
        first.accounts.map((account) => account.id).sort(),
      );

      const accountRows = await db
        .select()
        .from(brokerAccountsTable)
        .where(eq(brokerAccountsTable.appUserId, appUserId));
      assert.equal(accountRows.length, 2);
    }),
  );
});

test("Robinhood sync rejects when the user has not completed the OAuth connect", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await bootstrapInitialUser({
        email: "owner@example.com",
        password: "correct horse battery staple",
        bootstrapToken: "setup-token",
      });

      await assert.rejects(
        syncRobinhoodConnections({
          appUserId: auth.user.id,
          fetchImpl: mcpFetch(TWO_ACCOUNTS),
          encryptionKey: TEST_ENCRYPTION_KEY,
        }),
        (error: unknown) =>
          (error as { code?: string }).code === "robinhood_user_not_connected",
      );
    }),
  );
});
