import assert from "node:assert/strict";
import test from "node:test";

import { orderMatchesManagementPosition } from "./positionTradeManagement.js";

test("option management does not infer a contract when one provider id is missing", () => {
  const optionContract = {
    providerContractId: "robinhood-option-uuid",
    underlying: "AAPL",
    expirationDate: "2026-08-21",
    strike: 200,
    right: "call",
  };
  const position = { symbol: "AAPL", optionContract };

  assert.equal(
    orderMatchesManagementPosition(position, {
      symbol: "AAPL",
      optionContract: { ...optionContract, providerContractId: null },
    }),
    false,
  );
  assert.equal(
    orderMatchesManagementPosition(position, {
      symbol: "AAPL",
      optionContract,
    }),
    true,
  );
});

test("native Robinhood option management fails closed when both ids are missing", () => {
  const optionContract = {
    underlying: "AAPL",
    expirationDate: "2026-08-21",
    strike: 200,
    right: "call",
  };

  assert.equal(
    orderMatchesManagementPosition(
      {
        symbol: "AAPL",
        providerSecurityType: "robinhood_option",
        optionContract,
      },
      { symbol: "AAPL", optionContract },
    ),
    false,
  );
});
