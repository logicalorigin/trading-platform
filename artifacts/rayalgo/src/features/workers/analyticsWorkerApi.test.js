import assert from "node:assert/strict";
import test from "node:test";
import { flowEventsToChartEventConversion } from "../charting/chartEvents.ts";
import { buildOptionChainRowsFromApi } from "../trade/optionChainRows.js";
import { buildPendingFlowChartEventConversion } from "./analyticsClient.js";
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
