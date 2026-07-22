import assert from "node:assert/strict";
import test from "node:test";

import type { BrokerOrderSnapshot } from "../providers/ibkr/client";
import { __accountOrderInternalsForTests } from "./account";

const dte = (expirationDate: Date | string, activityDate: string) =>
  __accountOrderInternalsForTests.optionDteFromOrder(
    {
      optionContract: { expirationDate },
    } as BrokerOrderSnapshot,
    new Date(activityDate),
  );

test("option DTE uses New York calendar dates instead of elapsed instants", () => {
  assert.equal(dte("2026-07-21", "2026-07-21T14:30:00.000Z"), 0);
  assert.equal(dte("2026-07-21", "2026-07-21T00:30:00.000Z"), 1);
});

test("option DTE stays calendar-stable across both DST transitions", () => {
  assert.equal(dte("2026-03-09", "2026-03-07T23:30:00-05:00"), 2);
  assert.equal(dte("2026-11-02", "2026-10-31T23:30:00-04:00"), 2);
});

test("option DTE rejects malformed expirations and clamps expired contracts", () => {
  assert.equal(dte("2026-02-30", "2026-02-01T15:00:00.000Z"), null);
  assert.equal(dte("not-a-date", "2026-02-01T15:00:00.000Z"), null);
  assert.equal(dte("2026-01-31", "2026-02-01T15:00:00.000Z"), 0);
  assert.equal(
    dte(new Date("2026-07-21T00:00:00.000Z"), "2026-07-21T00:30:00.000Z"),
    1,
  );
});
