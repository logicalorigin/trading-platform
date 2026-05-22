import assert from "node:assert/strict";
import test from "node:test";
import { buildContractChartFlowEvents } from "./useContractFlowChartEvents.js";

const contract = {
  symbol: "SPY",
  providerContractId: "conid-call",
  optionTicker: "SPY20260529C500",
  expirationDate: "2026-05-29",
  right: "call",
  strike: 500,
};

const flowEvent = (overrides = {}) => ({
  id: overrides.id || "flow-event",
  underlying: "SPY",
  provider: "ibkr",
  sourceBasis: "snapshot_activity",
  confidence: "snapshot_activity",
  providerContractId: "conid-call",
  optionTicker: "SPY20260529C500",
  expirationDate: "2026-05-29",
  right: "call",
  strike: 500,
  premium: 120_000,
  occurredAt: "2026-05-21T18:30:00.000Z",
  ...overrides,
});

test("buildContractChartFlowEvents merges broad history with the selected contract event", () => {
  const selected = flowEvent({
    id: "selected-row",
    premium: 300_000,
    occurredAt: "2026-05-21T19:00:00.000Z",
  });
  const matchingHistory = flowEvent({
    id: "matching-history",
    sourceBasis: "confirmed_trade",
    confidence: "confirmed_trade",
    basis: "trade",
    side: "BUY",
    premium: 150_000,
    occurredAt: "2026-05-21T18:45:00.000Z",
  });
  const otherContract = flowEvent({
    id: "other-contract",
    providerContractId: "conid-put",
    optionTicker: "SPY20260529P490",
    right: "put",
    strike: 490,
  });

  const events = buildContractChartFlowEvents({
    flowEvents: [matchingHistory, otherContract],
    pinnedEvent: selected,
    contract,
    timeframe: "1m",
  });

  assert.deepEqual(
    events.map((event) => event.id).sort(),
    ["matching-history", "selected-row"],
  );
});

test("buildContractChartFlowEvents excludes fallback estimate rows from chart markers", () => {
  const events = buildContractChartFlowEvents({
    flowEvents: [
      flowEvent({ id: "real-snapshot" }),
      flowEvent({
        id: "fallback-estimate",
        sourceBasis: "fallback_estimate",
        confidence: "fallback_estimate",
      }),
    ],
    contract,
    timeframe: "1m",
  });

  assert.deepEqual(
    events.map((event) => event.id),
    ["real-snapshot"],
  );
});

test("buildContractChartFlowEvents keeps older flow inside loaded chart bars", () => {
  const loadedOldEvent = flowEvent({
    id: "loaded-old-event",
    sourceBasis: "confirmed_trade",
    confidence: "confirmed_trade",
    basis: "trade",
    side: "BUY",
    price: 1.25,
    occurredAt: "2026-05-01T14:32:00.000Z",
  });
  const newerEvents = Array.from({ length: 82 }, (_, index) =>
    flowEvent({
      id: `newer-${index}`,
      sourceBasis: "confirmed_trade",
      confidence: "confirmed_trade",
      basis: "trade",
      side: "BUY",
      price: 1.3 + index / 100,
      occurredAt: `2026-05-21T${String(14 + Math.floor(index / 60)).padStart(
        2,
        "0",
      )}:${String(index % 60).padStart(2, "0")}:00.000Z`,
    }),
  );

  const withoutChartBars = buildContractChartFlowEvents({
    flowEvents: [loadedOldEvent, ...newerEvents],
    contract,
    timeframe: "1m",
  });
  const withChartBars = buildContractChartFlowEvents({
    flowEvents: [loadedOldEvent, ...newerEvents],
    contract,
    timeframe: "1m",
    chartBars: [
      { time: Date.parse("2026-05-01T14:31:00.000Z") / 1000 },
      { time: Date.parse("2026-05-01T14:33:00.000Z") / 1000 },
    ],
  });

  assert.equal(
    withoutChartBars.some((event) => event.id === "loaded-old-event"),
    false,
  );
  assert.deepEqual(
    withChartBars.map((event) => event.id),
    ["loaded-old-event"],
  );
});

test("buildContractChartFlowEvents keeps pinned selection outside loaded chart bars", () => {
  const pinned = flowEvent({
    id: "selected-outside-window",
    occurredAt: "2026-05-21T18:30:00.000Z",
  });

  const events = buildContractChartFlowEvents({
    pinnedEvent: pinned,
    contract,
    timeframe: "1m",
    chartBars: [
      { time: Date.parse("2026-05-01T14:31:00.000Z") / 1000 },
      { time: Date.parse("2026-05-01T14:33:00.000Z") / 1000 },
    ],
  });

  assert.deepEqual(
    events.map((event) => event.id),
    ["selected-outside-window"],
  );
});
