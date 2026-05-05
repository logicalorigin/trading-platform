import assert from "node:assert/strict";
import test from "node:test";
import { buildRelatedFlowEvents } from "./flowRelatedEventsModel.js";

const selectedEvent = {
  id: "nvda-selected",
  ticker: "NVDA",
  cp: "C",
  strike: 920,
  expirationDate: "2026-05-15T00:00:00.000Z",
  occurredAt: "2026-05-05T14:30:00.000Z",
};

test("buildRelatedFlowEvents prioritizes same contract prints then recent underlying flow", () => {
  const related = buildRelatedFlowEvents({
    event: selectedEvent,
    events: [
      selectedEvent,
      {
        id: "old-underlying",
        underlying: "NVDA",
        cp: "P",
        strike: 900,
        expirationDate: "2026-05-22T00:00:00.000Z",
        occurredAt: "2026-05-05T14:24:00.000Z",
      },
      {
        id: "same-contract",
        ticker: "NVDA",
        right: "call",
        strike: 920,
        expirationDate: "2026-05-15",
        occurredAt: "2026-05-05T14:20:00.000Z",
      },
      {
        id: "new-underlying",
        ticker: "NVDA",
        cp: "C",
        strike: 925,
        expirationDate: "2026-05-15T00:00:00.000Z",
        occurredAt: "2026-05-05T14:28:00.000Z",
      },
      {
        id: "other-ticker",
        ticker: "AAPL",
        cp: "C",
        strike: 200,
        expirationDate: "2026-05-15T00:00:00.000Z",
        occurredAt: "2026-05-05T14:29:00.000Z",
      },
    ],
  });

  assert.deepEqual(
    related.map((event) => event.id),
    ["same-contract", "new-underlying", "old-underlying"],
  );
  assert.equal(related[0].relationship, "same_contract");
  assert.equal(related[1].relationship, "same_underlying");
});

test("buildRelatedFlowEvents honors limits and missing event guards", () => {
  assert.deepEqual(buildRelatedFlowEvents({ event: null, events: [] }), []);
  assert.deepEqual(
    buildRelatedFlowEvents({
      event: selectedEvent,
      events: [
        { id: "one", ticker: "NVDA" },
        { id: "two", ticker: "NVDA" },
      ],
      limit: 1,
    }).map((event) => event.id),
    ["one"],
  );
});
