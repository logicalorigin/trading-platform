import assert from "node:assert/strict";
import test from "node:test";
import {
  BROAD_MARKET_FLOW_STORE_KEY,
  EMPTY_MARKET_FLOW_SNAPSHOT,
  MARKET_FLOW_STORE_ENTRY_CAP,
  acquireFlowScannerOwner,
  buildMarketFlowStoreKey,
  clearMarketFlowSnapshot,
  getFlowScannerControlState,
  getMarketFlowSnapshotForStoreKey,
  getMarketFlowStoreEntryCount,
  publishMarketFlowSnapshot,
  releaseFlowScannerOwner,
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

const buildEmptySnapshotWithSource = (symbol, source) => ({
  ...EMPTY_MARKET_FLOW_SNAPSHOT,
  hasLiveFlow: false,
  flowStatus: "empty",
  providerSummary: {
    ...EMPTY_MARKET_FLOW_SNAPSHOT.providerSummary,
    label: "IBKR snapshot live",
    sourcesBySymbol: { [symbol]: source },
    coverage: {
      ...EMPTY_MARKET_FLOW_SNAPSHOT.providerSummary.coverage,
      degradedReason: source?.ibkrReason || null,
    },
  },
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

test("broad scanner snapshot is isolated from active chart flow snapshots", () => {
  resetMarketFlowStoreForTests();

  const chartStoreKey = buildMarketFlowStoreKey(["NVDA"]);
  publishMarketFlowSnapshot(BROAD_MARKET_FLOW_STORE_KEY, buildLiveSnapshot("SPY"));
  publishMarketFlowSnapshot(chartStoreKey, buildLiveSnapshot("NVDA"));

  assert.equal(
    getMarketFlowSnapshotForStoreKey(BROAD_MARKET_FLOW_STORE_KEY).flowEvents[0]
      .underlying,
    "SPY",
  );
  assert.equal(
    getMarketFlowSnapshotForStoreKey(chartStoreKey).flowEvents[0].underlying,
    "NVDA",
  );
});

test("marketFlowStore preserves existing flow events across transient degraded empties", () => {
  resetMarketFlowStoreForTests();

  const storeKey = buildMarketFlowStoreKey(["AAPL"]);
  publishMarketFlowSnapshot(storeKey, buildLiveSnapshot("AAPL"));
  publishMarketFlowSnapshot(
    storeKey,
    buildEmptySnapshotWithSource("AAPL", {
      provider: "none",
      status: "empty",
      ibkrStatus: "degraded",
      ibkrReason: "options_flow_quote_hydration_empty",
    }),
  );

  const snapshot = getMarketFlowSnapshotForStoreKey(storeKey);
  assert.equal(snapshot.hasLiveFlow, true);
  assert.equal(snapshot.flowStatus, "live");
  assert.equal(snapshot.flowEvents.length, 1);
  assert.equal(snapshot.flowEvents[0].underlying, "AAPL");
  assert.equal(snapshot.staleFlowEvents, true);
  assert.equal(
    snapshot.providerSummary.sourcesBySymbol.AAPL.ibkrReason,
    "options_flow_quote_hydration_empty",
  );
});

test("marketFlowStore replaces existing flow events on confirmed loaded empty", () => {
  resetMarketFlowStoreForTests();

  const storeKey = buildMarketFlowStoreKey(["MSFT"]);
  publishMarketFlowSnapshot(storeKey, buildLiveSnapshot("MSFT"));
  publishMarketFlowSnapshot(
    storeKey,
    buildEmptySnapshotWithSource("MSFT", {
      provider: "ibkr",
      status: "empty",
      ibkrStatus: "loaded",
      ibkrReason: "options_flow_no_volume_candidates",
    }),
  );

  const snapshot = getMarketFlowSnapshotForStoreKey(storeKey);
  assert.equal(snapshot.hasLiveFlow, false);
  assert.equal(snapshot.flowStatus, "empty");
  assert.equal(snapshot.flowEvents.length, 0);
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

test("flow scanner owner leases prevent stale cleanup from disabling an active owner", () => {
  resetFlowScannerControlForTests();

  const releaseBroadRuntime = acquireFlowScannerOwner("broad-runtime");
  acquireFlowScannerOwner("remounted-runtime");

  assert.equal(getFlowScannerControlState().ownerActive, true);

  releaseBroadRuntime();

  assert.equal(getFlowScannerControlState().ownerActive, true);

  releaseFlowScannerOwner("remounted-runtime");

  assert.equal(getFlowScannerControlState().ownerActive, false);
});
