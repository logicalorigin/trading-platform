import assert from "node:assert/strict";
import { after, test } from "node:test";

import { pool } from "@workspace/db";

import { HttpError } from "../lib/errors";
import { __backtestingInternalsForTests } from "./backtesting";

after(async () => {
  await pool.end();
});

test("optimizer dimensions reject empty and non-scalar values with a stable 400", () => {
  const invalidDimensions = [
    [{ key: "lookback", values: [] }],
    [{ key: "lookback", values: [null] }],
    [{ key: "lookback", values: [20, {}] }],
    [{ key: "lookback", values: [[]] }],
  ];

  for (const dimensions of invalidDimensions) {
    assert.throws(
      () =>
        __backtestingInternalsForTests.normalizeBacktestSweepParameters(
          {},
          dimensions,
        ),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 400 &&
        error.code === "backtest_sweep_dimensions_invalid" &&
        error.message ===
          "Optimizer dimensions must each contain at least one value and only use string, number, or boolean values.",
    );
  }
});

test("optimizer counting and queued payload share normalized scalar parameters", () => {
  const normalized =
    __backtestingInternalsForTests.normalizeBacktestSweepParameters(
      {
        lookback: 20,
        nested: { threshold: 2 },
        nullable: null,
      },
      [
        {
          key: "threshold",
          values: ["conservative", 2, true],
        },
      ],
    );

  assert.deepEqual(normalized, {
    baseParameters: {
      lookback: 20,
      nested: "[object Object]",
      nullable: "null",
    },
    dimensions: [
      {
        key: "threshold",
        values: ["conservative", 2, true],
      },
    ],
  });
});
