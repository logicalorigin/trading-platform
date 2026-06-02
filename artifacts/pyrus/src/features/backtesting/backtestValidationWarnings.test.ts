import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBacktestValidationWarningItems,
  normalizeBacktestValidationWarningDetails,
} from "./backtestValidationWarnings";

describe("backtest validation warning presentation", () => {
  it("prefers structured validation warning details with readable evidence", () => {
    const items = buildBacktestValidationWarningItems({
      runWarnings: ["Option quote data was unavailable for part of the run."],
      validation: {
        warnings: [
          "Trade count is below 30; statistical confidence is limited.",
        ],
        warningDetails: [
          {
            code: "low_trade_count",
            severity: "warning",
            scope: "sample",
            message:
              "Trade count is below 30; statistical confidence is limited.",
            evidence: {
              tradeCount: 12,
              minimumTradeCount: 30,
            },
          },
        ],
      },
    });

    assert.deepEqual(
      items.map((item) => ({
        code: item.code,
        severity: item.severity,
        scopeLabel: item.scopeLabel,
        message: item.message,
        evidence: item.evidence,
      })),
      [
        {
          code: "low_trade_count",
          severity: "warning",
          scopeLabel: "Sample",
          message: "Trade count is below 30; statistical confidence is limited.",
          evidence: ["Trades 12 / min 30"],
        },
        {
          code: "run_warning",
          severity: "info",
          scopeLabel: "Run",
          message: "Option quote data was unavailable for part of the run.",
          evidence: [],
        },
      ],
    );
  });

  it("dedupes legacy run and validation warning strings", () => {
    const items = buildBacktestValidationWarningItems({
      runWarnings: ["Data coverage is below target.", "Data coverage is below target."],
      validation: {
        warnings: [
          "Data coverage is below target.",
          "Multiple tested candidates without an out-of-sample window increase overfitting risk.",
        ],
      },
    });

    assert.deepEqual(
      items.map((item) => item.message),
      [
        "Data coverage is below target.",
        "Multiple tested candidates without an out-of-sample window increase overfitting risk.",
      ],
    );
  });

  it("normalizes only valid structured warning details", () => {
    assert.deepEqual(
      normalizeBacktestValidationWarningDetails([
        {
          code: "insufficient_sample_size",
          severity: "info",
          scope: "sample",
          message: "Return sample is below 30 observations.",
          evidence: { returnSampleSize: 8, minimumReturnSampleSize: 30 },
        },
        {
          code: "low_trade_count",
          severity: "warning",
          scope: "sample",
          message: "",
          evidence: {},
        },
        null,
      ]),
      [
        {
          code: "insufficient_sample_size",
          severity: "info",
          scope: "sample",
          message: "Return sample is below 30 observations.",
          evidence: { returnSampleSize: 8, minimumReturnSampleSize: 30 },
        },
      ],
    );
  });

  it("handles missing and malformed inputs without warnings", () => {
    assert.deepEqual(
      buildBacktestValidationWarningItems({
        runWarnings: null,
        validation: { warnings: "not-an-array", warningDetails: {} },
      }),
      [],
    );
  });
});
