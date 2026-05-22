import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPositionDisplayModel,
  formatPositionBidAskLabel,
  formatPositionOpenedLabel,
  getPositionOpenedAt,
  positionCostBasis,
} from "./positionDisplayModel.js";

test("position display prefers automation open date over broker field", () => {
  assert.deepEqual(
    getPositionOpenedAt({
      openedAt: "2026-05-19T14:00:00.000Z",
      openedAtSource: "broker",
      automationContext: {
        openedAt: "2026-05-20T14:00:00.000Z",
      },
    }),
    {
      openedAt: "2026-05-20T14:00:00.000Z",
      openedAtSource: "automation",
    },
  );
});

test("position opened date uses compact numeric format", () => {
  assert.equal(
    formatPositionOpenedLabel("2026-05-21T14:00:00.000Z"),
    "05/21/26",
  );
});

test("position display normalizes bid ask and spread", () => {
  const display = buildPositionDisplayModel({
    mark: 10,
    quote: {
      bid: 9.9,
      ask: 10.1,
      updatedAt: "2026-05-21T14:00:00.000Z",
      source: "bridge_quote",
    },
  });

  assert.equal(
    formatPositionBidAskLabel(display.quote, (value) => value.toFixed(2)),
    "9.90 / 10.10",
  );
  assert.equal(display.quote.spread.toFixed(2), "0.20");
  assert.equal(display.quote.spreadPercent.toFixed(1), "2.0");
});

test("position display prefers backend bid ask over mark-only option quote", () => {
  const display = buildPositionDisplayModel({
    mark: 10,
    optionQuote: {
      mark: 10,
      source: "position_mark",
    },
    quote: {
      bid: 9.85,
      ask: 10.15,
      mark: 10,
      source: "option_quote",
    },
  });

  assert.equal(
    formatPositionBidAskLabel(display.quote, (value) => value.toFixed(2)),
    "9.85 / 10.15",
  );
  assert.equal(display.quote.source, "option_quote");
});

test("position display prefers live option bid ask over backend snapshot", () => {
  const display = buildPositionDisplayModel(
    {
      mark: 10,
      quote: {
        bid: 9.8,
        ask: 10.2,
        mark: 10,
        source: "option_quote",
      },
    },
    {
      bid: 9.9,
      ask: 10.1,
      mark: 10,
      source: "option_quote",
    },
  );

  assert.equal(
    formatPositionBidAskLabel(display.quote, (value) => value.toFixed(2)),
    "9.90 / 10.10",
  );
});

test("position cost basis uses option multiplier", () => {
  assert.equal(
    positionCostBasis({
      quantity: 2,
      averageCost: 1.5,
      optionContract: { multiplier: 100 },
    }),
    300,
  );
});
