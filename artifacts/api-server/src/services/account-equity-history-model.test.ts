import assert from "node:assert/strict";
import test from "node:test";

import { reconstructEquityHistoryFromActivityLedger } from "./account-equity-history-model";

test("reconstructed account equity points use NYSE market-close timestamps", () => {
  const points = reconstructEquityHistoryFromActivityLedger({
    terminal: {
      timestamp: new Date("2026-06-30T20:00:00.000Z"),
      netLiquidation: 900,
      currency: "USD",
    },
    source: "SNAPTRADE_BALANCE_HISTORY",
    events: [
      {
        timestamp: new Date("2026-06-26T14:30:00.000Z"),
        currency: "USD",
        realizedPnl: -100,
      },
    ],
  });

  const eventPoint = points.find((point) => point.netLiquidation === 900);

  assert.equal(eventPoint?.timestamp.toISOString(), "2026-06-26T20:00:00.000Z");
});

