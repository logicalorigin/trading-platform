import assert from "node:assert/strict";
import test from "node:test";

import { buildContractChartFlowEvents } from "./useContractFlowChartEvents.js";

const contract = {
  symbol: "AAPL",
  providerContractId: "12345",
};

const eventAt = (id, occurredAt) => ({
  id,
  ticker: contract.symbol,
  providerContractId: contract.providerContractId,
  sourceBasis: "confirmed_trade",
  occurredAt,
});

test("the selected contract event survives the pre-hydration lookback cap", () => {
  const pinnedEvent = eventAt("pinned", "2000-01-03T15:30:00.000Z");
  const flowEvents = Array.from({ length: 81 }, (_, index) =>
    eventAt(
      `recent-${index}`,
      new Date(Date.now() - index * 1_000).toISOString(),
    ),
  );

  const result = buildContractChartFlowEvents({
    flowEvents,
    pinnedEvent,
    contract,
    timeframe: "1m",
    chartBars: [],
  });

  assert.ok(result.some((event) => event.id === pinnedEvent.id));
});
