import assert from "node:assert/strict";
import test from "node:test";
import { flowEventsToChartEventConversion } from "../charting/chartEvents.ts";
import { buildOptionChainRowsFromApi } from "../trade/optionChainRows.js";
import {
  buildFlowEventSignature,
  buildPendingFlowChartEventConversion,
} from "./analyticsClient.js";
import { analyticsWorkerApi } from "./analyticsWorkerApi.js";

const flowEvent = {
  id: "flow-1",
  ticker: "SPY",
  occurredAt: "2026-05-08T14:30:00.000Z",
  cp: "C",
  strike: 500,
  side: "BUY",
  premium: 250000,
  unusualScore: 2,
  contract: "SPY 500C",
};

test("analytics worker API matches sync flow event conversion", () => {
  const expected = flowEventsToChartEventConversion([flowEvent], "SPY");
  const actual = analyticsWorkerApi.flowEventsToChartEventConversion(
    [flowEvent],
    "SPY",
  );

  assert.deepEqual(actual, expected);
  assert.equal(actual.events[0]?.bias, "bullish");
});

test("pending flow chart conversion preserves input count without sync events", () => {
  assert.deepEqual(buildPendingFlowChartEventConversion([flowEvent]), {
    events: [],
    rawInputCount: 1,
    flowRecordCount: 0,
    convertedEventCount: 0,
    droppedInvalidTimeCount: 0,
    droppedSymbolCount: 0,
  });
});

test("flow chart worker signature changes when event chart times change", () => {
  const firstSignature = buildFlowEventSignature(
    [
      {
        ...flowEvent,
        id: "same-id",
        occurredAt: "2026-05-08T14:30:00.000Z",
      },
    ],
    "SPY",
  );
  const nextSignature = buildFlowEventSignature(
    [
      {
        ...flowEvent,
        id: "same-id",
        occurredAt: "2026-05-08T15:30:00.000Z",
      },
    ],
    "SPY",
  );

  assert.notEqual(firstSignature, nextSignature);
});

test("analytics worker flow overlay model renders volume from confirmed trades only", () => {
  const { events } = flowEventsToChartEventConversion(
    [
      {
        ...flowEvent,
        id: "confirmed-print",
        basis: "trade",
        sourceBasis: "confirmed_trade",
        provider: "polygon",
        occurredAt: "2026-05-08T14:31:00.000Z",
        premium: 125000,
      },
      {
        ...flowEvent,
        id: "snapshot-close-state",
        basis: "snapshot",
        sourceBasis: "snapshot_activity",
        confidence: "snapshot_activity",
        provider: "ibkr",
        occurredAt: "2026-05-08T14:39:00.000Z",
        premium: 10000000,
      },
    ],
    "SPY",
  );

  const model = {
    chartBars: [
      {
        time: Date.parse("2026-05-08T14:30:00.000Z") / 1000,
        ts: "2026-05-08T14:30:00.000Z",
        date: "2026-05-08",
        o: 100,
        h: 101,
        l: 99,
        c: 100,
        v: 100000,
      },
      {
        time: Date.parse("2026-05-08T14:35:00.000Z") / 1000,
        ts: "2026-05-08T14:35:00.000Z",
        date: "2026-05-08",
        o: 100,
        h: 102,
        l: 100,
        c: 101,
        v: 120000,
      },
    ],
    chartBarRanges: [
      {
        startMs: Date.parse("2026-05-08T14:30:00.000Z"),
        endMs: Date.parse("2026-05-08T14:35:00.000Z"),
      },
      {
        startMs: Date.parse("2026-05-08T14:35:00.000Z"),
        endMs: Date.parse("2026-05-08T14:40:00.000Z"),
      },
    ],
  };

  const overlayModel = analyticsWorkerApi.buildFlowChartOverlayModel({
    events,
    model,
  });

  assert.equal(overlayModel.buckets.length, 1);
  assert.equal(overlayModel.buckets[0].sourceBasis, "confirmed_trade");
  assert.equal(overlayModel.buckets[0].totalPremium, 125000);
  assert.equal(overlayModel.tooltips.length, 1);
  assert.equal(overlayModel.diagnostics.snapshotActivityFlowEventCount, 1);
});

test("analytics worker API matches sync option chain row build", () => {
  const contracts = [
    {
      contract: {
        ticker: "SPY-20260515-C500",
        underlying: "SPY",
        expirationDate: "2026-05-15T00:00:00.000Z",
        strike: 500,
        right: "call",
        providerContractId: "call-500",
      },
      bid: 1.2,
      ask: 1.4,
      mark: 1.3,
      quoteFreshness: "metadata",
    },
  ];

  assert.deepEqual(
    analyticsWorkerApi.buildOptionChainRows({ contracts, spotPrice: 501 }),
    buildOptionChainRowsFromApi(contracts, 501),
  );
});
