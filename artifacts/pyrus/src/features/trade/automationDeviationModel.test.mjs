import assert from "node:assert/strict";
import test from "node:test";

import { buildSignalOptionsDeviation } from "./automationDeviationModel.js";

const candidate = (right) => ({
  id: "candidate-1",
  deploymentId: "deployment-1",
  symbol: "SPY",
  selectedContract: {
    expirationDate: "2026-08-21",
    strike: 700,
    right,
    providerContractId: "contract-1",
  },
  orderPlan: { entryLimitPrice: 1.25, quantity: 1 },
});

const order = (right) => ({
  symbol: "SPY",
  side: "buy",
  type: "limit",
  quantity: 1,
  limitPrice: 1.25,
  stopPrice: null,
  timeInForce: "day",
  optionContract: {
    expirationDate: "2026-08-21",
    strike: 700,
    right,
    providerContractId: "contract-1",
  },
});

test("option right codes are normalized without guessing unknown values", () => {
  assert.deepEqual(
    buildSignalOptionsDeviation(candidate("call"), order("P"))?.payload.changedFields,
    ["contract"],
  );
  assert.equal(buildSignalOptionsDeviation(candidate("put"), order("P")), null);
  assert.deepEqual(
    buildSignalOptionsDeviation(candidate("unknown"), order("C"))?.payload.changedFields,
    ["contract"],
  );
});
