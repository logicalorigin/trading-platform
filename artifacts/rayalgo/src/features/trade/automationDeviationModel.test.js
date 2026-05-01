import assert from "node:assert/strict";
import test from "node:test";
import { buildSignalOptionsDeviation } from "./automationDeviationModel.js";

const candidate = {
  id: "SIGOPT-1-SPY-buy-1",
  deploymentId: "deployment-1",
  deploymentName: "Shadow Options",
  symbol: "SPY",
  direction: "buy",
  selectedContract: {
    expirationDate: "2026-05-01T00:00:00.000Z",
    strike: 505,
    right: "call",
    providerContractId: "12345",
  },
  orderPlan: {
    entryLimitPrice: 1.25,
    quantity: 2,
  },
};

const orderRequest = {
  accountId: "DU123",
  mode: "paper",
  symbol: "SPY",
  assetClass: "option",
  side: "buy",
  type: "limit",
  quantity: 2,
  limitPrice: 1.25,
  stopPrice: null,
  timeInForce: "day",
  optionContract: {
    expirationDate: "2026-05-01",
    strike: 505,
    right: "call",
    providerContractId: "12345",
  },
};

test("buildSignalOptionsDeviation returns null when preview matches the plan", () => {
  assert.equal(buildSignalOptionsDeviation(candidate, orderRequest), null);
});

test("buildSignalOptionsDeviation records changed trade preview fields", () => {
  const deviation = buildSignalOptionsDeviation(candidate, {
    ...orderRequest,
    quantity: 3,
    limitPrice: 1.4,
    timeInForce: "gtc",
  });

  assert.deepEqual(deviation.payload.changedFields, [
    "quantity",
    "limit_price",
    "time_in_force",
  ]);
  assert.equal(deviation.deploymentId, "deployment-1");
  assert.equal(deviation.payload.candidateId, candidate.id);
  assert.equal(deviation.payload.symbol, "SPY");
});
