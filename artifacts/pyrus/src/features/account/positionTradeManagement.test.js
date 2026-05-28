import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPositionTradeManagement,
  orderMatchesManagementPosition,
} from "./positionTradeManagement.js";

test("trade management uses active broker stop and target before local levels", () => {
  const management = buildPositionTradeManagement(
    {
      symbol: "AAPL",
      quantity: 100,
      mark: 190,
      sl: 150,
      tp: 240,
      openOrders: [
        {
          id: "stop-1",
          symbol: "AAPL",
          side: "sell",
          type: "stop",
          status: "submitted",
          stopPrice: 181,
        },
        {
          id: "target-1",
          symbol: "AAPL",
          side: "sell",
          type: "limit",
          status: "submitted",
          limitPrice: 215,
        },
      ],
    },
  );

  assert.equal(management.stop.price, 181);
  assert.equal(management.stop.source, "broker");
  assert.equal(management.target.price, 215);
  assert.equal(management.target.source, "broker");
  assert.equal(Number(management.riskDistancePct.toFixed(2)), 4.74);
  assert.equal(management.riskAmount, 900);
  assert.equal(management.status, "protected");
});

test("trade management handles short-side stop distance and breach status", () => {
  const management = buildPositionTradeManagement({
    symbol: "TSLA",
    quantity: -50,
    mark: 202,
    openOrders: [
      {
        id: "short-stop",
        symbol: "TSLA",
        side: "buy",
        type: "stop",
        status: "submitted",
        stopPrice: 200,
      },
    ],
  });

  assert.equal(management.stop.price, 200);
  assert.equal(Number(management.riskDistancePct.toFixed(2)), -0.99);
  assert.equal(management.status, "breached");
});

test("trade management exposes automation trailing stop state", () => {
  const management = buildPositionTradeManagement({
    symbol: "SPY",
    quantity: 2,
    mark: 3.4,
    optionContract: { multiplier: 100 },
    automationContext: {
      entryPrice: 2,
      peakPrice: 4,
      stopPrice: 3.1,
      premiumAtRisk: 400,
      tradeManagement: {
        trailActive: true,
        trailStopPrice: 3.1,
      },
    },
  });

  assert.equal(management.stop.price, 3.1);
  assert.equal(management.stop.source, "automation");
  assert.equal(management.trail.price, 3.1);
  assert.equal(management.trail.source, "automation");
  assert.equal(Math.round(management.riskAmount), 60);
});

test("management order matching requires equivalent option contracts", () => {
  const position = {
    symbol: "AAPL",
    optionContract: {
      underlying: "AAPL",
      expirationDate: "2026-06-19T00:00:00.000Z",
      strike: 200,
      right: "call",
    },
  };

  assert.equal(
    orderMatchesManagementPosition(position, {
      symbol: "AAPL",
      optionContract: {
        underlying: "AAPL",
        expirationDate: "2026-06-19",
        strike: 200,
        right: "C",
      },
    }),
    true,
  );
  assert.equal(
    orderMatchesManagementPosition(position, {
      symbol: "AAPL",
      optionContract: {
        underlying: "AAPL",
        expirationDate: "2026-06-19",
        strike: 200,
        right: "put",
      },
    }),
    false,
  );
});
