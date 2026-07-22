import assert from "node:assert/strict";
import test from "node:test";

import { buildExpiryConcentration } from "./account-risk-model";

const optionPosition = (expirationDate: Date, marketValue: number) =>
  ({
    id: expirationDate.toString(),
    symbol: "SPY",
    marketValue,
    optionContract: {
      expirationDate,
    },
  }) as never;

test("expiry concentration uses New York calendar days and excludes expired options", () => {
  const result = buildExpiryConcentration(
    [
      optionPosition(new Date("2026-03-07T00:00:00.000Z"), 100),
      optionPosition(new Date("2026-03-08T00:00:00.000Z"), 2),
      optionPosition(new Date("2026-03-15T00:00:00.000Z"), 3),
      optionPosition(new Date("2026-04-07T00:00:00.000Z"), 5),
      optionPosition(new Date("2026-06-06T00:00:00.000Z"), 7),
    ],
    new Date("2026-03-08T23:30:00.000Z").getTime(),
  );

  assert.deepEqual(result, {
    thisWeek: 5,
    thisMonth: 10,
    next90Days: 17,
  });
});

test("expiry concentration is unavailable when an option expiry or value is missing", () => {
  assert.equal(
    buildExpiryConcentration([
      { assetClass: "option", optionContract: null, marketValue: 100 } as never,
    ]),
    null,
  );
  assert.equal(
    buildExpiryConcentration([
      optionPosition(new Date("invalid"), 100),
    ]),
    null,
  );
  assert.equal(
    buildExpiryConcentration([
      optionPosition(new Date("2026-08-21T00:00:00.000Z"), Number.NaN),
    ]),
    null,
  );
});

test("an explicitly empty option population has zero expiry concentration", () => {
  assert.deepEqual(buildExpiryConcentration([]), {
    thisWeek: 0,
    thisMonth: 0,
    next90Days: 0,
  });
});
