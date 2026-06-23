import assert from "node:assert/strict";
import { after, test } from "node:test";

import { pool } from "@workspace/db";
import { ListBacktestStudiesResponse } from "@workspace/api-zod";

import { studyRecordToResponse } from "./backtesting";

after(async () => {
  await pool.end();
});

const baseStudy = (overrides: Record<string, unknown>) =>
  ({
    id: "study-1",
    name: "Test study",
    strategyId: "donchian_breakout",
    strategyVersion: "v1",
    directionMode: "long_only",
    watchlistId: null,
    symbols: ["SPY"],
    timeframe: "1m",
    startsAt: new Date("2026-06-01T00:00:00.000Z"),
    endsAt: new Date("2026-06-10T00:00:00.000Z"),
    parameters: {},
    portfolioRules: {
      initialCapital: 100_000,
      positionSizePercent: 10,
      maxConcurrentPositions: 5,
      maxGrossExposurePercent: 100,
    },
    executionProfile: { commissionBps: 1, slippageBps: 2 },
    optimizerMode: "grid",
    optimizerConfig: {},
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  }) as never;

test("pattern-discovery study with empty portfolio/execution maps to a schema-valid row", () => {
  // Reproduces the 400: a pattern-discovery study is stored with {} for these.
  const patternStudy = baseStudy({
    id: "pattern-1",
    strategyId: "mtf_pattern_discovery",
    portfolioRules: {},
    executionProfile: {},
    optimizerConfig: {},
  });
  const normalStudy = baseStudy({ id: "normal-1" });

  const mapped = {
    studies: [studyRecordToResponse(normalStudy), studyRecordToResponse(patternStudy)],
  };

  // The whole list now parses (before the fix, the {} row threw and 400'd the list).
  assert.doesNotThrow(() => ListBacktestStudiesResponse.parse(mapped));

  const [normal, pattern] = mapped.studies;
  // Pattern row gets an explicit zeroed placeholder, not a fabricated portfolio.
  assert.deepEqual(pattern.portfolioRules, {
    initialCapital: 0,
    positionSizePercent: 0,
    maxConcurrentPositions: 0,
    maxGrossExposurePercent: 0,
  });
  assert.deepEqual(pattern.executionProfile, { commissionBps: 0, slippageBps: 0 });
  // A real study's portfolio/execution is preserved untouched.
  assert.equal(normal.portfolioRules.initialCapital, 100_000);
  assert.equal(normal.executionProfile.commissionBps, 1);
});

test("the response schema is genuinely strict (guards the regression)", () => {
  // Confirms the bug is real: an unmapped {} row is rejected by the schema, so the
  // mapper's placeholder is doing the work — not a loosened schema.
  const rawEmptyRow = {
    ...studyRecordToResponse(baseStudy({ id: "raw-1" })),
    portfolioRules: {},
    executionProfile: {},
  };
  assert.equal(
    ListBacktestStudiesResponse.safeParse({ studies: [rawEmptyRow] }).success,
    false,
  );
});
