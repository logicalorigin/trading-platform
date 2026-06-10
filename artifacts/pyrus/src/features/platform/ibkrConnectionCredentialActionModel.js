export const resolveIbkrCredentialActionState = ({
  activationActive = false,
  activationId = null,
  directActivationShouldReplaceCurrentLaunch = false,
  gatewayConnected = false,
  launchInFlight = false,
  managementToken = null,
  runtimeActivationActive = false,
} = {}) => {
  const activeLaunch = Boolean(
    activationActive || launchInFlight || runtimeActivationActive,
  );
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

export const shouldAutoResumeIbkrCredentials = ({
  activationId = null,
  attemptedActivationId = null,
  directActivationShouldReplaceCurrentLaunch = false,
  gatewayConnected = false,
  launchCancelInFlight = false,
  loginEnvelopeSubmitAttemptCount = 0,
  loginHandoffReady = false,
  loginKeyReadCount = 0,
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
      Number(loginKeyReadCount || 0) > 0 &&
      Number(loginEnvelopeSubmitAttemptCount || 0) === 0,
  );
};

export const shouldClearIbkrPasswordAfterCredentialSubmit = ({
  clearPassword = false,
  credentialsDelivered = false,
} = {}) => Boolean(clearPassword || credentialsDelivered);
