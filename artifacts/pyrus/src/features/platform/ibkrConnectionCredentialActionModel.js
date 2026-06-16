export const resolveIbkrCredentialActionState = ({
  activationId = null,
  directActivationShouldReplaceCurrentLaunch = false,
  gatewayConnected = false,
  launchInFlight = false,
  managementToken = null,
  runtimeActivationActive = false,
} = {}) => {
  // A launch counts as "active" for resume/cancel ONLY when the client has a launch
  // currently in flight OR the backend still reports the activation as active. We
  // deliberately do NOT trust a bare client-side "activation active" flag here: that
  // flag (bridgeActivationActive) is not reset when the API process restarts, so with
  // the tab left open a stale activationId in sessionStorage made resume look
  // available and the credential submit tried to deliver to a dead activation —
  // hanging the reconnect at "waiting desktop". This mirrors
  // shouldAutoResumeIbkrCredentials below, which already requires runtimeActivationActive.
  const activeLaunch = Boolean(launchInFlight || runtimeActivationActive);
  const launchCancelable = Boolean(
    !gatewayConnected &&
      activationId &&
      managementToken &&
      activeLaunch,
  );
  const resumeAvailable = Boolean(
    !directActivationShouldReplaceCurrentLaunch &&
      !gatewayConnected &&
      activationId &&
      managementToken &&
      activeLaunch,
  );

  return {
    launchCancelable,
    primaryBlockedByActiveLaunch: Boolean(
      launchCancelable &&
        !resumeAvailable &&
        !directActivationShouldReplaceCurrentLaunch,
    ),
    resumeAvailable,
  };
};

export const resolveIbkrBridgeProcessActions = ({
  bridgeDeactivationComplete = false,
  bridgeLaunchCancelable = false,
  bridgeLaunchInFlight = false,
  bridgeManagementToken = null,
  bridgeRuntimeOverrideActive = false,
  gatewayConnectedForBridge = false,
  runtime = null,
} = {}) => {
  const hasManagementToken = Boolean(bridgeManagementToken);
  const hasRuntimeOverride = Boolean(
    bridgeRuntimeOverrideActive || runtime?.runtimeOverrideActive === true,
  );
  const hasBridgeProof = Boolean(
    gatewayConnectedForBridge ||
      runtime?.bridgeReachable === true ||
      runtime?.socketConnected === true ||
      runtime?.connected === true ||
      runtime?.authenticated === true,
  );
  const hasManagedTeardownTarget = Boolean(
    hasManagementToken && (hasRuntimeOverride || hasBridgeProof) && !bridgeLaunchInFlight,
  );
  // An active runtime override must ALWAYS be clearable from the UI, even when the
  // bridge looks disconnected or its health/proof fields are absent (e.g. the
  // session response stripped the passthrough fields, or the override points at a
  // now-dead bridge). Previously this also required hasBridgeProof, which stranded
  // the user with a silently no-op deactivate control and no way to clear a stale
  // override. The backend exposes a force-clear for exactly this case.
  const hasOverrideCleanupTarget = Boolean(
    !hasManagementToken && hasRuntimeOverride && !bridgeLaunchInFlight,
  );

  return {
    cancelLaunchAction: bridgeLaunchCancelable
      ? {
          label: "Cancel launch",
          mode: "cancel-launch",
        }
      : null,
    deactivateAction:
      !bridgeDeactivationComplete && hasManagedTeardownTarget
        ? {
            label: "Deactivate",
            mode: "managed-teardown",
            queueRemoteShutdown: true,
            stepperVariant: "deactivate",
          }
        : !bridgeDeactivationComplete && hasOverrideCleanupTarget
          ? {
              label: "Detach bridge",
              mode: "detach-bridge",
              queueRemoteShutdown: false,
              stepperVariant: "clear-state",
            }
          : null,
  };
};

export const shouldAutoResumeIbkrCredentials = ({
  activationId = null,
  attemptedActivationId = null,
  directActivationShouldReplaceCurrentLaunch = false,
  gatewayConnected = false,
  launchCancelInFlight = false,
  loginEnvelopeSubmitted = false,
  loginHandoffReady = false,
  managementToken = null,
  password = "",
  runtimeActivationActive = false,
  username = "",
} = {}) => {
  const normalizedUsername = String(username || "").trim();
  return Boolean(
    !directActivationShouldReplaceCurrentLaunch &&
      !gatewayConnected &&
      !launchCancelInFlight &&
      activationId &&
      attemptedActivationId !== activationId &&
      managementToken &&
      normalizedUsername &&
      password &&
      runtimeActivationActive &&
      loginHandoffReady &&
      loginEnvelopeSubmitted !== true,
  );
};

export const shouldClearIbkrPasswordAfterCredentialSubmit = ({
  clearPassword = false,
  credentialsDelivered = false,
} = {}) => Boolean(clearPassword || credentialsDelivered);
