import { isOlderHistoryIntentSource } from "./researchChartInteractionPolicy.js";

export function resolveOlderHistoryPrefetchDecision({
  visibleRange = null,
  barCount = 0,
  oldestBarTime = 0,
  currentIntentSource = "",
  currentIntentAgeMs = Number.POSITIVE_INFINITY,
  userRangeIntentMaxAgeMs = 0,
  edgeTriggerBars = 0,
  blocked = false,
  lastRequestKey = "",
} = {}) {
  const safeBarCount = Math.max(0, Number(barCount) || 0);
  if (!safeBarCount || !visibleRange) {
    return { action: "none" };
  }

  const visibleStart = Number(visibleRange?.from);
  const visibleEnd = Number(visibleRange?.to);
  if (!Number.isFinite(visibleStart) || !Number.isFinite(visibleEnd)) {
    return { action: "none" };
  }

  const visibleSpanBars = Math.max(1, Math.ceil(visibleEnd) - Math.floor(visibleStart) + 1);
  const prefetchTriggerBars = Math.max(
    Math.max(0, Number(edgeTriggerBars) || 0),
    Math.ceil(visibleSpanBars * 0.35),
  );
  const releaseTriggerBars = prefetchTriggerBars + 16;

  if (visibleStart > releaseTriggerBars) {
    return {
      action: "release",
      requestKey: "",
    };
  }

  if (visibleStart > prefetchTriggerBars) {
    return { action: "none" };
  }

  if (!isOlderHistoryIntentSource(currentIntentSource)) {
    return { action: "none" };
  }

  if (Math.max(0, Number(currentIntentAgeMs) || 0) > Math.max(0, Number(userRangeIntentMaxAgeMs) || 0)) {
    return { action: "none" };
  }

  if (blocked) {
    return { action: "none" };
  }

  const nextRequestKey = `${Number(oldestBarTime) || 0}:${safeBarCount}`;
  if (nextRequestKey === String(lastRequestKey || "")) {
    return { action: "none" };
  }

  return {
    action: "request",
    requestKey: nextRequestKey,
    oldestBarTime: Number(oldestBarTime) || 0,
    visibleRange,
  };
}

export function resolveOlderHistoryRequestSettleState({
  requestKey = "",
  currentRequestKey = "",
  didFail = false,
} = {}) {
  return {
    blocked: false,
    requestKey: didFail && String(currentRequestKey || "") === String(requestKey || "")
      ? ""
      : String(currentRequestKey || ""),
  };
}
