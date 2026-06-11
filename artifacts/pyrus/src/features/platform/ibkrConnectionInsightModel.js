const OWNER_LABELS = Object.freeze({
  cloudflareTunnel: "Tunnel",
  desktopHelper: "Windows helper",
  ibGateway: "IB Gateway",
  ibkrMobile: "IBKR Mobile",
  none: "",
  pyrus: "Pyrus",
  user: "You",
});

const PHASE_LABELS = Object.freeze({
  bridge: "Bridge",
  canceled: "Canceled",
  complete: "Connected",
  credentials: "Credentials",
  error: "Error",
  gateway: "Gateway",
  idle: "Idle",
  request: "Request",
  tunnel: "Tunnel",
  twoFactor: "2FA",
  update: "Update",
});

const TIMELINE_STATUS_LABELS = Object.freeze({
  active: "Active",
  attention: "Attention",
  canceled: "Canceled",
  complete: "Done",
  error: "Error",
  pending: "Pending",
});

const TIMELINE_STATUS_TONES = Object.freeze({
  active: "progress",
  attention: "attention",
  canceled: "error",
  complete: "success",
  error: "error",
  pending: "idle",
});

const normalizeFiniteNumber = (value) => {
  if (value == null || value === "") {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

export const formatIbkrInsightElapsed = (elapsedMs) => {
  const normalized = normalizeFiniteNumber(elapsedMs);
  if (normalized == null) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.floor(normalized / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
};

const getPhaseStartedAtMs = (insight) => {
  const ms =
    typeof insight?.currentPhaseStartedAt === "string"
      ? new Date(insight.currentPhaseStartedAt).getTime()
      : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
};

const getOwnerLabel = (owner) =>
  OWNER_LABELS[owner] || (owner ? String(owner) : "");

const getPhaseLabel = (phase) =>
  PHASE_LABELS[phase] || (phase ? String(phase) : "");

const normalizeTimelineRows = (rows = []) =>
  Array.isArray(rows)
    ? rows
        .filter((row) => row && typeof row === "object")
        .map((row) => ({
          elapsedLabel: formatIbkrInsightElapsed(row.elapsedMs),
          id: String(row.id || ""),
          label: row.label || getPhaseLabel(row.id),
          ownerLabel: getOwnerLabel(row.owner),
          status: row.status || "pending",
          statusLabel:
            TIMELINE_STATUS_LABELS[row.status] || String(row.status || "Pending"),
          tone: TIMELINE_STATUS_TONES[row.status] || "idle",
        }))
    : [];

const buildFromInsight = ({ insight }) => {
  const ownerLabel = getOwnerLabel(insight.currentOwner);
  const phaseLabel = getPhaseLabel(insight.currentPhase);
  // currentPhaseStartedAtMs is used by the leaf IbkrInsightElapsedLabel component to
  // compute elapsed in its own interval — keeping it out of the model prevents the
  // entire insight model (and stepper subtree) from rebuilding every second.
  const currentPhaseStartedAtMs = getPhaseStartedAtMs(insight);
  const staticElapsedLabel = currentPhaseStartedAtMs === null
    ? formatIbkrInsightElapsed(normalizeFiniteNumber(insight?.currentPhaseElapsedMs))
    : null;
  const waiting = Boolean(
    ownerLabel &&
      insight.severity !== "idle" &&
      insight.severity !== "success" &&
      insight.currentPhase !== "complete",
  );

  return {
    action: insight.recommendedAction || null,
    currentPhaseStartedAtMs,
    detail: insight.detail || "",
    elapsedLabel: staticElapsedLabel,
    ownerLabel,
    phaseLabel,
    stale: Boolean(insight.stale),
    statusLine: waiting ? `Waiting on ${ownerLabel}` : phaseLabel,
    timelineRows: normalizeTimelineRows(insight.timeline),
    title: insight.title || phaseLabel || "IBKR launch",
    tone: insight.severity || "progress",
  };
};

const buildFallback = ({
  bridgeOperationModel,
  busy,
  cancelInFlight,
  error,
  inFlight,
}) => {
  const errorMessage =
    error instanceof Error ? error.message : error ? String(error) : null;
  if (errorMessage) {
    return {
      action: "Check the latest launch message, then retry when the current attempt settles.",
      detail: errorMessage,
      elapsedLabel: null,
      ownerLabel: "Pyrus",
      phaseLabel: "Error",
      stale: true,
      statusLine: "Needs attention",
      timelineRows: [],
      title: "Launch error",
      tone: "error",
    };
  }

  if (cancelInFlight) {
    return {
      action: null,
      detail: "Pyrus is canceling the active IBKR launch.",
      elapsedLabel: null,
      ownerLabel: "Pyrus",
      phaseLabel: "Canceled",
      stale: false,
      statusLine: "Canceling launch",
      timelineRows: [],
      title: "Canceling launch",
      tone: "progress",
    };
  }

  if (!busy && !inFlight && !bridgeOperationModel) {
    return null;
  }

  return {
    action: null,
    detail:
      bridgeOperationModel?.latestMessage ||
      "Pyrus is preparing the IBKR launch request.",
    elapsedLabel: null,
    ownerLabel: "Pyrus",
    phaseLabel: "Request",
    stale: false,
    statusLine: "Preparing request",
    timelineRows: [],
    title: "Preparing IBKR launch",
    tone: "progress",
  };
};

export const buildIbkrConnectionInsightModel = ({
  activationStatus,
  bridgeOperationModel = null,
  busy = false,
  cancelInFlight = false,
  error = null,
  gatewayConnected = false,
  inFlight = false,
} = {}) => {
  const insight = activationStatus?.insight;
  if (
    gatewayConnected &&
    !busy &&
    !inFlight &&
    !cancelInFlight &&
    insight?.severity !== "error"
  ) {
    return null;
  }
  if (insight?.currentPhase === "complete" && insight.severity === "success") {
    return null;
  }

  if (insight && typeof insight === "object") {
    return buildFromInsight({ insight });
  }

  return buildFallback({
    bridgeOperationModel,
    busy,
    cancelInFlight,
    error,
    inFlight,
  });
};
