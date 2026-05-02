import assert from "node:assert/strict";
import test from "node:test";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
process.env["DIAGNOSTICS_SUPPRESS_DB_WARNINGS"] = "1";

test("account Flex internals extract XML records and tag text", async () => {
  const { __accountFlexInternalsForTests } = await import("./account");
  const xml = `
    <FlexStatement>
      <Status>Success</Status>
      <Trade symbol="AAPL" description="AT&amp;T &quot;test&quot;" />
      <Trade symbol='MSFT' quantity='2'></Trade>
    </FlexStatement>
  `;

  assert.equal(
    __accountFlexInternalsForTests.extractTagText(xml, "Status"),
    "Success",
  );
  assert.deepEqual(
    __accountFlexInternalsForTests
      .extractFlexRecords(xml, ["Trade"])
      .map((record) => record.attributes),
    [
      { symbol: "AAPL", description: 'AT&T "test"' },
      { symbol: "MSFT", quantity: "2" },
    ],
  );
});

test("account Flex internals derive configs from environment values", async () => {
  const { __accountFlexInternalsForTests } = await import("./account");
  const env = {
    IBKR_FLEX_TOKEN: " token ",
    IBKR_FLEX_QUERY_ID: "Q1, Q2\nQ3",
  };

  assert.deepEqual(__accountFlexInternalsForTests.getFlexConfigs(env), [
    { token: "token", queryId: "Q1" },
    { token: "token", queryId: "Q2" },
    { token: "token", queryId: "Q3" },
  ]);
  assert.equal(__accountFlexInternalsForTests.flexConfigured(env), true);
  assert.equal(__accountFlexInternalsForTests.flexConfigured({}), false);
});

test("account Flex internals plan scheduled and manual backfill windows", async () => {
  const { __accountFlexInternalsForTests } = await import("./account");
  const now = new Date("2026-05-01T12:34:56.000Z");

  assert.deepEqual(
    __accountFlexInternalsForTests.buildFlexBackfillWindows("scheduled", now),
    [{ fromDate: "2025-05-02", toDate: "2026-05-01" }],
  );

  const manualWindows =
    __accountFlexInternalsForTests.buildFlexBackfillWindows("manual", now);
  assert.deepEqual(manualWindows[0], {
    fromDate: "2022-01-01",
    toDate: "2022-12-31",
  });
  assert.deepEqual(manualWindows.at(-1), {
    fromDate: "2025-12-31",
    toDate: "2026-05-01",
  });
});
