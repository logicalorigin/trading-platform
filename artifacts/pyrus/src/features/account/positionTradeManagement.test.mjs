import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPositionTradeManagement,
  positionStopPeakMetrics,
} from "./positionTradeManagement.js";

test("long hard stop reports projected loss from average cost", () => {
  const management = buildPositionTradeManagement({
    averageCost: 100,
    mark: 110,
    quantity: 10,
    stopLoss: 90,
  });

  assert.equal(management.stopProjectedReturnPct, -10);
  assert.equal(management.trailProjectedReturnPct, null);
  assert.equal(management.status, "protected");
  assert.ok(Math.abs(management.riskDistancePct - 18.181818181818183) < 1e-12);
});

test("long trailing stop reports projected locked gain from average cost", () => {
  const management = buildPositionTradeManagement({
    averageCost: 100,
    mark: 130,
    quantity: 10,
    riskOverlay: {
      activeStopKind: "trailing_stop",
      hardStopPrice: 80,
      trailActive: true,
      trailHasTakenOver: true,
      trailStopPrice: 120,
    },
  });

  assert.equal(management.stopProjectedReturnPct, -20);
  assert.equal(management.trailProjectedReturnPct, 20);
  assert.equal(management.protectiveStop.price, 120);
});

test("short hard stop reports projected loss with the position sign reversed", () => {
  const management = buildPositionTradeManagement({
    averageCost: 100,
    mark: 95,
    quantity: -10,
    stopLoss: 110,
  });

  assert.equal(management.stopProjectedReturnPct, -10);
  assert.equal(management.trailProjectedReturnPct, null);
  assert.equal(management.status, "protected");
});

test("short trailing stop reports projected locked gain with the position sign reversed", () => {
  const management = buildPositionTradeManagement({
    averageCost: 100,
    mark: 75,
    quantity: -10,
    riskOverlay: {
      activeStopKind: "trailing_stop",
      hardStopPrice: 110,
      trailActive: true,
      trailHasTakenOver: true,
      trailStopPrice: 80,
    },
  });

  assert.equal(management.stopProjectedReturnPct, -10);
  assert.equal(management.trailProjectedReturnPct, 20);
  assert.equal(management.protectiveStop.price, 80);
});

test("projected stop returns are unavailable without a nonzero entry price", () => {
  for (const averageCost of [undefined, 0]) {
    const management = buildPositionTradeManagement({
      averageCost,
      mark: 110,
      quantity: 10,
      riskOverlay: {
        activeStopKind: "trailing_stop",
        hardStopPrice: 90,
        trailActive: true,
        trailHasTakenOver: true,
        trailStopPrice: 105,
      },
    });

    assert.equal(management.stopProjectedReturnPct, null);
    assert.equal(management.trailProjectedReturnPct, null);
  }
});

test("bid-backed stop peaks measure retracement of accrued profit", () => {
  const metrics = positionStopPeakMetrics({
    averageCost: 2.8,
    mark: 4.6,
    optionQuote: { bid: 3.2, ask: 5.8 },
    automationContext: {
      peakPrice: 3.6,
      peakEvidenceSource: "executable_bid",
    },
  });

  assert.deepEqual(
    { ...metrics, retracePct: null, givebackPct: null },
    {
      peakPrice: 3.6,
      peakEvidenceSource: "executable_bid",
      peakLabel: "Bid peak",
      comparisonPrice: 3.2,
      retracePct: null,
      givebackPct: null,
    },
  );
  assert.ok(Math.abs(metrics.retracePct - 50) < 1e-12);
  assert.equal(metrics.givebackPct, metrics.retracePct);
});

test("a quote ahead of its asynchronous bid-peak checkpoint shows zero retracement", () => {
  assert.equal(
    positionStopPeakMetrics({
      averageCost: 1,
      mark: 1.5,
      quote: { bid: 1.55 },
      automationContext: {
        peakPrice: 1.5,
        peakEvidenceSource: "executable_bid",
      },
    }).retracePct,
    0,
  );
});

test("active trails preserve zero-floor ratchet metadata for display", () => {
  const management = buildPositionTradeManagement({
    averageCost: 2.34,
    mark: 2.95,
    quantity: 6,
    riskOverlay: {
      entryPrice: 2.34,
      hardStopPrice: 1.87,
      activeStopPrice: 2.34,
      activeStopKind: "trailing_stop",
      trailActive: true,
      trailStopPrice: 2.34,
      trailHasTakenOver: true,
      trailActivationPct: 20,
      activeTrailActivationPct: 20,
      minLockedGainPct: 0,
      givebackPct: 30,
      peakPrice: 2.85,
      peakEvidenceSource: "executable_bid",
    },
  });

  assert.equal(management.trailProjectedReturnPct, 0);
  assert.equal(management.trailActivationPct, 20);
  assert.equal(management.trailActiveRungPct, 20);
  assert.equal(management.trailMinLockedGainPct, 0);
  assert.equal(management.trailGivebackPct, 30);
  assert.ok(Math.abs(management.trailPeakReturnPct - 21.794871794871806) < 1e-12);
  assert.equal(management.trailPeakLabel, "Bid peak");
});
