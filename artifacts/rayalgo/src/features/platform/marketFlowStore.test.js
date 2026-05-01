import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_MARKET_FLOW_SNAPSHOT,
  MARKET_FLOW_STORE_ENTRY_CAP,
  buildMarketFlowStoreKey,
  clearMarketFlowSnapshot,
  getFlowScannerControlState,
  getMarketFlowSnapshotForStoreKey,
  getMarketFlowStoreEntryCount,
  publishMarketFlowSnapshot,
  resetFlowScannerControlForTests,
  resetMarketFlowStoreForTests,
  setFlowScannerControlState,
} from "./marketFlowStore.js";
import { FLOW_SCANNER_MODE } from "./marketFlowScannerConfig.js";

const buildLiveSnapshot = (symbol) => ({
  ...EMPTY_MARKET_FLOW_SNAPSHOT,
  hasLiveFlow: true,
  flowStatus: "live",
  flowEvents: Object.freeze([{ id: symbol, underlying: symbol }]),
});

test("marketFlowStore does not allocate entries for missing snapshot reads", () => {
  resetMarketFlowStoreForTests();

  const storeKey = buildMarketFlowStoreKey(["AAPL", "MSFT"]);

  assert.equal(
    getMarketFlowSnapshotForStoreKey(storeKey),
    EMPTY_MARKET_FLOW_SNAPSHOT,
  );
  assert.equal(getMarketFlowStoreEntryCount(), 0);
});

test("marketFlowStore removes cleared snapshots when there are no subscribers", () => {
  resetMarketFlowStoreForTests();

  const storeKey = buildMarketFlowStoreKey(["AAPL"]);
  publishMarketFlowSnapshot(storeKey, buildLiveSnapshot("AAPL"));

  assert.equal(getMarketFlowStoreEntryCount(), 1);

  clearMarketFlowSnapshot(storeKey);

  assert.equal(getMarketFlowStoreEntryCount(), 0);
});

test("marketFlowStore caps unused market-flow snapshots", () => {
  resetMarketFlowStoreForTests();

  for (let index = 0; index < MARKET_FLOW_STORE_ENTRY_CAP + 5; index += 1) {
    const symbol = `T${index}`;
    publishMarketFlowSnapshot(
      buildMarketFlowStoreKey([symbol]),
      buildLiveSnapshot(symbol),
    );
  }

  assert.equal(getMarketFlowStoreEntryCount(), MARKET_FLOW_STORE_ENTRY_CAP);
  assert.equal(
    getMarketFlowSnapshotForStoreKey(buildMarketFlowStoreKey(["T0"])),
    EMPTY_MARKET_FLOW_SNAPSHOT,
  );
  assert.notEqual(
    getMarketFlowSnapshotForStoreKey(
      buildMarketFlowStoreKey([`T${MARKET_FLOW_STORE_ENTRY_CAP + 4}`]),
    ),
    EMPTY_MARKET_FLOW_SNAPSHOT,
  );
});

test("flow scanner control state normalizes and shares scanner settings", () => {
  resetFlowScannerControlForTests();

  assert.equal(getFlowScannerControlState().enabled, true);

  setFlowScannerControlState({
    enabled: true,
    ownerActive: true,
    config: { mode: "hybrid", maxSymbols: 999_999, batchSize: 999_999 },
  });

  const state = getFlowScannerControlState();
  assert.equal(state.enabled, true);
  assert.equal(state.ownerActive, true);
  assert.equal(state.config.mode, FLOW_SCANNER_MODE.market);
  assert.equal(state.config.maxSymbols, 2000);
  assert.equal(state.config.batchSize, 250);
});
