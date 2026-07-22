import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTicketNumber,
  resolveTicketOrderPrices,
} from "./ibkrOrderTicketModel.js";

test("ticket prices reject missing and malformed numeric input", () => {
  for (const value of [null, undefined, "", "  ", "not-a-price"])
    assert.equal(parseTicketNumber(value), null);

  assert.equal(parseTicketNumber("1.25"), 1.25);
  assert.deepEqual(
    resolveTicketOrderPrices({
      orderType: "LMT",
      limitPrice: "",
      fallbackPrice: null,
    }),
    { fillPrice: null, limitPrice: null, stopPrice: null },
  );
  assert.deepEqual(
    resolveTicketOrderPrices({
      orderType: "MKT",
      fallbackPrice: undefined,
    }),
    { fillPrice: null, limitPrice: null, stopPrice: null },
  );
});
