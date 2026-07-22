import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { __accountPositionInternalsForTests as internals } from "./account";

const accountSource = readFileSync(new URL("./account.ts", import.meta.url), "utf8");

test("account position totals do not coerce an unknown member weight to zero", () => {
  const totals = internals.buildAccountPositionTotals({
    accounts: [],
    rows: [
      { weightPercent: 40, unrealizedPnl: 1 },
      { weightPercent: null, unrealizedPnl: 2 },
    ],
    grossLong: 100,
    grossShort: 0,
    netExposure: 100,
    financialTotalsAvailable: true,
  });

  assert.equal(totals.weightPercent, null);
});

test("account position totals preserve an empty invested population as zero", () => {
  const totals = internals.buildAccountPositionTotals({
    accounts: [],
    rows: [],
    grossLong: 0,
    grossShort: 0,
    netExposure: 0,
    financialTotalsAvailable: true,
  });

  assert.equal(totals.weightPercent, 0);
});

test("SnapTrade position populations reject rows with unknown required economics", async () => {
  const universe = {
    appUserId: "user-1",
    allowDirectIbkr: false,
    requestedAccountId: "snaptrade:account-1",
    accountIds: ["snaptrade:account-1"],
    isCombined: false,
    accounts: [],
    positionOnlyAccounts: [
      {
        id: "snaptrade:account-1",
        provider: "snaptrade",
        providerAccountId: "provider-account-1",
        currency: "USD",
        updatedAt: new Date("2026-07-16T15:00:00.000Z"),
      },
    ],
    primaryCurrency: "USD",
    source: "snaptrade",
    latestSnapshotAt: null,
  } as never;

  await assert.rejects(
    () =>
      internals.readPositionsForUniverseUncached(universe, "live", {
        readSnapTradePortfolio: () =>
          ({
            positions: [
              {
                snapTradePositionId: "stock:AAPL",
                symbol: "AAPL",
                instrumentKind: "stock",
                assetClass: "equity",
                optionContract: null,
                quantity: null,
                side: "flat",
                price: 100,
                averagePurchasePrice: 90,
                marketValue: null,
                costBasis: null,
                unrealizedPnl: null,
              },
            ],
          }) as never,
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "snaptrade_position_economics_unavailable",
  );
});

test("allocation cash buckets distinguish unknown cash from known zero", () => {
  const unknownBuckets = new Map<string, number>();
  internals.addKnownCashAllocation(unknownBuckets, null);
  assert.equal(unknownBuckets.has("Cash"), false);

  const zeroBuckets = new Map<string, number>();
  internals.addKnownCashAllocation(zeroBuckets, 0);
  assert.equal(zeroBuckets.get("Cash"), 0);
});

test("combined position rows require complete day-change and beta populations", () => {
  const start = accountSource.indexOf("type AggregatedPositionRow = {");
  const end = accountSource.indexOf(": positions.map((position) => {", start);
  assert.ok(start >= 0 && end > start);
  const fold = accountSource.slice(start, end);

  assert.match(fold, /dayChangeContributions/);
  assert.match(fold, /betaWeightedDeltaContributions/);
  assert.match(
    fold,
    /sumNullableValues\(\s*row\.dayChangeContributions\s*\)/,
  );
  assert.match(
    fold,
    /sumNullableValues\(\s*row\.betaWeightedDeltaContributions,?\s*\)/,
  );
  assert.doesNotMatch(fold, /upsertNullableTotal/);
});
