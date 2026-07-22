import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import {
  publishTradeFlowSnapshotsByTicker,
  publishTradeFlowSnapshot,
  useTradeFlowSnapshot,
} from "./tradeFlowStore.js";

const readSnapshot = (ticker) => {
  let snapshot = null;
  const Probe = () => {
    snapshot = useTradeFlowSnapshot(ticker, { subscribe: false });
    return null;
  };
  renderToString(createElement(Probe));
  return snapshot;
};

test("Trade flow refreshes when a chart-rendered event field changes", () => {
  const ticker = "UNIT29_TRADE_FLOW";
  const event = {
    id: "print-1",
    ticker,
    contract: `${ticker} 100C`,
    cp: "C",
    side: "BUY",
    premium: 120_000,
    occurredAt: "2026-07-21T14:30:00.000Z",
    iv: 0.25,
  };

  publishTradeFlowSnapshot(ticker, { events: [event], status: "live" });
  assert.equal(readSnapshot(ticker).events[0].iv, 0.25);

  publishTradeFlowSnapshot(ticker, {
    events: [{ ...event, iv: 0.3 }],
    status: "live",
  });
  assert.equal(readSnapshot(ticker).events[0].iv, 0.3);
});

test("Trade flow keeps an explicit stale status when retained events exist", () => {
  const ticker = "UNIT29_STALE_FLOW";

  publishTradeFlowSnapshotsByTicker({
    symbols: [ticker],
    events: [{ id: "cached-print", ticker }],
    status: "stale",
    includeEmpty: true,
  });

  const snapshot = readSnapshot(ticker);
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.status, "stale");
});
