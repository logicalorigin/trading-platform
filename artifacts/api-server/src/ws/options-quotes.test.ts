import assert from "node:assert/strict";
import test from "node:test";

import { __optionQuoteWsInternalsForTests } from "./options-quotes";

test("option quote websocket queue normalizes OPRA subscription ids before exact filtering", () => {
  const state = __optionQuoteWsInternalsForTests.createOptionQuoteQueueState();

  __optionQuoteWsInternalsForTests.resetOptionQuoteQueueSubscription(state, [
    "SPY260717C00500000",
  ]);
  __optionQuoteWsInternalsForTests.enqueueCurrentOptionQuotes(state, {
    quotes: [
      {
        providerContractId: "O:SPY260717C00500000",
        bid: 1.2,
        ask: 1.25,
      },
    ],
  });

  assert.deepEqual(
    __optionQuoteWsInternalsForTests.getPendingProviderContractIds(state),
    ["O:SPY260717C00500000"],
  );
});

test("option quote websocket demand owners are isolated per connection", () => {
  const requestedOwner = "account-position-option-quotes:U123:2-contracts";
  const first = __optionQuoteWsInternalsForTests.optionQuoteDemandOwnerForConnection(
    requestedOwner,
    1,
  );
  const second = __optionQuoteWsInternalsForTests.optionQuoteDemandOwnerForConnection(
    requestedOwner,
    2,
  );

  assert.notEqual(first, second);
  assert.match(first, /^account-position-option-quotes:U123:2-contracts:ws-1$/);
  assert.match(second, /^account-position-option-quotes:U123:2-contracts:ws-2$/);
});
