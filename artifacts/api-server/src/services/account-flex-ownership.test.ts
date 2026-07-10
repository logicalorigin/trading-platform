import assert from "node:assert/strict";
import test from "node:test";

import {
  balanceSnapshotsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  flexNavHistoryTable,
  usersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";

import { listAccounts, recordAccountSnapshots } from "./account";
import { runAsAppUser } from "./app-user-context";

const listFlexAccountsForCurrentUser = () =>
  listAccounts(
    { mode: "live" },
    {
      listLiveAccounts: async () => [],
      getPersistedAccounts: async () => ({
        accounts: [],
        latestSnapshotAt: null,
      }),
      recordSnapshots: async () => {},
      getSnapTradeAccounts: async () => [],
      getRobinhoodAccounts: async () => [],
    },
  );

test("Flex discovery isolates provider accounts by app user and mode", async () => {
  await withTestDb(async () => {
    const [userA, userB] = await db
      .insert(usersTable)
      .values([
        { email: "flex-a@example.com", passwordHash: "test-only" },
        { email: "flex-b@example.com", passwordHash: "test-only" },
      ])
      .returning({ id: usersTable.id });
    assert.ok(userA);
    assert.ok(userB);

    const [connectionA, connectionB] = await db
      .insert(brokerConnectionsTable)
      .values([
        {
          appUserId: userA.id,
          name: "IBKR A",
          connectionType: "broker",
          brokerProvider: "ibkr",
          mode: "live",
          status: "connected",
        },
        {
          appUserId: userB.id,
          name: "IBKR B",
          connectionType: "broker",
          brokerProvider: "ibkr",
          mode: "live",
          status: "connected",
        },
      ])
      .returning({ id: brokerConnectionsTable.id });
    assert.ok(connectionA);
    assert.ok(connectionB);

    await db.insert(brokerAccountsTable).values([
      {
        appUserId: userA.id,
        connectionId: connectionA.id,
        providerAccountId: "FLEX-A",
        displayName: "Flex A",
        mode: "live",
      },
      {
        appUserId: userB.id,
        connectionId: connectionB.id,
        providerAccountId: "FLEX-B",
        displayName: "Flex B",
        mode: "live",
      },
      {
        appUserId: userA.id,
        connectionId: connectionA.id,
        providerAccountId: "FLEX-SHARED",
        displayName: "Shared A",
        mode: "live",
      },
      {
        appUserId: userB.id,
        connectionId: connectionB.id,
        providerAccountId: "FLEX-SHARED",
        displayName: "Shared B",
        mode: "live",
      },
    ]);
    await db.insert(flexNavHistoryTable).values([
      {
        providerAccountId: "FLEX-A",
        statementDate: "2026-07-08",
        netAssetValue: "100",
      },
      {
        providerAccountId: "FLEX-B",
        statementDate: "2026-07-08",
        netAssetValue: "200",
      },
      {
        providerAccountId: "FLEX-SHARED",
        statementDate: "2026-07-08",
        netAssetValue: "300",
      },
    ]);

    const forUserA = await runAsAppUser(userA.id, listFlexAccountsForCurrentUser);
    const forUserB = await runAsAppUser(userB.id, listFlexAccountsForCurrentUser);
    const unauthenticated = await listFlexAccountsForCurrentUser();

    assert.deepEqual(forUserA.accounts.map((account) => account.id), ["FLEX-A"]);
    assert.deepEqual(forUserB.accounts.map((account) => account.id), ["FLEX-B"]);
    assert.deepEqual(unauthenticated.accounts, []);
  });
});

test("IBKR snapshot writes isolate the same provider account by app user", async () => {
  await withTestDb(async () => {
    const [userA, userB] = await db
      .insert(usersTable)
      .values([
        { email: "snapshot-a@example.com", passwordHash: "test-only" },
        { email: "snapshot-b@example.com", passwordHash: "test-only" },
      ])
      .returning({ id: usersTable.id });
    assert.ok(userA);
    assert.ok(userB);

    const snapshot = {
      id: "DU-SHARED",
      providerAccountId: "DU-SHARED",
      provider: "ibkr" as const,
      mode: "live" as const,
      currency: "USD",
      buyingPower: 200,
      cash: 100,
      netLiquidation: 300,
      updatedAt: new Date("2026-07-10T12:00:00.000Z"),
    };

    await runAsAppUser(userB.id, () =>
      recordAccountSnapshots([{ ...snapshot, displayName: "User B IBKR" }], {
        nowMs: () => 120_000,
      }),
    );
    await runAsAppUser(userA.id, () =>
      recordAccountSnapshots([{ ...snapshot, displayName: "User A IBKR" }], {
        nowMs: () => 120_001,
      }),
    );
    await runAsAppUser(userA.id, () =>
      recordAccountSnapshots(
        [
          {
            ...snapshot,
            displayName: "User A IBKR Updated",
            updatedAt: new Date("2026-07-10T12:01:00.000Z"),
          },
        ],
        { nowMs: () => 180_001 },
      ),
    );

    const connections = await db.select().from(brokerConnectionsTable);
    const accounts = await db.select().from(brokerAccountsTable);
    const balances = await db.select().from(balanceSnapshotsTable);
    const accountA = accounts.find((account) => account.appUserId === userA.id);
    const accountB = accounts.find((account) => account.appUserId === userB.id);

    assert.equal(connections.length, 2);
    assert.equal(accounts.length, 2);
    assert.equal(accountA?.displayName, "User A IBKR Updated");
    assert.equal(accountB?.displayName, "User B IBKR");
    assert.notEqual(accountA?.connectionId, accountB?.connectionId);
    assert.equal(
      balances.filter((balance) => balance.accountId === accountA?.id).length,
      2,
    );
    assert.equal(
      balances.filter((balance) => balance.accountId === accountB?.id).length,
      1,
    );
  });
});
