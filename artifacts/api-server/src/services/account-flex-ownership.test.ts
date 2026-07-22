import assert from "node:assert/strict";
import test from "node:test";

import {
  balanceSnapshotsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  currentDbLane,
  db,
  flexNavHistoryTable,
  runInDbLane,
  usersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";

import {
  __accountSnapshotPersistenceInternalsForTests,
  listAccounts,
  recordAccountSnapshots,
} from "./account";
import { runAsAppUser } from "./app-user-context";

const listFlexAccountsForCurrentUser = () =>
  listAccounts(
    { mode: "live" },
    {
      listLiveAccounts: async () => [],
      recordSnapshots: async () => {},
      getSnapTradeAccounts: async () => [],
      getRobinhoodAccounts: async () => [],
    },
  );

test("Flex history never substitutes for the live Account list", async () => {
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

    assert.deepEqual(forUserA.accounts, []);
    assert.deepEqual(forUserB.accounts, []);
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

test("IBKR snapshot persistence is idempotent across process-local cache loss", async () => {
  await withTestDb(async ({ client }) => {
    await client.exec("DROP INDEX balance_snapshots_account_as_of_unique_idx");
    const [user] = await db
      .insert(usersTable)
      .values({
        email: "snapshot-restart@example.com",
        passwordHash: "test-only",
      })
      .returning({ id: usersTable.id });
    assert.ok(user);
    const snapshot = {
      id: "DU-RESTART",
      providerAccountId: "DU-RESTART",
      provider: "ibkr" as const,
      displayName: "Restart-safe IBKR",
      mode: "live" as const,
      currency: "USD",
      buyingPower: 200,
      cash: 100,
      netLiquidation: 300,
      updatedAt: new Date("2026-07-16T12:00:00.000Z"),
    };

    __accountSnapshotPersistenceInternalsForTests.resetCaches();
    try {
      await recordAccountSnapshots([snapshot], {
        appUserId: user.id,
        nowMs: () => 120_000,
      });
      __accountSnapshotPersistenceInternalsForTests.resetCaches();
      await recordAccountSnapshots([snapshot], {
        appUserId: user.id,
        nowMs: () => 120_000,
      });

      assert.equal((await db.select().from(balanceSnapshotsTable)).length, 1);
    } finally {
      __accountSnapshotPersistenceInternalsForTests.resetCaches();
    }
  });
});

test("detached account snapshot persistence uses the background DB lane", async () => {
  __accountSnapshotPersistenceInternalsForTests.resetCaches();
  let persistedLane: string | null = null;
  try {
    await runInDbLane("interactive", () =>
      recordAccountSnapshots(
        [
          {
            id: "DU-LANE",
            providerAccountId: "DU-LANE",
            provider: "ibkr",
            displayName: "Lane-owned IBKR",
            mode: "live",
            currency: "USD",
            buyingPower: 200,
            cash: 100,
            netLiquidation: 300,
            updatedAt: new Date("2026-07-18T20:00:00.000Z"),
          },
        ],
        {
          appUserId: "lane-user",
          nowMs: () => 120_000,
          persistSnapshots: async () => {
            persistedLane = currentDbLane();
          },
        },
      ),
    );
    assert.equal(persistedLane, "background");
  } finally {
    __accountSnapshotPersistenceInternalsForTests.resetCaches();
  }
});
