import assert from "node:assert/strict";
import test from "node:test";
import type { SignalOptionsGreekSelectorSmokeResult } from "../../artifacts/api-server/src/services/signal-options-automation";
import { renderGreekSelectorSmokeMarkdown } from "./signal-options-greek-selector-smoke";

function sampleResult(
  overrides: Partial<SignalOptionsGreekSelectorSmokeResult["config"]> = {},
): SignalOptionsGreekSelectorSmokeResult {
  return {
    generatedAt: "2026-05-31T21:43:00.000Z",
    date: "2026-05-29",
    deployment: {
      id: "deployment-1",
      name: "Pyrus Signals Options Shadow Paper",
      mode: "paper",
    },
    window: {
      from: "2026-05-29T00:00:00.000Z",
      to: "2026-05-29T23:59:59.999Z",
    },
    timeframe: "5m",
    config: {
      maxSignals: 2,
      maxCandidatesPerSignal: 12,
      riskFreeRate: 0.05,
      dividendYield: 0,
      ...overrides,
    },
    summary: {
      actionCandidates: 2,
      reportedSignals: 2,
      legacyClosedTrades: 2,
      comparedSignals: 2,
      changedSelections: 2,
      totalLegacyPnl: -130,
      totalSelectedPnl: -30,
      totalPnlDelta: 100,
      totalSelectedMarkedPnl: -30,
      candidatesScored: 20,
      candidatesSkipped: 4,
      skipReasons: {
        missing_entry_bar: 3,
        order_plan_entry_premium_above_cap: 1,
      },
      rowsWithSelection: 2,
      rowsWithMarkedPnl: 2,
      rowsWithoutSelection: 0,
    },
    rows: [],
    errors: [],
  };
}

test("Greek selector smoke report prints caps and summary values", () => {
  const report = renderGreekSelectorSmokeMarkdown(sampleResult());

  assert.match(report, /- Max signals: 2/);
  assert.match(report, /- Max candidates per signal: 12/);
  assert.match(
    report,
    /- Greek source: Black-Scholes reconstruction from historical option entry prices/,
  );
  assert.match(report, /\| PnL delta \| \$100\.00 \|/);
  assert.match(report, /\| missing_entry_bar \| 3 \|/);
});

test("Greek selector smoke report labels uncapped signal runs", () => {
  const report = renderGreekSelectorSmokeMarkdown(
    sampleResult({ maxSignals: null }),
  );

  assert.match(report, /- Max signals: all/);
});
