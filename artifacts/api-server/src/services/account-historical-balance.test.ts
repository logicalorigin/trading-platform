import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../lib/errors";
import { __accountPositionInternalsForTests } from "./account";

const aggregate = __accountPositionInternalsForTests.aggregateBalanceRows;
const availability =
  __accountPositionInternalsForTests.historicalPositionResponseAvailability;

function row(
  providerAccountId: string,
  overrides: Partial<{
    currency: string;
    cash: string;
    buyingPower: string;
    netLiquidation: string;
    maintenanceMargin: string | null;
  }> = {},
) {
  return {
    providerAccountId,
    asOf: new Date("2026-07-21T20:00:00.000Z"),
    currency: "USD",
    cash: "100",
    buyingPower: "200",
    netLiquidation: "300",
    maintenanceMargin: "25",
    ...overrides,
  };
}

test("historical balance aggregation requires every scoped account", () => {
  assert.equal(
    aggregate([row("one")], {
      expectedAccountIds: ["one", "two"],
      currency: "USD",
    }),
    null,
  );
  assert.equal(
    aggregate([row("one"), row("two")], {
      expectedAccountIds: ["one", "two"],
      currency: "USD",
    })?.netLiquidation,
    600,
  );
});

test("historical balance aggregation rejects incomplete values", () => {
  assert.equal(
    aggregate([row("one", { netLiquidation: "not-a-number" })], {
      expectedAccountIds: ["one"],
      currency: "USD",
    }),
    null,
  );
});

test("historical balance aggregation fails closed across currencies", () => {
  assert.throws(
    () =>
      aggregate([row("one", { currency: "CAD" })], {
        expectedAccountIds: ["one"],
        currency: "USD",
      }),
    (error) =>
      error instanceof HttpError &&
      error.statusCode === 409 &&
      error.code === "account_currency_conversion_required",
  );
});

test("historical activity remains available without a position or balance snapshot", () => {
  assert.deepEqual(
    availability({
      positionCount: 0,
      hasBalanceSnapshot: false,
      activityCount: 1,
    }),
    {
      status: "historical",
      message:
        "No Flex open-position snapshot or recorded balance snapshot exists for this date; showing recorded account activity.",
    },
  );
  assert.equal(
    availability({
      positionCount: 0,
      hasBalanceSnapshot: false,
      activityCount: 0,
    }).status,
    "unavailable",
  );
});
