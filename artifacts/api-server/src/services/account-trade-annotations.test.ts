import assert from "node:assert/strict";
import test from "node:test";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
process.env["DIAGNOSTICS_SUPPRESS_DB_WARNINGS"] = "1";

test("account trade annotation internals build stable account-scoped keys", async () => {
  const { __accountTradeAnnotationInternalsForTests } = await import("./account");

  assert.equal(
    __accountTradeAnnotationInternalsForTests.buildAccountTradeAnnotationKey({
      source: "FLEX",
      accountId: "DU123",
      id: "trade-1",
      symbol: "AAPL",
      closeDate: new Date("2026-05-01T16:00:00.000Z"),
    } as any),
    "FLEX:DU123:trade-1",
  );
});

test("account trade annotation internals normalize notes and tags", async () => {
  const { __accountTradeAnnotationInternalsForTests } = await import("./account");

  assert.equal(
    __accountTradeAnnotationInternalsForTests.normalizeAnnotationNote(123),
    "",
  );
  assert.deepEqual(
    __accountTradeAnnotationInternalsForTests.normalizeAnnotationTags([
      " mistake ",
      "MISTAKE",
      "good setup",
      "",
      null,
    ]),
    ["mistake", "good setup"],
  );
});

test("account trade annotation internals prefer shadow mode for shadow account", async () => {
  const { __accountTradeAnnotationInternalsForTests } = await import("./account");

  assert.equal(
    __accountTradeAnnotationInternalsForTests.normalizeAccountAnnotationMode({
      accountId: "shadow",
      mode: "paper",
    }),
    "shadow",
  );
  assert.equal(
    __accountTradeAnnotationInternalsForTests.normalizeAccountAnnotationMode({
      accountId: "combined",
      mode: "live",
    }),
    "live",
  );
});

test("account closed trades ignore opening FLEX rows without realized P&L", async () => {
  const { __accountTradeAnnotationInternalsForTests } = await import("./account");
  const { isClosedFlexTradeRow } = __accountTradeAnnotationInternalsForTests;

  assert.equal(isClosedFlexTradeRow({ openClose: "O", realizedPnl: "0" }), false);
  assert.equal(isClosedFlexTradeRow({ openClose: null, realizedPnl: "0" }), false);
  assert.equal(isClosedFlexTradeRow({ openClose: "C", realizedPnl: "0" }), true);
  assert.equal(isClosedFlexTradeRow({ openClose: null, realizedPnl: "-42.5" }), true);
});

test("account trade outcome buckets keep losers left and winners right", async () => {
  const { __accountOverviewInternalsForTests } = await import("./account");
  const buckets = __accountOverviewInternalsForTests.buildTradeOutcomeBuckets(
    [-200, -25, 0, 30, 160],
    9,
  );

  assert.equal(
    buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    5,
  );
  assert.ok(
    buckets.findIndex((bucket) => bucket.side === "loss") <
      buckets.findIndex((bucket) => bucket.side === "flat"),
  );
  assert.ok(
    buckets.findIndex((bucket) => bucket.side === "flat") <
      buckets.findIndex((bucket) => bucket.side === "win"),
  );
});

test("account trade outcome buckets normalize counts and preserve all-flat rows", async () => {
  const { __accountOverviewInternalsForTests } = await import("./account");

  assert.equal(
    __accountOverviewInternalsForTests.normalizeTradeOutcomeBucketCount(8),
    9,
  );
  assert.equal(
    __accountOverviewInternalsForTests.normalizeTradeOutcomeBucketCount(100),
    31,
  );

  const buckets = __accountOverviewInternalsForTests.buildTradeOutcomeBuckets(
    [0, 0, 0],
    11,
  );
  assert.deepEqual(buckets, [
    {
      id: "pnl:flat",
      index: 0,
      bucketCount: 1,
      min: 0,
      max: 0,
      label: "Flat",
      side: "flat",
      count: 3,
      total: 0,
      average: 0,
    },
  ]);
});

test("account overview cache matching rejects stale shape for changed controls", async () => {
  const { __accountOverviewInternalsForTests } = await import("./account");
  const overview = {
    accountId: "combined",
    mode: "paper",
    range: "ALL",
    assetClass: null,
    orderTab: "working",
  } as any;

  assert.equal(
    __accountOverviewInternalsForTests.overviewMatchesRequest(overview, {
      accountId: "combined",
      mode: "paper",
      range: "ALL",
      assetClass: null,
      orderTab: "working",
    }),
    true,
  );
  assert.equal(
    __accountOverviewInternalsForTests.overviewMatchesRequest(overview, {
      accountId: "combined",
      mode: "paper",
      range: "1M",
      assetClass: null,
      orderTab: "working",
    }),
    false,
  );
});
