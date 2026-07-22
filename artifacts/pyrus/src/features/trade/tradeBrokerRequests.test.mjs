import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBrokerExecutionsPayload } from "./tradeBrokerRequests.js";

const execution = {
  id: "exec-1",
  accountId: "acct-1",
  symbol: "aapl",
  assetClass: "equity",
  side: "buy",
  quantity: 2,
  price: 201.25,
  netAmount: -402.5,
  exchange: "NASDAQ",
  executedAt: "2026-07-21T12:00:00.000Z",
  orderDescription: null,
  contractDescription: null,
  providerContractId: null,
  optionContract: null,
  orderRef: null,
};

test("broker execution payloads normalize only complete economic facts", () => {
  assert.deepEqual(normalizeBrokerExecutionsPayload({ executions: [execution] }), {
    executions: [{ ...execution, symbol: "AAPL" }],
  });

  for (const payload of [
    null,
    {},
    { executions: {} },
    { executions: [{ ...execution, side: "BUY" }] },
    { executions: [{ ...execution, price: 0 }] },
    { executions: [{ ...execution, exchange: undefined }] },
    { executions: [{ ...execution, netAmount: "-402.50" }] },
    { executions: [{ ...execution, executedAt: "not-a-date" }] },
  ]) {
    assert.throws(
      () => normalizeBrokerExecutionsPayload(payload),
      /Invalid broker executions payload/,
    );
  }
});

test("option execution payloads require positive contract economics", () => {
  const optionExecution = {
    ...execution,
    id: "exec-option-1",
    assetClass: "option",
    optionContract: {
      ticker: "AAPL  260821C00200000",
      underlying: "AAPL",
      expirationDate: "2026-08-21",
      strike: 200,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
    },
  };
  const normalized = normalizeBrokerExecutionsPayload({
    executions: [optionExecution],
  });

  assert.equal(
    normalized.executions[0].optionContract.expirationDate,
    "2026-08-21T00:00:00.000Z",
  );
  assert.throws(
    () =>
      normalizeBrokerExecutionsPayload({
        executions: [
          {
            ...optionExecution,
            optionContract: { ...optionExecution.optionContract, multiplier: 0 },
          },
        ],
      }),
    /Invalid broker executions payload/,
  );

  for (const optionContract of [null, undefined]) {
    assert.throws(
      () =>
        normalizeBrokerExecutionsPayload({
          executions: [{ ...optionExecution, optionContract }],
        }),
      /Invalid broker executions payload/,
    );
  }
});
