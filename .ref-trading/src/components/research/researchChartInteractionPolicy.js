const USER_RANGE_SOURCES = new Set(["user", "chart-drag", "chart-wheel"]);
const INTERNAL_RANGE_SOURCES = new Set(["preset", "data", "range-recovery", "selection-lock", "selection", "resize"]);

export function isUserRangeSource(source) {
  const normalized = String(source || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (USER_RANGE_SOURCES.has(normalized)) {
    return true;
  }
  if (INTERNAL_RANGE_SOURCES.has(normalized) || normalized.startsWith("link:")) {
    return false;
  }
  return false;
}

export function isOlderHistoryIntentSource(source) {
  return String(source || "").trim().toLowerCase() === "chart-drag";
}

export function isDeferredPresentationSource(source) {
  const normalized = String(source || "").trim().toLowerCase();
  return normalized === "chart-wheel" || normalized === "chart-drag";
}

export function resolveDeferredPresentationDelayMs(source, delays = {}) {
  const normalized = String(source || "").trim().toLowerCase();
  if (normalized === "chart-wheel") {
    return Math.max(0, Number(delays.wheelDelayMs) || 0);
  }
  if (normalized === "chart-drag") {
    return Math.max(0, Number(delays.dragDelayMs) || 0);
  }
  return Math.max(0, Number(delays.defaultDelayMs) || 0);
}

export function shouldReassertVisibleRangeOnIdle(source) {
  void source;
  return false;
}

export function shouldDeferRenderWindowRefreshUntilIdle(source) {
  const normalized = String(source || "").trim().toLowerCase();
  return normalized === "chart-drag" || normalized === "chart-wheel";
}

export function shouldDeferVisibleRangeClampUntilIdle({
  isProgrammaticUpdate = false,
  interactionOwner = "preset",
  interactionSource = "",
} = {}) {
  if (isProgrammaticUpdate) {
    return false;
  }
  if (String(interactionOwner || "").trim().toLowerCase() !== "user") {
    return false;
  }
  return isDeferredPresentationSource(interactionSource);
}

export function shouldTreatVisibleRangeChangeAsActiveUserInteraction({
  isProgrammaticUpdate = false,
  interactionOwner = "preset",
  interactionSource = "",
} = {}) {
  if (isProgrammaticUpdate) {
    return false;
  }
  if (String(interactionOwner || "").trim().toLowerCase() !== "user") {
    return false;
  }
  return isUserRangeSource(interactionSource);
}
