import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPositionOptionQuoteGroups,
  optionProviderContractIds,
  rowOptionProviderContractIds,
} from "./PositionOptionQuoteStreams.jsx";

const numericOptionRow = {
  id: "U123:12345",
  accountId: "U123",
  symbol: "NVDA",
  assetClass: "Options",
  optionContract: {
    ticker: "NVDA260612C00145000",
    underlying: "NVDA",
    expirationDate: "2026-06-12T00:00:00.000Z",
    strike: 145,
    right: "call",
    multiplier: 100,
    sharesPerContract: 100,
    providerContractId: "12345",
  },
  optionQuote: {
    providerContractId: "12345",
  },
};

test("account option quote streams subscribe to structured ids and keep numeric aliases", () => {
  const subscriptionProviderContractIds = optionProviderContractIds(
    numericOptionRow.optionContract,
  );
  assert.equal(subscriptionProviderContractIds.length, 1);
  assert.match(subscriptionProviderContractIds[0], /^twsopt:/);

  assert.deepEqual(rowOptionProviderContractIds(numericOptionRow), [
    subscriptionProviderContractIds[0],
    "12345",
  ]);

  const groups = buildPositionOptionQuoteGroups([numericOptionRow]);
  assert.deepEqual(groups, [
    {
      underlying: "NVDA",
      providerContractIds: subscriptionProviderContractIds,
    },
  ]);
});
