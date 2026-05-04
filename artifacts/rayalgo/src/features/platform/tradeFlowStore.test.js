import assert from "node:assert/strict";
import test from "node:test";
import {
  TRADE_FLOW_STORE_ENTRY_CAP,
  clearTradeFlowSnapshot,
  getTradeFlowStoreEntryCount,
  publishTradeFlowSnapshot,
  resetTradeFlowStoreForTests,
  subscribeToTradeFlowSnapshotForTests,
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

test("tradeFlowStore does not evict a newly subscribed entry before listener registration", () => {
  resetTradeFlowStoreForTests();

  const unsubscribes = [];
  for (let index = 0; index < TRADE_FLOW_STORE_ENTRY_CAP; index += 1) {
    unsubscribes.push(
      subscribeToTradeFlowSnapshotForTests(`ACTIVE${index}`, () => {}),
    );
  }

  assert.equal(getTradeFlowStoreEntryCount(), TRADE_FLOW_STORE_ENTRY_CAP);

  const unsubscribeExtra = subscribeToTradeFlowSnapshotForTests(
    "EXTRA",
    () => {},
  );
  assert.equal(getTradeFlowStoreEntryCount(), TRADE_FLOW_STORE_ENTRY_CAP + 1);

  unsubscribeExtra();
  unsubscribes.forEach((unsubscribe) => unsubscribe());

  assert.equal(getTradeFlowStoreEntryCount(), 0);
});
