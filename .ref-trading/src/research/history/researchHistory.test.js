import test from "node:test";
import assert from "node:assert/strict";

import { createResearchRunHistoryEntry } from "./researchHistory.js";

test("createResearchRunHistoryEntry drops local payload for persisted results", () => {
  const entry = createResearchRunHistoryEntry({
    runId: "result-123",
    resultId: "result-123",
    createdAt: 123,
    marketSymbol: "SPY",
    setup: {},
    metrics: { n: 10, roi: 4.1 },
    trades: [{ ts: "2026-03-27 09:30", optionTicker: "SPY", pnl: 12 }],
    equity: [{ i: 1, bal: 1000 }],
    skippedTrades: [{ ts: "2026-03-27 10:00", optionTicker: "SPY", pnl: 0 }],
    skippedByReason: { filtered: 2 },
  });

  assert.equal(entry.resultId, "result-123");
  assert.equal(entry.hasStoredPayload, false);
  assert.deepEqual(entry.trades, []);
  assert.deepEqual(entry.equity, []);
  assert.deepEqual(entry.skippedTrades, []);
  assert.equal(entry.tradeCount, 10);
  assert.equal(entry.skippedTradeCount, 1);
});

test("createResearchRunHistoryEntry keeps compact payload for local-only runs", () => {
  const entry = createResearchRunHistoryEntry({
    runId: "local-run-1",
    createdAt: 123,
    marketSymbol: "QQQ",
    setup: {},
    metrics: { n: 1, roi: -0.5 },
    trades: [{ ts: "2026-03-27 09:30", optionTicker: "QQQ", pnl: -5, bh: 3, er: "stop_loss" }],
    equity: [{ i: 1, bal: 995 }],
    skippedTrades: [{ ts: "2026-03-27 09:45", optionTicker: "QQQ", pnl: 0 }],
  });

  assert.equal(entry.resultId, null);
  assert.equal(entry.hasStoredPayload, true);
  assert.equal(entry.trades.length, 1);
  assert.equal(entry.equity.length, 1);
  assert.equal(entry.skippedTrades.length, 1);
});
