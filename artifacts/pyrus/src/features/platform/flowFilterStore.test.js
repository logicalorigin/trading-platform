import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFlowTapePresetPatch,
  clearFlowTapeFilterSymbol,
  filterFlowEventsForChartDisplay,
  filterFlowTapeEvents,
  flowTapeFiltersAreActive,
  getFlowTapeFilterState,
  normalizeFlowTapeFilterState,
  parseFlowTapeTickerTokens,
  resetFlowTapeFilterStateForTests,
  setFlowTapeFilterState,
  setFlowTapeFilterSymbol,
  toggleFlowTapeFilterSymbol,
} from "./flowFilterStore.js";

test("normalizeFlowTapeFilterState repairs invalid persisted filter values", () => {
  assert.deepEqual(
    normalizeFlowTapeFilterState({
      activeFlowPresetId: "missing",
      filter: "bad",
      minPrem: -10,
      includeQuery: 123,
      excludeQuery: null,
    }),
    {
      activeFlowPresetId: null,
      filter: "all",
      minPrem: 0,
      includeQuery: "123",
      excludeQuery: "",
      symbol: null,
    },
  );
});

test("flowTapeFiltersAreActive distinguishes default and narrowed filters", () => {
  assert.equal(flowTapeFiltersAreActive({}), false);
  assert.equal(flowTapeFiltersAreActive({ filter: "all", minPrem: 0 }), false);
  assert.equal(flowTapeFiltersAreActive({ includeQuery: "SPY" }), true);
  assert.equal(flowTapeFiltersAreActive({ excludeQuery: "QQQ" }), true);
  assert.equal(flowTapeFiltersAreActive({ minPrem: 50_000 }), true);
  assert.equal(flowTapeFiltersAreActive({ activeFlowPresetId: "sweeps" }), true);
});

test("flow tape filter state shares linked filter updates", () => {
  resetFlowTapeFilterStateForTests();

  setFlowTapeFilterState({
    filter: "calls",
    minPrem: "50000",
    includeQuery: "SPY, QQQ",
    excludeQuery: "TSLA",
  });

  assert.deepEqual(getFlowTapeFilterState(), {
    activeFlowPresetId: null,
    filter: "calls",
    minPrem: 50_000,
    includeQuery: "SPY, QQQ",
    excludeQuery: "TSLA",
    symbol: null,
  });
});

test("buildFlowTapePresetPatch mirrors Flow page preset behavior", () => {
  assert.deepEqual(
    buildFlowTapePresetPatch("sweeps", {
      activeFlowPresetId: null,
      filter: "calls",
      minPrem: 100_000,
    }),
    {
      activeFlowPresetId: "sweeps",
      filter: "sweep",
      minPrem: 100_000,
    },
  );

  assert.deepEqual(
    buildFlowTapePresetPatch("premium-250k", {
      activeFlowPresetId: null,
      filter: "calls",
      minPrem: 50_000,
    }),
    {
      activeFlowPresetId: "premium-250k",
      filter: "all",
      minPrem: 250_000,
    },
  );

  assert.deepEqual(
    buildFlowTapePresetPatch("premium-250k", {
      activeFlowPresetId: "premium-250k",
      filter: "all",
      minPrem: 250_000,
    }),
    { activeFlowPresetId: null },
  );
});

test("filterFlowTapeEvents applies the shared Flow visual filters", () => {
  const events = [
    {
      id: "spy-call",
      ticker: "SPY",
      cp: "C",
      premium: 125_000,
      type: "SWEEP",
      isUnusual: true,
    },
    {
      id: "qqq-put",
      ticker: "QQQ",
      cp: "P",
      premium: 80_000,
      type: "BLOCK",
      isUnusual: true,
    },
    {
      id: "nvda-call",
      ticker: "NVDA",
      cp: "C",
      premium: 30_000,
      type: "TRADE",
      isUnusual: false,
    },
  ];

  assert.deepEqual(parseFlowTapeTickerTokens(" spy,qqq  SPY "), [
    "SPY",
    "QQQ",
  ]);
  assert.deepEqual(
    filterFlowTapeEvents(events, {
      filter: "calls",
      minPrem: 50_000,
      includeQuery: "spy,nvda",
      excludeQuery: "",
    }).map((event) => event.id),
    ["spy-call"],
  );
  assert.deepEqual(
    filterFlowTapeEvents(events, {
      filter: "block",
      minPrem: 0,
      includeQuery: "",
      excludeQuery: "spy",
    }).map((event) => event.id),
    ["qqq-put"],
  );
});

test("filterFlowTapeEvents keeps repeat filters on the shared cluster model", () => {
  const events = [
    {
      id: "first",
      ticker: "AAPL",
      cp: "C",
      strike: 210,
      expirationDate: "2026-05-15",
      premium: 25_000,
    },
    {
      id: "repeat",
      ticker: "AAPL",
      cp: "C",
      strike: 210,
      expirationDate: "2026-05-15",
      premium: 35_000,
    },
    {
      id: "single",
      ticker: "MSFT",
      cp: "P",
      strike: 410,
      expirationDate: "2026-05-15",
      premium: 100_000,
    },
  ];

  assert.deepEqual(
    filterFlowTapeEvents(events, { filter: "cluster" }).map(
      (event) => event.id,
    ),
    ["first", "repeat"],
  );
  assert.deepEqual(
    filterFlowTapeEvents(events, { activeFlowPresetId: "repeats" }).map(
      (event) => event.id,
    ),
    ["first", "repeat"],
  );
});

test("shared Flow tape filters narrow only the tape event set", () => {
  const events = [
    {
      id: "visible-call",
      ticker: "SPY",
      cp: "C",
      premium: 42_000,
      occurredAt: "2026-05-01T15:12:00.000Z",
      isUnusual: false,
    },
    {
      id: "hidden-put",
      ticker: "SPY",
      cp: "P",
      premium: 250_000,
      occurredAt: "2026-05-01T15:13:00.000Z",
      isUnusual: true,
    },
    {
      id: "hidden-symbol",
      ticker: "QQQ",
      cp: "C",
      premium: 500_000,
      occurredAt: "2026-05-01T15:14:00.000Z",
      isUnusual: true,
    },
  ];

  const filtered = filterFlowTapeEvents(events, {
    filter: "calls",
    minPrem: 0,
    includeQuery: "SPY",
    excludeQuery: "",
  });

  assert.deepEqual(filtered.map((event) => event.id), ["visible-call"]);
});

test("chart flow display filters ignore ticker include and exclude queries", () => {
  const events = [
    {
      id: "spy-call",
      ticker: "SPY",
      cp: "C",
      premium: 125_000,
      type: "SWEEP",
    },
    {
      id: "spy-put",
      ticker: "SPY",
      cp: "P",
      premium: 250_000,
      type: "BLOCK",
      isUnusual: true,
    },
    {
      id: "qqq-call",
      ticker: "QQQ",
      cp: "C",
      premium: 500_000,
      type: "SWEEP",
    },
  ];

  assert.deepEqual(
    filterFlowEventsForChartDisplay(events, {
      filter: "calls",
      minPrem: 50_000,
      includeQuery: "NVDA",
      excludeQuery: "SPY",
    }).map((event) => event.id),
    ["spy-call", "qqq-call"],
  );
  assert.deepEqual(
    filterFlowEventsForChartDisplay(events, {
      filter: "puts",
      minPrem: 100_000,
      includeQuery: "NVDA",
      excludeQuery: "SPY",
    }).map((event) => event.id),
    ["spy-put"],
  );
});

test("chart flow display filters preserve repeat and preset semantics", () => {
  const events = [
    {
      id: "first",
      ticker: "AAPL",
      cp: "C",
      strike: 210,
      expirationDate: "2026-05-15",
      premium: 25_000,
    },
    {
      id: "repeat",
      ticker: "AAPL",
      cp: "C",
      strike: 210,
      expirationDate: "2026-05-15",
      premium: 35_000,
    },
    {
      id: "single",
      ticker: "MSFT",
      cp: "P",
      strike: 410,
      expirationDate: "2026-05-15",
      premium: 100_000,
    },
  ];

  assert.deepEqual(
    filterFlowEventsForChartDisplay(events, {
      activeFlowPresetId: "repeats",
      includeQuery: "MSFT",
    }).map((event) => event.id),
    ["first", "repeat"],
  );
});

test("chart flow display presets normalize ask and bid side aliases", () => {
  const events = [
    {
      id: "ask-call",
      ticker: "SPY",
      cp: "C",
      side: "ASK",
      premium: 125_000,
    },
    {
      id: "at-ask-call",
      ticker: "SPY",
      cp: "C",
      side: "at_ask",
      premium: 130_000,
    },
    {
      id: "bid-put",
      ticker: "SPY",
      cp: "P",
      side: "BID",
      premium: 250_000,
    },
    {
      id: "hit-bid-put",
      ticker: "SPY",
      cp: "P",
      side: "hit_bid",
      premium: 260_000,
    },
    {
      id: "mid-call",
      ticker: "SPY",
      cp: "C",
      side: "MID",
      premium: 300_000,
    },
  ];

  assert.deepEqual(
    filterFlowEventsForChartDisplay(events, {
      activeFlowPresetId: "ask-calls",
    }).map((event) => event.id),
    ["ask-call", "at-ask-call"],
  );
  assert.deepEqual(
    filterFlowEventsForChartDisplay(events, {
      activeFlowPresetId: "bid-puts",
    }).map((event) => event.id),
    ["bid-put", "hit-bid-put"],
  );
});

test("symbol filter normalizes input to uppercase and treats blanks as null", () => {
  assert.equal(normalizeFlowTapeFilterState({ symbol: "nvda" }).symbol, "NVDA");
  assert.equal(normalizeFlowTapeFilterState({ symbol: "  aapl " }).symbol, "AAPL");
  assert.equal(normalizeFlowTapeFilterState({ symbol: "" }).symbol, null);
  assert.equal(normalizeFlowTapeFilterState({ symbol: null }).symbol, null);
  assert.equal(normalizeFlowTapeFilterState({}).symbol, null);
});

test("symbol filter narrows tape events to a single ticker, additive with includeQuery", () => {
  const events = [
    { id: "nvda-call", ticker: "NVDA", cp: "C", premium: 100_000 },
    { id: "aapl-call", ticker: "AAPL", cp: "C", premium: 100_000 },
    { id: "tsla-put", ticker: "TSLA", cp: "P", premium: 100_000 },
  ];

  assert.deepEqual(
    filterFlowTapeEvents(events, { symbol: "NVDA" }).map((event) => event.id),
    ["nvda-call"],
  );

  assert.deepEqual(
    filterFlowTapeEvents(events, {
      symbol: "NVDA",
      includeQuery: "AAPL",
    }).map((event) => event.id),
    [],
  );

  assert.deepEqual(
    filterFlowTapeEvents(events, {
      symbol: "AAPL",
      includeQuery: "AAPL,TSLA",
    }).map((event) => event.id),
    ["aapl-call"],
  );
});

test("flowTapeFiltersAreActive reports symbol-only filter as active", () => {
  assert.equal(flowTapeFiltersAreActive({ symbol: "NVDA" }), true);
  assert.equal(flowTapeFiltersAreActive({ symbol: null }), false);
});

test("setFlowTapeFilterSymbol and clearFlowTapeFilterSymbol update store", () => {
  resetFlowTapeFilterStateForTests();

  setFlowTapeFilterSymbol("nvda");
  assert.equal(getFlowTapeFilterState().symbol, "NVDA");

  setFlowTapeFilterSymbol("aapl");
  assert.equal(getFlowTapeFilterState().symbol, "AAPL");

  clearFlowTapeFilterSymbol();
  assert.equal(getFlowTapeFilterState().symbol, null);
});

test("toggleFlowTapeFilterSymbol adds, swaps, and clears", () => {
  resetFlowTapeFilterStateForTests();

  toggleFlowTapeFilterSymbol("nvda");
  assert.equal(getFlowTapeFilterState().symbol, "NVDA");

  toggleFlowTapeFilterSymbol("nvda");
  assert.equal(getFlowTapeFilterState().symbol, null);

  toggleFlowTapeFilterSymbol("nvda");
  toggleFlowTapeFilterSymbol("aapl");
  assert.equal(getFlowTapeFilterState().symbol, "AAPL");
});

test("symbol filter persists alongside other filters without disturbing them", () => {
  resetFlowTapeFilterStateForTests();

  setFlowTapeFilterState({ filter: "calls", minPrem: 50_000 });
  setFlowTapeFilterSymbol("NVDA");

  const state = getFlowTapeFilterState();
  assert.equal(state.symbol, "NVDA");
  assert.equal(state.filter, "calls");
  assert.equal(state.minPrem, 50_000);

  clearFlowTapeFilterSymbol();
  const cleared = getFlowTapeFilterState();
  assert.equal(cleared.symbol, null);
  assert.equal(cleared.filter, "calls");
  assert.equal(cleared.minPrem, 50_000);
});
