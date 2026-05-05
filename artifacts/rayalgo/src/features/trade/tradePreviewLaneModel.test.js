import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTradePreviewLaneLevels,
  formatPreviewLanePrice,
} from "./tradePreviewLaneModel.js";

test("trade preview lane builds bid mid ask levels for options", () => {
  const levels = buildTradePreviewLaneLevels({
    bid: 1.2,
    mid: 1.3,
    ask: 1.4,
  });

  assert.deepEqual(
    levels.map((item) => item.id),
    ["bid", "mid", "ask"],
  );
  assert.equal(levels.find((item) => item.id === "mid")?.price, 1.3);
  assert.equal(levels.some((item) => item.disabled), false);
});

test("trade preview lane uses last price for shares and disables missing prices", () => {
  const shareLevels = buildTradePreviewLaneLevels({
    ticketIsShares: true,
    equityPrice: 502.12,
  });
  const missingLevels = buildTradePreviewLaneLevels({ bid: 0, mid: null, ask: -1 });

  assert.deepEqual(shareLevels, [
    {
      id: "last",
      label: "LAST",
      price: 502.12,
      tone: "neutral",
      disabled: false,
    },
  ]);
  assert.equal(missingLevels.every((item) => item.disabled), true);
  assert.equal(formatPreviewLanePrice(1.234), "1.23");
  assert.equal(formatPreviewLanePrice(null), "--");
});
