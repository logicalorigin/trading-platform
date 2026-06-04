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

const IBKR_LAUNCH_UPDATE_STEP = {
  id: "update",
  label: "Update",
  icon: "refresh",
  motion: "spin",
};

export const IBKR_DEACTIVATE_OPERATION_STEPS = [
  { id: "queue", label: "Queue", icon: "clock", motion: "queue" },
  { id: "detach", label: "Detach", icon: "unplug", motion: "detach" },
  { id: "refresh", label: "Refresh", icon: "refresh", motion: "spin" },
  { id: "desktop", label: "Desktop", icon: "power", motion: "power" },
];

const LAUNCH_STEP_PHASES = {
  request: new Set([
    "checking_gateway_socket",
    "helper_launched",
    "helper_launch_requested",
    "queued_on_pyrus",
    "waiting_desktop_agent",
  ]),
  update: new Set([
    "helper_updated",
    "updating_helper",
  ]),
  credentials: new Set([
    "autologin_preflight",
    "credentials_delivered",
    "credentials_received",
    "credentials_sent_to_pyrus",
    "encrypting_credentials",
    "waiting_secure_credentials",
  ]),
  gateway: new Set([
    "credentials_submitted",
    "gateway_foreground_fallback",
    "gateway_login_window_active",
    "gateway_login_window_unconfirmed",
    "gateway_login_window_wait",
    "gateway_login_window_waiting",
    "gateway_process_started",
    "gateway_ready",
    "gateway_running_waiting_login",
    "gateway_running_waiting_socket",
    "gateway_socket_ready",
    "gateway_window_login",
    "launching_gateway",
    "starting_gateway",
    "starting_ibc",
    "typing_gateway_credentials",
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

const HELPER_UPDATE_PROGRESS_STEPS = LAUNCH_STEP_PHASES.update;

const LAUNCH_ACTION_LABEL_BY_STEP = {
  autologin_preflight: "Preparing handoff",
  bridge_bundle_fallback: "Preparing bridge",
  bridge_bundle_ready: "Preparing bridge",
  bridge_reused: "Starting bridge",
  bridge_restart_for_bundle: "Restarting bridge",
  bridge_unhealthy: "Checking bridge",
  building_bridge: "Building bridge",
  checking_gateway_socket: "Checking Gateway",
  cloning_repo: "Preparing bridge",
  connected: "Connected",
  credentials_delivered: "Credentials sent",
  credentials_received: "Credentials sent",
  credentials_sent_to_pyrus: "Credentials sent",
  credentials_submitted: "Waiting for 2FA",
  downloading_bridge_bundle: "Downloading bridge",
  encrypting_credentials: "Encrypting",
  gateway_login_window_active: "Typing credentials",
  gateway_login_window_unconfirmed: "Check Gateway",
  gateway_login_window_wait: "Finding Gateway",
  gateway_login_window_waiting: "Finding Gateway",
  gateway_process_started: "Opening Gateway",
  gateway_ready: "Gateway ready",
  gateway_reconnect_required: "Reconnecting Gateway",
  gateway_running_waiting_login: "Finding Gateway",
  gateway_running_waiting_socket: "Checking Gateway",
  gateway_socket_ready: "Starting bridge",
  gateway_window_login: "Logging in",
  helper_launched: "Launching helper",
  helper_launch_requested: "Opening helper",
  helper_updated: "Updating helper",
  installing_dependencies: "Preparing bridge",
  installing_prerequisite: "Installing helper",
  launching_gateway: "Opening Gateway",
  local_bridge_ready: "Starting tunnel",
  preparing_bridge: "Preparing bridge",
  queued_on_pyrus: "Queued",
  retrying_tunnel: "Retrying tunnel",
  sidecar_ready: "Starting bridge",
  sidecar_restart_for_helper: "Restarting sidecar",
  starting_bridge: "Starting bridge",
  starting_gateway: "Opening Gateway",
  starting_ibc: "Starting Gateway",
  starting_sidecar: "Starting sidecar",
  starting_tunnel: "Starting tunnel",
  tunnel_reused: "Validating tunnel",
  typing_gateway_credentials: "Typing credentials",
  updating_helper: "Updating helper",
  updating_repo: "Preparing bridge",
  validating_tunnel: "Validating tunnel",
  waiting_2fa: "Waiting for 2FA",
  waiting_bridge_gateway_api: "Connecting bridge",
  waiting_desktop_agent: "Waiting desktop",
  waiting_secure_credentials: "Waiting credentials",
  waiting_tunnel_dns: "Waiting tunnel DNS",
};

export const getIbkrLaunchActionProgressLabel = ({
  activationStatus,
  busy = false,
  fallback = "Preparing",
  inFlight = false,
} = {}) => {
  const recentProgress = normalizeProgressEvents(activationStatus?.recentProgress);
  const latestProgress =
    activationStatus?.latestProgress || recentProgress.at(-1) || null;
  const latestStep = String(latestProgress?.step || "");
  if (latestStep && LAUNCH_ACTION_LABEL_BY_STEP[latestStep]) {
    return LAUNCH_ACTION_LABEL_BY_STEP[latestStep];
  }

  const latestStatus = String(latestProgress?.status || "");
  if (latestStatus === "starting_tunnel") {
    return "Starting tunnel";
  }
  if (latestStatus === "starting_bridge") {
    return "Starting bridge";
  }
  if (latestStatus === "waiting_gateway") {
    return "Checking Gateway";
  }
  if (latestStatus === "connected") {
    return "Connected";
  }
  if (inFlight) {
    return "Launching";
  }
  if (busy) {
    return fallback;
  }
  return fallback;
};

const getLaunchOperationSteps = (events) => {
  const shouldShowUpdate = events.some((event) =>
    HELPER_UPDATE_PROGRESS_STEPS.has(String(event?.step || "")),
  );
  if (!shouldShowUpdate) {
    return IBKR_LAUNCH_OPERATION_STEPS;
  }

  return [
    IBKR_LAUNCH_OPERATION_STEPS[0],
    IBKR_LAUNCH_UPDATE_STEP,
    ...IBKR_LAUNCH_OPERATION_STEPS.slice(1),
  ];
};

const getLaunchStepIndex = (steps) =>
  new Map(steps.map((step, index) => [step.id, index]));

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

const getLatestLaunchPhaseIndex = (events, steps) => {
  if (!events.length) {
    return 0;
  }
  const stepIndex = getLaunchStepIndex(steps);
  const latestEvent = events.at(-1);
  const latestPhase = getProgressStepPhase(latestEvent);
  const lastUpdateIndex = events.findLastIndex((event) =>
    HELPER_UPDATE_PROGRESS_STEPS.has(String(event?.step || "")),
  );
  if (
    lastUpdateIndex >= 0 &&
    lastUpdateIndex < events.length - 1 &&
    latestPhase === "request" &&
    stepIndex.has("credentials")
  ) {
    return stepIndex.get("credentials");
  }

  return Math.max(
    0,
    ...events.map((event) => stepIndex.get(getProgressStepPhase(event)) ?? 0),
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
  const launchSteps = getLaunchOperationSteps(progressEvents);
  const latestPhaseIndex = getLatestLaunchPhaseIndex(progressEvents, launchSteps);
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
      steps: launchSteps.map((step) => ({
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
    steps: buildSteps(launchSteps, latestPhaseIndex, terminalStatus),
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
  const steps = IBKR_DEACTIVATE_OPERATION_STEPS.map((step) => ({
    ...step,
    status: statusById[step.id],
  }));
  const activeStep =
    [...steps].reverse().find((step) => step.status === "current") || null;
  const activityByStepId = {
    queue: {
      detail: "Sending the shutdown request to the paired Windows desktop.",
      label: "Queueing Windows shutdown",
    },
    detach: {
      detail: "Clearing the active bridge runtime and persisted session handoff.",
      label: "Detaching backend runtime",
    },
    refresh: {
      detail: "Refreshing session, runtime diagnostics, and line usage state.",
      label: "Refreshing connection state",
    },
    desktop: {
      detail: "Waiting for the desktop helper to close IB Gateway.",
      label: "Stopping IB Gateway",
    },
  };

  return {
    activity: activeStep
      ? {
          ...activeStep,
          ...(activityByStepId[activeStep.id] || {}),
        }
      : null,
    operation: "deactivate",
    title: "Deactivate IBKR",
    latestMessage: message,
    steps,
  };
};
