import assert from "node:assert/strict";
import test from "node:test";

import type { BrokerAccountSnapshot } from "../providers/ibkr/client";
import { sumAccounts, weightedAccountAverage } from "./account-summary-model";

type PartialAccountFixture = Omit<
  Partial<BrokerAccountSnapshot>,
  "cash" | "netLiquidation"
> & {
  cash?: number | null;
  netLiquidation?: number | null;
};

function account(
  id: string,
  values: PartialAccountFixture,
): BrokerAccountSnapshot {
  return {
    id,
    currency: "USD",
    ...values,
  } as BrokerAccountSnapshot;
}

test("account sums withhold partial multi-account populations", () => {
  assert.equal(
    sumAccounts(
      [account("one", { cash: 100 }), account("two", { cash: null })],
      "cash",
    ),
    null,
  );
  assert.equal(
    sumAccounts(
      [account("one", { cash: 100 }), account("two", { cash: 50 })],
      "cash",
    ),
    150,
  );
});

test("account weighted averages withhold missing values or NAV weights", () => {
  assert.equal(
    weightedAccountAverage(
      [
        account("one", { cushion: 0.2, netLiquidation: 100 }),
        account("two", { cushion: null, netLiquidation: 300 }),
      ],
      "cushion",
    ),
    null,
  );
  assert.equal(
    weightedAccountAverage(
      [
        account("one", { cushion: 0.2, netLiquidation: 100 }),
        account("two", { cushion: 0.4, netLiquidation: null }),
      ],
      "cushion",
    ),
    null,
  );
  assert.equal(
    weightedAccountAverage(
      [
        account("one", { cushion: 0.2, netLiquidation: 100 }),
        account("two", { cushion: 0.4, netLiquidation: 300 }),
      ],
      "cushion",
    ),
    0.35,
  );
});
