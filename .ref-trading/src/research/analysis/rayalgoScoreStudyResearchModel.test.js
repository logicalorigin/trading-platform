import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInlineScoreStudySummary,
  normalizeDirectionSummary,
  normalizeScoreStudyRunRecord,
  resolveRunScoreStudySummary,
} from "./rayalgoScoreStudyResearchModel.js";

function buildDirectionSummary({
  totalSignals = 18,
  meanRawScore = 0.512,
  meanFinalScore = 0.641,
  meanEffectiveScore = 0.628,
  validatedQualityScore = 0.588,
  bestMoveAtr = 0.944,
  closeResultAtr = 0.181,
  directionCorrectPct = 57.2,
  stayedRightPct = 61.9,
  earlyCheckPct = 78.4,
  status = "working",
} = {}) {
  return {
    overallSummary: {
      totalSignals,
      preferredScoreType: "final",
      renderAction: "keep_all_arrows",
      renderFloorScore: 0.63,
      headlineMeanPredictedRawScore: meanRawScore,
      headlineMeanPredictedFinalScore: meanFinalScore,
      headlineMeanPredictedEffectiveScore: meanEffectiveScore,
      headlineValidatedQualityScore: validatedQualityScore,
      headlineMeanBestMoveAtr: bestMoveAtr,
      headlineMeanCloseResultAtr: closeResultAtr,
      headlineMeanDirectionCorrectPct: directionCorrectPct,
      headlineMeanStayedRightPct: stayedRightPct,
      headlineFewCandleCorrectRatePct: earlyCheckPct,
    },
    predictedScoreSummary: {
      preferredScoreType: "final",
      meanRawScore,
      meanFinalScore,
      meanEffectiveScore,
    },
    validatedOutcomeSummary: {
      signalCount: totalSignals,
      validatedQualityScore,
      bestMoveAtr,
      closeResultAtr,
      directionCorrectPct,
      stayedRightPct,
      earlyCheckPct,
    },
    rankValiditySummary: {
      status,
      verdict: status === "working" ? "Promote candidate" : "Keep testing",
      headline: "Validation headline",
      orderReliabilityPct: 74.2,
      topBottomValidatedQualityLift: 0.084,
      topBottomBestMoveLiftAtr: 0.21,
      topBottomCloseLiftAtr: 0.09,
      topBottomDirectionCorrectLiftPct: 7.4,
      topBottomStayedRightLiftPct: 8.6,
      evaluatedTimeframeCount: 3,
      workingTimeframeCount: status === "working" ? 2 : 1,
      stabilityPct: 66.1,
    },
    precisionCoverageFrontier: {
      tiers: [
        {
          key: "top_10",
          label: "Top 10%",
          count: 2,
          thresholdScore: 0.73,
          meanExcursionEdgeAtr3x: 1.104,
          fewCandleCorrectRatePct: 81.2,
          sustainedCorrectRatePct: 68.4,
        },
      ],
    },
  };
}

test("buildInlineScoreStudySummary derives normalized operator summaries and frontier tiers from a result payload", () => {
  const result = {
    directionSummaries: {
      combined: buildDirectionSummary(),
      long: buildDirectionSummary({ validatedQualityScore: 0.612, directionCorrectPct: 60.4 }),
      short: buildDirectionSummary({ validatedQualityScore: 0.541, status: "mixed" }),
    },
  };

  const summary = buildInlineScoreStudySummary(result);

  assert.equal(summary.directions.combined.validatedQualityScore, 0.588);
  assert.equal(summary.directions.combined.rankValidity.orderReliabilityPct, 74.2);
  assert.deepEqual(Object.keys(summary.directions.combined.frontierTiers), ["top_10"]);
  assert.equal(summary.directions.long.validatedQualityScore, 0.612);
  assert.equal(summary.directions.short.rankValidity.status, "mixed");
});

test("resolveRunScoreStudySummary preserves stored top-level summary metadata while replacing sparse directions from the result payload", () => {
  const run = {
    runId: "run-1",
    summary: {
      marketSymbol: "SPY",
      directions: {
        combined: {
          validatedQualityScore: null,
        },
      },
    },
    result: {
      directionSummaries: {
        combined: buildDirectionSummary(),
      },
    },
  };

  const summary = resolveRunScoreStudySummary(run);

  assert.equal(summary.marketSymbol, "SPY");
  assert.equal(summary.directions.combined.validatedQualityScore, 0.588);
  assert.equal(summary.directions.combined.bestMoveAtr, 0.944);
});

test("normalizeScoreStudyRunRecord upgrades shallow saved-run summaries so compare and research consumers can read consistent metrics", () => {
  const storedSummaryOnly = {
    validatedQualityScore: 0.533,
    meanExcursionEdgeAtr: 0.911,
    meanCloseReturnAtr: 0.244,
    guidanceRatePct: 52.4,
    stayedRightPct: 58.1,
    meanRawScore: 0.501,
    meanFinalScore: 0.588,
    meanEffectiveScore: 0.575,
    predictedScoreType: "final",
    rankValidity: {
      status: "mixed",
      orderReliabilityPct: 67.5,
    },
  };
  const normalizedStoredSummary = normalizeDirectionSummary(storedSummaryOnly);
  assert.equal(normalizedStoredSummary.validatedQualityScore, 0.533);
  assert.equal(normalizedStoredSummary.directionCorrectPct, 52.4);
  assert.equal(normalizedStoredSummary.bestMoveAtr, 0.911);
  assert.equal(normalizedStoredSummary.closeResultAtr, 0.244);
  assert.equal(normalizedStoredSummary.stayedRightPct, 58.1);
  assert.equal(normalizedStoredSummary.meanFinalScore, 0.588);
  assert.equal(normalizedStoredSummary.rankValidity.orderReliabilityPct, 67.5);

  const run = normalizeScoreStudyRunRecord({
    runId: "run-2",
    summary: {
      directions: {
        combined: {
          validatedQualityScore: null,
          rankValidity: {
            status: null,
          },
        },
      },
    },
    result: {
      directionSummaries: {
        combined: buildDirectionSummary({ validatedQualityScore: 0.601 }),
        long: buildDirectionSummary({ validatedQualityScore: 0.644 }),
        short: buildDirectionSummary({ validatedQualityScore: 0.559 }),
      },
    },
  });

  assert.equal(run.summary.directions.combined.validatedQualityScore, 0.601);
  assert.equal(run.summary.directions.long.validatedQualityScore, 0.644);
  assert.equal(run.summary.directions.short.validatedQualityScore, 0.559);
  assert.equal(run.summary.directions.combined.rankValidity.status, "working");
});
