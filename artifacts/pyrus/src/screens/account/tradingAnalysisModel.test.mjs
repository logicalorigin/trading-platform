import assert from "node:assert/strict";
import test from "node:test";

import * as filterModel from "./tradingAnalysisFilters.js";
import {
  buildAccountAnalysisQueryParams,
  buildRangeDateBounds,
  defaultTradingAnalysisFilters,
  normalizeTradingAnalysisFilters,
  resolveTradingAnalysisDateScope,
  tradingAnalysisFilterReducer,
} from "./tradingAnalysisModel.js";

test("trading analysis model reuses the shared filter helpers", () => {
  assert.equal(
    defaultTradingAnalysisFilters,
    filterModel.defaultTradingAnalysisFilters,
  );
  assert.equal(
    normalizeTradingAnalysisFilters,
    filterModel.normalizeTradingAnalysisFilters,
  );
  assert.equal(
    tradingAnalysisFilterReducer,
    filterModel.tradingAnalysisFilterReducer,
  );
  assert.equal(buildRangeDateBounds, filterModel.buildRangeDateBounds);
  assert.equal(
    resolveTradingAnalysisDateScope,
    filterModel.resolveTradingAnalysisDateScope,
  );
  assert.equal(
    buildAccountAnalysisQueryParams,
    filterModel.buildAccountAnalysisQueryParams,
  );
});

test("shared trading analysis filters preserve normalization behavior", () => {
  assert.deepEqual(
    normalizeTradingAnalysisFilters({
      symbol: " spy ",
      assetClass: "option",
      pnlSign: "winners",
      side: " LONG ",
      holdDuration: "intraday",
      feeDrags: ["high", "all", "high"],
      closeHour: 9,
      recentOnly: 1,
    }),
    {
      ...defaultTradingAnalysisFilters(),
      symbol: "SPY",
      assetClass: "option",
      pnlSign: "winners",
      side: "long",
      holdDuration: "intraday",
      holdDurations: ["intraday"],
      feeDrags: ["high"],
      closeHour: "9",
      recentOnly: true,
    },
  );

  assert.deepEqual(
    tradingAnalysisFilterReducer(
      { holdDurations: ["intraday"], feeDrags: ["high"] },
      { type: "toggleArray", key: "holdDurations", value: "swing" },
    ).holdDurations,
    ["intraday", "swing"],
  );
});
