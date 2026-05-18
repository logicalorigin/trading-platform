import assert from "node:assert/strict";
import test from "node:test";

import {
  __internalsForTests,
  buildAlgoTuningImpact,
} from "./algoTuningImpactModel";

const candidate = (overrides) => ({
  symbol: "SPY",
  reason: "",
  dte: 1,
  ...overrides,
});

const position = (overrides) => ({
  symbol: "SPY",
  entryPrice: 4.0,
  lastMarkPrice: 4.0,
  peakPrice: 4.0,
  ...overrides,
});

test("spreadTooWide counts candidates blocked on spread and samples top symbols", () => {
  const impact = buildAlgoTuningImpact({
    cockpit: {
      candidates: [
        candidate({ symbol: "TSLA", reason: "spread_too_wide" }),
        candidate({ symbol: "SMCI", reason: "spread_too_wide" }),
        candidate({ symbol: "NVDA", reason: "" }),
        candidate({ symbol: "TSLA", reason: "spread_too_wide" }),
      ],
    },
    profile: { optionSelection: { minDte: 1, maxDte: 3 } },
  });
  assert.equal(impact.spreadTooWide.count, 3);
  assert.deepEqual(impact.spreadTooWide.sampleSymbols, ["TSLA", "SMCI"]);
});

test("dte window impact counts candidates outside the configured bounds", () => {
  const impact = buildAlgoTuningImpact({
    cockpit: {
      candidates: [
        candidate({ symbol: "AAPL", dte: 5 }),
        candidate({ symbol: "MSFT", dte: 1 }),
        candidate({ symbol: "AMZN", dte: 0 }),
        candidate({ symbol: "GOOG", dte: 7 }),
      ],
    },
    profile: { optionSelection: { minDte: 1, maxDte: 3 } },
  });
  assert.equal(impact.dteWindow.count, 3);
  assert.deepEqual(impact.dteWindow.sampleSymbols, ["AAPL", "AMZN", "GOOG"]);
});

test("regime blockers fold mtf + bear + inverse + entry gate into one bucket", () => {
  const impact = buildAlgoTuningImpact({
    cockpit: {
      candidates: [
        candidate({ symbol: "SPY", reason: "bear_regime_gate_failed" }),
        candidate({ symbol: "QQQ", reason: "mtf_not_aligned" }),
        candidate({ symbol: "TSLA", reason: "inverse_put_blocked" }),
        candidate({ symbol: "AMD", reason: "entry_gate_failed" }),
        candidate({ symbol: "PLTR", reason: "" }),
      ],
    },
    profile: {},
  });
  assert.equal(impact.regimeBlocks.count, 4);
  assert.equal(impact.regimeBlocks.sampleSymbols.length, 3);
});

test("hardStop impact computes trigger prices for open positions and sorts by distance", () => {
  const impact = buildAlgoTuningImpact({
    cockpit: { candidates: [] },
    profile: { exitPolicy: { hardStopPct: -40 } },
    positions: [
      position({ symbol: "SPY", entryPrice: 4.2, lastMarkPrice: 3.1 }),
      position({ symbol: "NVDA", entryPrice: 8.0, lastMarkPrice: 6.5 }),
      position({ symbol: "MSFT", entryPrice: 1.9, lastMarkPrice: 2.6 }),
    ],
  });
  assert.equal(impact.hardStop.count, 3);
  assert.equal(impact.hardStop.triggers[0].symbol, "SPY");
  assert.equal(Math.round(impact.hardStop.triggers[0].triggerPrice * 100) / 100, 2.52);
});

test("trailing impact counts positions where peak has moved above entry", () => {
  const impact = buildAlgoTuningImpact({
    cockpit: { candidates: [] },
    profile: {},
    positions: [
      position({ symbol: "SPY", entryPrice: 4.0, peakPrice: 5.1 }),
      position({ symbol: "NVDA", entryPrice: 8.0, peakPrice: 7.5 }),
      position({ symbol: "MSFT", entryPrice: 1.9, peakPrice: 2.6 }),
    ],
  });
  assert.equal(impact.trailing.count, 2);
  assert.equal(impact.trailing.total, 3);
  assert.deepEqual(impact.trailing.sampleSymbols, ["SPY", "MSFT"]);
});

test("sampleTopSymbols dedupes and caps the result list", () => {
  const symbols = __internalsForTests.sampleTopSymbols(
    [{ symbol: "spy" }, { symbol: "SPY" }, { symbol: "NVDA" }, { symbol: "TSLA" }, { symbol: "MSFT" }],
    3,
  );
  assert.deepEqual(symbols, ["SPY", "NVDA", "TSLA"]);
});
