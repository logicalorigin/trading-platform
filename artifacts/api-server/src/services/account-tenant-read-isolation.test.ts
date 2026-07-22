import assert from "node:assert/strict";
import test from "node:test";

import {
  balanceSnapshotsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  usersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import type { BrokerAccountSnapshot } from "../providers/ibkr/client";
import { getAccountEquityHistory, listAccounts } from "./account";
import { __setIbkrAccountBridgeDependenciesForTests } from "./ibkr-account-bridge";

const PROVIDER_ACCOUNT_ID = "DUPLICATE-TENANT-ACCOUNT";

function liveAccount(netLiquidation: number): BrokerAccountSnapshot {
  return {
    id: PROVIDER_ACCOUNT_ID,
    providerAccountId: PROVIDER_ACCOUNT_ID,
    provider: "ibkr",
    mode: "live",
    displayName: "Duplicate tenant account",
    currency: "USD",
    buyingPower: netLiquidation,
    cash: netLiquidation,
    netLiquidation,
    updatedAt: new Date("2026-07-08T16:00:00.000Z"),
  };
}

test("account snapshot reads isolate duplicate provider IDs and preserve platform-null ownership", async () => {
  await withTestDb(async () => {
    const users = await db
      .insert(usersTable)
      .values([
        { email: "tenant-read-owner-a@example.invalid" },
        { email: "tenant-read-owner-b@example.invalid" },
      ])
      .returning({ id: usersTable.id });
    const ownerIds: Array<string | null> = [
      users[0]!.id,
      users[1]!.id,
      null,
    ];
    const connections = await db
      .insert(brokerConnectionsTable)
      .values(
        ownerIds.map((appUserId, index) => ({
          appUserId,
          name: `tenant-read-${index}`,
          connectionType: "broker" as const,
          brokerProvider: "ibkr" as const,
          mode: "live" as const,
          status: "connected" as const,
        })),
      )
      .returning({ id: brokerConnectionsTable.id });
    const accounts = await db
      .insert(brokerAccountsTable)
      .values(
        connections.map((connection, index) => ({
          appUserId: ownerIds[index] ?? null,
          connectionId: connection.id,
          providerAccountId: PROVIDER_ACCOUNT_ID,
          displayName: `Tenant read ${index}`,
          mode: "live" as const,
          baseCurrency: "USD",
        })),
      )
      .returning({ id: brokerAccountsTable.id });
    const baselines = [1000, 9000, 2000];
    await db.insert(balanceSnapshotsTable).values(
      accounts.map((account, index) => ({
        accountId: account.id,
        currency: "USD",
        cash: String(baselines[index]),
        buyingPower: String(baselines[index]),
        netLiquidation: String(baselines[index]),
        asOf: new Date(`2026-07-07T${18 + index}:00:00.000Z`),
      })),
    );

    const currentValues = [1100, 9200, 2300];
    const expectedDayPnl = [100, 200, 300];
    for (let index = 0; index < ownerIds.length; index += 1) {
      const result = await listAccounts(
        { mode: "live" },
        {
          appUserId: ownerIds[index],
          allowDirectIbkr: true,
          listLiveAccounts: async () => [liveAccount(currentValues[index]!)],
          recordSnapshots: async () => {},
          getSnapTradeAccounts: async () => [],
          getRobinhoodAccounts: async () => [],
        },
      );
      assert.equal(result.accounts[0]?.dayPnl, expectedDayPnl[index]);
    }

    __setIbkrAccountBridgeDependenciesForTests({
      bridgeClient: {
        listAccounts: async () => [liveAccount(5000)],
        listPositions: async () => [],
        listExecutions: async () => [],
      },
    });
    try {
      const visibility: boolean[][] = [];
      for (const appUserId of ownerIds) {
        const history = await getAccountEquityHistory({
          accountId: PROVIDER_ACCOUNT_ID,
          appUserId,
          allowDirectIbkr: true,
          range: "ALL",
          mode: "live",
        });
        const values = history.points.map((point) => point.netLiquidation);
        visibility.push(baselines.map((baseline) => values.includes(baseline)));
      }
      assert.deepEqual(visibility, [
        [true, false, false],
        [false, true, false],
        [false, false, true],
      ]);
    } finally {
      __setIbkrAccountBridgeDependenciesForTests(null);
    }
  });
});
