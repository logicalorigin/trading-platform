import assert from "node:assert/strict";
import test from "node:test";

import { __tradePositionsPanelInternalsForTests } from "./TradePositionsPanel.jsx";

const { buildTradePositionLoadIntent } =
  __tradePositionsPanelInternalsForTests;

test("position Trade actions preserve equity versus option ticket intent", () => {
  assert.deepEqual(
    buildTradePositionLoadIntent({ ticker: "AAPL", optionLoadContract: null }),
    { ticker: "AAPL", assetMode: "equity" },
  );
  assert.deepEqual(
    buildTradePositionLoadIntent({
      ticker: "SPY",
      optionLoadContract: { strike: 600, cp: "C", exp: "2026-07-17" },
    }),
    {
      ticker: "SPY",
      assetMode: "option",
      strike: 600,
      cp: "C",
      exp: "2026-07-17",
    },
  );
  assert.equal(
    buildTradePositionLoadIntent({
      ticker: "SPY",
      optionContract: { right: "unknown" },
      optionLoadContract: null,
    }),
    null,
    "an option with incomplete identity must not fall back to an equity ticket",
  );
  assert.equal(buildTradePositionLoadIntent({ ticker: "" }), null);
});
