import { aggregateBarsToMinutes } from "../data/aggregateBars.js";
import {
  computeMetrics as computeBacktestMetrics,
  detectRegimes as detectBacktestRegimes,
  runBacktest as runBacktestRuntime,
} from "../engine/runtime.js";
import {
  getRayAlgoWatcherCandidateSettings,
  mergeRayAlgoSettings,
  normalizeRayAlgoSettings,
} from "../config/rayalgoSettings.js";
import {
  getSupportedSignalOverlayTimeframes,
  timeframeToMinutes,
} from "../chart/timeframeModel.js";

export const WATCHER_WINDOW_SESSIONS = [8, 12, 20];
export const WATCHER_WINDOW_WEIGHTS = [0.5, 0.3, 0.2];
export const MAX_SIGNAL_TIMEFRAME_CANDIDATES = 4;
export const MIN_SIGNAL_BARS = 120;

function uniqueValues(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function compareTimeframes(left, right) {
  return (timeframeToMinutes(left) || 999999) - (timeframeToMinutes(right) || 999999);
}

function buildBarsFingerprint(bars = []) {
  if (!Array.isArray(bars) || !bars.length) {
    return "0";
  }
  const first = bars[0] || {};
  const last = bars[bars.length - 1] || {};
  return [
    bars.length,
    String(first.ts || first.time || first.date || ""),
    String(last.ts || last.time || last.date || ""),
  ].join(":");
}

export function createIdleWatcherState(overrides = {}) {
  return {
    status: "idle",
    error: null,
    lastRunAt: null,
    lastDurationMs: 0,
    leader: null,
    runnerUp: null,
    candidateCount: 0,
    freshnessLabel: "Idle",
    ...overrides,
  };
}

export function scoreWatcherMetrics(metrics) {
  if (!metrics || metrics.n < 3 || metrics.pnl <= 0 || metrics.exp <= 0) {
    return 0;
  }
  const profitFactor = metrics.pf === "∞" ? 10 : parseFloat(metrics.pf);
  const cappedPf = Math.min(Math.max(Number.isFinite(profitFactor) ? profitFactor : 0, 0), 5);
  const drawdownPenalty = Math.pow(1 - Math.min(metrics.dd, 80) / 100, 1.5);
  const significance = Math.log2(Math.max(metrics.n, 2));
  const sharpe = Math.max(metrics.sharpe, 0);
  const winRate = metrics.wr / 100;
  const expectancyBoost = Math.min(Math.max(metrics.exp / 75, 0.25), 2.5);
  return +(sharpe * cappedPf * drawdownPenalty * significance * Math.max(winRate, 0.15) * expectancyBoost).toFixed(4);
}

function sliceBarsByRecentSessions(bars = [], sessions = 12) {
  if (!Array.isArray(bars) || !bars.length) {
    return [];
  }
  const targetSessions = Math.max(1, Math.round(Number(sessions) || 1));
  const seenDates = new Set();
  let startIndex = 0;
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    const date = String(bars[index]?.date || "").trim();
    if (!date) {
      continue;
    }
    seenDates.add(date);
    startIndex = index;
    if (seenDates.size >= targetSessions) {
      break;
    }
  }
  return bars.slice(startIndex);
}

export function deriveRecommendedShadingTimeframe(signalTimeframe, supportedTimeframes = []) {
  const signalMinutes = timeframeToMinutes(signalTimeframe);
  const ordered = [...supportedTimeframes].sort(compareTimeframes);
  if (!Number.isFinite(signalMinutes)) {
    return ordered[0] || signalTimeframe || "15m";
  }
  if (signalMinutes < 15 && ordered.includes("15m")) {
    return "15m";
  }
  const nextHigher = ordered.find((candidate) => {
    const minutes = timeframeToMinutes(candidate);
    return Number.isFinite(minutes) && minutes > signalMinutes;
  });
  return nextHigher || signalTimeframe;
}

export function summarizeWatcherConfidence(leader, runnerUp) {
  if (!leader) {
    return "Idle";
  }
  if (!runnerUp || runnerUp.score <= 0) {
    return "High";
  }
  const margin = (leader.score - runnerUp.score) / Math.max(Math.abs(leader.score), 0.0001);
  if (margin >= 0.3) return "High";
  if (margin >= 0.12) return "Medium";
  return "Low";
}

export function buildWatcherLeaderSummary(leader) {
  if (!leader) {
    return "No leader";
  }
  const horizon = leader.rayalgoSettings.marketStructure.timeHorizon;
  const bos = leader.rayalgoSettings.marketStructure.bosConfirmation === "wicks" ? "Wicks" : "Close";
  return `${leader.signalTimeframe} arrows · ${leader.shadingTimeframe} shading · TH ${horizon} · BOS ${bos}`;
}

function sortNumericCandidates(values = [], preferredValues = [], maxCount = null) {
  const normalized = Array.from(new Set(values.map((value) => Number(value)).filter(Number.isFinite))).sort((left, right) => left - right);
  if (!normalized.length) {
    return [];
  }
  const preferred = Array.from(new Set(preferredValues.map((value) => Number(value)).filter(Number.isFinite)));
  if (!preferred.length) {
    return maxCount ? normalized.slice(0, maxCount) : normalized;
  }
  const ranked = normalized
    .map((value) => ({
      value,
      distance: Math.min(...preferred.map((preferredValue) => Math.abs(preferredValue - value))),
    }))
    .sort((left, right) => left.distance - right.distance || left.value - right.value)
    .map((entry) => entry.value);
  return maxCount ? ranked.slice(0, maxCount) : ranked;
}

function prioritizeSignalTimeframes(supportedSignalTimeframes = [], preferredSignalTimeframes = [], fullScan = false) {
  const supported = uniqueValues(supportedSignalTimeframes).sort(compareTimeframes);
  if (!supported.length) {
    return [];
  }
  if (fullScan) {
    return supported.slice(0, MAX_SIGNAL_TIMEFRAME_CANDIDATES);
  }
  const preferred = uniqueValues(preferredSignalTimeframes).filter((timeframe) => supported.includes(timeframe));
  const ranked = [...preferred];
  for (const timeframe of preferred) {
    const index = supported.indexOf(timeframe);
    if (index > 0) {
      ranked.push(supported[index - 1]);
    }
    if (index >= 0 && index < supported.length - 1) {
      ranked.push(supported[index + 1]);
    }
  }
  for (const timeframe of supported) {
    ranked.push(timeframe);
  }
  return uniqueValues(ranked).slice(0, MAX_SIGNAL_TIMEFRAME_CANDIDATES);
}

function getAggregatedBarsForTimeframe({
  bars = [],
  barsFingerprint,
  signalTimeframe,
  aggregatedBarsCache,
}) {
  const signalTfMin = Math.max(1, timeframeToMinutes(signalTimeframe) || 5);
  const cacheKey = `${barsFingerprint}:${signalTfMin}`;
  if (aggregatedBarsCache?.has(cacheKey)) {
    return aggregatedBarsCache.get(cacheKey);
  }
  const signalBars = aggregateBarsToMinutes(bars, signalTfMin);
  const nextEntry = {
    signalBars,
    signalTfMin,
  };
  aggregatedBarsCache?.set(cacheKey, nextEntry);
  return nextEntry;
}

export function evaluateRayAlgoWatcherCandidates({
  bars = [],
  capital,
  baseRunConfig = {},
  tfMin = 5,
  normalizedRayAlgoSettings = null,
  currentSignalTimeframe = "5m",
  previousLeader = null,
  mode = "incremental",
  aggregatedBarsCache = null,
} = {}) {
  const startedAt = Date.now();
  const supportedSignalTimeframes = getSupportedSignalOverlayTimeframes(tfMin).slice(0, MAX_SIGNAL_TIMEFRAME_CANDIDATES);
  const normalizedSettings = normalizeRayAlgoSettings(normalizedRayAlgoSettings || {});
  const barsFingerprint = buildBarsFingerprint(bars);
  const fullScan = String(mode || "").trim().toLowerCase() === "full";
  const signalTimeframes = prioritizeSignalTimeframes(
    supportedSignalTimeframes,
    [
      currentSignalTimeframe,
      previousLeader?.signalTimeframe,
    ],
    fullScan,
  );
  const grid = getRayAlgoWatcherCandidateSettings(normalizedSettings);
  const timeHorizons = fullScan
    ? grid.timeHorizons
    : sortNumericCandidates(
      grid.timeHorizons,
      [
        normalizedSettings.marketStructure.timeHorizon,
        previousLeader?.rayalgoSettings?.marketStructure?.timeHorizon,
      ],
      4,
    );
  const bosModes = fullScan
    ? grid.bosModes
    : uniqueValues([
      normalizedSettings.marketStructure.bosConfirmation,
      previousLeader?.rayalgoSettings?.marketStructure?.bosConfirmation,
      ...grid.bosModes,
    ]).slice(0, 2);
  const bandProfiles = fullScan
    ? grid.bandProfiles
    : grid.bandProfiles;
  const candidates = [];

  for (const signalTimeframe of signalTimeframes) {
    const aggregated = getAggregatedBarsForTimeframe({
      bars,
      barsFingerprint,
      signalTimeframe,
      aggregatedBarsCache,
    });
    const signalBars = aggregated.signalBars;
    const signalTfMin = aggregated.signalTfMin;
    if (!signalBars || signalBars.length < MIN_SIGNAL_BARS) {
      continue;
    }
    const shadingTimeframe = deriveRecommendedShadingTimeframe(signalTimeframe, supportedSignalTimeframes);

    for (const timeHorizon of timeHorizons) {
      for (const bosConfirmation of bosModes) {
        for (const bandProfile of bandProfiles) {
          const candidateSettings = mergeRayAlgoSettings(normalizedSettings, {
            marketStructure: {
              timeHorizon,
              bosConfirmation,
            },
            bands: bandProfile.settings,
          });
          const windowSummaries = [];
          let weightedScore = 0;
          let weightTotal = 0;

          for (let index = 0; index < WATCHER_WINDOW_SESSIONS.length; index += 1) {
            const sessions = WATCHER_WINDOW_SESSIONS[index];
            const weight = WATCHER_WINDOW_WEIGHTS[index] || 0;
            const windowBars = sliceBarsByRecentSessions(signalBars, sessions);
            if (windowBars.length < MIN_SIGNAL_BARS / 2) {
              continue;
            }
            const windowRegimes = detectBacktestRegimes(windowBars);
            const run = runBacktestRuntime(windowBars, windowRegimes, {
              ...baseRunConfig,
              tfMin: signalTfMin,
              rayalgoSettings: candidateSettings,
            });
            const metrics = computeBacktestMetrics(run.trades || [], capital);
            const score = scoreWatcherMetrics(metrics);
            windowSummaries.push({
              sessions,
              score,
              metrics,
            });
            if (score > 0) {
              weightedScore += score * weight;
              weightTotal += weight;
            }
          }

          if (!windowSummaries.length || weightTotal <= 0) {
            continue;
          }

          const averageScore = weightedScore / weightTotal;
          const scoreValues = windowSummaries.map((entry) => entry.score);
          const scoreMean = scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length;
          const scoreVariance = scoreValues.reduce((sum, value) => sum + (value - scoreMean) ** 2, 0) / scoreValues.length;
          const stabilityPenalty = 1 - Math.min(Math.sqrt(scoreVariance) / Math.max(scoreMean, 0.0001), 0.35) * 0.12;
          const primaryWindow = windowSummaries[0]?.metrics || windowSummaries[windowSummaries.length - 1]?.metrics || null;
          const finalScore = +(averageScore * stabilityPenalty).toFixed(4);
          if (finalScore <= 0) {
            continue;
          }

          candidates.push({
            signalTimeframe,
            shadingTimeframe,
            rayalgoSettings: candidateSettings,
            score: finalScore,
            primaryMetrics: primaryWindow,
            windows: windowSummaries,
            signature: JSON.stringify({
              signalTimeframe,
              shadingTimeframe,
              settings: candidateSettings,
            }),
          });
        }
      }
    }
  }

  const ranked = candidates.sort((left, right) => right.score - left.score);
  const leader = ranked[0] || null;
  const runnerUp = ranked[1] || null;
  const confidenceLabel = summarizeWatcherConfidence(leader, runnerUp);
  const completedAt = Date.now();

  return {
    status: "ready",
    error: null,
    lastRunAt: completedAt,
    lastDurationMs: completedAt - startedAt,
    leader: leader
      ? {
          ...leader,
          confidenceLabel,
          summaryLabel: buildWatcherLeaderSummary(leader),
        }
      : null,
    runnerUp,
    candidateCount: ranked.length,
    freshnessLabel: "Fresh",
  };
}
