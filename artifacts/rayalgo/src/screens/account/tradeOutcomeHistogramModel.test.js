import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTradeOutcomeHistogramModel,
  tradeMatchesOutcomeBucket,
} from "./tradeOutcomeHistogramModel.js";

test("trade outcome histogram buckets losers left and winners right", () => {
  const model = buildTradeOutcomeHistogramModel({
    trades: [
      { id: "loss-big", realizedPnl: -200 },
      { id: "loss-small", realizedPnl: -25 },
      { id: "flat", realizedPnl: 0 },
      { id: "win-small", realizedPnl: 30 },
      { id: "win-big", realizedPnl: 160 },
    ],
  });

  assert.equal(model.summary.totalTrades, 5);
  assert.equal(model.summary.winners, 2);
  assert.equal(model.summary.losers, 2);
  assert.equal(model.summary.breakeven, 1);
  assert.ok(model.buckets.findIndex((bucket) => bucket.side === "loss") < model.buckets.findIndex((bucket) => bucket.side === "flat"));
  assert.ok(model.buckets.findIndex((bucket) => bucket.side === "flat") < model.buckets.findIndex((bucket) => bucket.side === "win"));
});

test("trade outcome histogram keeps all-flat trades in a flat bucket", () => {
  const model = buildTradeOutcomeHistogramModel({
    trades: [
      { id: "flat-1", realizedPnl: 0 },
      { id: "flat-2", realizedPnl: 0 },
    ],
  });

  assert.equal(model.buckets.length, 1);
  assert.equal(model.buckets[0].side, "flat");
  assert.equal(model.buckets[0].count, 2);
});

test("trade outcome bucket matching filters by realized pnl", () => {
  const model = buildTradeOutcomeHistogramModel({
    trades: [
      { id: "loss", realizedPnl: -50 },
      { id: "win", realizedPnl: 75 },
    ],
  });
  const winningBucket = model.buckets.find((bucket) =>
    bucket.trades.some((trade) => trade.id === "win"),
  );

  assert.equal(tradeMatchesOutcomeBucket({ realizedPnl: 75 }, winningBucket), true);
  assert.equal(tradeMatchesOutcomeBucket({ realizedPnl: -50 }, winningBucket), false);
});

test("trade outcome bucket matching accepts compact server buckets", () => {
  const serverBucket = {
    id: "pnl:server",
    index: 2,
    bucketCount: 5,
    min: 50,
    max: 100,
    label: "50 to 100",
    side: "win",
    count: 4,
    total: 300,
    average: 75,
  };

  assert.equal(tradeMatchesOutcomeBucket({ realizedPnl: 75 }, serverBucket), true);
  assert.equal(tradeMatchesOutcomeBucket({ realizedPnl: 125 }, serverBucket), false);
});

test("trade outcome histogram supports percent-return mode", () => {
  const model = buildTradeOutcomeHistogramModel({
    metric: "percent",
    trades: [
      { id: "loss", realizedPnl: -50, realizedPnlPercent: -2.5 },
      { id: "win", realizedPnl: 75, realizedPnlPercent: 4.2 },
    ],
  });

  assert.equal(model.metric, "percent");
  assert.equal(model.summary.winners, 1);
  assert.equal(model.summary.losers, 1);
});
