const STEP_STATUS_SET = new Set([
  "pending",
  "current",
  "complete",
  "warning",
  "error",
  "canceled",
]);

export const IBKR_LAUNCH_OPERATION_STEPS = [
  { id: "request", label: "Request", icon: "send", motion: "dispatch" },
  { id: "credentials", label: "Credentials", icon: "key", motion: "secure" },
  { id: "gateway", label: "Gateway", icon: "monitor", motion: "boot" },
  { id: "bridge", label: "Bridge", icon: "cable", motion: "link" },
  { id: "tunnel", label: "Tunnel", icon: "network", motion: "tunnel" },
];

export const IBKR_DEACTIVATE_OPERATION_STEPS = [
  { id: "queue", label: "Queue", icon: "clock", motion: "queue" },
  { id: "detach", label: "Detach", icon: "unplug", motion: "detach" },
  { id: "refresh", label: "Refresh", icon: "refresh", motion: "spin" },
  { id: "desktop", label: "Desktop", icon: "power", motion: "power" },
];

const LAUNCH_STEP_PHASES = {
  request: new Set([
    "helper_launched",
    "waiting_secure_credentials",
  ]),
  credentials: new Set([
    "autologin_preflight",
    "credentials_delivered",
    "credentials_submitted",
    "gateway_foreground_fallback",
    "gateway_login_window_active",
    "gateway_login_window_wait",
    "gateway_login_window_waiting",
    "gateway_window_login",
    "typing_gateway_credentials",
  ]),
  gateway: new Set([
    "checking_gateway_socket",
    "gateway_process_started",
    "gateway_ready",
    "gateway_running_waiting_login",
    "gateway_running_waiting_socket",
    "gateway_socket_ready",
    "launching_gateway",
    "starting_gateway",
    "starting_ibc",
    "waiting_2fa",
  ]),
  bridge: new Set([
    "bridge_bundle_fallback",
    "bridge_bundle_ready",
    "bridge_reused",
    "bridge_restart_for_bundle",
    "bridge_unhealthy",
    "building_bridge",
    "cloning_repo",
    "downloading_bridge_bundle",
    "gateway_reconnect_required",
    "installing_dependencies",
    "local_bridge_ready",
    "preparing_bridge",
    "starting_bridge",
    "updating_repo",
    "waiting_bridge_gateway_api",
  ]),
  tunnel: new Set([
    "connected",
    "retrying_tunnel",
    "starting_tunnel",
    "tunnel_reused",
    "validating_tunnel",
    "waiting_tunnel_dns",
  ]),
};

const LAUNCH_STEP_INDEX = new Map(
  IBKR_LAUNCH_OPERATION_STEPS.map((step, index) => [step.id, index]),
);

const normalizeStatus = (value, fallback = "pending") =>
  STEP_STATUS_SET.has(value) ? value : fallback;

const normalizeProgressEvents = (events) =>
  Array.isArray(events)
    ? events.filter((event) => event && typeof event === "object")
    : [];

const getProgressStepPhase = (event) => {
  const step = String(event?.step || "");
  for (const [phase, steps] of Object.entries(LAUNCH_STEP_PHASES)) {
    if (steps.has(step)) {
      return phase;
    }
  }
  if (String(event?.status || "") === "connected") {
    return "tunnel";
  }
  if (String(event?.status || "") === "starting_tunnel") {
    return "tunnel";
  }
  if (String(event?.status || "") === "starting_bridge") {
    return "bridge";
  }
  if (String(event?.status || "") === "waiting_gateway") {
    return "gateway";
  }
  return "request";
};

const getLatestLaunchPhaseIndex = (events) => {
  if (!events.length) {
    return 0;
  }
  return Math.max(
    0,
    ...events.map((event) => LAUNCH_STEP_INDEX.get(getProgressStepPhase(event)) ?? 0),
  );
};

const buildSteps = (definitions, currentIndex, terminalStatus = null) =>
  definitions.map((step, index) => ({
    ...step,
    status:
      terminalStatus && index === currentIndex
        ? terminalStatus
        : index < currentIndex
          ? "complete"
          : index === currentIndex
            ? "current"
            : "pending",
  }));

export const buildIbkrLaunchOperationStepper = ({
  activationStatus,
  canceled = false,
  error = null,
  gatewayConnected = false,
  inFlight = false,
  message = null,
} = {}) => {
  const recentProgress = normalizeProgressEvents(activationStatus?.recentProgress);
  const latestProgress =
    activationStatus?.latestProgress || recentProgress.at(-1) || null;
  const progressEvents = latestProgress
    ? [...recentProgress, latestProgress]
    : recentProgress;
  const latestPhaseIndex = getLatestLaunchPhaseIndex(progressEvents);
  const latestStatus = String(latestProgress?.status || "");
  const latestStep = String(latestProgress?.step || "");
  const canceledState =
    canceled ||
    activationStatus?.canceled === true ||
    latestStatus === "canceled" ||
    latestStep === "cancel_requested";
  const errorState = Boolean(error || latestStatus === "error" || latestStep === "error");
  const connectedState =
    gatewayConnected ||
    latestStatus === "connected" ||
    latestStep === "connected";
  const latestMessage =
    message ||
    (error instanceof Error ? error.message : error ? String(error) : null) ||
    latestProgress?.message ||
    (inFlight
      ? "IB Gateway activation is running from the Windows helper."
      : null);

  if (connectedState) {
    const connectedProgressMessage =
      latestStatus === "connected" || latestStep === "connected"
        ? latestProgress?.message
        : null;
    const connectedMessage =
      connectedProgressMessage ||
      (!errorState && !canceledState ? message : null) ||
      "IB Gateway bridge attached.";
    return {
      operation: "launch",
      title: "Connect IBKR",
      latestMessage: connectedMessage,
      steps: IBKR_LAUNCH_OPERATION_STEPS.map((step) => ({
        ...step,
        status: "complete",
      })),
    };
  }

  const terminalStatus = errorState ? "error" : canceledState ? "canceled" : null;
  return {
    operation: "launch",
    title: "Connect IBKR",
    latestMessage,
    steps: buildSteps(IBKR_LAUNCH_OPERATION_STEPS, latestPhaseIndex, terminalStatus),
  };
};

export const buildIbkrDeactivateOperationStepper = ({
  desktop = "pending",
  detach = "pending",
  message = null,
  queue = "pending",
  refresh = "pending",
} = {}) => {
  const statusById = {
    queue: normalizeStatus(queue),
    detach: normalizeStatus(detach),
    refresh: normalizeStatus(refresh),
    desktop: normalizeStatus(desktop),
  };
  return {
    operation: "deactivate",
    title: "Deactivate IBKR",
    latestMessage: message,
    steps: IBKR_DEACTIVATE_OPERATION_STEPS.map((step) => ({
      ...step,
      status: statusById[step.id],
    })),
  };
};
