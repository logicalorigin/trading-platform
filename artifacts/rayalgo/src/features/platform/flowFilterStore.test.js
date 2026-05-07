import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFlowTapePresetPatch,
  filterFlowTapeEvents,
  flowTapeFiltersAreActive,
  getFlowTapeFilterState,
  normalizeFlowTapeFilterState,
  parseFlowTapeTickerTokens,
  resetFlowTapeFilterStateForTests,
  setFlowTapeFilterState,
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
