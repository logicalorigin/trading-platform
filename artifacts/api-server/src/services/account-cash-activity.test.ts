import assert from "node:assert/strict";
import test from "node:test";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  currentDbLane,
  db,
  flexCashActivityTable,
  flexDividendsTable,
  flexReportRunsTable,
  usersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";

import { HttpError } from "../lib/errors";
import { __accountFlexInternalsForTests as internals } from "./account";

test("scheduled Flex refreshes execute in the background DB lane", async () => {
  const observations: string[] = [];

  await internals.runScheduledFlexRefresh("scheduled-initial", {
    shouldRunInitialFlexRefresh: async () => {
      observations.push(`check:${currentDbLane()}`);
      return true;
    },
    refreshFlexReport: async (reason) => {
      observations.push(`${reason}:${currentDbLane()}`);
      return null;
    },
  });

  assert.deepEqual(observations, [
    "check:background",
    "scheduled-initial:background",
  ]);
});

test("cash coverage requires gap-free completed Flex windows for every account", () => {
  const runs = [
    {
      metadata: {
        window: { fromDate: "2026-01-01", toDate: "2026-03-31" },
        providerAccountIds: ["DU-A", "DU-B"],
      },
    },
    {
      metadata: {
        window: { fromDate: "2026-04-01", toDate: "2026-07-16" },
        providerAccountIds: ["DU-A", "DU-B"],
      },
    },
  ];

  assert.equal(
    internals.completedFlexRunsCoverRange({
      runs,
      providerAccountIds: ["DU-A", "DU-B"],
      fromDate: "2026-01-01",
      toDate: "2026-07-16",
    }),
    true,
  );
  assert.equal(
    internals.completedFlexRunsCoverRange({
      runs: runs.slice(1),
      providerAccountIds: ["DU-A", "DU-B"],
      fromDate: "2026-01-01",
      toDate: "2026-07-16",
    }),
    false,
  );
  assert.equal(
    internals.completedFlexRunsCoverRange({
      runs,
      providerAccountIds: ["DU-A", "DU-C"],
      fromDate: "2026-01-01",
      toDate: "2026-07-16",
    }),
    false,
  );
});

test("Flex report headers persist account coverage even when cash rows are empty", () => {
  assert.deepEqual(
    internals.flexProviderAccountIdsFromReport(`
      <FlexQueryResponse>
        <FlexStatement accountId="DU-A"></FlexStatement>
        <FlexStatement accountId="DU-B"></FlexStatement>
      </FlexQueryResponse>
    `),
    ["DU-A", "DU-B"],
  );
});

test("Flex cash totals include complete YTD rows while display lists stay ranged and bounded", async () => {
  await withTestDb(async () => {
    const now = new Date("2026-07-16T20:00:00.000Z");
    const [user] = await db
      .insert(usersTable)
      .values({
        email: "cash-activity@example.com",
        passwordHash: "test-only",
      })
      .returning({ id: usersTable.id });
    assert.ok(user);
    const [connection] = await db
      .insert(brokerConnectionsTable)
      .values({
        appUserId: user.id,
        name: "Cash Activity IBKR",
        connectionType: "broker",
        brokerProvider: "ibkr",
        mode: "live",
        status: "connected",
      })
      .returning({ id: brokerConnectionsTable.id });
    assert.ok(connection);
    await db.insert(brokerAccountsTable).values({
      appUserId: user.id,
      connectionId: connection.id,
      providerAccountId: "DU-CASH",
      displayName: "Cash Activity",
      mode: "live",
    });
    await db.insert(flexReportRunsTable).values({
      queryId: "cash-activity-test",
      status: "completed",
      completedAt: now,
      metadata: {
        window: { fromDate: "2026-01-01", toDate: "2026-07-16" },
        providerAccountIds: ["DU-CASH"],
      },
    });
    const universe = {
      appUserId: user.id,
      allowDirectIbkr: false,
      requestedAccountId: "DU-CASH",
      accountIds: ["DU-CASH"],
      isCombined: false,
      accounts: [
        {
          id: "DU-CASH",
          providerAccountId: "DU-CASH",
          provider: "ibkr" as const,
          displayName: "Cash Activity",
          mode: "live" as const,
          currency: "USD",
          settledCash: 80,
          cash: 100,
          buyingPower: 200,
          netLiquidation: 300,
          updatedAt: now,
        },
      ],
      primaryCurrency: "USD",
      source: "live" as const,
      latestSnapshotAt: now,
    };

    const visibleAt = new Date("2026-07-15T12:00:00.000Z");
    await db.insert(flexCashActivityTable).values([
      ...Array.from({ length: 200 }, (_, index) => ({
        providerAccountId: "DU-CASH",
        activityId: `visible-${index}`,
        activityType: "Deposit",
        description: "Visible display activity",
        amount: "0",
        activityDate: new Date(visibleAt.getTime() + index),
      })),
      {
        providerAccountId: "DU-CASH",
        activityId: "older-fee",
        activityType: "Commission",
        description: "Older YTD commission",
        amount: "-7",
        activityDate: new Date("2026-07-14T12:00:00.000Z"),
      },
      {
        providerAccountId: "DU-CASH",
        activityId: "older-interest",
        activityType: "Interest",
        description: "Older YTD interest",
        amount: "3",
        activityDate: new Date("2026-07-13T12:00:00.000Z"),
      },
    ]);
    await db.insert(flexDividendsTable).values([
      ...Array.from({ length: 100 }, (_, index) => ({
        providerAccountId: "DU-CASH",
        dividendId: `visible-${index}`,
        symbol: "TST",
        description: "Visible display dividend",
        amount: "1",
        paidDate: new Date(visibleAt.getTime() + index),
      })),
      {
        providerAccountId: "DU-CASH",
        dividendId: "older-month-dividend",
        symbol: "TST",
        description: "Older current-month dividend",
        amount: "9",
        paidDate: new Date("2026-07-02T12:00:00.000Z"),
      },
      {
        providerAccountId: "DU-CASH",
        dividendId: "future-outside-display-range",
        symbol: "TST",
        description: "Future dividend",
        amount: "500",
        paidDate: new Date("2026-07-17T12:00:00.000Z"),
      },
    ]);

    const result = await internals.readAccountCashActivityForUniverse({
      universe,
      mode: "live",
      from: new Date("2026-07-15T00:00:00.000Z"),
      to: new Date("2026-07-16T00:00:00.000Z"),
      now,
    });

    assert.equal(result.activities.length, 200);
    assert.equal(result.dividends.length, 100);
    assert.equal(
      result.dividends.some(
        (dividend) => dividend.id === "future-outside-display-range",
      ),
      false,
    );
    assert.equal(result.feesYtd, 7);
    assert.equal(result.interestPaidEarnedYtd, 3);
    assert.equal(result.dividendsMonth, 109);
    assert.equal(result.dividendsYtd, 109);

    await db.delete(flexReportRunsTable);
    await assert.rejects(
      internals.readAccountCashActivityForUniverse({
        universe,
        mode: "live",
        now,
      }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 503 &&
        error.code === "ibkr_flex_coverage_unavailable",
    );
  });
});
