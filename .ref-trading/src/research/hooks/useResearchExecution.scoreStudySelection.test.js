import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveDefaultScoreStudySelectedRunId,
} from "./researchScoreStudySelectionUtils.js";

test("resolveDefaultScoreStudySelectedRunId preserves an existing valid selection", () => {
  const selectedRunId = resolveDefaultScoreStudySelectedRunId({
    runs: [
      {
        runId: "older-current",
        presetId: "current_setup",
        symbol: "SPY",
        completedAt: "2026-04-03T00:48:23.618Z",
        validityStatus: "valid",
      },
      {
        runId: "newer-current",
        presetId: "current_setup",
        symbol: "SPY",
        completedAt: "2026-04-03T01:08:27.799Z",
        validityStatus: "valid",
      },
    ],
    selectedRunId: "older-current",
    presetId: "current_setup",
    symbol: "SPY",
  });

  assert.equal(selectedRunId, "older-current");
});

test("resolveDefaultScoreStudySelectedRunId picks the newest valid run for the selected preset on cold load", () => {
  const selectedRunId = resolveDefaultScoreStudySelectedRunId({
    runs: [
      {
        runId: "qqq-newer",
        presetId: "current_setup",
        symbol: "QQQ",
        completedAt: "2026-04-03T01:20:00.000Z",
        validityStatus: "valid",
      },
      {
        runId: "spy-older",
        presetId: "current_setup",
        symbol: "SPY",
        completedAt: "2026-04-03T00:48:23.618Z",
        validityStatus: "valid",
      },
      {
        runId: "spy-newer",
        presetId: "current_setup",
        symbol: "SPY",
        completedAt: "2026-04-03T01:08:27.799Z",
        validityStatus: "valid",
      },
      {
        runId: "spy-invalid",
        presetId: "current_setup",
        symbol: "SPY",
        completedAt: "2026-04-03T01:30:00.000Z",
        validityStatus: "invalid",
      },
      {
        runId: "baseline",
        presetId: "tranche2_2m",
        symbol: "SPY",
        completedAt: "2026-04-03T01:11:43.117Z",
        validityStatus: "valid",
      },
    ],
    selectedRunId: null,
    presetId: "current_setup",
    symbol: "SPY",
  });

  assert.equal(selectedRunId, "spy-newer");
});

test("resolveDefaultScoreStudySelectedRunId falls back to any valid preset match when symbol-specific runs are unavailable", () => {
  const selectedRunId = resolveDefaultScoreStudySelectedRunId({
    runs: [
      {
        runId: "direction-qqq",
        presetId: "direction_rank_v1",
        symbol: "QQQ",
        completedAt: "2026-04-03T01:14:31.194Z",
        validityStatus: "valid",
      },
      {
        runId: "direction-invalid",
        presetId: "direction_rank_v1",
        symbol: "SPY",
        completedAt: "2026-04-03T01:20:00.000Z",
        validityStatus: "invalid",
      },
    ],
    selectedRunId: null,
    presetId: "direction_rank_v1",
    symbol: "SPY",
  });

  assert.equal(selectedRunId, "direction-qqq");
});
