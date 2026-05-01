import assert from "node:assert/strict";
import test from "node:test";
import {
  TRADE_FLOW_STORE_ENTRY_CAP,
  clearTradeFlowSnapshot,
  getTradeFlowStoreEntryCount,
  publishTradeFlowSnapshot,
  resetTradeFlowStoreForTests,
} from "./tradeFlowStore.js";

const buildFlowSnapshot = (ticker) => ({
  events: [{ id: `${ticker}-flow`, ticker, premium: 100_000 }],
  status: "live",
});

test("tradeFlowStore caps unused ticker snapshots", () => {
  resetTradeFlowStoreForTests();

  for (let index = 0; index < TRADE_FLOW_STORE_ENTRY_CAP + 4; index += 1) {
    const ticker = `FLOW${index}`;
    publishTradeFlowSnapshot(ticker, buildFlowSnapshot(ticker));
  }

  assert.equal(getTradeFlowStoreEntryCount(), TRADE_FLOW_STORE_ENTRY_CAP);
});

test("tradeFlowStore clears unused snapshots", () => {
  resetTradeFlowStoreForTests();

  publishTradeFlowSnapshot("CLEARFLOW", buildFlowSnapshot("CLEARFLOW"));
  assert.equal(getTradeFlowStoreEntryCount(), 1);

  clearTradeFlowSnapshot("CLEARFLOW");

  assert.equal(getTradeFlowStoreEntryCount(), 0);
});
