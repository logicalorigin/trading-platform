import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLanePresetPatch,
  buildLaneWarnings,
  LANE_PRESETS,
  normalizeLaneSymbolList,
  resolveLanePreview,
} from "./ibkrLaneUiModel.js";

test("normalizes pasted lane symbols and removes duplicates", () => {
  assert.deepEqual(
    normalizeLaneSymbolList("spy, qqq\nSPY;$bad;nvda"),
    ["SPY", "QQQ", "NVDA"],
  );
});

test("lane preview applies sources, exclusions, capacity, and manual symbols", () => {
  const preview = resolveLanePreview(
    {
      laneId: "flow-scanner",
      label: "Flow Scanner",
      availableSources: {
        "built-in": ["SPY", "QQQ"],
        "flow-universe": ["AAPL", "TSLA"],
      },
    },
    {
      enabled: true,
      sources: {
        "built-in": true,
        "flow-universe": true,
        manual: true,
      },
      manualSymbols: ["NVDA"],
      excludedSymbols: ["TSLA"],
      maxSymbols: 3,
      priority: ["manual", "flow-universe", "built-in"],
    },
  );

  assert.deepEqual(preview.admittedSymbols, ["NVDA", "AAPL", "QQQ"]);
  assert.deepEqual(
    preview.droppedSymbols.map((entry) => [entry.symbol, entry.reason]),
    [
      ["TSLA", "excluded"],
      ["SPY", "capacity"],
    ],
  );
});

test("balanced preset mirrors editable backend defaults", () => {
  const defaults = {
    "flow-scanner": {
      enabled: true,
      sources: { "built-in": true },
      manualSymbols: ["SPY"],
      excludedSymbols: [],
      maxSymbols: 500,
      priority: ["manual"],
    },
    "orders-control": {
      enabled: true,
      sources: { system: true },
      maxSymbols: 1,
    },
  };
  const patch = buildLanePresetPatch("balanced", defaults);

  assert.deepEqual(Object.keys(patch), ["flow-scanner"]);
  assert.notStrictEqual(
    patch["flow-scanner"].manualSymbols,
    defaults["flow-scanner"].manualSymbols,
  );
  assert.deepEqual(patch["flow-scanner"].manualSymbols, ["SPY"]);
});

test("line booster preset uses the expanded Level 1 allowance without maxing every lane", () => {
  assert.ok(LANE_PRESETS.some((preset) => preset.id === "line-booster"));

  const patch = buildLanePresetPatch("line-booster", {});

  assert.deepEqual(patch["equity-live-quotes"], {
    enabled: true,
    sources: {
      watchlists: true,
      manual: true,
      system: true,
      "flow-universe": false,
      "built-in": false,
    },
    maxSymbols: 120,
  });
  assert.deepEqual(patch["option-live-quotes"], {
    enabled: true,
    sources: {
      "flow-universe": true,
      watchlists: true,
      manual: true,
      "built-in": false,
      system: false,
    },
    maxSymbols: 120,
  });
  assert.equal(patch["flow-scanner"].maxSymbols, 750);
  assert.equal(patch["option-chain-metadata"].maxSymbols, 180);
  assert.equal(patch["historical-bars"].maxSymbols, 100);
});

test("warnings flag guarded changes without blocking them", () => {
  const warnings = buildLaneWarnings({
    lane: {
      laneId: "flow-scanner",
      label: "Flow Scanner",
      droppedSymbols: [{ symbol: "MSFT", reason: "capacity" }],
    },
    basePolicy: {
      enabled: true,
      sources: { "flow-universe": false },
      manualSymbols: [],
      maxSymbols: 500,
    },
    mergedPolicy: {
      enabled: true,
      sources: { "flow-universe": true },
      manualSymbols: [],
      maxSymbols: 1000,
    },
    defaultPolicy: {
      maxSymbols: 500,
    },
  });

  assert.deepEqual(
    warnings.map((warning) => warning.code),
    ["cap-increase", "scanner-expanded", "source-flow-universe", "capacity-drops"],
  );
});
