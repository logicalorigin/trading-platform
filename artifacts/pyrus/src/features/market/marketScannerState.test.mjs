import assert from "node:assert/strict";
import test from "node:test";
import { resolveMarketScannerState } from "./marketScannerState.js";

const base = {
  filterText: "",
  flowError: false,
  flowHasData: true,
  quotesError: false,
  quotesHasData: true,
  totalUniverse: 20,
  universeError: false,
  universeHasData: true,
  universePending: false,
  visibleRows: 20,
};

test("scanner distinguishes initial loading, fatal error, and true empty", () => {
  assert.deepEqual(
    resolveMarketScannerState({
      ...base,
      flowHasData: false,
      quotesHasData: false,
      totalUniverse: 0,
      universeHasData: false,
      universePending: true,
      visibleRows: 0,
    }),
    {
      body: "loading",
      canRetry: false,
      flowSettled: false,
      quotesSettled: false,
      status: "loading",
      statusLabel: "Scanner data loading",
      statusText: "LOADING",
      statusTone: "loading",
    },
  );

  assert.equal(
    resolveMarketScannerState({
      ...base,
      totalUniverse: 0,
      universeError: true,
      universeHasData: false,
      visibleRows: 0,
    }).body,
    "error",
  );

  const empty = resolveMarketScannerState({
    ...base,
    totalUniverse: 0,
    visibleRows: 0,
  });
  assert.equal(empty.body, "empty");
  assert.equal(empty.statusText, "EMPTY");
});

test("scanner distinguishes a filtered empty result from an empty universe", () => {
  const state = resolveMarketScannerState({
    ...base,
    filterText: "ZZZZ",
    visibleRows: 0,
  });

  assert.equal(state.body, "filtered-empty");
  assert.equal(state.statusText, "FILTERED");
});

test("scanner preserves cached rows and reports stale refetch failures", () => {
  const state = resolveMarketScannerState({
    ...base,
    universeError: true,
  });

  assert.equal(state.body, "rows");
  assert.equal(state.status, "stale");
  assert.equal(state.canRetry, true);
  assert.equal(state.quotesSettled, true);
  assert.equal(state.flowSettled, true);
});

test("scanner settles failed quote/flow lanes and reports partial data", () => {
  const state = resolveMarketScannerState({
    ...base,
    flowError: true,
    flowHasData: false,
    quotesError: true,
    quotesHasData: false,
  });

  assert.equal(state.body, "rows");
  assert.equal(state.status, "partial");
  assert.equal(state.statusText, "PARTIAL");
  assert.equal(state.canRetry, true);
  assert.equal(state.quotesSettled, true);
  assert.equal(state.flowSettled, true);
});

test("scanner reports hydration and live completion without moving row state", () => {
  const hydrating = resolveMarketScannerState({
    ...base,
    flowHasData: false,
    quotesHasData: false,
  });
  assert.equal(hydrating.body, "rows");
  assert.equal(hydrating.status, "loading");
  assert.equal(hydrating.quotesSettled, false);
  assert.equal(hydrating.flowSettled, false);

  const live = resolveMarketScannerState(base);
  assert.equal(live.body, "rows");
  assert.equal(live.status, "live");
  assert.equal(live.statusText, "LIVE");
});
