import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPositionOptionQuoteGroups,
  buildPositionOptionQuoteStreamSubscription,
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

test("account option quote streams subscribe to OPRA ids and keep numeric aliases", () => {
  const subscriptionProviderContractIds = optionProviderContractIds(
    numericOptionRow.optionContract,
  );
  assert.equal(subscriptionProviderContractIds.length, 1);
  assert.equal(subscriptionProviderContractIds[0], "O:NVDA260612C00145000");

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

test("account option quote streams keep quote OPRA aliases when contract OPRA differs", () => {
  const adjustedOptionRow = {
    ...numericOptionRow,
    optionContract: {
      ...numericOptionRow.optionContract,
      ticker: "NVDA260612C00145000",
      providerContractId: "12345",
    },
    optionQuote: {
      providerContractId: "O:NVDA260612C00146000",
    },
  };

  assert.deepEqual(rowOptionProviderContractIds(adjustedOptionRow), [
    "O:NVDA260612C00145000",
    "12345",
    "O:NVDA260612C00146000",
  ]);

  const groups = buildPositionOptionQuoteGroups([adjustedOptionRow]);
  assert.deepEqual(groups, [
    {
      underlying: "NVDA",
      providerContractIds: [
        "O:NVDA260612C00145000",
        "O:NVDA260612C00146000",
      ],
    },
  ]);
});

test("account option quote stream groups aggregate into one subscription", () => {
  const subscription = buildPositionOptionQuoteStreamSubscription(
    [
      {
        underlying: "NVDA",
        providerContractIds: ["O:NVDA260612C00145000", "12345"],
      },
      {
        underlying: "TSLA",
        providerContractIds: ["O:TSLA260612P00200000", "12345"],
      },
    ],
    "algo-position-option-quotes",
  );

  assert.deepEqual(subscription.providerContractIds, [
    "O:NVDA260612C00145000",
    "12345",
    "O:TSLA260612P00200000",
  ]);
  assert.equal(subscription.underlying, null);
  assert.equal(subscription.owner, "algo-position-option-quotes:3-contracts");
});
