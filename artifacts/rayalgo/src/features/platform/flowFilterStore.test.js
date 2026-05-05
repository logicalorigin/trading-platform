import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOW_BUILT_IN_PRESETS,
  buildFlowTapePresetPatch,
  decorateFlowEventsWithPresetContext,
  flowEventMatchesBuiltInPreset,
  getFlowTapeFilterState,
  normalizeFlowTapeFilterState,
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

test("Flow built-in presets include Phase 10 scanner modes", () => {
  const presetIds = FLOW_BUILT_IN_PRESETS.map((preset) => preset.id);
  assert.deepEqual(
    [
      "momentum",
      "earnings-week",
      "unusual-calls",
      "unusual-puts",
      "high-rvol",
      "held-positions",
    ].filter((id) => presetIds.includes(id)),
    [
      "momentum",
      "earnings-week",
      "unusual-calls",
      "unusual-puts",
      "high-rvol",
      "held-positions",
    ],
  );

  assert.deepEqual(
    buildFlowTapePresetPatch("unusual-calls", {
      activeFlowPresetId: null,
      filter: "all",
      minPrem: 0,
    }),
    {
      activeFlowPresetId: "unusual-calls",
      filter: "unusual",
      minPrem: 0,
    },
  );
});

test("flowEventMatchesBuiltInPreset evaluates scanner preset semantics", () => {
  assert.equal(
    flowEventMatchesBuiltInPreset("unusual-calls", {
      cp: "C",
      isUnusual: true,
    }),
    true,
  );
  assert.equal(
    flowEventMatchesBuiltInPreset("unusual-puts", {
      right: "put",
      isUnusual: true,
    }),
    true,
  );
  assert.equal(
    flowEventMatchesBuiltInPreset("momentum", {
      score: 80,
    }),
    true,
  );
  assert.equal(
    flowEventMatchesBuiltInPreset("earnings-week", {
      earningsWithinDays: 5,
    }),
    true,
  );
  assert.equal(
    flowEventMatchesBuiltInPreset("held-positions", {
      positionQuantity: -2,
    }),
    true,
  );
  assert.equal(
    flowEventMatchesBuiltInPreset("repeats", { id: "one" }, () => ({ count: 2 })),
    true,
  );
  assert.equal(
    flowEventMatchesBuiltInPreset("unusual-calls", {
      cp: "P",
      isUnusual: true,
    }),
    false,
  );
});

test("decorateFlowEventsWithPresetContext wires app state into preset semantics", () => {
  const [earningsEvent, heldEvent, untouchedEvent] = decorateFlowEventsWithPresetContext(
    [
      { id: "earnings", ticker: "SPY" },
      { id: "held", underlying: "NVDA" },
      { id: "other", ticker: "AAPL" },
    ],
    {
      earningsSymbols: ["spy"],
      positionSymbols: new Set(["nvda"]),
    },
  );

  assert.equal(flowEventMatchesBuiltInPreset("earnings-week", earningsEvent), true);
  assert.equal(flowEventMatchesBuiltInPreset("held-positions", heldEvent), true);
  assert.equal(flowEventMatchesBuiltInPreset("earnings-week", untouchedEvent), false);
  assert.equal(flowEventMatchesBuiltInPreset("held-positions", untouchedEvent), false);
});
