import assert from "node:assert/strict";
import test from "node:test";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  flexNavHistoryTable,
  usersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";

import { listAccounts } from "./account";
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
