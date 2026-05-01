import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFlowTapePresetPatch,
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
