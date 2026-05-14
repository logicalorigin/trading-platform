import assert from "node:assert/strict";
import test from "node:test";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
process.env["DIAGNOSTICS_SUPPRESS_DB_WARNINGS"] = "1";

test("persisted account snapshots use the latest row per account for offline account history", async () => {
  const { __accountEquityHistoryInternalsForTests } = await import("./account");
  const { accounts, latestSnapshotAt } =
    __accountEquityHistoryInternalsForTests.persistedAccountRowsToSnapshots([
      {
        providerAccountId: "U1",
        displayName: "IBKR U1",
        mode: "live",
        asOf: new Date("2026-04-30T14:00:00.000Z"),
        currency: "USD",
        cash: "10000",
        buyingPower: "50000",
        netLiquidation: "100000",
        maintenanceMargin: "2500",
      },
      {
        providerAccountId: "U1",
        displayName: "IBKR U1",
        mode: "live",
        asOf: new Date("2026-04-30T13:59:00.000Z"),
        currency: "USD",
        cash: "9000",
        buyingPower: "45000",
        netLiquidation: "99000",
        maintenanceMargin: "2400",
      },
      {
        providerAccountId: "U2",
        displayName: "IBKR U2",
        mode: "live",
        asOf: new Date("2026-04-30T14:01:00.000Z"),
        currency: "USD",
        cash: "20000",
        buyingPower: "70000",
        netLiquidation: "102000",
        maintenanceMargin: null,
      },
    ]);

  assert.deepEqual(
    accounts.map((account) => ({
      id: account.id,
      netLiquidation: account.netLiquidation,
      cash: account.cash,
      buyingPower: account.buyingPower,
      updatedAt: account.updatedAt.toISOString(),
    })),
    [
      {
        id: "U1",
        netLiquidation: 100000,
        cash: 10000,
        buyingPower: 50000,
        updatedAt: "2026-04-30T14:00:00.000Z",
      },
      {
        id: "U2",
        netLiquidation: 102000,
        cash: 20000,
        buyingPower: 70000,
        updatedAt: "2026-04-30T14:01:00.000Z",
      },
    ],
  );
  assert.equal(latestSnapshotAt?.toISOString(), "2026-04-30T14:01:00.000Z");
});

test("account history returns exclude deposits and withdrawals from P&L", async () => {
  const { __accountEquityHistoryInternalsForTests } = await import("./account");
  const points =
    __accountEquityHistoryInternalsForTests.calculateTransferAdjustedReturnPoints([
      {
        timestamp: new Date("2026-04-01T00:00:00.000Z"),
        netLiquidation: 100_000,
        currency: "USD",
        source: "FLEX",
        deposits: 0,
        withdrawals: 0,
        dividends: 0,
        fees: 0,
      },
      {
        timestamp: new Date("2026-04-02T00:00:00.000Z"),
        netLiquidation: 110_000,
        currency: "USD",
        source: "FLEX",
        deposits: 10_000,
        withdrawals: 0,
        dividends: 0,
        fees: 0,
      },
      {
        timestamp: new Date("2026-04-03T00:00:00.000Z"),
        netLiquidation: 108_500,
        currency: "USD",
        source: "FLEX",
        deposits: 0,
        withdrawals: 2_000,
        dividends: 0,
        fees: 0,
      },
      {
        timestamp: new Date("2026-04-04T00:00:00.000Z"),
        netLiquidation: 112_000,
        currency: "USD",
        source: "FLEX",
        deposits: 0,
        withdrawals: 0,
        dividends: 0,
        fees: 0,
      },
    ]);

  assert.deepEqual(
    points.map((point) => ({
      externalTransfer: point.externalTransfer,
      pnlDelta: point.pnlDelta,
      cumulativePnl: point.cumulativePnl,
      returnPercent: Number(point.returnPercent.toFixed(6)),
    })),
    [
      { externalTransfer: 0, pnlDelta: 0, cumulativePnl: 0, returnPercent: 0 },
      { externalTransfer: 10_000, pnlDelta: 0, cumulativePnl: 0, returnPercent: 0 },
      {
        externalTransfer: -2_000,
        pnlDelta: 500,
        cumulativePnl: 500,
        returnPercent: 0.454545,
      },
      {
        externalTransfer: 0,
        pnlDelta: 3_500,
        cumulativePnl: 4_000,
        returnPercent: 3.636364,
      },
    ],
  );
});

test("account history backs first-point external transfers out of the return baseline", async () => {
  const { __accountEquityHistoryInternalsForTests } = await import("./account");
  const points =
    __accountEquityHistoryInternalsForTests.calculateTransferAdjustedReturnPoints([
      {
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
        netLiquidation: 110_000,
        currency: "USD",
        source: "FLEX",
        deposits: 10_000,
        withdrawals: 0,
        dividends: 0,
        fees: 0,
      },
      {
        timestamp: new Date("2026-04-30T00:00:00.000Z"),
        netLiquidation: 115_000,
        currency: "USD",
        source: "FLEX",
        deposits: 0,
        withdrawals: 0,
        dividends: 0,
        fees: 0,
      },
    ]);

  assert.deepEqual(
    points.map((point) => ({
      externalTransfer: point.externalTransfer,
      pnlDelta: point.pnlDelta,
      cumulativePnl: point.cumulativePnl,
      returnPercent: Number(point.returnPercent.toFixed(6)),
    })),
    [
      { externalTransfer: 10_000, pnlDelta: 0, cumulativePnl: 0, returnPercent: 0 },
      {
        externalTransfer: 0,
        pnlDelta: 5_000,
        cumulativePnl: 5_000,
        returnPercent: 4.545455,
      },
    ],
  );
});

test("account margin snapshot normalizes IBKR cushion ratios to percentage points", async () => {
  const { buildAccountMarginSnapshot } = await import("./account-summary-model");
  const snapshot = buildAccountMarginSnapshot([
    {
      id: "U1",
      providerAccountId: "U1",
      provider: "ibkr",
      mode: "live",
      displayName: "IBKR U1",
      currency: "USD",
      netLiquidation: 100_000,
      cushion: 0.375,
    },
  ] as any);

  assert.equal(snapshot.maintenanceCushionPercent, 37.5);
});

test("account history classifies Flex cash transfer rows", async () => {
  const { __accountEquityHistoryInternalsForTests } = await import("./account");
  const classify =
    __accountEquityHistoryInternalsForTests.classifyExternalCashTransfer;

  assert.equal(
    classify({
      activityType: "Deposits/Withdrawals",
      description: "CASH RECEIPTS / ELECTRONIC FUND TRANSFERS",
      amount: "2000.000000",
    }),
    2000,
  );
  assert.equal(
    classify({
      activityType: "Deposits/Withdrawals",
      description: "DISBURSEMENT INITIATED BY Riley Bishop",
      amount: "-250.000000",
    }),
    -250,
  );
  assert.equal(
    classify({
      activityType: "Dividend",
      description: "ORDINARY DIVIDEND",
      amount: "12.34",
    }),
    null,
  );
});

test("account history excludes local snapshots on Flex external-transfer dates", async () => {
  const { __accountEquityHistoryInternalsForTests } = await import("./account");
  const filter =
    __accountEquityHistoryInternalsForTests.filterSnapshotsOnFlexTransferDates;
  const rows = [
    {
      providerAccountId: "U1",
      asOf: new Date("2026-04-27T20:30:00.000Z"),
      currency: "USD",
      netLiquidation: "3725.90",
    },
    {
      providerAccountId: "U1",
      asOf: new Date("2026-04-28T03:30:00.000Z"),
      currency: "USD",
      netLiquidation: "3726.90",
    },
    {
      providerAccountId: "U1",
      asOf: new Date("2026-04-28T12:30:00.000Z"),
      currency: "USD",
      netLiquidation: "5723.10",
    },
    {
      providerAccountId: "U1",
      asOf: new Date("2026-04-29T00:30:00.000Z"),
      currency: "USD",
      netLiquidation: "5724.70",
    },
  ];

  assert.deepEqual(
    filter(rows, new Set(["2026-04-28"])).map((row) => row.asOf.toISOString()),
    [
      "2026-04-27T20:30:00.000Z",
      "2026-04-29T00:30:00.000Z",
    ],
  );
});

test("account history filters zero-only account placeholders before compaction", async () => {
  const { __accountEquityHistoryInternalsForTests } = await import("./account");
  const filter =
    __accountEquityHistoryInternalsForTests.filterPlaceholderZeroEquitySnapshotRows;
  const compact = __accountEquityHistoryInternalsForTests.compactEquitySnapshotRows;
  const rows = [
    {
      providerAccountId: "FUNDED",
      asOf: new Date("2026-05-01T16:35:47.497Z"),
      currency: "USD",
      netLiquidation: "5734.56",
      cash: "4461.44",
      buyingPower: "19151.10",
    },
    {
      providerAccountId: "EMPTY",
      asOf: new Date("2026-05-01T16:37:59.576Z"),
      currency: "USD",
      netLiquidation: "0",
      cash: "0",
      buyingPower: "0",
    },
    {
      providerAccountId: "FUNDED",
      asOf: new Date("2026-05-01T16:38:47.492Z"),
      currency: "USD",
      netLiquidation: "5730.54",
      cash: "4461.44",
      buyingPower: "19145.83",
    },
  ];

  const compacted = compact(filter(rows), "1W");

  assert.deepEqual(
    compacted.map((row) => ({
      account: row.providerAccountId,
      timestamp: row.asOf.toISOString(),
      netLiquidation: row.netLiquidation,
    })),
    [
      {
        account: "FUNDED",
        timestamp: "2026-05-01T16:35:47.497Z",
        netLiquidation: "5734.56",
      },
      {
        account: "FUNDED",
        timestamp: "2026-05-01T16:38:47.492Z",
        netLiquidation: "5730.54",
      },
    ],
  );
});

test("account history compaction preserves first daily snapshot for calendar P&L boundaries", async () => {
  const { __accountEquityHistoryInternalsForTests } = await import("./account");
  const compact = __accountEquityHistoryInternalsForTests.compactEquitySnapshotRows;
  const rows = [
    {
      providerAccountId: "U1",
      asOf: new Date("2026-05-08T18:26:02.932Z"),
      currency: "USD",
      netLiquidation: "5753.34",
    },
    {
      providerAccountId: "U1",
      asOf: new Date("2026-05-08T19:56:58.939Z"),
      currency: "USD",
      netLiquidation: "5778.57",
    },
    {
      providerAccountId: "U1",
      asOf: new Date("2026-05-08T20:57:22.819Z"),
      currency: "USD",
      netLiquidation: "5752.74",
    },
  ];

  assert.deepEqual(
    compact(rows, "1Y").map((row) => ({
      timestamp: row.asOf.toISOString(),
      netLiquidation: row.netLiquidation,
    })),
    [
      {
        timestamp: "2026-05-08T18:26:02.932Z",
        netLiquidation: "5753.34",
      },
      {
        timestamp: "2026-05-08T19:56:58.939Z",
        netLiquidation: "5778.57",
      },
      {
        timestamp: "2026-05-08T20:57:22.819Z",
        netLiquidation: "5752.74",
      },
    ],
  );
});

test("account history filters transient all-zero balance rows for funded accounts", async () => {
  const { __accountEquityHistoryInternalsForTests } = await import("./account");
  const filter =
    __accountEquityHistoryInternalsForTests.filterPlaceholderZeroEquitySnapshotRows;
  const rows = [
    {
      providerAccountId: "FUNDED",
      asOf: new Date("2026-05-01T16:35:47.497Z"),
      currency: "USD",
      netLiquidation: "5734.56",
      cash: "4461.44",
      buyingPower: "19151.10",
    },
    {
      providerAccountId: "FUNDED",
      asOf: new Date("2026-05-01T16:36:47.497Z"),
      currency: "USD",
      netLiquidation: "0",
      cash: "0",
      buyingPower: "0",
    },
    {
      providerAccountId: "FUNDED",
      asOf: new Date("2026-05-01T16:37:47.497Z"),
      currency: "USD",
      netLiquidation: "5735.11",
      cash: "4461.44",
      buyingPower: "19152.00",
    },
  ];

  assert.deepEqual(
    filter(rows).map((row) => row.netLiquidation),
    ["5734.56", "5735.11"],
  );
});

test("account history recognizes all-zero live account summaries as placeholders", async () => {
  const { __accountEquityHistoryInternalsForTests } = await import("./account");
  const isPlaceholder =
    __accountEquityHistoryInternalsForTests.isPlaceholderZeroAccountSnapshot;

  assert.equal(
    isPlaceholder({
      netLiquidation: 0,
      cash: 0,
      buyingPower: 0,
    }),
    true,
  );
  assert.equal(
    isPlaceholder({
      netLiquidation: 0,
      cash: 500,
      buyingPower: 0,
    }),
    false,
  );
});
