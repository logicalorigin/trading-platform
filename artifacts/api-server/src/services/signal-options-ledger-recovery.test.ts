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

test("live deployments do not inherit positions from the Shadow strategy ledger", async () => {
  const carriedShadowPosition = {
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
    peakPrice: 2.5,
    stopPrice: 1.3,
    premiumAtRisk: 1_860,
    selectedContract,
  };

  const positions =
    await internals.reconcileSignalOptionsDeploymentPositionsForTests({
      deployment: { id: deploymentId, mode: "live" } as never,
      positions: [carriedShadowPosition] as never,
      events: [],
    });

  assert.deepEqual(positions, []);
});

function recoverCrmPositionWithMarks(input: {
  marks: unknown[];
  positionMark?: string | null;
}) {
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
        mark:
          input.positionMark === undefined ? "0.060000" : input.positionMark,
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
    marks: input.marks as never,
  });

  assert.equal(recovered.length, 1);
  const position = recovered[0];
  assert.ok(position);
  assert.equal(position.candidateId, candidateId);
  assert.equal(position.symbol, "CRM");
  assert.equal(position.quantity, 10);
  assert.equal(position.entryPrice, 1.86);
  assert.equal(position.lastMarkPrice, 0.06);
  assert.equal(position.peakPrice, 2.5);
}

test("Signal Options active positions recover from open shadow ledger rows", () => {
  recoverCrmPositionWithMarks({
    marks: [
      {
        id: "mark-crm-peak",
        positionId: "shadow-position-crm",
        mark: "2.500000",
        asOf: new Date("2026-06-11T19:00:00.000Z"),
        createdAt: new Date("2026-06-11T19:00:01.000Z"),
      },
      {
        id: "mark-crm-latest",
        positionId: "shadow-position-crm",
        mark: "0.060000",
        asOf: new Date("2026-06-12T17:14:34.959Z"),
        createdAt: new Date("2026-06-12T17:14:35.000Z"),
      },
    ],
  });
});

test("Signal Options recovery preserves a pinned executable-bid peak over valuation marks", () => {
  const [recovered] = internals.recoverActivePositionsFromShadowLedgerRows({
    deploymentId,
    positions: [
      {
        id: "shadow-position-corrected-peak",
        accountId: "shadow",
        positionKey,
        symbol: "CRM",
        assetClass: "option",
        quantity: "10.000000",
        averageCost: "1.860000",
        mark: "2.200000",
        optionContract: selectedContract,
        openedAt: new Date("2026-06-11T18:38:01.478Z"),
        asOf: new Date("2026-06-12T17:14:34.959Z"),
        status: "open",
      },
    ] as never,
    orders: [
      {
        id: "shadow-order-corrected-peak",
        accountId: "shadow",
        source: "automation",
        sourceEventId: "entry-event-corrected-peak",
        symbol: "CRM",
        assetClass: "option",
        side: "buy",
        status: "filled",
        quantity: "10.000000",
        filledQuantity: "10.000000",
        averageFillPrice: "1.860000",
        optionContract: selectedContract,
        placedAt: new Date("2026-06-11T18:38:01.478Z"),
        createdAt: new Date("2026-06-11T18:38:01.478Z"),
        payload: {
          metadata: { deploymentId },
          candidate: { id: candidateId, symbol: "CRM", direction: "buy" },
          position: {
            id: `${deploymentId}:CRM`,
            candidateId,
            symbol: "CRM",
            direction: "buy",
            openedAt: "2026-06-11T18:38:01.478Z",
            entryPrice: 1.86,
            quantity: 10,
            peakPrice: 2.1,
            stopPrice: 1.8,
            selectedContract,
            lastStop: { peakEvidenceSource: "executable_bid" },
          },
          selectedContract,
        },
      },
    ] as never,
    marks: [
      {
        id: "shadow-mark-valuation-high",
        positionId: "shadow-position-corrected-peak",
        mark: "3.500000",
        asOf: new Date("2026-06-12T16:00:00.000Z"),
        createdAt: new Date("2026-06-12T16:00:00.001Z"),
      },
      {
        id: "shadow-mark-valuation-latest",
        positionId: "shadow-position-corrected-peak",
        mark: "2.200000",
        asOf: new Date("2026-06-12T17:14:34.959Z"),
        createdAt: new Date("2026-06-12T17:14:34.960Z"),
      },
    ] as never,
  });

  assert.ok(recovered);
  assert.equal(recovered.peakPrice, 2.1);
  assert.equal(recovered.lastMarkPrice, 2.2);
  assert.equal(
    (recovered.lastStop as { peakEvidenceSource?: string })
      .peakEvidenceSource,
    "executable_bid",
  );
});

test("Signal Options recovery hydrates the durable lifecycle executable-bid peak", () => {
  const openedAt = new Date("2026-06-11T18:38:01.478Z");
  const [recovered] = internals.recoverActivePositionsFromShadowLedgerRows({
    deploymentId,
    positions: [
      {
        id: "shadow-position-durable-bid-peak",
        accountId: "shadow",
        positionKey,
        symbol: "CRM",
        assetClass: "option",
        quantity: "10.000000",
        averageCost: "1.860000",
        mark: "2.200000",
        executableBidPeak: "3.000000",
        executableBidPeakAsOf: new Date("2026-06-12T16:00:00.000Z"),
        optionContract: selectedContract,
        openedAt,
        asOf: new Date("2026-06-12T17:14:34.959Z"),
        status: "open",
      },
    ] as never,
    orders: [
      {
        id: "shadow-order-durable-bid-peak",
        accountId: "shadow",
        source: "automation",
        sourceEventId: "entry-event-durable-bid-peak",
        symbol: "CRM",
        assetClass: "option",
        side: "buy",
        status: "filled",
        quantity: "10.000000",
        filledQuantity: "10.000000",
        averageFillPrice: "1.860000",
        optionContract: selectedContract,
        placedAt: openedAt,
        createdAt: openedAt,
        payload: {
          metadata: { deploymentId },
          candidate: { id: candidateId, symbol: "CRM", direction: "buy" },
          position: {
            id: `${deploymentId}:CRM`,
            candidateId,
            symbol: "CRM",
            direction: "buy",
            openedAt: openedAt.toISOString(),
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
        id: "shadow-mark-valuation-higher",
        positionId: "shadow-position-durable-bid-peak",
        mark: "4.500000",
        asOf: new Date("2026-06-12T16:30:00.000Z"),
        createdAt: new Date("2026-06-12T16:30:00.001Z"),
      },
    ] as never,
  });

  assert.ok(recovered);
  assert.equal(recovered.peakPrice, 3);
  assert.equal(
    (recovered.lastStop as { peakEvidenceSource?: string })
      .peakEvidenceSource,
    "executable_bid",
  );
});

test("Signal Options recovery ignores historical orders, forward-test sells, and shadow-equity-forward sells", () => {
  const entryOrder = {
    id: "shadow-order-reopened-entry",
    accountId: "shadow",
    source: "automation",
    sourceEventId: "entry-event-reopened",
    clientOrderId: "shadow-auto-entry-entry-event-reopened",
    symbol: "CRM",
    assetClass: "option",
    side: "buy",
    status: "filled",
    quantity: "10.000000",
    filledQuantity: "10.000000",
    averageFillPrice: "1.860000",
    optionContract: selectedContract,
    placedAt: new Date("2026-06-11T18:38:01.478Z"),
    createdAt: new Date("2026-06-11T18:38:01.478Z"),
    payload: {
      metadata: { deploymentId },
      candidate: { id: candidateId, symbol: "CRM", direction: "buy" },
      position: {
        id: `${deploymentId}:CRM`,
        candidateId,
        symbol: "CRM",
        direction: "buy",
        openedAt: "2026-06-11T18:38:01.478Z",
        entryPrice: 1.86,
        quantity: 10,
        peakPrice: 1.86,
        stopPrice: 1.3,
        selectedContract,
      },
      selectedContract,
    },
  };
  const excludedSell = (input: {
    id: string;
    clientOrderId: string;
    payload: Record<string, unknown>;
  }) => ({
    ...entryOrder,
    id: input.id,
    sourceEventId: `${input.id}-event`,
    clientOrderId: input.clientOrderId,
    side: "sell",
    placedAt: new Date("2026-06-12T19:45:00.000Z"),
    createdAt: new Date("2026-06-12T19:45:00.000Z"),
    payload: {
      ...entryOrder.payload,
      ...input.payload,
    },
  });
  const historicalBuy = {
    ...entryOrder,
    id: "shadow-order-historical-entry",
    sourceEventId: "historical-entry-event",
    clientOrderId: "shadow-auto-entry-historical-entry-event",
    quantity: "50.000000",
    filledQuantity: "50.000000",
    averageFillPrice: "9.000000",
    placedAt: new Date("2026-06-11T18:30:00.000Z"),
    createdAt: new Date("2026-06-11T18:30:00.000Z"),
    payload: {
      ...entryOrder.payload,
      backfillEventKey: "signal_options_backfill:CRM:entry",
      metadata: {
        deploymentId,
        runMode: "historical_backfill",
        runSource: "signal_options_backfill",
      },
      candidate: {
        id: "candidate-historical",
        symbol: "CRM",
        direction: "buy",
      },
      position: {
        ...entryOrder.payload.position,
        candidateId: "candidate-historical",
        entryPrice: 9,
        quantity: 50,
      },
    },
  };
  const [recovered] = internals.recoverActivePositionsFromShadowLedgerRows({
    deploymentId,
    positions: [
      {
        id: "shadow-position-reopened",
        accountId: "shadow",
        positionKey,
        symbol: "CRM",
        assetClass: "option",
        quantity: "10.000000",
        averageCost: "1.860000",
        mark: "2.000000",
        optionContract: selectedContract,
        openedAt: new Date("2026-06-11T18:38:01.478Z"),
        asOf: new Date("2026-06-12T19:59:00.000Z"),
        status: "open",
      },
    ] as never,
    orders: [
      historicalBuy,
      entryOrder,
      excludedSell({
        id: "shadow-order-forward-test-sell",
        clientOrderId: "shadow-auto-exit-old-eod",
        payload: { forwardTest: true },
      }),
      excludedSell({
        id: "shadow-order-equity-forward-sell",
        clientOrderId: "shadow-equity-forward-ledger-audit",
        payload: {},
      }),
    ] as never,
    marks: [],
  });

  assert.ok(recovered);
  assert.equal(recovered.quantity, 10);
  assert.equal(recovered.entryPrice, 1.86);
});

test("Signal Options active positions recover raw SQL shadow mark timestamp strings", () => {
  recoverCrmPositionWithMarks({
    positionMark: null,
    marks: [
      {
        id: "mark-crm-peak",
        positionId: "shadow-position-crm",
        mark: "2.500000",
        asOf: "2026-06-11T19:00:00.000Z",
        createdAt: "2026-06-11T19:00:01.000Z",
      },
      {
        id: "mark-crm-latest",
        positionId: "shadow-position-crm",
        mark: "0.060000",
        asOf: "2026-06-12T17:14:34.959Z",
        createdAt: "2026-06-12T17:14:35.000Z",
      },
    ],
  });
});

test("Signal Options recovery preserves the entry lifecycle timestamp when the cash mirror is 1ms later", () => {
  const [recovered] = internals.recoverActivePositionsFromShadowLedgerRows({
    deploymentId,
    positions: [
      {
        id: "shadow-position-abat",
        accountId: "shadow",
        positionKey,
        symbol: "CRM",
        assetClass: "option",
        quantity: "10.000000",
        averageCost: "1.860000",
        mark: "1.860000",
        optionContract: selectedContract,
        openedAt: new Date("2026-07-16T14:53:19.616Z"),
        asOf: new Date("2026-07-16T19:45:00.000Z"),
        status: "open",
      },
    ] as never,
    orders: [
      {
        id: "shadow-order-abat",
        accountId: "shadow",
        source: "automation",
        sourceEventId: "entry-event-abat",
        symbol: "CRM",
        assetClass: "option",
        side: "buy",
        quantity: "10.000000",
        averageFillPrice: "1.860000",
        optionContract: selectedContract,
        placedAt: new Date("2026-07-16T14:53:19.616Z"),
        payload: {
          metadata: { deploymentId },
          candidate: { id: candidateId, symbol: "CRM", direction: "buy" },
          position: {
            id: `${deploymentId}:CRM`,
            candidateId,
            symbol: "CRM",
            direction: "buy",
            openedAt: "2026-07-16T14:53:19.615Z",
            entryPrice: 1.86,
            quantity: 10,
            peakPrice: 1.86,
            stopPrice: 1.49,
            selectedContract,
          },
          selectedContract,
        },
      },
    ] as never,
  });

  assert.equal(recovered?.openedAt, "2026-07-16T14:53:19.615Z");
});

test("Signal Options recovery folds only the requested deployment's contract inventory", () => {
  const globalPosition = {
    id: "shadow-position-shared-contract",
    accountId: "shadow",
    positionKey,
    symbol: "CRM",
    assetClass: "option",
    quantity: "3.000000",
    averageCost: "2.333333",
    mark: "2.500000",
    optionContract: selectedContract,
    openedAt: new Date("2026-07-16T14:30:00.000Z"),
    asOf: new Date("2026-07-16T15:00:00.000Z"),
    status: "open",
  };
  const entryOrder = (input: {
    id: string;
    deploymentId: string;
    candidateId: string;
    quantity: number;
    price: number;
    placedAt: string;
  }) => ({
    id: input.id,
    accountId: "shadow",
    source: "automation",
    sourceEventId: `${input.id}-event`,
    symbol: "CRM",
    assetClass: "option",
    side: "buy",
    status: "filled",
    quantity: input.quantity.toFixed(6),
    filledQuantity: input.quantity.toFixed(6),
    averageFillPrice: input.price.toFixed(6),
    optionContract: selectedContract,
    placedAt: new Date(input.placedAt),
    createdAt: new Date(input.placedAt),
    payload: {
      metadata: { deploymentId: input.deploymentId },
      candidate: {
        id: input.candidateId,
        symbol: "CRM",
        direction: "buy",
      },
      position: {
        id: `${input.deploymentId}:CRM`,
        candidateId: input.candidateId,
        symbol: "CRM",
        direction: "buy",
        openedAt: input.placedAt,
        entryPrice: input.price,
        quantity: input.quantity,
        peakPrice: input.price,
        stopPrice: input.price * 0.7,
        selectedContract,
      },
      selectedContract,
    },
  });
  const orders = [
    entryOrder({
      id: "order-deployment-a",
      deploymentId: "deployment-a",
      candidateId: "candidate-a",
      quantity: 1,
      price: 1,
      placedAt: "2026-07-16T14:30:00.000Z",
    }),
    entryOrder({
      id: "order-deployment-b",
      deploymentId: "deployment-b",
      candidateId: "candidate-b",
      quantity: 2,
      price: 3,
      placedAt: "2026-07-16T14:31:00.000Z",
    }),
  ];

  const recover = (requestedDeploymentId: string) =>
    internals.recoverActivePositionsFromShadowLedgerRows({
      deploymentId: requestedDeploymentId,
      positions: [globalPosition] as never,
      orders: orders as never,
      marks: [],
    })[0];

  const deploymentA = recover("deployment-a");
  const deploymentB = recover("deployment-b");
  assert.ok(deploymentA);
  assert.ok(deploymentB);
  assert.equal(deploymentA.quantity, 1);
  assert.equal(deploymentA.entryPrice, 1);
  assert.equal(deploymentA.candidateId, "candidate-a");
  assert.equal(deploymentB.quantity, 2);
  assert.equal(deploymentB.entryPrice, 3);
  assert.equal(deploymentB.candidateId, "candidate-b");
});

test("Signal Options recovery uses immutable mark IDs to break equal-time ties", () => {
  const ledgerPosition = {
    id: "shadow-position-equal-time-marks",
    accountId: "shadow",
    positionKey,
    symbol: "CRM",
    assetClass: "option",
    quantity: "1.000000",
    averageCost: "1.000000",
    mark: null,
    optionContract: selectedContract,
    openedAt: new Date("2026-07-16T14:30:00.000Z"),
    asOf: new Date("2026-07-16T14:30:00.000Z"),
    status: "open",
  };
  const entryOrder = {
    id: "shadow-order-equal-time-marks",
    accountId: "shadow",
    source: "automation",
    sourceEventId: "entry-event-equal-time-marks",
    symbol: "CRM",
    assetClass: "option",
    side: "buy",
    status: "filled",
    quantity: "1.000000",
    filledQuantity: "1.000000",
    averageFillPrice: "1.000000",
    optionContract: selectedContract,
    placedAt: new Date("2026-07-16T14:30:00.000Z"),
    createdAt: new Date("2026-07-16T14:30:00.000Z"),
    payload: {
      metadata: { deploymentId },
      candidate: { id: candidateId, symbol: "CRM", direction: "buy" },
      position: {
        id: `${deploymentId}:CRM`,
        candidateId,
        symbol: "CRM",
        direction: "buy",
        openedAt: "2026-07-16T14:30:00.000Z",
        entryPrice: 1,
        quantity: 1,
        peakPrice: 1,
        stopPrice: 0.7,
        selectedContract,
      },
      selectedContract,
    },
  };
  const tiedAt = new Date("2026-07-16T15:00:00.000Z");
  const lowerId = {
    id: "mark-a",
    positionId: ledgerPosition.id,
    mark: "1.200000",
    asOf: tiedAt,
    createdAt: tiedAt,
  };
  const higherId = {
    id: "mark-b",
    positionId: ledgerPosition.id,
    mark: "1.400000",
    asOf: tiedAt,
    createdAt: tiedAt,
  };
  const recover = (marks: unknown[]) =>
    internals.recoverActivePositionsFromShadowLedgerRows({
      deploymentId,
      positions: [ledgerPosition] as never,
      orders: [entryOrder] as never,
      marks: marks as never,
    })[0];

  assert.equal(recover([lowerId, higherId])?.lastMarkPrice, 1.4);
  assert.equal(recover([higherId, lowerId])?.lastMarkPrice, 1.4);
});

test("Signal Options recovery prefers newer mark history over a stale materialized row", () => {
  const [recovered] = internals.recoverActivePositionsFromShadowLedgerRows({
    deploymentId,
    positions: [
      {
        id: "shadow-position-stale-row",
        accountId: "shadow",
        positionKey,
        symbol: "CRM",
        assetClass: "option",
        quantity: "1.000000",
        averageCost: "1.000000",
        mark: "0.500000",
        optionContract: selectedContract,
        openedAt: new Date("2026-07-16T13:30:00.000Z"),
        asOf: new Date("2026-07-16T14:00:00.000Z"),
        status: "open",
      },
    ] as never,
    orders: [
      {
        id: "shadow-order-stale-row",
        accountId: "shadow",
        source: "automation",
        sourceEventId: "entry-event-stale-row",
        symbol: "CRM",
        assetClass: "option",
        side: "buy",
        status: "filled",
        quantity: "1.000000",
        filledQuantity: "1.000000",
        averageFillPrice: "1.000000",
        optionContract: selectedContract,
        placedAt: new Date("2026-07-16T13:30:00.000Z"),
        createdAt: new Date("2026-07-16T13:30:00.000Z"),
        payload: {
          metadata: { deploymentId },
          candidate: { id: candidateId, symbol: "CRM", direction: "buy" },
          position: {
            id: `${deploymentId}:CRM`,
            candidateId,
            symbol: "CRM",
            direction: "buy",
            openedAt: "2026-07-16T13:30:00.000Z",
            entryPrice: 1,
            quantity: 1,
            peakPrice: 1,
            stopPrice: 0.7,
            selectedContract,
          },
          selectedContract,
        },
      },
    ] as never,
    marks: [
      {
        id: "mark-newer-than-row",
        positionId: "shadow-position-stale-row",
        mark: "2.000000",
        asOf: new Date("2026-07-16T15:00:00.000Z"),
        createdAt: new Date("2026-07-16T15:00:01.000Z"),
      },
    ] as never,
  });

  assert.equal(recovered?.lastMarkPrice, 2);
  assert.equal(recovered?.lastMarkedAt, "2026-07-16T15:00:00.000Z");
});

test("shadow valuation peaks cannot acquire executable-bid provenance during reconciliation", () => {
  const eventPosition = {
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
    peakPrice: 2.1,
    stopPrice: 1.8,
    premiumAtRisk: 1_860,
    selectedContract,
    lastMarkPrice: 2,
    lastMarkedAt: "2026-06-12T17:14:34.959Z",
    lastStop: { peakEvidenceSource: "executable_bid" },
  } as const;
  const ledgerPosition = {
    ...eventPosition,
    peakPrice: 3.5,
    lastMarkPrice: 2.2,
    lastStop: null,
  };

  const [reconciled] =
    internals.mergeActivePositionsWithShadowLedgerForTests(
      [eventPosition] as never,
      [ledgerPosition] as never,
    );

  assert.ok(reconciled);
  assert.equal(reconciled.peakPrice, 2.1);
  assert.equal(reconciled.lastMarkPrice, 2.2);
});

test("reconciliation keeps the higher durable executable-bid peak", () => {
  const eventPosition = {
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
    peakPrice: 2.1,
    stopPrice: 1.8,
    premiumAtRisk: 1_860,
    selectedContract,
    lastMarkPrice: 2,
    lastMarkedAt: "2026-06-12T17:14:34.959Z",
    lastStop: { peakEvidenceSource: "executable_bid" },
  } as const;
  const ledgerPosition = {
    ...eventPosition,
    peakPrice: 3,
    lastMarkPrice: 2.2,
  };

  const [reconciled] =
    internals.mergeActivePositionsWithShadowLedgerForTests(
      [eventPosition] as never,
      [ledgerPosition] as never,
    );

  assert.ok(reconciled);
  assert.equal(reconciled.peakPrice, 3);
  assert.equal(
    (reconciled.lastStop as { peakEvidenceSource?: string })
      .peakEvidenceSource,
    "executable_bid",
  );
});
