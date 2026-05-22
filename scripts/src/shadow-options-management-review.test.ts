import assert from "node:assert/strict";
import test from "node:test";
import { buildRecommendations } from "./shadow-options-management-review";

test("management review prioritizes runner retention and re-entry from leak evidence", () => {
  const recommendations = buildRecommendations({
    opportunityRatio: 5.5,
    sweepEvidence: [
      {
        reportDir: "/tmp/sweep",
        window: "2026-05-04 through 2026-05-21",
        bestVariant: "trail-ladder-aggressive-early8-loss25",
        bestPnl: 28941,
        bestProfitFactor: 5.143,
        bestTrades: 179,
        bestWinPct: 66.5,
        bestMaxDrawdown: 218,
      },
    ],
    weakSymbols: [
      {
        symbol: "KTOS",
        exits: 6,
        wins: 2,
        winPct: 33.3,
        pnl: -227.15,
        avgPnl: -37.86,
        missedToPostExitHigh: 6149,
      },
    ],
    byExitReason: [
      {
        bucket: "runner_trail_stop",
        exits: 320,
        wins: 254,
        winPct: 79.4,
        pnl: 91094.83,
        avgPnl: 284.67,
        missedToPostExitHigh: 485331,
        reached25AfterExit: 285,
        finalAboveExit: 163,
      },
      {
        bucket: "opposite_signal",
        exits: 207,
        wins: 123,
        winPct: 59.4,
        pnl: 50487.86,
        avgPnl: 243.9,
        missedToPostExitHigh: 255874,
        reached25AfterExit: 153,
        finalAboveExit: 84,
      },
      {
        bucket: "early_invalidation",
        exits: 49,
        wins: 0,
        winPct: 0,
        pnl: -10677,
        avgPnl: -217.9,
        missedToPostExitHigh: 53290,
        reached25AfterExit: 25,
        finalAboveExit: 24,
      },
    ],
  });

  assert.equal(recommendations[0]?.title, "Keep a runner alive after first trail exit");
  assert.ok(
    recommendations.some(
      (recommendation) =>
        recommendation.title ===
        "Require confirmation before full opposite-signal liquidation",
    ),
  );
  assert.ok(
    recommendations.some(
      (recommendation) =>
        recommendation.title ===
        "Convert early invalidation from permanent exit to re-entry watch",
    ),
  );
  assert.ok(
    recommendations.some(
      (recommendation) =>
        recommendation.title === "Scale only after management improves capture",
    ),
  );
});
