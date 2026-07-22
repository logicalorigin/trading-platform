import assert from "node:assert/strict";
import test from "node:test";

import { buildChartPositionOverlays } from "./chartPositionOverlays";

test("option overlays do not infer identity when only one side has a provider id", () => {
  const overlays = buildChartPositionOverlays({
    chartContext: {
      surfaceKind: "option",
      symbol: "AAPL",
      optionContract: {
        underlying: "AAPL",
        expirationDate: "2026-08-21",
        strike: 200,
        right: "call",
      },
    },
    positions: [
      {
        symbol: "AAPL",
        quantity: 1,
        averageCost: 2,
        optionContract: {
          providerContractId: "robinhood-option-uuid",
          underlying: "AAPL",
          expirationDate: "2026-08-21",
          strike: 200,
          right: "call",
        },
      },
    ],
  });

  assert.deepEqual(overlays.entryLines, []);
});

test("native Robinhood option overlays fail closed when both ids are missing", () => {
  const optionContract = {
    underlying: "AAPL",
    expirationDate: "2026-08-21",
    strike: 200,
    right: "call",
  };
  const overlays = buildChartPositionOverlays({
    chartContext: {
      surfaceKind: "option",
      symbol: "AAPL",
      optionContract,
    },
    positions: [
      {
        symbol: "AAPL",
        providerSecurityType: "robinhood_option",
        quantity: 1,
        averageCost: 2,
        optionContract,
      },
    ],
  });

  assert.deepEqual(overlays.entryLines, []);
});
