import assert from "node:assert/strict";
import test from "node:test";

import { ListOrdersResponse } from "@workspace/api-zod";

test("public order responses preserve canonical option semantics", () => {
  const parsed = ListOrdersResponse.parse({
    orders: [
      {
        id: "option-order-1",
        accountId: "U1234567",
        mode: "live",
        symbol: "AAPL",
        assetClass: "option",
        side: "sell",
        type: "limit",
        timeInForce: "day",
        status: "submitted",
        quantity: 1,
        filledQuantity: 0,
        limitPrice: 4.5,
        stopPrice: null,
        placedAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z",
        optionContract: {
          ticker: "AAPL260821C00200000",
          underlying: "AAPL",
          expirationDate: "2026-08-21T00:00:00.000Z",
          strike: 200,
          right: "call",
          multiplier: 100,
          sharesPerContract: 100,
          providerContractId: "700001",
          brokerContractId: null,
        },
        optionAction: "sell_to_open",
        positionEffect: "open",
        strategyIntent: "covered_call",
      },
    ],
  });

  assert.equal(parsed.orders[0]?.optionAction, "sell_to_open");
  assert.equal(parsed.orders[0]?.positionEffect, "open");
  assert.equal(parsed.orders[0]?.strategyIntent, "covered_call");
});
