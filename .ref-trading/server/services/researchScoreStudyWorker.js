import { parentPort, workerData } from "node:worker_threads";

import { buildRayAlgoScoreStudy } from "../../src/research/analysis/rayalgoScoreStudy.js";
import { resolveResearchSpotHistory } from "./researchSpotHistory.js";

function serializeWorkerError(error) {
  if (!error) {
    return "Score-study worker failed.";
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return "Score-study worker failed.";
}

try {
  const requestPayload = workerData?.requestPayload && typeof workerData.requestPayload === "object"
    ? workerData.requestPayload
    : {};
  const marketSymbol = requestPayload.marketSymbol || workerData?.marketSymbol || "SPY";
  parentPort?.postMessage({
    type: "progress",
    progress: {
      stage: "hydrating-bars",
      detail: `Loading research bars for ${String(marketSymbol || "SPY").toUpperCase()}.`,
      pct: 12,
    },
  });
  const history = await resolveResearchSpotHistory({
    symbol: marketSymbol,
    apiKey: workerData?.apiKey || "",
    mode: requestPayload.mode || "full",
    initialDays: requestPayload.initialDays || 60,
    preferredTf: requestPayload.preferredTf || "1m",
  });
  const bars = Array.isArray(history?.intradayBars) ? history.intradayBars : [];
  if (!bars.length) {
    throw new Error(history?.error || `No spot bars returned for ${marketSymbol}.`);
  }
  parentPort?.postMessage({
    type: "progress",
    progress: {
      stage: "running-score-study",
      detail: `Loaded ${bars.length.toLocaleString()} bars. Building the score study.`,
      pct: 34,
      barCount: bars.length,
    },
  });
  const result = buildRayAlgoScoreStudy({
    marketSymbol,
    bars,
    rayalgoSettings: requestPayload.rayalgoSettings || workerData?.rayalgoSettings || null,
    rayalgoScoringConfig: requestPayload.rayalgoScoringConfig || workerData?.rayalgoScoringConfig || null,
    timeframes: Array.isArray(requestPayload?.timeframes) ? requestPayload.timeframes : (Array.isArray(workerData?.timeframes) ? workerData.timeframes : []),
    includeAdvancedDiagnostics: Boolean(requestPayload?.includeAdvancedDiagnostics || workerData?.includeAdvancedDiagnostics),
    onProgress: (progress = {}) => {
      parentPort?.postMessage({
        type: "progress",
        progress: {
          barCount: bars.length,
          ...(progress && typeof progress === "object" ? progress : {}),
        },
      });
    },
  });
  parentPort?.postMessage({
    type: "result",
    result: {
      scoreStudy: result,
      history: {
        dataSource: history?.dataSource || null,
        meta: history?.meta || null,
        barCount: bars.length,
      },
    },
  });
} catch (error) {
  parentPort?.postMessage({
    type: "error",
    error: serializeWorkerError(error),
  });
  process.exitCode = 1;
}
