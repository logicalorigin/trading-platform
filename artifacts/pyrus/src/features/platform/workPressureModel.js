export const WORK_PRESSURE_STATE = Object.freeze({
  normal: "normal",
  degraded: "degraded",
  backoff: "backoff",
  stalled: "stalled",
});

const normalizeText = (value) => String(value || "").toLowerCase();

const schedulerLanePressures = (bridge = null) => {
  const scheduler = bridge?.bridgeDiagnostics?.scheduler;
  if (!scheduler || typeof scheduler !== "object") {
    return [];
  }
  return Object.values(scheduler)
    .map((lane) => normalizeText(lane?.pressure))
    .filter(Boolean);
};

export const resolveIbkrWorkPressure = (bridge = null) => {
  if (!bridge?.configured && !bridge?.authenticated) {
    return WORK_PRESSURE_STATE.normal;
  }

  const lanePressures = schedulerLanePressures(bridge);
  if (lanePressures.some((pressure) => pressure === WORK_PRESSURE_STATE.stalled)) {
    return WORK_PRESSURE_STATE.stalled;
  }
  if (lanePressures.some((pressure) => pressure === WORK_PRESSURE_STATE.backoff)) {
    return WORK_PRESSURE_STATE.backoff;
  }
  if (lanePressures.some((pressure) => pressure === WORK_PRESSURE_STATE.degraded)) {
    return WORK_PRESSURE_STATE.degraded;
  }

  const bridgeStrictReady = Boolean(
    bridge?.authenticated &&
      bridge?.strictReady === true &&
      bridge?.healthFresh !== false &&
      bridge?.streamFresh !== false,
  );
  const errorText = normalizeText(
    [bridge?.lastError, bridge?.strictReason, bridge?.streamStateReason]
      .filter(Boolean)
      .join(" "),
  );

  if (!bridgeStrictReady) {
    if (
      errorText.includes("stalled") ||
      errorText.includes("timed out") ||
      errorText.includes("queue full")
    ) {
      return WORK_PRESSURE_STATE.stalled;
    }

    if (
      errorText.includes("backed off") ||
      errorText.includes("backoff") ||
      errorText.includes("lane queue")
    ) {
      return WORK_PRESSURE_STATE.backoff;
    }
  }

  if (
    bridge?.stale ||
    bridge?.healthFresh === false ||
    bridge?.streamFresh === false ||
    bridge?.strictReady === false
  ) {
    return WORK_PRESSURE_STATE.degraded;
  }

  return WORK_PRESSURE_STATE.normal;
};

export const isForegroundWorkAllowed = (pressure) =>
  pressure === WORK_PRESSURE_STATE.normal ||
  pressure === WORK_PRESSURE_STATE.degraded;

export const isBackgroundWorkAllowed = (pressure) =>
  pressure === WORK_PRESSURE_STATE.normal;

export const toHydrationPressureState = (pressure) => {
  if (pressure === WORK_PRESSURE_STATE.stalled) return "stalled";
  if (pressure === WORK_PRESSURE_STATE.backoff) return "backoff";
  if (pressure === WORK_PRESSURE_STATE.degraded) return "degraded";
  return "normal";
};
