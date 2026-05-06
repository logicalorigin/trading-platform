import assert from "node:assert/strict";
import test from "node:test";
import {
  TRADE_FLOW_STORE_ENTRY_CAP,
  clearTradeFlowSnapshot,
  getTradeFlowSnapshotForTests,
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

test("tradeFlowStore preserves live events when the next refresh is a transient empty", () => {
  resetTradeFlowStoreForTests();

  publishTradeFlowSnapshot("SPY", buildFlowSnapshot("SPY"));
  publishTradeFlowSnapshot("SPY", {
    events: [],
    status: "empty",
    source: {
      provider: "none",
      status: "empty",
      ibkrStatus: "empty",
      ibkrReason: "options_flow_scanner_line_budget_exhausted",
    },
  });

  const preserved = getTradeFlowSnapshotForTests("SPY");
  assert.equal(preserved.status, "stale");
  assert.deepEqual(preserved.events, buildFlowSnapshot("SPY").events);
});

test("tradeFlowStore accepts confirmed empty loaded snapshots", () => {
  resetTradeFlowStoreForTests();

  publishTradeFlowSnapshot("SPY", buildFlowSnapshot("SPY"));
  publishTradeFlowSnapshot("SPY", {
    events: [],
    status: "empty",
    source: {
      provider: "ibkr",
      status: "empty",
      ibkrStatus: "loaded",
      ibkrReason: "options_flow_no_volume_candidates",
    },
  });

  const empty = getTradeFlowSnapshotForTests("SPY");
  assert.equal(empty.status, "empty");
  assert.deepEqual(empty.events, []);
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
