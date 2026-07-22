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

  const bridgeStrictReady = Boolean(
    bridge?.authenticated &&
      bridge?.strictReady === true &&
      bridge?.healthFresh !== false &&
      bridge?.streamFresh !== false,
  );

  const lanePressures = schedulerLanePressures(bridge);
  const laneStalled = lanePressures.some(
    (pressure) => pressure === WORK_PRESSURE_STATE.stalled,
  );
  const laneBackoff = lanePressures.some(
    (pressure) => pressure === WORK_PRESSURE_STATE.backoff,
  );
  const laneDegraded = lanePressures.some(
    (pressure) => pressure === WORK_PRESSURE_STATE.degraded,
  );

  // A single scheduler lane (account, historical, option-metadata, ...) reporting
  // stalled/backoff must NOT collapse ALL realtime IBKR work to stalled when the
  // core bridge is strict-ready (authenticated + health + stream fresh). The realtime
  // quote path runs on its own healthy lanes; killing it because the option-metadata
  // or account lane is lagging blacks out live data off an unrelated, often-stale
  // lane flag. While the bridge core is strict-ready, cap lane-driven pressure at
  // "degraded" (foreground/realtime still allowed, only background is held); let lanes
  // escalate to backoff/stalled only when the bridge core is itself not strict-ready.
  if (bridgeStrictReady) {
    return laneStalled || laneBackoff || laneDegraded
      ? WORK_PRESSURE_STATE.degraded
      : WORK_PRESSURE_STATE.normal;
  }

  if (laneStalled) {
    return WORK_PRESSURE_STATE.stalled;
  }
  if (laneBackoff) {
    return WORK_PRESSURE_STATE.backoff;
  }
  if (laneDegraded) {
    return WORK_PRESSURE_STATE.degraded;
  }

  const errorText = normalizeText(
    [bridge?.lastError, bridge?.strictReason, bridge?.streamStateReason]
      .filter(Boolean)
      .join(" "),
  );

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
