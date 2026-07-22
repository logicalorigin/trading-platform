import assert from "node:assert/strict";
import test from "node:test";

import { isHttpError } from "../lib/errors";
import {
  aggregateCombinedEquitySnapshotRows,
  aggregateCombinedEquitySeedPoints,
  filterSnapshotsOnFlexTransferDates,
  reconstructEquityHistoryFromActivityLedger,
} from "./account-equity-history-model";

test("combined equity aggregates reject mixed currencies without authoritative FX", () => {
  assert.throws(
    () =>
      aggregateCombinedEquitySnapshotRows([
        {
          providerAccountId: "usd",
          asOf: new Date("2026-07-17T20:00:00.000Z"),
          currency: "USD",
          netLiquidation: "100",
        },
        {
          providerAccountId: "cad",
          asOf: new Date("2026-07-17T20:00:00.000Z"),
          currency: "CAD",
          netLiquidation: "100",
        },
      ]),
    (error) =>
      isHttpError(error) &&
      error.statusCode === 409 &&
      error.code === "account_currency_conversion_required",
  );

  assert.throws(
    () =>
      aggregateCombinedEquitySeedPoints([
        {
          providerAccountId: "usd",
          point: {
            timestamp: new Date("2026-07-17T20:00:00.000Z"),
            netLiquidation: 100,
            currency: "USD",
            source: "LOCAL_LEDGER",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
          },
        },
        {
          providerAccountId: "cad",
          point: {
            timestamp: new Date("2026-07-17T20:00:00.000Z"),
            netLiquidation: 100,
            currency: "CAD",
            source: "LOCAL_LEDGER",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
          },
        },
      ]),
    (error) =>
      isHttpError(error) &&
      error.statusCode === 409 &&
      error.code === "account_currency_conversion_required",
  );
});

test("combined equity seed points sum asynchronous account histories", () => {
  const points = aggregateCombinedEquitySeedPoints([
    {
      providerAccountId: "snaptrade-a",
      point: {
        timestamp: new Date("2026-07-16T20:00:00.000Z"),
        netLiquidation: 100,
        currency: "USD",
        source: "SNAPTRADE_BALANCE_HISTORY",
        deposits: 0,
        withdrawals: 0,
        dividends: 0,
        fees: 0,
      },
    },
    {
      providerAccountId: "snaptrade-b",
      point: {
        timestamp: new Date("2026-07-16T20:00:01.000Z"),
        netLiquidation: 1_000,
        currency: "USD",
        source: "SNAPTRADE_BALANCE_HISTORY",
        deposits: 0,
        withdrawals: 0,
        dividends: 0,
        fees: 0,
      },
    },
    {
      providerAccountId: "robinhood-a",
      point: {
        timestamp: new Date("2026-07-16T20:00:02.000Z"),
        netLiquidation: 10,
        currency: "USD",
        source: "LOCAL_LEDGER",
        deposits: 0,
        withdrawals: 0,
        dividends: 0,
        fees: 0,
      },
    },
    {
      providerAccountId: "snaptrade-a",
      point: {
        timestamp: new Date("2026-07-17T20:00:00.000Z"),
        netLiquidation: 125,
        currency: "USD",
        source: "SNAPTRADE_BALANCE_HISTORY",
        deposits: 0,
        withdrawals: 0,
        dividends: 0,
        fees: 0,
      },
    },
    {
      providerAccountId: "snaptrade-b",
      point: {
        timestamp: new Date("2026-07-17T20:00:01.000Z"),
        netLiquidation: 1_050,
        currency: "USD",
        source: "SNAPTRADE_BALANCE_HISTORY",
        deposits: 0,
        withdrawals: 0,
        dividends: 0,
        fees: 0,
      },
    },
    {
      providerAccountId: "robinhood-a",
      point: {
        timestamp: new Date("2026-07-17T20:00:02.000Z"),
        netLiquidation: 12,
        currency: "USD",
        source: "LOCAL_LEDGER",
        deposits: 0,
        withdrawals: 0,
        dividends: 0,
        fees: 0,
      },
    },
  ]);

  assert.deepEqual(
    points.map((point) => point.netLiquidation),
    [1_110, 1_135, 1_185, 1_187],
  );
  assert.equal(points.at(-1)?.timestamp.toISOString(), "2026-07-17T20:00:02.000Z");
});

test("combined equity waits for every account even when histories begin far apart", () => {
  const early = new Date("2026-07-16T20:00:00.000Z");
  const late = new Date("2026-07-16T20:10:00.000Z");

  assert.deepEqual(
    aggregateCombinedEquitySnapshotRows([
      {
        providerAccountId: "account-a",
        asOf: early,
        currency: "USD",
        netLiquidation: "100",
        cash: "10",
        buyingPower: "20",
      },
      {
        providerAccountId: "account-b",
        asOf: late,
        currency: "USD",
        netLiquidation: "1,000",
        cash: "100",
        buyingPower: "200",
      },
    ]),
    [
      {
        providerAccountId: "combined",
        asOf: late,
        currency: "USD",
        netLiquidation: "1100",
        cash: "110",
        buyingPower: "220",
      },
    ],
  );

  assert.deepEqual(
    aggregateCombinedEquitySeedPoints([
      {
        providerAccountId: "account-a",
        point: {
          timestamp: early,
          netLiquidation: 100,
          currency: "USD",
          source: "LOCAL_LEDGER",
          deposits: 0,
          withdrawals: 0,
          dividends: 0,
          fees: 0,
        },
      },
      {
        providerAccountId: "account-b",
        point: {
          timestamp: late,
          netLiquidation: 1_000,
          currency: "USD",
          source: "LOCAL_LEDGER",
          deposits: 0,
          withdrawals: 0,
          dividends: 0,
          fees: 0,
        },
      },
    ]).map((point) => ({
      timestamp: point.timestamp,
      netLiquidation: point.netLiquidation,
    })),
    [{ timestamp: late, netLiquidation: 1_100 }],
  );
});

test("combined equity requires every expected account, including accounts without rows", () => {
  const points = aggregateCombinedEquitySeedPoints(
    [
      {
        providerAccountId: "account-a",
        point: {
          timestamp: new Date("2026-07-16T20:00:00.000Z"),
          netLiquidation: 100,
          currency: "USD",
          source: "LOCAL_LEDGER",
          deposits: 0,
          withdrawals: 0,
          dividends: 0,
          fees: 0,
        },
      },
    ],
    { expectedAccountIds: ["account-a", "account-b"] },
  );

  assert.deepEqual(points, []);
});

test("combined equity provenance includes carried account sources", () => {
  const points = aggregateCombinedEquitySeedPoints([
    {
      providerAccountId: "flex-account",
      point: {
        timestamp: new Date("2026-07-16T20:00:00.000Z"),
        netLiquidation: 100,
        currency: "USD",
        source: "FLEX",
        deposits: 0,
        withdrawals: 0,
        dividends: 0,
        fees: 0,
      },
    },
    {
      providerAccountId: "snap-account",
      point: {
        timestamp: new Date("2026-07-16T20:00:00.000Z"),
        netLiquidation: 1_000,
        currency: "USD",
        source: "SNAPTRADE_BALANCE_HISTORY",
        deposits: 0,
        withdrawals: 0,
        dividends: 0,
        fees: 0,
      },
    },
    {
      providerAccountId: "flex-account",
      point: {
        timestamp: new Date("2026-07-17T20:00:00.000Z"),
        netLiquidation: 125,
        currency: "USD",
        source: "FLEX",
        deposits: 0,
        withdrawals: 0,
        dividends: 0,
        fees: 0,
      },
    },
  ]);

  assert.deepEqual(
    points.map((point) => point.source),
    ["MIXED", "MIXED"],
  );
});

test("combined snapshots withhold incomplete account values", () => {
  const timestamp = new Date("2026-07-17T20:00:00.000Z");
  const [combined] = aggregateCombinedEquitySnapshotRows([
    {
      providerAccountId: "account-a",
      asOf: timestamp,
      currency: "USD",
      netLiquidation: "100",
      cash: "10",
      buyingPower: "20",
    },
    {
      providerAccountId: "account-b",
      asOf: timestamp,
      currency: "USD",
      netLiquidation: null,
      cash: null,
      buyingPower: null,
    },
  ]);

  assert.equal(combined?.netLiquidation, null);
  assert.equal(combined?.cash, null);
  assert.equal(combined?.buyingPower, null);
});

test("FLEX transfer-date snapshot filtering is account scoped", () => {
  const timestamp = new Date("2026-07-17T20:00:00.000Z");
  const rows = [
    {
      providerAccountId: "account-a",
      asOf: timestamp,
      currency: "USD",
      netLiquidation: "100",
    },
    {
      providerAccountId: "account-b",
      asOf: timestamp,
      currency: "USD",
      netLiquidation: "1,000",
    },
  ];

  assert.deepEqual(
    filterSnapshotsOnFlexTransferDates(
      rows,
      new Set(["account-a:2026-07-17"]),
    ),
    [rows[1]],
  );
});

test("combined equity seed points retain account transfer deltas once", () => {
  const timestamp = new Date("2026-07-17T20:00:00.000Z");
  const points = aggregateCombinedEquitySeedPoints([
    {
      providerAccountId: "account-a",
      point: {
        timestamp,
        netLiquidation: 1_100,
        currency: "USD",
        source: "LOCAL_LEDGER",
        deposits: 100,
        withdrawals: 0,
        dividends: 0,
        fees: 0,
      },
    },
    {
      providerAccountId: "account-b",
      point: {
        timestamp,
        netLiquidation: 500,
        currency: "USD",
        source: "LOCAL_LEDGER",
        deposits: 0,
        withdrawals: 20,
        dividends: 5,
        fees: 1,
      },
    },
  ]);

  assert.deepEqual(points, [
    {
      timestamp,
      netLiquidation: 1_600,
      currency: "USD",
      source: "LOCAL_LEDGER",
      deposits: 100,
      withdrawals: 20,
      dividends: 5,
      fees: 1,
    },
  ]);
});

test("reconstructed account equity points use NYSE market-close timestamps", () => {
  const points = reconstructEquityHistoryFromActivityLedger({
    terminal: {
      timestamp: new Date("2026-06-30T20:00:00.000Z"),
      netLiquidation: 900,
      currency: "USD",
    },
    source: "SNAPTRADE_BALANCE_HISTORY",
    events: [
      {
        timestamp: new Date("2026-06-26T14:30:00.000Z"),
        currency: "USD",
        realizedPnl: -100,
      },
    ],
  });

  const eventPoint = points.find((point) => point.netLiquidation === 900);

  assert.equal(eventPoint?.timestamp.toISOString(), "2026-06-26T20:00:00.000Z");
});
