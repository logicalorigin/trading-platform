function toFiniteNumber(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string" && !value.trim()) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeDisplayNumber(value, digits = null) {
  const numeric = toFiniteNumber(value);
  if (numeric == null) {
    return null;
  }
  return digits == null ? numeric : Number(numeric.toFixed(digits));
}

function firstFinite(...values) {
  for (const value of values) {
    const numeric = toFiniteNumber(value);
    if (numeric != null) {
      return numeric;
    }
  }
  return null;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) {
      return text;
    }
  }
  return null;
}

export function normalizeDirectionSummary(directionSummary = null) {
  const summary = directionSummary?.overallSummary || directionSummary || {};
  const predicted = directionSummary?.predictedScoreSummary || directionSummary?.predictedScore || {};
  const validated = directionSummary?.validatedOutcomeSummary || directionSummary?.validatedOutcome || {};
  const rank = directionSummary?.rankValiditySummary || directionSummary?.rankValidity || {};
  return {
    totalSignals: Number(summary.totalSignals || validated.signalCount) || 0,
    predictedScoreType: firstText(predicted.preferredScoreType, summary.predictedScoreType, summary.preferredScoreType, directionSummary?.preferredScoreType),
    meanRawScore: normalizeDisplayNumber(firstFinite(predicted.meanRawScore, summary.meanRawScore, summary.headlineMeanPredictedRawScore), 3),
    meanFinalScore: normalizeDisplayNumber(firstFinite(predicted.meanFinalScore, summary.meanFinalScore, summary.headlineMeanPredictedFinalScore), 3),
    meanEffectiveScore: normalizeDisplayNumber(firstFinite(predicted.meanEffectiveScore, summary.meanEffectiveScore, summary.headlineMeanPredictedEffectiveScore), 3),
    validatedQualityScore: normalizeDisplayNumber(firstFinite(validated.validatedQualityScore, summary.validatedQualityScore, summary.headlineValidatedQualityScore, summary.headlineMeanRealizedQualityScore), 3),
    bestMoveAtr: normalizeDisplayNumber(firstFinite(validated.bestMoveAtr, summary.bestMoveAtr, summary.meanExcursionEdgeAtr, summary.headlineMeanBestMoveAtr, summary.headlineMeanExcursionEdgeAtr), 3),
    closeResultAtr: normalizeDisplayNumber(firstFinite(validated.closeResultAtr, summary.closeResultAtr, summary.meanCloseReturnAtr, summary.headlineMeanCloseResultAtr, summary.headlineMeanCloseReturnAtr), 3),
    directionCorrectPct: normalizeDisplayNumber(firstFinite(validated.directionCorrectPct, summary.directionCorrectPct, summary.guidanceRatePct, summary.headlineMeanDirectionCorrectPct, summary.headlineGuidanceRatePct), 1),
    stayedRightPct: normalizeDisplayNumber(firstFinite(validated.stayedRightPct, summary.stayedRightPct, summary.meanStayedRightPct, summary.meanTenurePct, summary.headlineMeanStayedRightPct, summary.headlineMeanTenurePct, summary.headlineSustainedCorrectRatePct), 1),
    earlyCheckPct: normalizeDisplayNumber(firstFinite(validated.earlyCheckPct, summary.earlyCheckPct, summary.fewCandleCorrectRatePct, summary.headlineFewCandleCorrectRatePct), 1),
    preferredScoreType: firstText(summary.preferredScoreType, summary.predictedScoreType, predicted.preferredScoreType),
    renderFloorScore: normalizeDisplayNumber(firstFinite(summary.renderFloorScore), 2),
    renderAction: firstText(summary.renderAction),
    rankValidity: {
      status: firstText(rank.status) || null,
      verdict: firstText(rank.verdict) || null,
      headline: firstText(rank.headline) || null,
      orderReliabilityPct: normalizeDisplayNumber(firstFinite(rank.orderReliabilityPct), 1),
      topBottomValidatedQualityLift: normalizeDisplayNumber(firstFinite(rank.topBottomValidatedQualityLift), 3),
      topBottomBestMoveLiftAtr: normalizeDisplayNumber(firstFinite(rank.topBottomBestMoveLiftAtr), 3),
      topBottomCloseLiftAtr: normalizeDisplayNumber(firstFinite(rank.topBottomCloseLiftAtr), 3),
      topBottomDirectionCorrectLiftPct: normalizeDisplayNumber(firstFinite(rank.topBottomDirectionCorrectLiftPct), 1),
      topBottomStayedRightLiftPct: normalizeDisplayNumber(firstFinite(rank.topBottomStayedRightLiftPct), 1),
      evaluatedTimeframeCount: Number(rank.evaluatedTimeframeCount) || 0,
      workingTimeframeCount: Number(rank.workingTimeframeCount) || 0,
      stabilityPct: normalizeDisplayNumber(firstFinite(rank.stabilityPct), 1),
    },
  };
}

function summarizeInlineDirection(directionSummary = null) {
  const normalized = normalizeDirectionSummary(directionSummary);
  const tiers = Array.isArray(directionSummary?.precisionCoverageFrontier?.tiers)
    ? Object.fromEntries(directionSummary.precisionCoverageFrontier.tiers.filter((tier) => tier?.key).map((tier) => [tier.key, tier]))
    : directionSummary?.frontierTiers || {};
  return {
    ...normalized,
    frontierTiers: tiers,
  };
}

export function buildInlineScoreStudySummary(result = null) {
  if (!result || typeof result !== "object") {
    return null;
  }
  return {
    directions: {
      combined: summarizeInlineDirection(result?.directionSummaries?.combined || result),
      long: summarizeInlineDirection(result?.directionSummaries?.long),
      short: summarizeInlineDirection(result?.directionSummaries?.short),
    },
  };
}

export function resolveRunScoreStudySummary(run = null) {
  if (!run || typeof run !== "object") {
    return null;
  }
  const storedSummary = run?.summary && typeof run.summary === "object" ? run.summary : null;
  const inlineSummary = buildInlineScoreStudySummary(run?.result || null);
  if (!inlineSummary) {
    return storedSummary;
  }
  return {
    ...(storedSummary || {}),
    ...inlineSummary,
    directions: {
      ...(storedSummary?.directions || {}),
      ...(inlineSummary?.directions || {}),
    },
  };
}

export function resolveRunScoreStudyDirectionSummary(run = null, directionKey = "combined") {
  return resolveRunScoreStudySummary(run)?.directions?.[directionKey] || null;
}

export function normalizeScoreStudyRunRecord(run = null) {
  if (!run || typeof run !== "object") {
    return null;
  }
  return {
    ...run,
    summary: resolveRunScoreStudySummary(run),
  };
}
