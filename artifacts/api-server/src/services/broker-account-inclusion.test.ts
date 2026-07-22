import assert from "node:assert/strict";
import test from "node:test";

import { eq } from "drizzle-orm";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  usersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import {
  listBrokerAccountInclusions,
  setBrokerAccountInclusions,
} from "./broker-account-inclusion";

async function createUser(email: string): Promise<string> {
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      displayName: null,
      passwordHash: "scrypt:v1:test-only",
      role: "member",
    })
    .returning({ id: usersTable.id });
  assert.ok(user);
  return user.id;
}

async function createBrokerConnection(
  appUserId: string,
  status: "configured" | "connected" | "disconnected" | "error" = "connected",
): Promise<string> {
  const [connection] = await db
    .insert(brokerConnectionsTable)
    .values({
      appUserId,
      name: `snaptrade:${appUserId}`,
      connectionType: "broker",
      brokerProvider: "snaptrade",
      mode: "live",
      status,
      capabilities: ["accounts", "positions"],
    })
    .returning({ id: brokerConnectionsTable.id });
  assert.ok(connection);
  return connection.id;
}

async function createBrokerAccount(input: {
  appUserId: string;
  connectionId: string;
  providerAccountId: string;
  displayName: string;
  accountType: string;
  includedInTrading: boolean;
  capabilities?: string[];
  executionBlockers?: string[];
}) {
  const [account] = await db
    .insert(brokerAccountsTable)
    .values({
      appUserId: input.appUserId,
      connectionId: input.connectionId,
      providerAccountId: input.providerAccountId,
      displayName: input.displayName,
      accountType: input.accountType,
      includedInTrading: input.includedInTrading,
      mode: "live",
      accountStatus: "open",
      baseCurrency: "USD",
      capabilities: input.capabilities ?? ["accounts", "positions"],
      executionBlockers: input.executionBlockers ?? [],
    })
    .returning({
      id: brokerAccountsTable.id,
      updatedAt: brokerAccountsTable.updatedAt,
    });
  assert.ok(account);
  return account;
}

test("broker account inclusions list category and inclusion fields for the app user", async () => {
  await withTestDb(async () => {
    const ownerId = await createUser("broker-inclusions-owner@example.com");
    const otherId = await createUser("broker-inclusions-other@example.com");
    const ownerConnectionId = await createBrokerConnection(ownerId);
    const otherConnectionId = await createBrokerConnection(otherId);

    const equity = await createBrokerAccount({
      appUserId: ownerId,
      connectionId: ownerConnectionId,
      providerAccountId: "snaptrade:equity-1",
      displayName: "Webull Individual Cash",
      accountType: "equity",
      includedInTrading: true,
      capabilities: ["accounts", "positions", "execution-ready"],
    });
    await createBrokerAccount({
      appUserId: ownerId,
      connectionId: ownerConnectionId,
      providerAccountId: "snaptrade:crypto-1",
      displayName: "Webull Crypto Cash",
      accountType: "crypto",
      includedInTrading: false,
      capabilities: ["accounts", "positions", "execution-ready"],
      executionBlockers: [
        "snaptrade.connection.read_only",
        "provider-secret=must-not-leak",
      ],
    });
    await createBrokerAccount({
      appUserId: otherId,
      connectionId: otherConnectionId,
      providerAccountId: "snaptrade:foreign-1",
      displayName: "Other User Account",
      accountType: "equity",
      includedInTrading: true,
    });

    const result = await listBrokerAccountInclusions({ appUserId: ownerId });

    assert.equal(result.accounts.length, 2);
    assert.deepEqual(
      result.accounts.map((account) => ({
        providerAccountId: account.providerAccountId,
        provider: account.provider,
        mode: account.mode,
        displayName: account.displayName,
        accountType: account.accountType,
        includedInTrading: account.includedInTrading,
        connectionVerified: account.connectionVerified,
        executionReady: account.executionReady,
        executionBlockers: account.executionBlockers,
      })),
      [
        {
          providerAccountId: "snaptrade:crypto-1",
          provider: "snaptrade",
          mode: "live",
          displayName: "Webull Crypto Cash",
          accountType: "crypto",
          includedInTrading: false,
          connectionVerified: true,
          executionReady: false,
          executionBlockers: [
            "snaptrade.connection.read_only",
            "broker.execution_unavailable",
          ],
        },
        {
          providerAccountId: "snaptrade:equity-1",
          provider: "snaptrade",
          mode: "live",
          displayName: "Webull Individual Cash",
          accountType: "equity",
          includedInTrading: true,
          connectionVerified: true,
          executionReady: true,
          executionBlockers: [],
        },
      ],
    );
    assert.equal(result.accounts[1]?.id, equity.id);
    assert.ok(result.accounts[1]?.updatedAt instanceof Date);
  });
});

test("disconnected broker connections remain visible but cannot be verified or execution-ready", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser(
      "broker-inclusions-disconnected@example.com",
    );
    const connectionId = await createBrokerConnection(
      appUserId,
      "disconnected",
    );
    await createBrokerAccount({
      appUserId,
      connectionId,
      providerAccountId: "snaptrade:disconnected",
      displayName: "Disconnected Account",
      accountType: "equity",
      includedInTrading: true,
      capabilities: ["accounts", "positions", "execution-ready"],
      executionBlockers: ["broker.connection_not_connected"],
    });

    const result = await listBrokerAccountInclusions({ appUserId });

    assert.deepEqual(
      result.accounts.map((account) => ({
        connectionVerified: account.connectionVerified,
        executionReady: account.executionReady,
        executionBlockers: account.executionBlockers,
      })),
      [
        {
          connectionVerified: false,
          executionReady: false,
          executionBlockers: ["broker.connection_not_connected"],
        },
      ],
    );
  });
});

test("broker accounts linked to another user's connection are excluded", async () => {
  await withTestDb(async () => {
    const ownerId = await createUser(
      "broker-inclusions-mismatched-owner@example.com",
    );
    const otherId = await createUser(
      "broker-inclusions-mismatched-connection@example.com",
    );
    const otherConnectionId = await createBrokerConnection(otherId);
    const mismatched = await createBrokerAccount({
      appUserId: ownerId,
      connectionId: otherConnectionId,
      providerAccountId: "snaptrade:mismatched-owner",
      displayName: "Mismatched Owner",
      accountType: "equity",
      includedInTrading: false,
      capabilities: ["accounts", "positions", "execution-ready"],
    });

    await setBrokerAccountInclusions({
      appUserId: ownerId,
      includedAccountIds: [mismatched.id],
    });
    const result = await listBrokerAccountInclusions({ appUserId: ownerId });
    const [persisted] = await db
      .select({ includedInTrading: brokerAccountsTable.includedInTrading })
      .from(brokerAccountsTable)
      .where(eq(brokerAccountsTable.id, mismatched.id));

    assert.deepEqual(result.accounts, []);
    assert.equal(persisted?.includedInTrading, false);
  });
});

test("accounts linked to a non-broker connection cannot be included", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser(
      "broker-inclusions-market-data-link@example.com",
    );
    const [connection] = await db
      .insert(brokerConnectionsTable)
      .values({
        appUserId,
        name: `massive:${appUserId}`,
        connectionType: "market_data",
        marketDataProvider: "massive",
        mode: "live",
        status: "connected",
        capabilities: ["quotes"],
      })
      .returning({ id: brokerConnectionsTable.id });
    assert.ok(connection);
    const nonBrokerAccount = await createBrokerAccount({
      appUserId,
      connectionId: connection.id,
      providerAccountId: "massive:not-a-broker-account",
      displayName: "Invalid market-data account link",
      accountType: "equity",
      includedInTrading: false,
      capabilities: ["execution-ready"],
    });

    const result = await setBrokerAccountInclusions({
      appUserId,
      includedAccountIds: [nonBrokerAccount.id],
    });
    const [persisted] = await db
      .select({ includedInTrading: brokerAccountsTable.includedInTrading })
      .from(brokerAccountsTable)
      .where(eq(brokerAccountsTable.id, nonBrokerAccount.id));

    assert.deepEqual(result.accounts, []);
    assert.equal(persisted?.includedInTrading, false);
  });
});

test("setting broker account inclusions ignores unknown and foreign ids", async () => {
  await withTestDb(async () => {
    const ownerId = await createUser("broker-inclusions-set-owner@example.com");
    const otherId = await createUser("broker-inclusions-set-other@example.com");
    const ownerConnectionId = await createBrokerConnection(ownerId);
    const otherConnectionId = await createBrokerConnection(otherId);

    const ownerEquity = await createBrokerAccount({
      appUserId: ownerId,
      connectionId: ownerConnectionId,
      providerAccountId: "snaptrade:owner-equity",
      displayName: "Owner Equity",
      accountType: "equity",
      includedInTrading: true,
    });
    const ownerCrypto = await createBrokerAccount({
      appUserId: ownerId,
      connectionId: ownerConnectionId,
      providerAccountId: "snaptrade:owner-crypto",
      displayName: "Owner Crypto",
      accountType: "crypto",
      includedInTrading: false,
    });
    const foreignEquity = await createBrokerAccount({
      appUserId: otherId,
      connectionId: otherConnectionId,
      providerAccountId: "snaptrade:foreign-equity",
      displayName: "Foreign Equity",
      accountType: "equity",
      includedInTrading: true,
    });
    const foreignCrossLinked = await createBrokerAccount({
      appUserId: otherId,
      connectionId: ownerConnectionId,
      providerAccountId: "snaptrade:foreign-cross-linked",
      displayName: "Foreign Cross-linked",
      accountType: "equity",
      includedInTrading: false,
    });

    const result = await setBrokerAccountInclusions({
      appUserId: ownerId,
      includedAccountIds: [
        ownerCrypto.id,
        ownerCrypto.id,
        foreignEquity.id,
        foreignCrossLinked.id,
        "00000000-0000-0000-0000-000000000000",
      ],
    });

    assert.deepEqual(
      result.accounts.map((account) => ({
        id: account.id,
        includedInTrading: account.includedInTrading,
      })),
      [
        { id: ownerCrypto.id, includedInTrading: true },
        { id: ownerEquity.id, includedInTrading: false },
      ],
    );

    const otherResult = await listBrokerAccountInclusions({
      appUserId: otherId,
    });
    assert.deepEqual(
      otherResult.accounts.map((account) => ({
        id: account.id,
        includedInTrading: account.includedInTrading,
      })),
      [{ id: foreignEquity.id, includedInTrading: true }],
    );
    const [persistedCrossLinked] = await db
      .select({ includedInTrading: brokerAccountsTable.includedInTrading })
      .from(brokerAccountsTable)
      .where(eq(brokerAccountsTable.id, foreignCrossLinked.id));
    assert.equal(persistedCrossLinked?.includedInTrading, false);
  });
});

test("broker account inclusion changes round-trip through persistence", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("broker-inclusions-roundtrip@example.com");
    const connectionId = await createBrokerConnection(appUserId);
    const equity = await createBrokerAccount({
      appUserId,
      connectionId,
      providerAccountId: "snaptrade:roundtrip-equity",
      displayName: "Roundtrip Equity",
      accountType: "equity",
      includedInTrading: true,
    });
    const futures = await createBrokerAccount({
      appUserId,
      connectionId,
      providerAccountId: "snaptrade:roundtrip-futures",
      displayName: "Roundtrip Futures",
      accountType: "futures",
      includedInTrading: false,
    });

    await setBrokerAccountInclusions({
      appUserId,
      includedAccountIds: [futures.id],
    });
    const afterFirstUpdate = await listBrokerAccountInclusions({ appUserId });
    assert.deepEqual(
      afterFirstUpdate.accounts.map((account) => ({
        id: account.id,
        includedInTrading: account.includedInTrading,
      })),
      [
        { id: equity.id, includedInTrading: false },
        { id: futures.id, includedInTrading: true },
      ],
    );

    await setBrokerAccountInclusions({
      appUserId,
      includedAccountIds: [],
    });
    const afterClearing = await listBrokerAccountInclusions({ appUserId });
    assert.deepEqual(
      afterClearing.accounts.map((account) => account.includedInTrading),
      [false, false],
    );
  });
});
