import assert from "node:assert/strict";
import test from "node:test";

import { __signalOptionsAutomationInternalsForTests as internals } from "./signal-options-automation";

const selectedContract = {
  right: "call",
  strike: 167.5,
  ticker: "CRM20260612C1675",
  multiplier: 100,
  underlying: "CRM",
  expirationDate: "2026-06-12",
  providerContractId: "crm-contract",
};

const deploymentId = "deployment-shadow";
const candidateId = "SIGOPT-deployment-CRM-buy-1781198700000";
const positionKey = "option:CRM:2026-06-12:167.5:call:crm-contract";

test("Signal Options active positions recover from open shadow ledger rows", () => {
  const recovered = internals.recoverActivePositionsFromShadowLedgerRows({
    deploymentId,
    positions: [
      {
        id: "shadow-position-crm",
        accountId: "shadow",
        positionKey,
        symbol: "CRM",
        assetClass: "option",
        quantity: "10.000000",
        averageCost: "1.860000",
        mark: "0.060000",
        optionContract: selectedContract,
        openedAt: new Date("2026-06-11T18:38:01.478Z"),
        asOf: new Date("2026-06-12T17:14:34.959Z"),
        status: "open",
      },
    ] as never,
    orders: [
      {
        id: "shadow-order-crm",
        accountId: "shadow",
        source: "automation",
        sourceEventId: "entry-event-crm",
        symbol: "CRM",
        assetClass: "option",
        side: "buy",
        quantity: "10.000000",
        averageFillPrice: "1.860000",
        optionContract: selectedContract,
        placedAt: new Date("2026-06-11T18:38:01.478Z"),
        payload: {
          metadata: {
            deploymentId,
            deploymentName: "Pyrus Signals Options Shadow",
          },
          candidate: {
            id: candidateId,
            symbol: "CRM",
            direction: "buy",
            optionRight: "call",
            timeframe: "5m",
            signalAt: "2026-06-11T17:25:00.000Z",
          },
          position: {
            id: `${deploymentId}:CRM`,
            candidateId,
            symbol: "CRM",
            direction: "buy",
            optionRight: "call",
            timeframe: "5m",
            signalAt: "2026-06-11T17:25:00.000Z",
            openedAt: "2026-06-11T18:38:01.478Z",
            entryPrice: 1.86,
            quantity: 10,
            peakPrice: 1.86,
            stopPrice: 1.3,
            selectedContract,
          },
          selectedContract,
        },
      },
    ] as never,
    marks: [
      {
        id: "mark-crm-peak",
        positionId: "shadow-position-crm",
        mark: "2.500000",
        asOf: new Date("2026-06-11T19:00:00.000Z"),
      },
      {
        id: "mark-crm-latest",
        positionId: "shadow-position-crm",
        mark: "0.060000",
        asOf: new Date("2026-06-12T17:14:34.959Z"),
      },
    ] as never,
  });

  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.candidateId, candidateId);
  assert.equal(recovered[0]?.symbol, "CRM");
  assert.equal(recovered[0]?.quantity, 10);
  assert.equal(recovered[0]?.entryPrice, 1.86);
  assert.equal(recovered[0]?.lastMarkPrice, 0.06);
  assert.equal(recovered[0]?.peakPrice, 2.5);
});
