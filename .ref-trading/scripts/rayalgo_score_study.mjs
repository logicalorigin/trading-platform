#!/usr/bin/env node

import fs from "fs";
import path from "path";

import { buildRayAlgoScoreStudy } from "../src/research/analysis/rayalgoScoreStudy.js";
import { SIGNAL_OVERLAY_TIMEFRAME_OPTIONS } from "../src/research/chart/timeframeModel.js";
import { normalizeRayAlgoScoringPreferences } from "../src/research/engine/rayalgoScoring.js";
import { resolveResearchSpotHistory } from "../server/services/researchSpotHistory.js";

function parseArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  if (!hit) return fallback;
  return hit.slice(prefix.length).trim();
}

function parseNumberArg(name, fallback) {
  const raw = parseArg(name, "");
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function parseListArg(name, fallback = []) {
  const raw = parseArg(name, "");
  if (!raw) return fallback;
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function normalizeHistoryMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "initial" || normalized === "chunk" ? normalized : "full";
}

function normalizePreferredTf(value) {
  return String(value || "").trim().toLowerCase() === "5m" ? "5m" : "1m";
}

function normalizeStudyMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "tenure" ? "tenure" : normalized === "both" ? "both" : "forward";
}

function buildSignalClassCliSummary(result = {}) {
  const summaries = result?.signalClassSummaries || {};
  return Object.fromEntries(
    Object.entries(summaries).map(([signalClass, summary]) => [
      signalClass,
      {
        signalCount: summary?.totalSignals ?? null,
        finalScoreRange: {
          p50: summary?.directions?.combined?.scoreDistributions?.final?.p50 ?? null,
          p75: summary?.directions?.combined?.scoreDistributions?.final?.p75 ?? null,
          p90: summary?.directions?.combined?.scoreDistributions?.final?.p90 ?? null,
          max: summary?.directions?.combined?.scoreDistributions?.final?.max ?? null,
        },
        realizedQualityRange: {
          mean: summary?.directions?.combined?.scoreDistributions?.realizedQuality?.mean ?? null,
          p50: summary?.directions?.combined?.scoreDistributions?.realizedQuality?.p50 ?? null,
          p75: summary?.directions?.combined?.scoreDistributions?.realizedQuality?.p75 ?? null,
          p90: summary?.directions?.combined?.scoreDistributions?.realizedQuality?.p90 ?? null,
          max: summary?.directions?.combined?.scoreDistributions?.realizedQuality?.max ?? null,
        },
        fewCandleQualityRange: {
          mean: summary?.directions?.combined?.scoreDistributions?.fewCandleQuality?.mean ?? null,
          p50: summary?.directions?.combined?.scoreDistributions?.fewCandleQuality?.p50 ?? null,
          p75: summary?.directions?.combined?.scoreDistributions?.fewCandleQuality?.p75 ?? null,
          p90: summary?.directions?.combined?.scoreDistributions?.fewCandleQuality?.p90 ?? null,
          max: summary?.directions?.combined?.scoreDistributions?.fewCandleQuality?.max ?? null,
        },
        topPositiveFeatureStates: (summary?.featureImpactSummaries?.topPositiveStates || []).slice(0, 4).map((state) => ({
          featureKey: state.featureKey,
          state: state.state,
          count: state.count,
          realizedQualityLift: state.realizedQualityLift,
        })),
        topNegativeFeatureStates: (summary?.featureImpactSummaries?.topNegativeStates || []).slice(0, 4).map((state) => ({
          featureKey: state.featureKey,
          state: state.state,
          count: state.count,
          realizedQualityLift: state.realizedQualityLift,
        })),
        qualityFloorRecommendation: {
          status: summary?.directions?.combined?.qualityFloorRecommendation?.status ?? null,
          floorScore: summary?.directions?.combined?.qualityFloorRecommendation?.floorScore ?? null,
          headline: summary?.directions?.combined?.qualityFloorRecommendation?.headline ?? null,
          bestCandidate: summary?.directions?.combined?.qualityFloorRecommendation?.bestCandidate
            ? {
              threshold: summary.directions.combined.qualityFloorRecommendation.bestCandidate.threshold,
              aboveCount: summary.directions.combined.qualityFloorRecommendation.bestCandidate.above?.count ?? null,
              aboveCoveragePct: summary.directions.combined.qualityFloorRecommendation.bestCandidate.above?.coveragePct ?? null,
              aboveMeanRealizedQualityScore: summary.directions.combined.qualityFloorRecommendation.bestCandidate.above?.meanRealizedQualityScore ?? null,
              aboveMeanExcursionEdgeAtr: summary.directions.combined.qualityFloorRecommendation.bestCandidate.above?.meanExcursionEdgeAtr ?? null,
            }
            : null,
        },
        directionDiagnostics: Object.fromEntries(
          ["long", "short"].map((directionKey) => [
            directionKey,
            {
              signalCount: summary?.directions?.[directionKey]?.totalSignals ?? null,
              meanPredictedFinalScore: summary?.directions?.[directionKey]?.forward?.overallSummary?.headlineMeanPredictedFinalScore ?? null,
              meanRealizedQualityScore: summary?.directions?.[directionKey]?.forward?.overallSummary?.headlineMeanRealizedQualityScore ?? null,
              meanFewCandleQualityScore: summary?.directions?.[directionKey]?.forward?.overallSummary?.headlineMeanFewCandleQualityScore ?? null,
              guidanceRatePct: summary?.directions?.[directionKey]?.forward?.overallSummary?.headlineGuidanceRatePct ?? null,
              fewCandleCorrectRatePct: summary?.directions?.[directionKey]?.forward?.overallSummary?.headlineFewCandleCorrectRatePct ?? null,
              sustainedCorrectRatePct: summary?.directions?.[directionKey]?.forward?.overallSummary?.headlineSustainedCorrectRatePct ?? null,
              meanExcursionEdgeAtr: summary?.directions?.[directionKey]?.forward?.overallSummary?.headlineMeanExcursionEdgeAtr ?? null,
              floorStatus: summary?.directions?.[directionKey]?.qualityFloorRecommendation?.status ?? null,
              floorScore: summary?.directions?.[directionKey]?.qualityFloorRecommendation?.floorScore ?? null,
            },
          ]),
        ),
        subtypeDiagnostics: summary?.subtypeSummaries
          ? Object.fromEntries(
            Object.entries(summary.subtypeSummaries).map(([subtypeKey, subtypeSummary]) => [
              subtypeKey,
              {
                signalCount: subtypeSummary?.totalSignals ?? null,
                guidanceRatePct: subtypeSummary?.directions?.combined?.forward?.overallSummary?.headlineGuidanceRatePct ?? null,
                fewCandleCorrectRatePct: subtypeSummary?.directions?.combined?.forward?.overallSummary?.headlineFewCandleCorrectRatePct ?? null,
                sustainedCorrectRatePct: subtypeSummary?.directions?.combined?.forward?.overallSummary?.headlineSustainedCorrectRatePct ?? null,
                meanExcursionEdgeAtr: subtypeSummary?.directions?.combined?.forward?.overallSummary?.headlineMeanExcursionEdgeAtr ?? null,
                meanRealizedQualityScore: subtypeSummary?.directions?.combined?.forward?.overallSummary?.headlineMeanRealizedQualityScore ?? null,
                longMeanExcursionEdgeAtr: subtypeSummary?.directions?.long?.forward?.overallSummary?.headlineMeanExcursionEdgeAtr ?? null,
                shortMeanExcursionEdgeAtr: subtypeSummary?.directions?.short?.forward?.overallSummary?.headlineMeanExcursionEdgeAtr ?? null,
              },
            ]),
          )
          : null,
        forward: {
          preferredScoreType: summary?.directions?.combined?.forward?.preferredScoreType ?? null,
          meanPredictedFinalScore: summary?.directions?.combined?.forward?.overallSummary?.headlineMeanPredictedFinalScore ?? null,
          meanRealizedQualityScore: summary?.directions?.combined?.forward?.overallSummary?.headlineMeanRealizedQualityScore ?? null,
          meanFewCandleQualityScore: summary?.directions?.combined?.forward?.overallSummary?.headlineMeanFewCandleQualityScore ?? null,
          guidanceRatePct: summary?.directions?.combined?.forward?.overallSummary?.headlineGuidanceRatePct ?? null,
          fewCandleCorrectRatePct: summary?.directions?.combined?.forward?.overallSummary?.headlineFewCandleCorrectRatePct ?? null,
          sustainedCorrectRatePct: summary?.directions?.combined?.forward?.overallSummary?.headlineSustainedCorrectRatePct ?? null,
          meanExcursionEdgeAtr: summary?.directions?.combined?.forward?.overallSummary?.headlineMeanExcursionEdgeAtr ?? null,
          qualifiedFinalBuckets: summary?.directions?.combined?.forward?.bucketCoverage?.final?.qualifiedBucketCount ?? null,
          populatedFinalBuckets: summary?.directions?.combined?.forward?.bucketCoverage?.final?.populatedBucketCount ?? null,
        },
        precisionCoverageFrontier: {
          status: summary?.directions?.combined?.precisionCoverageFrontier?.status ?? null,
          headline: summary?.directions?.combined?.precisionCoverageFrontier?.headline ?? null,
          targetTier: summary?.directions?.combined?.precisionCoverageFrontier?.targetTier ?? null,
          bestFewCandleTier: summary?.directions?.combined?.precisionCoverageFrontier?.bestFewCandleTier ?? null,
          bestSustainedTier: summary?.directions?.combined?.precisionCoverageFrontier?.bestSustainedTier ?? null,
        },
        tenure: {
          preferredScoreType: summary?.directions?.combined?.tenure?.preferredScoreType ?? null,
          meanPredictedFinalScore: summary?.directions?.combined?.tenure?.overallSummary?.headlineMeanPredictedFinalScore ?? null,
          meanRealizedQualityScore: summary?.directions?.combined?.tenure?.overallSummary?.headlineMeanRealizedQualityScore ?? null,
          majorityCorrectRatePct: summary?.directions?.combined?.tenure?.overallSummary?.headlineMajorityCorrectRatePct ?? null,
          meanTenurePct: summary?.directions?.combined?.tenure?.overallSummary?.headlineMeanTenurePct ?? null,
          qualifiedFinalBuckets: summary?.directions?.combined?.tenure?.bucketCoverage?.final?.qualifiedBucketCount ?? null,
          populatedFinalBuckets: summary?.directions?.combined?.tenure?.bucketCoverage?.final?.populatedBucketCount ?? null,
        },
      },
    ]),
  );
}

function buildCliHorizonDiagnostics(study = null, result = {}, directionKey = "combined") {
  const isTenure = study?.studyMode === "tenure";
  const directionSummary = study?.directionSummaries?.[directionKey] || null;
  const horizonSummaries = directionSummary?.horizonSummaries || study?.horizonSummaries || {};
  const horizonEntries = Array.isArray(study?.horizons) ? study.horizons : [];
  const timeframeWindows = result?.metadata?.horizonSemantics?.timeframeWindowMinutes || {};
  return horizonEntries.map((entry) => {
    const horizonKey = entry?.key || null;
    const overall = horizonSummaries?.[horizonKey]?.final?.overall || null;
    return {
      horizon: horizonKey,
      label: entry?.label || horizonKey,
      multiplier: entry?.multiplier ?? null,
      windowMinutesByTimeframe: Object.fromEntries(
        Object.entries(timeframeWindows).map(([timeframe, windows]) => [
          timeframe,
          isTenure ? windows?.tenure?.[horizonKey] ?? null : windows?.forward?.[horizonKey] ?? null,
        ]),
      ),
      signalCount: overall?.signalCount ?? null,
      zeroWindowCount: overall?.zeroWindowCount ?? null,
      guidanceRatePct: overall?.guidanceRatePct ?? null,
      meanExcursionEdgeAtr: overall?.meanExcursionEdgeAtr ?? null,
      meanCloseReturnAtr: overall?.meanCloseReturnAtr ?? null,
      meanMfeAtr: overall?.meanMfeAtr ?? null,
      meanMaeAtr: overall?.meanMaeAtr ?? null,
      meanEffectiveBars: overall?.meanEffectiveBars ?? null,
      meanRequestedClockMinutes: overall?.meanRequestedClockMinutes ?? null,
      meanEffectiveClockMinutes: overall?.meanEffectiveClockMinutes ?? null,
      majorityCorrectRatePct: overall?.majorityCorrectRatePct ?? null,
      meanTenurePct: overall?.meanTenurePct ?? null,
      meanEligibleBars: overall?.meanEligibleBars ?? null,
      meanEligibleClockMinutes: overall?.meanEligibleClockMinutes ?? null,
      contrarianStopRatePct: overall?.contrarianStopRatePct ?? null,
    };
  });
}

async function fetchSpotBars(symbol, { mode, initialDays, preferredTf, apiKey }) {
  if (mode === "full") {
    const mergedByTime = new Map();
    const seenCursors = new Set();
    let before = null;
    let finalDataSource = "unknown";
    let finalMeta = null;
    let safety = 0;

    while (safety < 64) {
      const pageMode = before ? "chunk" : "initial";
      const response = await resolveResearchSpotHistory({
        symbol,
        apiKey,
        mode: pageMode,
        before,
        initialDays,
        preferredTf,
      });
      const pageBars = Array.isArray(response?.intradayBars) ? response.intradayBars : [];
      for (const bar of pageBars) {
        const time = Number(bar?.time);
        if (Number.isFinite(time)) {
          mergedByTime.set(time, bar);
        }
      }
      finalDataSource = response?.dataSource || finalDataSource;
      finalMeta = response?.meta || finalMeta;

      const nextBefore = response?.meta?.nextBefore ?? null;
      const hasMore = Boolean(response?.meta?.hasMoreIntraday);
      if (!hasMore || !nextBefore || seenCursors.has(String(nextBefore))) {
        break;
      }
      seenCursors.add(String(nextBefore));
      before = nextBefore;
      safety += 1;
    }

    const bars = [...mergedByTime.values()].sort((left, right) => Number(left?.time || 0) - Number(right?.time || 0));
    if (!bars.length) {
      throw new Error(`No spot bars returned for ${symbol}.`);
    }
    return {
      bars,
      dataSource: finalDataSource,
      meta: finalMeta,
    };
  }

  const response = await resolveResearchSpotHistory({
    symbol,
    apiKey,
    mode,
    initialDays,
    preferredTf,
  });
  const bars = Array.isArray(response?.intradayBars) ? response.intradayBars : [];
  if (!bars.length) {
    throw new Error(response?.error || `No spot bars returned for ${symbol}.`);
  }
  return {
    bars,
    dataSource: response?.dataSource || "unknown",
    meta: response?.meta || null,
  };
}

async function main() {
  const symbol = String(parseArg("symbol", "SPY") || "SPY").toUpperCase();
  const initialDays = parseNumberArg("days", 60);
  const mode = normalizeHistoryMode(parseArg("mode", "initial"));
  const preferredTf = normalizePreferredTf(parseArg("preferredTf", "1m"));
  const studyMode = normalizeStudyMode(parseArg("studyMode", "forward"));
  const outDir = parseArg("out", "output/rayalgo-score-study");
  const requestedTimeframes = parseListArg("timeframes", SIGNAL_OVERLAY_TIMEFRAME_OPTIONS);
  const requestedContextTimeframes = parseListArg("contextTimeframes", []);
  const scoringPreferences = normalizeRayAlgoScoringPreferences({
    precursorLadderId: parseArg("precursor", "none"),
    authority: parseArg("authority", "observe_only"),
    conflictPolicy: parseArg("conflict", "v2_nuance"),
  });
  const scoringConfig = {
    ...scoringPreferences,
    precursorFrames: requestedContextTimeframes,
    executionProfile: parseArg("executionProfile", ""),
    scoringVersion: parseArg("scoringVersion", ""),
  };
  const apiKey = process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || "";
  if (!apiKey) {
    throw new Error("MASSIVE_API_KEY or POLYGON_API_KEY is required for rayalgo score study export.");
  }

  fs.mkdirSync(outDir, { recursive: true });

  const { bars, dataSource, meta } = await fetchSpotBars(symbol, {
    mode,
    initialDays,
    preferredTf,
    apiKey,
  });
  const result = buildRayAlgoScoreStudy({
    marketSymbol: symbol,
    bars,
    rayalgoScoringConfig: scoringConfig,
    timeframes: requestedTimeframes,
  });
  if (result?.status === "error") {
    throw new Error(result.error || "RayAlgo score study failed.");
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(outDir, `score-study-${symbol}-${stamp}.json`);
  const payload = {
    generatedAt: new Date().toISOString(),
    symbol,
    initialDays,
    mode,
    preferredTf,
    studyMode,
    requestedTimeframes,
    scoringPreferences: scoringConfig,
    requestedContextTimeframes,
    dataSource,
    spotMeta: meta,
    result,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));

  const selectedStudy = studyMode === "tenure"
    ? result?.studyModes?.tenure
    : result?.studyModes?.forward || result;
  const selectedSummary = selectedStudy?.overallSummary || result?.overallSummary || null;
  const contrarianPolicyComparison = selectedStudy?.contrarianPolicyComparison || result?.contrarianPolicyComparison || null;
  const scoreTrustAudit = selectedStudy?.scoreTrustAudit || result?.scoreTrustAudit || null;

  console.log(JSON.stringify({
    filePath,
    symbol,
    initialDays,
    mode,
    preferredTf,
    studyMode,
    dataSource,
    signalCount: result?.metadata?.signalCount ?? null,
    signalClassCounts: result?.metadata?.signalClassCounts ?? null,
    analyzedTimeframes: result?.metadata?.analyzedTimeframes ?? [],
    preferredScoreType: selectedSummary?.preferredScoreType ?? null,
    precursorEffect: selectedSummary?.precursorEffect ?? null,
    renderAction: selectedSummary?.renderAction ?? null,
    renderFloorScore: selectedSummary?.renderFloorScore ?? null,
    headlineMeanPredictedRawScore: selectedSummary?.headlineMeanPredictedRawScore ?? null,
    headlineMeanPredictedFinalScore: selectedSummary?.headlineMeanPredictedFinalScore ?? null,
    headlineMeanRealizedQualityScore: selectedSummary?.headlineMeanRealizedQualityScore ?? null,
    headlineMeanFewCandleQualityScore: selectedSummary?.headlineMeanFewCandleQualityScore ?? null,
    headlineGuidanceRatePct: selectedSummary?.headlineGuidanceRatePct ?? null,
    headlineFewCandleCorrectRatePct: selectedSummary?.headlineFewCandleCorrectRatePct ?? null,
    headlineSustainedCorrectRatePct: selectedSummary?.headlineSustainedCorrectRatePct ?? null,
    headlineMeanExcursionEdgeAtr: selectedSummary?.headlineMeanExcursionEdgeAtr ?? null,
    headlineMeanMfeAtr: selectedSummary?.headlineMeanMfeAtr ?? null,
    headlineMeanMaeAtr: selectedSummary?.headlineMeanMaeAtr ?? null,
    headlineBlocks: selectedSummary?.headlineBlocks ?? null,
    headlineHitRatePct: selectedSummary?.headlineHitRatePct ?? null,
    headlineMeanCloseReturnAtr: selectedSummary?.headlineMeanCloseReturnAtr ?? null,
    headlineMajorityCorrectRatePct: selectedSummary?.headlineMajorityCorrectRatePct ?? null,
    headlineMeanTenurePct: selectedSummary?.headlineMeanTenurePct ?? null,
    headlineMeanRequestedClockMinutes: selectedSummary?.headlineMeanRequestedClockMinutes ?? null,
    headlineMeanEffectiveClockMinutes: selectedSummary?.headlineMeanEffectiveClockMinutes ?? null,
    headlineMeanEligibleClockMinutes: selectedSummary?.headlineMeanEligibleClockMinutes ?? null,
    horizonSemantics: result?.metadata?.horizonSemantics ?? null,
    horizonDiagnostics: {
      forward: buildCliHorizonDiagnostics(result?.studyModes?.forward || result, result),
      tenure: buildCliHorizonDiagnostics(result?.studyModes?.tenure || null, result),
    },
    fewCandleDefinition: result?.metadata?.fewCandleDefinition ?? null,
    precisionCoverageFrontier: {
      status: result?.precisionCoverageFrontier?.status ?? null,
      headline: result?.precisionCoverageFrontier?.headline ?? null,
      targetTier: result?.precisionCoverageFrontier?.targetTier ?? null,
      bestFewCandleTier: result?.precisionCoverageFrontier?.bestFewCandleTier ?? null,
      bestSustainedTier: result?.precisionCoverageFrontier?.bestSustainedTier ?? null,
    },
    qualityFloorRecommendation: {
      status: result?.qualityFloorRecommendation?.status ?? null,
      floorScore: result?.qualityFloorRecommendation?.floorScore ?? null,
      headline: result?.qualityFloorRecommendation?.headline ?? null,
      bestCandidate: result?.qualityFloorRecommendation?.bestCandidate
        ? {
          threshold: result.qualityFloorRecommendation.bestCandidate.threshold,
          aboveCount: result.qualityFloorRecommendation.bestCandidate.above?.count ?? null,
          aboveCoveragePct: result.qualityFloorRecommendation.bestCandidate.above?.coveragePct ?? null,
          aboveMeanRealizedQualityScore: result.qualityFloorRecommendation.bestCandidate.above?.meanRealizedQualityScore ?? null,
          aboveMeanExcursionEdgeAtr: result.qualityFloorRecommendation.bestCandidate.above?.meanExcursionEdgeAtr ?? null,
        }
        : null,
    },
    topPositiveFeatureStates: (result?.featureImpactSummaries?.topPositiveStates || []).slice(0, 6).map((state) => ({
      featureKey: state.featureKey,
      state: state.state,
      count: state.count,
      realizedQualityLift: state.realizedQualityLift,
    })),
    topNegativeFeatureStates: (result?.featureImpactSummaries?.topNegativeStates || []).slice(0, 6).map((state) => ({
      featureKey: state.featureKey,
      state: state.state,
      count: state.count,
      realizedQualityLift: state.realizedQualityLift,
    })),
    requestedContextTimeframes,
    scoringConfigPreview: result?.metadata?.scoringConfigPreview ?? null,
    scoreTrustAudit: scoreTrustAudit ? {
      status: scoreTrustAudit.status,
      headline: scoreTrustAudit.headline,
      preferredScoreKey: scoreTrustAudit.preferredScoreKey,
      calibration: {
        bucketEvaluation: scoreTrustAudit?.calibration?.bucketEvaluation || null,
        bucketSummary: scoreTrustAudit?.calibration?.bucketSummary || null,
      },
      entryIntegrity: {
        status: scoreTrustAudit?.entryIntegrity?.status || null,
        headline: scoreTrustAudit?.entryIntegrity?.headline || null,
        baseline: scoreTrustAudit?.entryIntegrity?.baseline || null,
        bestTier: scoreTrustAudit?.entryIntegrity?.bestTier || null,
        bestThreshold: scoreTrustAudit?.entryIntegrity?.bestThreshold || null,
        thresholds: scoreTrustAudit?.entryIntegrity?.thresholds || [],
      },
      forwardSuccess: {
        status: scoreTrustAudit?.forwardSuccess?.status || null,
        headline: scoreTrustAudit?.forwardSuccess?.headline || null,
        baseline: scoreTrustAudit?.forwardSuccess?.baseline || null,
        bestTier: scoreTrustAudit?.forwardSuccess?.bestTier || null,
        bestThreshold: scoreTrustAudit?.forwardSuccess?.bestThreshold || null,
        thresholds: scoreTrustAudit?.forwardSuccess?.thresholds || [],
      },
      asymmetry: scoreTrustAudit?.asymmetry || null,
      simpleBaselines: scoreTrustAudit?.simpleBaselines || null,
    } : null,
    contrarianPolicyComparison: contrarianPolicyComparison ? {
      scoreBasis: contrarianPolicyComparison.scoreBasis,
      floorGrid: contrarianPolicyComparison.floorGrid,
      marginGrid: contrarianPolicyComparison.marginGrid,
      overallBestPolicy: contrarianPolicyComparison.overallBestPolicy
        ? {
          policyId: contrarianPolicyComparison.overallBestPolicy.policyId,
          label: contrarianPolicyComparison.overallBestPolicy.label,
          family: contrarianPolicyComparison.overallBestPolicy.family,
          combined: contrarianPolicyComparison.overallBestPolicy.directionSummaries?.combined || null,
        }
        : null,
      bestByFamily: Object.fromEntries(
        Object.entries(contrarianPolicyComparison.families || {}).map(([familyKey, family]) => [
          familyKey,
          family?.best
            ? {
              policyId: family.best.policyId,
              label: family.best.label,
              combined: family.best.directionSummaries?.combined || null,
            }
            : null,
        ]),
      ),
    } : null,
    signalClassDiagnostics: buildSignalClassCliSummary(result),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
